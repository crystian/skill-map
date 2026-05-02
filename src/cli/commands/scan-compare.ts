/**
 * `sm scan compare-with <dump> [roots...]` — read-only delta between a
 * fresh scan and a saved `ScanResult` JSON dump.
 *
 * Step 8.2 originally shipped this surface as `sm scan --compare-with
 * <dump>`. It got promoted to a proper sub-verb pre-1.0 (M1 review
 * finding) because the flag combinatorics were getting noisy: the
 * compare-with flow disables persistence, ignores `--changed`,
 * `--no-built-ins`, `--allow-empty`, conflicts with `--watch`. Every
 * one of those checks lived in `scan.ts`'s `execute()` as a runtime
 * guard against the wrong-flag-combo. As a verb the conflicts are
 * structural: a flag that does not belong to `scan compare-with` cannot
 * be passed in the first place.
 *
 * Flow:
 *
 *   1. Load the dump from `<dump>` and AJV-validate it against
 *      `scan-result.schema.json`. A missing file, malformed JSON, or
 *      a schema-violating dump → exit 2.
 *   2. Run a fresh scan in memory using the same wiring as `sm scan`
 *      (built-ins, plugin runtime gated by `--no-plugins`, layered
 *      config + ignore filter). The result is NOT persisted — this
 *      verb is read-only.
 *   3. Compute the delta against the dump and emit it.
 *
 * Exit codes:
 *   0  empty delta — current state matches the dump.
 *   1  delta has at least one added / removed / changed item.
 *   2  operational error (dump load failure, scan failure, config
 *      load failure).
 *
 * Typical use case: CI guard against drift. Freeze a baseline at merge
 * to main (`sm scan --json > .skill-map/baseline.json`); on every PR,
 * `sm scan compare-with .skill-map/baseline.json` — exit 1 trips the
 * build before the drift lands.
 */

import { existsSync, readFileSync } from 'node:fs';

import { Command, Option } from 'clipanion';

import { computeScanDelta, createKernel, isEmptyDelta, runScan } from '../../kernel/index.js';
import type { IScanDelta, ScanResult } from '../../kernel/index.js';
import { listBuiltIns } from '../../built-in-plugins/built-ins.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { loadConfig } from '../../kernel/config/loader.js';
import { buildIgnoreFilter, readIgnoreFileText } from '../../kernel/scan/ignore.js';
import { tx } from '../../kernel/util/tx.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { SCAN_TEXTS } from '../i18n/scan.texts.js';
import { createCliProgressEmitter } from '../util/cli-progress-emitter.js';
import { ExitCode } from '../util/exit-codes.js';
import { formatErrorMessage } from '../util/error-reporter.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import {
  composeScanExtensions,
  emptyPluginRuntime,
  filterBuiltInManifests,
  loadPluginRuntime,
} from '../util/plugin-runtime.js';

export class ScanCompareCommand extends Command {
  static override paths = [['scan', 'compare-with']];

  static override usage = Command.Usage({
    category: 'Scan',
    description:
      'Run a fresh scan in memory and emit a delta against the saved ScanResult dump at <dump>. Read-only.',
    details: `
      Loads the JSON dump at <dump>, AJV-validates it against
      scan-result.schema.json, runs a fresh scan over [roots...]
      (default: current directory) using the same pipeline as 'sm scan'
      (built-ins + plugin runtime + layered config + ignore filter),
      and emits the delta between the dump and the fresh scan. The DB
      is NEVER touched — this verb is read-only.

      Exit 0 on empty delta (state matches the dump), exit 1 on any
      drift (added / removed / changed nodes, links, or issues), exit
      2 on operational error (missing or malformed dump, schema
      violation, config / scan failure).

      Typical use case: CI guard. Freeze a baseline at merge to main:
        sm scan --json > .skill-map/baseline.json
      And on every PR, before the merge:
        sm scan compare-with .skill-map/baseline.json
      Any drift trips the build.
    `,
    examples: [
      ['Compare against a baseline', '$0 scan compare-with .skill-map/baseline.json'],
      ['Compare a specific subtree', '$0 scan compare-with baseline.json src/'],
      ['JSON output for tooling', '$0 scan compare-with baseline.json --json'],
    ],
  });

  dump = Option.String({ required: true });
  roots = Option.Rest({ name: 'roots' });
  json = Option.Boolean('--json', false, {
    description: 'Emit the IScanDelta document as JSON on stdout.',
  });
  noTokens = Option.Boolean('--no-tokens', false, {
    description: 'Skip per-node token counts during the fresh scan.',
  });
  strict = Option.Boolean('--strict', false, {
    description:
      'Promote layered-config warnings and frontmatter-validation findings from warn to error.',
  });
  noPlugins = Option.Boolean('--no-plugins', false, {
    description: 'Skip drop-in plugin discovery.',
  });

  // Cyclomatic count comes from CLI ergonomics: 3 distinct try/catch
  // (dump load, config load, scan run) + flag-default handling + ternary
  // for the JSON branch. The pure pieces already live in
  // `loadAndValidateDump` and `computeScanDelta`.
  // eslint-disable-next-line complexity
  async execute(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const roots = this.roots.length > 0 ? this.roots : ['.'];

    // 1. Load + validate the dump. Errors here are operational (exit 2)
    //    — a missing file, malformed JSON, or a schema-violating dump
    //    are all problems with the caller's input, not with the project
    //    state.
    let prior: ScanResult;
    try {
      prior = loadAndValidateDump(this.dump);
    } catch (err) {
      const message = formatErrorMessage(err);
      this.context.stderr.write(tx(SCAN_TEXTS.compareErrorPrefix, { message }));
      return ExitCode.Error;
    }

    // 2. Run a fresh scan with the same wiring as the normal `sm scan`
    //    code path. Skip persistence — this verb is read-only.
    const kernel = createKernel();
    const pluginRuntime = this.noPlugins
      ? emptyPluginRuntime()
      : await loadPluginRuntime({ scope: 'project' });
    for (const warn of pluginRuntime.warnings) this.context.stderr.write(`${warn}\n`);
    const enabledBuiltIns = filterBuiltInManifests(listBuiltIns(), pluginRuntime.resolveEnabled);
    for (const manifest of enabledBuiltIns) kernel.registry.register(manifest);
    for (const manifest of pluginRuntime.manifests) kernel.registry.register(manifest);

    let cfg;
    try {
      const loaded = loadConfig({ scope: 'project', strict: this.strict, cwd: ctx.cwd, homedir: ctx.homedir });
      // Mirror `cli/commands/config.ts`: surface the layered loader's
      // accumulated warnings to stderr so the user sees malformed JSON /
      // unknown keys here too. Without this forward the verb silently
      // discarded them.
      for (const w of loaded.warnings) this.context.stderr.write(w + '\n');
      cfg = loaded.effective;
    } catch (err) {
      const message = formatErrorMessage(err);
      this.context.stderr.write(tx(SCAN_TEXTS.compareErrorPrefix, { message }));
      return ExitCode.Error;
    }
    const ignoreFileText = readIgnoreFileText(ctx.cwd);
    const ignoreFilterOpts: Parameters<typeof buildIgnoreFilter>[0] = {};
    if (cfg.ignore.length > 0) ignoreFilterOpts.configIgnore = cfg.ignore;
    if (ignoreFileText !== undefined) ignoreFilterOpts.ignoreFileText = ignoreFileText;
    const ignoreFilter = buildIgnoreFilter(ignoreFilterOpts);
    const effectiveStrict = this.strict || cfg.scan.strict === true;

    const composedExtensions = composeScanExtensions({ noBuiltIns: false, pluginRuntime });
    let current: ScanResult;
    try {
      const compareRunOpts: Parameters<typeof runScan>[1] = {
        roots,
        scope: 'project',
        tokenize: !this.noTokens,
        ignoreFilter,
        strict: effectiveStrict,
        emitter: createCliProgressEmitter(this.context.stderr),
      };
      if (composedExtensions) compareRunOpts.extensions = composedExtensions;
      current = await runScan(kernel, compareRunOpts);
    } catch (err) {
      const message = formatErrorMessage(err);
      this.context.stderr.write(tx(SCAN_TEXTS.compareErrorPrefix, { message }));
      return ExitCode.Error;
    }

    // 3. Compute + render the delta. Exit 1 iff something diverged.
    const delta = computeScanDelta(prior, current, this.dump);
    const exitCode = isEmptyDelta(delta) ? ExitCode.Ok : ExitCode.Issues;

    if (this.json) {
      this.context.stdout.write(JSON.stringify(delta) + '\n');
      return exitCode;
    }
    this.context.stdout.write(renderDeltaHuman(delta));
    return exitCode;
  }
}

function loadAndValidateDump(path: string): ScanResult {
  if (!existsSync(path)) {
    throw new Error(tx(SCAN_TEXTS.compareDumpNotFound, { path }));
  }
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    const message = formatErrorMessage(err);
    throw new Error(tx(SCAN_TEXTS.compareDumpReadFailed, { path, message }), { cause: err });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = formatErrorMessage(err);
    throw new Error(tx(SCAN_TEXTS.compareDumpInvalidJson, { message }), { cause: err });
  }
  const validators = loadSchemaValidators();
  const result = validators.validate<ScanResult>('scan-result', parsed);
  if (!result.ok) {
    throw new Error(tx(SCAN_TEXTS.compareDumpSchemaMismatch, { errors: result.errors }));
  }
  return result.data;
}

function renderDeltaHuman(delta: IScanDelta): string {
  const out: string[] = [];
  const totalAdded = delta.nodes.added.length + delta.links.added.length + delta.issues.added.length;
  const totalRemoved = delta.nodes.removed.length + delta.links.removed.length + delta.issues.removed.length;
  const totalChanged = delta.nodes.changed.length;

  out.push(
    tx(SCAN_TEXTS.compareDeltaSummary, {
      comparedWith: delta.comparedWith,
      nodesAdded: delta.nodes.added.length,
      nodesRemoved: delta.nodes.removed.length,
      nodesChanged: delta.nodes.changed.length,
      linksAdded: delta.links.added.length,
      linksRemoved: delta.links.removed.length,
      issuesAdded: delta.issues.added.length,
      issuesRemoved: delta.issues.removed.length,
    }),
  );

  if (totalAdded === 0 && totalRemoved === 0 && totalChanged === 0) {
    out.push('', SCAN_TEXTS.compareDeltaNoDifferences);
    return out.join('\n') + '\n';
  }

  out.push(...renderDeltaNodes(delta.nodes));
  out.push(...renderDeltaLinks(delta.links));
  out.push(...renderDeltaIssues(delta.issues));
  return out.join('\n') + '\n';
}

function renderDeltaNodes(nodes: IScanDelta['nodes']): string[] {
  if (nodes.added.length + nodes.removed.length + nodes.changed.length === 0) return [];
  const lines: string[] = ['', SCAN_TEXTS.compareDeltaNodesHeader];
  for (const n of nodes.added) {
    lines.push(tx(SCAN_TEXTS.compareDeltaNodeAdded, {
      path: sanitizeForTerminal(n.path),
      kind: sanitizeForTerminal(n.kind),
    }));
  }
  for (const n of nodes.removed) {
    lines.push(tx(SCAN_TEXTS.compareDeltaNodeRemoved, {
      path: sanitizeForTerminal(n.path),
      kind: sanitizeForTerminal(n.kind),
    }));
  }
  for (const c of nodes.changed) {
    lines.push(tx(SCAN_TEXTS.compareDeltaNodeChanged, {
      path: sanitizeForTerminal(c.after.path),
      reason: c.reason,
    }));
  }
  return lines;
}

function renderDeltaLinks(links: IScanDelta['links']): string[] {
  if (links.added.length + links.removed.length === 0) return [];
  const lines: string[] = ['', SCAN_TEXTS.compareDeltaLinksHeader];
  for (const l of links.added) {
    lines.push(tx(SCAN_TEXTS.compareDeltaLinkAdded, {
      source: sanitizeForTerminal(l.source),
      kind: sanitizeForTerminal(l.kind),
      target: sanitizeForTerminal(l.target),
    }));
  }
  for (const l of links.removed) {
    lines.push(tx(SCAN_TEXTS.compareDeltaLinkRemoved, {
      source: sanitizeForTerminal(l.source),
      kind: sanitizeForTerminal(l.kind),
      target: sanitizeForTerminal(l.target),
    }));
  }
  return lines;
}

function renderDeltaIssues(issues: IScanDelta['issues']): string[] {
  if (issues.added.length + issues.removed.length === 0) return [];
  const lines: string[] = ['', SCAN_TEXTS.compareDeltaIssuesHeader];
  for (const i of issues.added) {
    lines.push(tx(SCAN_TEXTS.compareDeltaIssueAdded, {
      severity: i.severity,
      ruleId: sanitizeForTerminal(i.ruleId),
      message: sanitizeForTerminal(i.message),
    }));
  }
  for (const i of issues.removed) {
    lines.push(tx(SCAN_TEXTS.compareDeltaIssueRemoved, {
      severity: i.severity,
      ruleId: sanitizeForTerminal(i.ruleId),
      message: sanitizeForTerminal(i.message),
    }));
  }
  return lines;
}
