import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Command, Option, type BaseContext } from 'clipanion';
import type { Kysely } from 'kysely';

import { computeScanDelta, createKernel, isEmptyDelta, runScan, runScanWithRenames } from '../../kernel/index.js';
import type { IScanDelta, RenameOp, ScanResult } from '../../kernel/index.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { listBuiltIns } from '../../extensions/built-ins.js';
import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import type { IDatabase } from '../../kernel/adapters/sqlite/schema.js';
import { persistScanResult } from '../../kernel/adapters/sqlite/scan-persistence.js';
import { loadScanResult } from '../../kernel/adapters/sqlite/scan-load.js';
import { loadConfig } from '../../kernel/config/loader.js';
import { buildIgnoreFilter, readIgnoreFileText } from '../../kernel/scan/ignore.js';
import {
  composeScanExtensions,
  emptyPluginRuntime,
  loadPluginRuntime,
  type IPluginRuntimeBundle,
} from '../util/plugin-runtime.js';
import { runWatchLoop } from './watch.js';

const DEFAULT_PROJECT_DB = '.skill-map/skill-map.db';

/**
 * `sm scan [roots...] [--json] [--no-built-ins] [--no-plugins] [-n|--dry-run] [--changed]`
 *
 * Scans the given roots using the built-in extension set (claude adapter,
 * 4 detectors, 3 rules) plus any drop-in plugin extensions discovered
 * under `.skill-map/plugins/` and `~/.skill-map/plugins/` (Step 9.1).
 * The registry is populated with manifest rows so introspection
 * (`sm help`, `sm plugins list`) sees what's active; the orchestrator
 * consumes the callable instances separately.
 *
 * Result is persisted into `<cwd>/.skill-map/skill-map.db` (auto-migrated)
 * with replace-all semantics across `scan_nodes / scan_links / scan_issues`.
 *
 * - `--no-built-ins` skips both the pipeline and the persistence step
 *   (kernel-empty-boot parity); cannot be combined with `--changed`.
 * - `--no-plugins` skips drop-in plugin discovery entirely. Only the
 *   built-in set runs. Pairs with `--no-built-ins` for a fully empty
 *   pipeline (e.g. for the `kernel-empty-boot` conformance contract).
 *   Failed / incompatible plugins are logged to stderr and skipped;
 *   the scan never aborts on a bad plugin.
 * - `-n` / `--dry-run` runs the scan in-memory and skips ALL DB writes.
 *   Combined with `--changed` it still opens the DB read-side to load
 *   the prior snapshot, then exits without writing.
 * - `--changed` performs an incremental scan against the persisted prior
 *   snapshot. Reuses unchanged nodes (matched by path + bodyHash +
 *   frontmatterHash) and reprocesses new / modified files only. If the
 *   DB doesn't exist or the prior snapshot is empty, degrades to a full
 *   scan and prints a one-liner to stderr.
 */
export class ScanCommand extends Command {
  static override paths = [['scan']];

  static override usage = Command.Usage({
    category: 'Scan',
    description: 'Scan roots for markdown nodes, run detectors and rules.',
    details: `
      Walks the given roots with the built-in claude adapter, runs the
      frontmatter / slash / at-directive / external-url-counter
      detectors per node, then the trigger-collision / broken-ref /
      superseded rules over the full graph. Emits a ScanResult
      conforming to scan-result.schema.json.

      The result is persisted into <cwd>/.skill-map/skill-map.db
      (replace-all over scan_nodes/links/issues). Pass --no-built-ins
      to skip both the pipeline and the persistence step (kernel-empty-boot
      parity).

      Pass -n / --dry-run to skip every DB operation (the result is
      computed in memory and emitted to stdout). Pass --changed to load
      the prior snapshot from the DB, reuse unchanged nodes, and only
      reprocess new / modified files.
    `,
    examples: [
      ['Scan the current directory', '$0 scan'],
      ['Scan multiple roots and print JSON', '$0 scan ./docs ./skills --json'],
      ['Empty-pipeline conformance', '$0 scan --no-built-ins --json'],
      ['Dry-run, no DB writes', '$0 scan -n --json'],
      ['Incremental scan against prior snapshot', '$0 scan --changed'],
      ['What would the next incremental scan persist?', '$0 scan --changed -n --json'],
    ],
  });

  roots = Option.Rest({ name: 'roots' });
  json = Option.Boolean('--json', false, {
    description: 'Emit a machine-readable ScanResult document on stdout.',
  });
  noBuiltIns = Option.Boolean('--no-built-ins', false, {
    description: 'Skip the built-in extension set. Yields a zero-filled ScanResult (kernel-empty-boot parity); skips DB persistence.',
  });
  noPlugins = Option.Boolean('--no-plugins', false, {
    description: 'Skip drop-in plugin discovery. Only the built-in set runs. Combine with --no-built-ins for a fully empty pipeline.',
  });
  noTokens = Option.Boolean('--no-tokens', false, {
    description: 'Skip per-node token counts (cl100k_base BPE). Leaves node.tokens undefined; spec-valid since the field is optional.',
  });
  dryRun = Option.Boolean('-n,--dry-run', false, {
    description: 'Run the scan in memory and skip every DB write. Combined with --changed, still opens the DB read-side to load the prior snapshot.',
  });
  changed = Option.Boolean('--changed', false, {
    description: 'Incremental scan: reuse unchanged nodes from the persisted prior snapshot. Degrades to a full scan if no prior snapshot exists.',
  });
  allowEmpty = Option.Boolean('--allow-empty', false, {
    description: 'Allow a zero-result scan to wipe an already-populated DB (replace-all replace by zero rows). Off by default to avoid the typo-trap where an invalid root silently clears your data.',
  });
  strict = Option.Boolean('--strict', false, {
    description: 'Promote frontmatter-validation findings from warn to error (exit code 1 on any violation). Overrides scan.strict from config when both are set.',
  });
  watch = Option.Boolean('--watch', false, {
    description: 'Long-running mode: watch the roots and trigger an incremental scan after each debounced batch of filesystem events. Alias of `sm watch`.',
  });
  compareWith = Option.String('--compare-with', {
    required: false,
    description: 'Run a fresh scan in memory and emit a delta against the saved ScanResult dump at <path>. Does NOT touch the DB. Exit 0 on empty delta, 1 if anything diverges, 2 on dump load / validation errors.',
  });

  async execute(): Promise<number> {
    // --- watch alias -----------------------------------------------------
    // `--watch` is a thin alias for the `sm watch` verb. We delegate to
    // the shared loop so there is exactly one watcher implementation.
    // Combining `--watch` with one-shot-only flags is incoherent — the
    // watcher always persists incrementally over the prior snapshot.
    if (this.watch) {
      if (this.noBuiltIns || this.dryRun || this.changed || this.allowEmpty || this.compareWith !== undefined) {
        this.context.stderr.write(
          '--watch cannot be combined with --no-built-ins, --dry-run, --changed, --allow-empty, or --compare-with.\n',
        );
        return 2;
      }
      const roots = this.roots.length > 0 ? this.roots : ['.'];
      return runWatchLoop({
        roots,
        json: this.json,
        noTokens: this.noTokens,
        strict: this.strict,
        noPlugins: this.noPlugins,
        context: this.context,
      });
    }

    // --- compare-with branch --------------------------------------------
    // `--compare-with` runs a fresh scan in memory, computes a delta
    // against the saved dump, and emits a report. Never persists. Combo
    // with `--watch` is rejected up-front (different lifecycles); combo
    // with `--changed` is incoherent (the comparison itself is the diff,
    // there is no prior snapshot to fold in); combo with `--no-built-ins`
    // would produce a trivially-empty current snapshot, making the
    // delta meaningless. `--dry-run` is an implicit no-op (we already
    // skip persistence).
    if (this.compareWith !== undefined) {
      if (this.changed || this.noBuiltIns || this.allowEmpty) {
        this.context.stderr.write(
          '--compare-with cannot be combined with --changed, --no-built-ins, or --allow-empty.\n',
        );
        return 2;
      }
      return runCompareWith({
        comparedWithPath: this.compareWith,
        roots: this.roots.length > 0 ? this.roots : ['.'],
        json: this.json,
        noTokens: this.noTokens,
        strict: this.strict,
        noPlugins: this.noPlugins,
        context: this.context,
      });
    }

    // --- flag combinatorics -------------------------------------------------
    // `--no-built-ins` zero-fills the pipeline; combining it with
    // `--changed` (which loads a prior to merge against) is incoherent.
    if (this.changed && this.noBuiltIns) {
      this.context.stderr.write(
        '--changed and --no-built-ins cannot be combined: --no-built-ins yields a zero-filled ScanResult, leaving nothing to merge against.\n',
      );
      return 2;
    }

    const kernel = createKernel();
    const roots = this.roots.length > 0 ? this.roots : ['.'];

    // --- plugin runtime --------------------------------------------------
    // Step 9.1 wires plugin discovery into the scan pipeline. Failed
    // plugins (`incompatible-spec` / `invalid-manifest` / `load-error`)
    // emit one stderr line each but never abort the scan — the kernel
    // keeps booting on a bad plugin. Disabled plugins are silently
    // skipped; their `sm plugins list` row already conveys intent.
    //
    // `--no-plugins` short-circuits discovery entirely (no DB / config
    // reads, no FS walk under `.skill-map/plugins/`). Pairs with
    // `--no-built-ins` for the kernel-empty-boot conformance posture.
    const pluginRuntime = this.noPlugins
      ? emptyPluginRuntime()
      : await loadPluginRuntime({ scope: 'project' });
    for (const warn of pluginRuntime.warnings) {
      this.context.stderr.write(`${warn}\n`);
    }

    const extensions = composeScanExtensions({
      noBuiltIns: this.noBuiltIns,
      pluginRuntime,
    });
    if (!this.noBuiltIns) {
      for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
    }
    for (const manifest of pluginRuntime.manifests) kernel.registry.register(manifest);

    // --- prior snapshot --------------------------------------------------
    // Step 5.8 decoupled "prior for rename detection" from "prior for
    // cache reuse". Now: ALWAYS load the prior when the DB exists and
    // we plan to walk (i.e. not under `--no-built-ins`). The orchestrator
    // uses `priorSnapshot` to fire the rename heuristic (every scan that
    // can detect deletes / additions), and uses `enableCache` —
    // independently — to decide whether to skip detectors on
    // hash-matching nodes (`--changed` only).
    //
    // When `--changed` is set but no prior is found, we still warn so
    // the user gets feedback that the incremental flag had nothing to
    // act on. Without `--changed`, an empty / missing prior is silent
    // (it's the normal first-scan path).
    const dbPath = resolve(process.cwd(), DEFAULT_PROJECT_DB);
    let priorSnapshot: ScanResult | null = null;
    if (!this.noBuiltIns && existsSync(dbPath)) {
      const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
      await adapter.init();
      try {
        const loaded = await loadScanResult(adapter.db);
        if (loaded.nodes.length > 0) {
          priorSnapshot = loaded;
        }
      } finally {
        await adapter.close();
      }
    }
    if (this.changed && priorSnapshot === null) {
      this.context.stderr.write(
        '--changed: no prior snapshot found; running full scan.\n',
      );
    }

    // Compose the ignore filter from layered config + .skill-mapignore.
    // Built-in defaults are always pre-loaded by buildIgnoreFilter so
    // `.git`, `node_modules`, `dist`, `.tmp`, `.skill-map` are skipped
    // even on a fresh scope without any user config.
    //
    // `--strict` (Step 6.7 + the .strict-config unification) propagates
    // to BOTH validation surfaces: the layered loader (so a bogus key
    // in settings.json fails the scan instead of being skipped with a
    // warning) and the per-node frontmatter validator (so any node
    // emitting a `frontmatter-invalid` issue trips exit 1).
    let cfg;
    try {
      cfg = loadConfig({ scope: 'project', strict: this.strict }).effective;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.context.stderr.write(`sm scan: ${message}\n`);
      return 2;
    }
    const ignoreFileText = readIgnoreFileText(process.cwd());
    const ignoreFilterOpts: Parameters<typeof buildIgnoreFilter>[0] = {};
    if (cfg.ignore.length > 0) ignoreFilterOpts.configIgnore = cfg.ignore;
    if (ignoreFileText !== undefined) ignoreFilterOpts.ignoreFileText = ignoreFileText;
    const ignoreFilter = buildIgnoreFilter(ignoreFilterOpts);

    // Frontmatter strict: --strict on the CLI takes precedence; scan.strict
    // in config provides the team default. (Loader strict above is gated
    // strictly by --strict — config can't promote a loader warning to an
    // error transparently because the warning lives at config-load time.)
    const strict = this.strict || cfg.scan.strict === true;

    const runOptions: Parameters<typeof runScan>[1] = {
      roots,
      // `--global` for `sm scan` lands in Step 6 (config + onboarding).
      // The orchestrator already accepts the scope override; the CLI
      // surface defaults to `'project'` until the flag is wired.
      scope: 'project',
      tokenize: !this.noTokens,
      ignoreFilter,
      strict,
    };
    if (extensions) runOptions.extensions = extensions;
    if (priorSnapshot) {
      runOptions.priorSnapshot = priorSnapshot;
      // Cache reuse is opt-in via `--changed`. With a prior loaded but
      // no `--changed`, the rename heuristic still fires but every file
      // re-walks through detectors deterministically.
      runOptions.enableCache = this.changed;
    }

    // Surface root-validation errors from the orchestrator as clean
    // operational failures (exit 2) rather than crash-trace dumps.
    // `runScan` validates each root exists as a directory up front;
    // those messages start with `runScan: root path ...`.
    let result: ScanResult;
    let renameOps: RenameOp[];
    try {
      const ran = await runScanWithRenames(kernel, runOptions);
      result = ran.result;
      renameOps = ran.renameOps;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.context.stderr.write(`sm scan: ${message}\n`);
      return 2;
    }

    // --- persist (skipped under --no-built-ins or --dry-run) ---------------
    let persistedTo: string | null = null;
    const willPersist = !this.noBuiltIns && !this.dryRun;
    if (willPersist) {
      persistedTo = dbPath;
      const adapter = new SqliteStorageAdapter({ databasePath: persistedTo });
      await adapter.init();
      try {
        // Defensive guard: refuse to wipe a populated DB with a
        // zero-result scan unless `--allow-empty` is passed. Belt-and-
        // braces with the orchestrator-level root validation: even if
        // a future code path or weird edge case yields a zero-filled
        // ScanResult, an existing populated snapshot survives. The
        // natural case of "empty repo on first scan" is not affected
        // (DB starts empty, scan returns 0 rows, persist proceeds).
        if (result.stats.nodesCount === 0 && !this.allowEmpty) {
          const existing = await countExistingScanRows(adapter.db);
          if (existing > 0) {
            this.context.stderr.write(
              `sm scan: refusing to wipe a populated DB (${existing} rows in scan_*) ` +
                `with a zero-result scan. Pass --allow-empty to override. ` +
                `If this is unexpected, double-check the root paths.\n`,
            );
            return 2;
          }
        }
        await persistScanResult(adapter.db, result, renameOps);
      } finally {
        await adapter.close();
      }
    }

    // Exit code mirrors `sm check` (and spec/cli-contract.md §Exit codes):
    // 1 only when at least one issue is at `error` severity. Warns / infos
    // do not fail the verb. The exit code is independent of `--json`.
    const exitCode = result.issues.some((i) => i.severity === 'error') ? 1 : 0;

    if (this.json) {
      this.context.stdout.write(JSON.stringify(result) + '\n');
      return exitCode;
    }

    this.context.stdout.write(
      `Scanned ${result.roots.length} root(s) in ${result.stats.durationMs}ms — ` +
        `${result.stats.nodesCount} nodes, ${result.stats.linksCount} links, ` +
        `${result.stats.issuesCount} issues.\n`,
    );
    if (persistedTo) {
      this.context.stdout.write(`Persisted to ${persistedTo}\n`);
    } else if (this.dryRun && !this.noBuiltIns) {
      this.context.stdout.write(
        `Would persist ${result.stats.nodesCount} nodes / ${result.stats.linksCount} links / ${result.stats.issuesCount} issues to ${dbPath} (dry-run).\n`,
      );
    }
    return exitCode;
  }
}

/**
 * Sum of `scan_nodes + scan_links + scan_issues` row counts. Used by the
 * Layer-3 defensive guard in `ScanCommand.execute` to detect that a
 * zero-result scan is about to wipe a populated snapshot. Three small
 * `COUNT(*)` queries on tables that have at most a few thousand rows
 * each — cheap enough to skip a UNION ALL.
 */
async function countExistingScanRows(db: Kysely<IDatabase>): Promise<number> {
  const rows = await Promise.all([
    db.selectFrom('scan_nodes').select((eb) => eb.fn.countAll<number>().as('c')).executeTakeFirst(),
    db.selectFrom('scan_links').select((eb) => eb.fn.countAll<number>().as('c')).executeTakeFirst(),
    db.selectFrom('scan_issues').select((eb) => eb.fn.countAll<number>().as('c')).executeTakeFirst(),
  ]);
  let total = 0;
  for (const r of rows) total += Number(r?.c ?? 0);
  return total;
}

// ---------------------------------------------------------------------------
// `--compare-with` (Step 8.2)
// ---------------------------------------------------------------------------
//
// Loads the dump JSON at `comparedWithPath`, validates it against
// `scan-result.schema.json`, runs a fresh scan in memory using the same
// pipeline as `sm scan` (built-ins, ignore filter, layered config), and
// emits the delta between the two snapshots. Never touches the DB.

interface IRunCompareWithOptions {
  comparedWithPath: string;
  roots: string[];
  json: boolean;
  noTokens: boolean;
  strict: boolean;
  noPlugins: boolean;
  context: BaseContext;
}

async function runCompareWith(opts: IRunCompareWithOptions): Promise<number> {
  const { comparedWithPath, roots, json, noTokens, strict, noPlugins, context } = opts;

  // 1. Load + validate the dump. Errors here are operational (exit 2) —
  //    a missing file, malformed JSON, or a schema-violating dump are
  //    all problems with the caller's input, not with the project state.
  let prior: ScanResult;
  try {
    prior = loadAndValidateDump(comparedWithPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    context.stderr.write(`sm scan --compare-with: ${message}\n`);
    return 2;
  }

  // 2. Run a fresh scan with the same wiring as the normal `sm scan`
  //    code path (Step 9.1: plugin runtime included, gated by
  //    `--no-plugins`). Skip persistence — the verb's contract is
  //    read-only.
  const kernel = createKernel();
  for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
  const pluginRuntime = noPlugins
    ? emptyPluginRuntime()
    : await loadPluginRuntime({ scope: 'project' });
  for (const warn of pluginRuntime.warnings) context.stderr.write(`${warn}\n`);
  for (const manifest of pluginRuntime.manifests) kernel.registry.register(manifest);

  let cfg;
  try {
    cfg = loadConfig({ scope: 'project', strict }).effective;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    context.stderr.write(`sm scan --compare-with: ${message}\n`);
    return 2;
  }
  const ignoreFileText = readIgnoreFileText(process.cwd());
  const ignoreFilterOpts: Parameters<typeof buildIgnoreFilter>[0] = {};
  if (cfg.ignore.length > 0) ignoreFilterOpts.configIgnore = cfg.ignore;
  if (ignoreFileText !== undefined) ignoreFilterOpts.ignoreFileText = ignoreFileText;
  const ignoreFilter = buildIgnoreFilter(ignoreFilterOpts);
  const effectiveStrict = strict || cfg.scan.strict === true;

  const composedExtensions = composeScanExtensions({ noBuiltIns: false, pluginRuntime });
  let current: ScanResult;
  try {
    const compareRunOpts: Parameters<typeof runScan>[1] = {
      roots,
      scope: 'project',
      tokenize: !noTokens,
      ignoreFilter,
      strict: effectiveStrict,
    };
    if (composedExtensions) compareRunOpts.extensions = composedExtensions;
    current = await runScan(kernel, compareRunOpts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    context.stderr.write(`sm scan --compare-with: ${message}\n`);
    return 2;
  }

  // 3. Compute + render the delta. Exit 1 iff something diverged; this
  //    is the CI-friendly contract — wire `sm scan --compare-with
  //    .skill-map/baseline.json` into a pre-commit / pre-merge hook
  //    and any drift trips the build.
  const delta = computeScanDelta(prior, current, comparedWithPath);
  const exitCode = isEmptyDelta(delta) ? 0 : 1;

  if (json) {
    context.stdout.write(JSON.stringify(delta) + '\n');
    return exitCode;
  }
  context.stdout.write(renderDeltaHuman(delta));
  return exitCode;
}

function loadAndValidateDump(path: string): ScanResult {
  if (!existsSync(path)) {
    throw new Error(`dump file not found: ${path}`);
  }
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`could not read dump file ${path}: ${message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`dump file is not valid JSON: ${message}`);
  }
  const validators = loadSchemaValidators();
  const result = validators.validate<ScanResult>('scan-result', parsed);
  if (!result.ok) {
    throw new Error(`dump does not conform to scan-result.schema.json: ${result.errors}`);
  }
  return result.data;
}

function renderDeltaHuman(delta: IScanDelta): string {
  const out: string[] = [];
  const totalAdded = delta.nodes.added.length + delta.links.added.length + delta.issues.added.length;
  const totalRemoved = delta.nodes.removed.length + delta.links.removed.length + delta.issues.removed.length;
  const totalChanged = delta.nodes.changed.length;

  out.push(
    `Delta vs ${delta.comparedWith}: ` +
      `${delta.nodes.added.length} nodes added, ${delta.nodes.removed.length} removed, ${delta.nodes.changed.length} changed; ` +
      `${delta.links.added.length} links added, ${delta.links.removed.length} removed; ` +
      `${delta.issues.added.length} issues added, ${delta.issues.removed.length} removed.`,
  );

  if (totalAdded === 0 && totalRemoved === 0 && totalChanged === 0) {
    out.push('', '(no differences)');
    return out.join('\n') + '\n';
  }

  if (delta.nodes.added.length + delta.nodes.removed.length + delta.nodes.changed.length > 0) {
    out.push('', '## nodes');
    for (const n of delta.nodes.added) out.push(`+ ${n.path} (${n.kind})`);
    for (const n of delta.nodes.removed) out.push(`- ${n.path} (${n.kind})`);
    for (const c of delta.nodes.changed) out.push(`~ ${c.after.path} (${c.reason} changed)`);
  }

  if (delta.links.added.length + delta.links.removed.length > 0) {
    out.push('', '## links');
    for (const l of delta.links.added) out.push(`+ ${l.source} --${l.kind}--> ${l.target}`);
    for (const l of delta.links.removed) out.push(`- ${l.source} --${l.kind}--> ${l.target}`);
  }

  if (delta.issues.added.length + delta.issues.removed.length > 0) {
    out.push('', '## issues');
    for (const i of delta.issues.added) out.push(`+ [${i.severity}] ${i.ruleId}: ${i.message}`);
    for (const i of delta.issues.removed) out.push(`- [${i.severity}] ${i.ruleId}: ${i.message}`);
  }

  return out.join('\n') + '\n';
}
