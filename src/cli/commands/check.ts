/**
 * `sm check [--json] [-n <node.path>] [--rules <ids>] [--include-prob] [--async]`
 *
 * Print every current issue from `scan_issues`. Equivalent to
 * `sm scan --json | jq '.issues'` but reads from the persisted snapshot,
 * so it skips the entire walk + extract + rule pipeline.
 *
 * Filters (orthogonal):
 *   `-n <node.path>`     restrict to issues whose nodeIds include the path.
 *   `--rules <ids>`      comma-separated qualified rule ids (e.g.
 *                         `core/validate-all,core/broken-ref`); restrict to
 *                         issues whose `ruleId` matches any entry. Both
 *                         qualified and short ids match — the verb compares
 *                         on suffix when the entry has no `<plugin>/` prefix.
 *
 * Probabilistic Rules (spec § A.7):
 *   `--include-prob`     opt-in flag. Default unchanged: deterministic only,
 *                         CI-safe. With the flag, the verb loads the plugin
 *                         runtime, finds Rules with `mode === 'probabilistic'`
 *                         (filtered by `--rules` if set), and emits a stderr
 *                         advisory naming the skipped rule ids. Full dispatch
 *                         requires the job subsystem (Step 10) — until then
 *                         the flag is a stub: prob rules never produce issues
 *                         and never alter the exit code.
 *   `--async`            reserved companion to `--include-prob`. Once jobs
 *                         land it will return job ids without waiting for
 *                         completion; today it is a no-op (the advisory
 *                         simply mentions it).
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  ok — no error-severity issues (warns / infos do not fail the verb)
 *   1  one or more issues at severity `error`
 *   5  DB file missing — run `sm scan` first
 *
 * The `1` ≠ `0` boundary intentionally mirrors `sm scan`'s contract: an
 * agent / CI loop can use `sm check` as a fast pre-flight without paying
 * for a full walk.
 *
 * TODO (Step 10): when the job subsystem ships, render an output marker
 * (`(prob)` / `🧠`) on issues whose `ruleId` belongs to a probabilistic
 * rule. Today the stub never produces such issues, so the marker has
 * nothing to attach to and is intentionally absent.
 */

import { Command, Option } from 'clipanion';

import { qualifiedExtensionId } from '../../kernel/registry.js';
import type { Issue, Severity } from '../../kernel/types.js';
import { CHECK_TEXTS } from '../i18n/check.texts.js';
import { assertDbExists, resolveDbPath } from '../util/db-path.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { ExitCode } from '../util/exit-codes.js';
import {
  composeScanExtensions,
  emptyPluginRuntime,
  loadPluginRuntime,
} from '../util/plugin-runtime.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { withSqlite } from '../util/with-sqlite.js';

const SEVERITY_ORDER: Severity[] = ['error', 'warn', 'info'];

export class CheckCommand extends Command {
  static override paths = [['check']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Print all current issues (reads from DB, faster than sm scan --json | jq).',
    details: `
      Loads every row from scan_issues. Exits 1 if any issue has
      severity \`error\`, otherwise 0. \`warn\` and \`info\` do not fail.

      Run \`sm scan\` first to populate the DB.

      \`--include-prob\` is an opt-in flag for probabilistic Rule
      dispatch (spec § A.7). Default is deterministic-only — same
      CI-safe behaviour as before. With the flag, registered prob
      rules are detected and named in a stderr advisory; full
      dispatch lands when the job subsystem ships at Step 10.
    `,
    examples: [
      ['Print every current issue', '$0 check'],
      ['Machine-readable issue list', '$0 check --json'],
      ['Restrict to a single node', '$0 check -n .claude/agents/architect.md'],
      ['Restrict to specific rules', '$0 check --rules core/broken-ref,core/validate-all'],
      ['Opt in to probabilistic rules (stub until Step 10)', '$0 check --include-prob'],
      ['Check the global scope', '$0 check --global'],
      ['Use a non-default DB file', '$0 check --db /path/to/skill-map.db'],
    ],
  });

  global = Option.Boolean('-g,--global', false);
  db = Option.String('--db', { required: false });
  json = Option.Boolean('--json', false);
  node = Option.String('-n,--node', {
    required: false,
    description:
      'Restrict to issues whose nodeIds include the given path. Combines with --rules and --include-prob.',
  });
  rules = Option.String('--rules', {
    required: false,
    description:
      'Comma-separated rule ids (qualified or short). Restrict the issue read; with --include-prob, also filters which prob rules surface in the advisory.',
  });
  includeProb = Option.Boolean('--include-prob', false, {
    description:
      'Detect probabilistic Rules and emit a stub advisory naming them (full dispatch lands at Step 10). Default off → deterministic-only, CI-safe.',
  });
  async = Option.Boolean('--async', false, {
    description:
      'Reserved companion to --include-prob: once jobs ship, returns job ids without waiting. No effect today.',
  });
  noPlugins = Option.Boolean('--no-plugins', false, {
    description:
      'Skip drop-in plugin discovery; only kernel built-ins participate in the prob detection. Same flag shape as `sm scan`.',
  });

  async execute(): Promise<number> {
    const dbPath = resolveDbPath({ global: this.global, db: this.db, ...defaultRuntimeContext() });
    if (!assertDbExists(dbPath, this.context.stderr)) return ExitCode.NotFound;

    // Parse `--rules` once. Empty / whitespace tokens dropped.
    const ruleFilter = parseRulesFlag(this.rules);

    // Probabilistic Rule detection. Cheap when the flag is off — we never
    // touch the plugin loader at all (status quo for `sm check`).
    if (this.includeProb) {
      const probRuleIds = await detectProbRuleIds({
        scope: this.global ? 'global' : 'project',
        noPlugins: this.noPlugins,
        ruleFilter,
        stderr: this.context.stderr,
      });
      if (probRuleIds.length > 0) {
        const template = this.async
          ? CHECK_TEXTS.probStubAdvisoryAsync
          : CHECK_TEXTS.probStubAdvisory;
        this.context.stderr.write(
          tx(template, {
            count: probRuleIds.length,
            ruleIds: probRuleIds.join(', '),
          }),
        );
      }
    }

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      let issues = await adapter.issues.listAll();

      // Filters apply to the persisted issue list. They do NOT affect the
      // prob-rule advisory above (which already honoured `--rules`).
      if (this.node !== undefined) {
        const nodePath = this.node;
        issues = issues.filter((i) => i.nodeIds.includes(nodePath));
      }
      if (ruleFilter !== undefined) {
        issues = issues.filter((i) => matchesRuleFilter(i.ruleId, ruleFilter));
      }

      if (this.json) {
        this.context.stdout.write(JSON.stringify(issues) + '\n');
      } else if (issues.length === 0) {
        this.context.stdout.write(CHECK_TEXTS.noIssues);
      } else {
        this.context.stdout.write(renderHuman(issues));
      }

      return issues.some((i) => i.severity === 'error') ? ExitCode.Issues : ExitCode.Ok;
    });
  }
}

/**
 * Parse the `--rules <ids>` flag into a normalised filter set. Returns
 * `undefined` when the flag is absent — the caller treats that as "no
 * filter, every rule passes". Empty entries are dropped silently so a
 * trailing comma does not change the matched set.
 */
function parseRulesFlag(raw: string | undefined): Set<string> | undefined {
  if (raw === undefined) return undefined;
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (ids.length === 0) return undefined;
  return new Set(ids);
}

/**
 * Match a `ruleId` (which always arrives qualified — `<plugin>/<id>` —
 * because issues are persisted with the full extension id since spec
 * § A.6) against the user's `--rules` filter. The filter accepts both
 * qualified and short forms; a short entry matches when the ruleId's
 * suffix after `/` is identical, which lets a user type
 * `--rules validate-all` without remembering the `core/` prefix.
 */
function matchesRuleFilter(ruleId: string, filter: Set<string>): boolean {
  if (filter.has(ruleId)) return true;
  const slashIdx = ruleId.indexOf('/');
  if (slashIdx >= 0) {
    const short = ruleId.slice(slashIdx + 1);
    if (filter.has(short)) return true;
  }
  return false;
}

interface IDetectProbRulesOptions {
  scope: 'project' | 'global';
  noPlugins: boolean;
  ruleFilter: Set<string> | undefined;
  stderr: NodeJS.WritableStream;
}

/**
 * Load the plugin runtime + built-ins, collect every Rule with
 * `mode === 'probabilistic'`, and return their qualified ids (filtered
 * by `--rules` when set). Plugin load warnings are forwarded verbatim
 * to stderr so the user sees the same diagnostics `sm scan` produces.
 *
 * Returns an empty list when no prob rules are registered — the caller
 * skips the advisory entirely in that case (advising about nothing
 * would be noise).
 */
// eslint-disable-next-line complexity
async function detectProbRuleIds(opts: IDetectProbRulesOptions): Promise<string[]> {
  const pluginRuntime = opts.noPlugins
    ? emptyPluginRuntime()
    : await loadPluginRuntime({ scope: opts.scope });
  for (const warn of pluginRuntime.warnings) {
    opts.stderr.write(`${warn}\n`);
  }
  const composed = composeScanExtensions({ noBuiltIns: false, pluginRuntime });
  const rules = composed?.rules ?? [];

  const probIds: string[] = [];
  for (const rule of rules) {
    if (rule.mode !== 'probabilistic') continue;
    const qualified = qualifiedExtensionId(rule.pluginId, rule.id);
    if (opts.ruleFilter && !matchesRuleFilter(qualified, opts.ruleFilter)) continue;
    probIds.push(qualified);
  }
  // Stable ordering so the advisory is deterministic across runs.
  probIds.sort();
  return probIds;
}

function renderHuman(issues: Issue[]): string {
  // Group by severity (errors first, then warns, then infos) so the
  // most actionable rows are at the top of the output.
  const grouped = new Map<Severity, Issue[]>();
  for (const sev of SEVERITY_ORDER) grouped.set(sev, []);
  for (const issue of issues) {
    const bucket = grouped.get(issue.severity);
    if (bucket) bucket.push(issue);
    else grouped.set(issue.severity, [issue]);
  }

  const lines: string[] = [];
  for (const sev of SEVERITY_ORDER) {
    const bucket = grouped.get(sev) ?? [];
    for (const issue of bucket) {
      // Defence in depth: `ruleId` / `message` / `nodeIds` originate from
      // plugin-authored strings persisted in the DB. Strip ANSI / C0
      // bytes before printing so a hostile plugin cannot repaint the
      // user's terminal via a stored issue row.
      lines.push(
        tx(CHECK_TEXTS.issueRow, {
          severity: issue.severity,
          ruleId: sanitizeForTerminal(issue.ruleId),
          message: sanitizeForTerminal(issue.message),
          nodeIds: issue.nodeIds.map(sanitizeForTerminal).join(', '),
        }),
      );
    }
  }
  return lines.join('\n') + '\n';
}
