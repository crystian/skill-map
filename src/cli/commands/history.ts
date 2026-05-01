/**
 * `sm history [-n <path>] [--action <id>] [--status <s,...>] [--since <ISO>] [--until <ISO>] [--json]`
 * `sm history stats [--since <ISO>] [--until <ISO>] [--period day|week|month] [--top N] [--json]`
 *
 * Read-side surfaces over `state_executions`. Step 5.3 ships the lister;
 * Step 5.4 ships the aggregator. Both share the date-window parsing and
 * the elapsed-time helpers.
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  ok (including empty result)
 *   2  bad flag (unparseable date, unknown status, invalid --top)
 *   5  DB file missing — run `sm scan` first
 */

import { Command, Option } from 'clipanion';

import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import {
  aggregateHistoryStats,
  listExecutions,
  type IListExecutionsFilter,
  type THistoryStatsPeriod,
} from '../../kernel/adapters/sqlite/history.js';
import type {
  ExecutionRecord,
  ExecutionStatus,
  HistoryStats,
} from '../../kernel/types.js';
import { assertDbExists, resolveDbPath } from '../util/db-path.js';
import { emitDoneStderr, formatElapsed, startElapsed } from '../util/elapsed.js';
import { ExitCode } from '../util/exit-codes.js';
import { withSqlite } from '../util/with-sqlite.js';

const STATUSES: readonly ExecutionStatus[] = ['completed', 'failed', 'cancelled'];
const PERIODS: readonly THistoryStatsPeriod[] = ['day', 'week', 'month'];

// --- helpers ---------------------------------------------------------------

/**
 * Parse an ISO-8601 string into Unix ms. Rejects unparseable input via
 * stderr + exit 2 — caller propagates the return value.
 *
 * Returns `null` on parse error so callers can short-circuit.
 */
function parseIsoMs(
  input: string,
  flag: string,
  stderr: NodeJS.WritableStream,
): number | null {
  const ms = Date.parse(input);
  if (!Number.isFinite(ms)) {
    stderr.write(`${flag}: expected an ISO-8601 date-time, got "${input}".\n`);
    return null;
  }
  return ms;
}

function parseStatuses(
  input: string,
  stderr: NodeJS.WritableStream,
): ExecutionStatus[] | null {
  const parts = input.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) {
    stderr.write(`--status: expected one or more of ${STATUSES.join(', ')}.\n`);
    return null;
  }
  for (const p of parts) {
    if (!STATUSES.includes(p as ExecutionStatus)) {
      stderr.write(
        `--status: invalid value "${p}". Allowed: ${STATUSES.join(', ')}.\n`,
      );
      return null;
    }
  }
  return parts as ExecutionStatus[];
}

// --- sm history ------------------------------------------------------------

export class HistoryCommand extends Command {
  static override paths = [['history']];
  static override usage = Command.Usage({
    category: 'History',
    description:
      'Filter execution records. --json emits an array conforming to execution-record.schema.json.',
    details: `
      Reads from state_executions. Filters:
        -n <path>          restrict to executions whose nodeIds[] contains <path>
        --action <id>      restrict to a specific action extension id
        --status <s,...>   restrict to one or more of completed,failed,cancelled
        --since <ISO>      lower bound on startedAt (inclusive, ISO-8601)
        --until <ISO>      upper bound on startedAt (exclusive, ISO-8601)
        --limit N          cap result count

      Output is most-recent-first. Run \`sm scan\` first to provision the DB.
    `,
    examples: [
      ['Recent executions', '$0 history --limit 10'],
      ['Failures in the last week', '$0 history --status failed --since 2026-04-19T00:00:00Z'],
      ['Machine-readable, scoped to one node', '$0 history -n skills/foo.md --json'],
    ],
  });

  global = Option.Boolean('-g,--global', false);
  db = Option.String('--db', { required: false });
  node = Option.String('-n', { required: false });
  action = Option.String('--action', { required: false });
  status = Option.String('--status', { required: false });
  since = Option.String('--since', { required: false });
  until = Option.String('--until', { required: false });
  limit = Option.String('--limit', { required: false });
  json = Option.Boolean('--json', false);
  quiet = Option.Boolean('--quiet', false);

  // CLI list verb: many optional filter flags (`--node`, `--action`,
  // `--status`, `--since`, `--until`, `--limit`, `--json`, `--quiet`)
  // each adding a guarded mutation to the filter or render path. Each
  // branch is single-purpose; splitting per flag would distance the
  // validations from the filter they shape.
  // eslint-disable-next-line complexity
  async execute(): Promise<number> {
    const elapsed = startElapsed();

    // --- flag validation -------------------------------------------------
    const filter: IListExecutionsFilter = {};
    if (this.node !== undefined) filter.nodePath = this.node;
    if (this.action !== undefined) filter.actionId = this.action;
    if (this.status !== undefined) {
      const parsed = parseStatuses(this.status, this.context.stderr);
      if (parsed === null) return ExitCode.Error;
      filter.statuses = parsed;
    }
    if (this.since !== undefined) {
      const ms = parseIsoMs(this.since, '--since', this.context.stderr);
      if (ms === null) return ExitCode.Error;
      filter.sinceMs = ms;
    }
    if (this.until !== undefined) {
      const ms = parseIsoMs(this.until, '--until', this.context.stderr);
      if (ms === null) return ExitCode.Error;
      filter.untilMs = ms;
    }
    if (this.limit !== undefined) {
      const parsed = Number.parseInt(this.limit, 10);
      if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== this.limit.trim()) {
        this.context.stderr.write(
          `--limit: expected a positive integer, got "${this.limit}".\n`,
        );
        return ExitCode.Error;
      }
      filter.limit = parsed;
    }

    // --- DB --------------------------------------------------------------
    const dbPath = resolveDbPath({ global: this.global, db: this.db });
    if (!assertDbExists(dbPath, this.context.stderr)) return ExitCode.NotFound;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const rows = await listExecutions(adapter.db, filter);

      if (this.json) {
        // Array output — no top-level elapsedMs per cli-contract.md
        // §Elapsed time. The `done in <…>` stderr line still fires.
        this.context.stdout.write(JSON.stringify(rows.map(toExecutionRecord)) + '\n');
      } else if (rows.length === 0) {
        this.context.stdout.write('No executions found.\n');
      } else {
        this.context.stdout.write(renderTable(rows));
      }

      emitDoneStderr(this.context.stderr, elapsed, this.quiet);
      return ExitCode.Ok;
    });
  }
}

// --- sm history stats ------------------------------------------------------

export class HistoryStatsCommand extends Command {
  static override paths = [['history', 'stats']];
  static override usage = Command.Usage({
    category: 'History',
    description:
      'Aggregate counts, tokens, periods, top nodes, and error rates over state_executions. --json conforms to history-stats.schema.json.',
    details: `
      Defaults: --period month, --top 10, all-time when --since omitted.

      Window: --since is inclusive, --until is exclusive. Both ISO-8601.

      The --json output ALWAYS includes the full per-failure-reason key
      set (zero-filled if a reason has no occurrences) so dashboards see
      a predictable shape.
    `,
    examples: [
      ['All-time stats', '$0 history stats'],
      ['Last 30 days, daily buckets', '$0 history stats --since 2026-03-26T00:00:00Z --period day'],
      ['Top 5 nodes, JSON', '$0 history stats --top 5 --json'],
    ],
  });

  global = Option.Boolean('-g,--global', false);
  db = Option.String('--db', { required: false });
  since = Option.String('--since', { required: false });
  until = Option.String('--until', { required: false });
  period = Option.String('--period', { required: false });
  top = Option.String('--top', { required: false });
  json = Option.Boolean('--json', false);
  quiet = Option.Boolean('--quiet', false);

  async execute(): Promise<number> {
    const elapsed = startElapsed();

    // --- flag validation -------------------------------------------------
    let sinceMs: number | null = null;
    let untilMs: number = Date.now();
    if (this.since !== undefined) {
      const parsed = parseIsoMs(this.since, '--since', this.context.stderr);
      if (parsed === null) return ExitCode.Error;
      sinceMs = parsed;
    }
    if (this.until !== undefined) {
      const parsed = parseIsoMs(this.until, '--until', this.context.stderr);
      if (parsed === null) return ExitCode.Error;
      untilMs = parsed;
    }
    let period: THistoryStatsPeriod = 'month';
    if (this.period !== undefined) {
      if (!PERIODS.includes(this.period as THistoryStatsPeriod)) {
        this.context.stderr.write(
          `--period: invalid value "${this.period}". Allowed: ${PERIODS.join(', ')}.\n`,
        );
        return ExitCode.Error;
      }
      period = this.period as THistoryStatsPeriod;
    }
    let topN = 10;
    if (this.top !== undefined) {
      const parsed = Number.parseInt(this.top, 10);
      if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== this.top.trim()) {
        this.context.stderr.write(
          `--top: expected a positive integer, got "${this.top}".\n`,
        );
        return ExitCode.Error;
      }
      topN = parsed;
    }

    // --- DB --------------------------------------------------------------
    const dbPath = resolveDbPath({ global: this.global, db: this.db });
    if (!assertDbExists(dbPath, this.context.stderr)) return ExitCode.NotFound;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const aggregated = await aggregateHistoryStats(
        adapter.db,
        { sinceMs, untilMs },
        period,
        topN,
      );

      const stats: HistoryStats = {
        schemaVersion: 1,
        range: {
          since: sinceMs === null ? null : new Date(sinceMs).toISOString(),
          until: new Date(untilMs).toISOString(),
        },
        totals: aggregated.totals,
        tokensPerAction: aggregated.tokensPerAction,
        executionsPerPeriod: aggregated.executionsPerPeriod,
        topNodes: aggregated.topNodes,
        errorRates: aggregated.errorRates,
        elapsedMs: elapsed.ms(),
      };

      if (this.json) {
        // Self-validate against history-stats.schema.json so a runtime
        // shape regression is caught at the boundary (existing pattern
        // from src/test/self-scan.test.ts).
        const validators = loadSchemaValidators();
        // Step 5.10: re-stamp `elapsedMs` after the validator load
        // (which dominates wall-clock at cold start, ~100ms in cold-cache
        // CLI runs). Captured at construction time, the field understated
        // the user-perceived duration vs `done in <…>` on stderr by the
        // schema-load delta. Doing it after validate but before serialise
        // captures the heavy work; serialisation itself is microseconds.
        stats.elapsedMs = elapsed.ms();
        const result = validators.validate('history-stats', stats);
        if (!result.ok) {
          this.context.stderr.write(
            `internal: history-stats output failed schema validation — ${result.errors}\n`,
          );
          return ExitCode.Error;
        }
        this.context.stdout.write(JSON.stringify(stats) + '\n');
      } else {
        this.context.stdout.write(renderStats(stats));
      }

      emitDoneStderr(this.context.stderr, elapsed, this.quiet);
      return ExitCode.Ok;
    });
  }
}

// --- renderers -------------------------------------------------------------

const COL_ID = 26;
const COL_ACTION = 24;
// Per-column widths for `renderTable`. Step 5.10: previous version
// padded every non-ID column to a flat 11 chars, which collapsed the
// STARTED column (20 chars for an ISO-8601 timestamp) against ACTION.
// Widths sized so the longest expected content fits with at least 2
// trailing spaces between columns. Step 5.11 widened STATUS from 12
// to 30 to fit `cancelled (user-cancelled)` and the longest enum
// `failed (job-file-missing)` (25 chars + 2 padding rounded up).
//                          ID      STARTED  ACTION         STATUS  DUR.   TOKENS  NODES
const COL_WIDTHS: number[] = [COL_ID + 2, 22, COL_ACTION + 2, 30, 10, 14, 6];

function toExecutionRecord(r: ExecutionRecord): ExecutionRecord {
  // listExecutions already returns the camelCased domain shape; we just
  // emit it as-is. The function name advertises intent for the JSON path.
  return r;
}

function renderTable(rows: ExecutionRecord[]): string {
  const header = formatRow(
    'ID', 'STARTED', 'ACTION', 'STATUS', 'DURATION', 'TOKENS', 'NODES',
  );
  const sep = '-'.repeat(header.length);
  const lines = [header, sep];
  for (const r of rows) {
    const tokens = `${r.tokensIn ?? 0}/${r.tokensOut ?? 0}`;
    const duration = r.durationMs === null || r.durationMs === undefined
      ? '-'
      : formatElapsed(r.durationMs);
    // Step 5.11 — show `failureReason` inline when present so the human
    // path stops hiding info that's already in --json. Format:
    //   completed                       (no reason ever)
    //   failed (timeout)                (reason populated)
    //   cancelled (user-cancelled)      (reason populated)
    //   failed                          (reason missing — defensive)
    const status =
      r.failureReason !== null && r.failureReason !== undefined && r.failureReason.length > 0
        ? `${r.status} (${r.failureReason})`
        : r.status;
    lines.push(
      formatRow(
        truncate(r.id, COL_ID),
        new Date(r.startedAt).toISOString().slice(0, 19) + 'Z',
        truncate(r.extensionId, COL_ACTION),
        status,
        duration,
        tokens,
        String((r.nodeIds ?? []).length),
      ),
    );
  }
  return lines.join('\n') + '\n';
}

function renderStats(stats: HistoryStats): string {
  const lines: string[] = [];
  const since = stats.range.since ?? '(all time)';
  lines.push(`Window: ${since} → ${stats.range.until}`);
  lines.push('');
  lines.push(
    `Totals: ${stats.totals.executionsCount} executions ` +
      `(${stats.totals.completedCount} ok, ${stats.totals.failedCount} failed) — ` +
      `tokens ${stats.totals.tokensIn} in / ${stats.totals.tokensOut} out — ` +
      `duration ${formatElapsed(stats.totals.durationMsTotal)}`,
  );
  lines.push(`Global error rate: ${(stats.errorRates.global * 100).toFixed(1)}%`);
  lines.push('');

  if (stats.tokensPerAction.length > 0) {
    lines.push('Top actions by tokens:');
    for (const a of stats.tokensPerAction.slice(0, 5)) {
      lines.push(
        `  ${a.actionId}@${a.actionVersion}: ${a.executionsCount} runs, ` +
          `${a.tokensIn} in / ${a.tokensOut} out`,
      );
    }
    lines.push('');
  }
  if (stats.topNodes.length > 0) {
    lines.push('Top nodes:');
    for (const n of stats.topNodes.slice(0, 5)) {
      lines.push(`  ${n.nodePath}: ${n.executionsCount} runs`);
    }
    lines.push('');
  }
  const failures = Object.entries(stats.errorRates.perFailureReason).filter(
    ([, v]) => v > 0,
  );
  if (failures.length > 0) {
    lines.push('Failures by reason:');
    for (const [reason, count] of failures) {
      lines.push(`  ${reason}: ${count}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function formatRow(...cols: string[]): string {
  return cols.map((c, i) => c.padEnd(COL_WIDTHS[i] ?? 10)).join('');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
