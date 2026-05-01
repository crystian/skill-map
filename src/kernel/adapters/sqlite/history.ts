/**
 * History readers, writers, and FK-migration helpers for the `state_*`
 * zone. Step 5.2 lays the storage contracts that `sm history` /
 * `sm history stats` (5.3 / 5.4) and the rename heuristic + `sm orphans`
 * (5.5 / 5.6) consume.
 *
 * Three responsibilities:
 *   1. `insertExecution` — write a single `state_executions` row. Used by
 *      tests today; consumed by `sm record` / `sm job run` at Step 9.
 *   2. `listExecutions` — read with filters (node, action, status, time
 *      window). Backs `sm history`.
 *   3. `aggregateHistoryStats` — totals, per-action, per-period, top
 *      nodes, error rates. Backs `sm history stats`.
 *   4. `migrateNodeFks` — repoint every `state_*` reference to a node
 *      from `fromPath` to `toPath`. Used by the rename heuristic
 *      (forward, inside the scan tx) and by `sm orphans reconcile` /
 *      `sm orphans undo-rename`.
 *
 * All mutating operations accept a `Kysely<IDatabase>` *or* a
 * `Transaction<IDatabase>` so callers can compose them inside a larger
 * tx (the rename heuristic does this).
 */

import { sql, type Insertable, type Kysely, type Selectable, type Transaction } from 'kysely';

import type {
  ExecutionFailureReason,
  ExecutionRecord,
  ExecutionStatus,
  HistoryStats,
  HistoryStatsExecutionsPerPeriod,
  HistoryStatsPerActionRate,
  HistoryStatsTokensPerAction,
  HistoryStatsTopNode,
} from '../../types.js';
import type { IDatabase, IStateExecutionsTable } from './schema.js';

type DbOrTx = Kysely<IDatabase> | Transaction<IDatabase>;

/** Filter shape for `listExecutions`. All fields optional. */
export interface IListExecutionsFilter {
  /** Restrict to executions whose `nodeIds` array contains this path. */
  nodePath?: string;
  /** Exact match on `extension_id`. */
  actionId?: string;
  /** Subset of {`completed`,`failed`,`cancelled`}. */
  statuses?: ExecutionStatus[];
  /** Lower bound (inclusive) on `started_at`. Unix ms. */
  sinceMs?: number;
  /** Upper bound (exclusive) on `started_at`. Unix ms. */
  untilMs?: number;
  /** Cap result count. No default. */
  limit?: number;
}

const FAILURE_REASONS: readonly ExecutionFailureReason[] = [
  'runner-error',
  'report-invalid',
  'timeout',
  'abandoned',
  'job-file-missing',
  'user-cancelled',
];

// --- Inserts ---------------------------------------------------------------

export async function insertExecution(
  db: DbOrTx,
  exec: ExecutionRecord,
): Promise<void> {
  await db.insertInto('state_executions').values(executionToRow(exec)).execute();
}

function executionToRow(exec: ExecutionRecord): Insertable<IStateExecutionsTable> {
  return {
    id: exec.id,
    kind: exec.kind,
    extensionId: exec.extensionId,
    extensionVersion: exec.extensionVersion,
    nodeIdsJson: JSON.stringify(exec.nodeIds ?? []),
    contentHash: exec.contentHash ?? null,
    status: exec.status,
    failureReason: exec.failureReason ?? null,
    exitCode: exec.exitCode ?? null,
    runner: exec.runner ?? null,
    startedAt: exec.startedAt,
    finishedAt: exec.finishedAt,
    durationMs: exec.durationMs ?? null,
    tokensIn: exec.tokensIn ?? null,
    tokensOut: exec.tokensOut ?? null,
    reportPath: exec.reportPath ?? null,
    jobId: exec.jobId ?? null,
  };
}

// --- Reads -----------------------------------------------------------------

export async function listExecutions(
  db: DbOrTx,
  filter: IListExecutionsFilter = {},
): Promise<ExecutionRecord[]> {
  let query = db.selectFrom('state_executions').selectAll();

  if (filter.actionId !== undefined) {
    query = query.where('extensionId', '=', filter.actionId);
  }
  if (filter.statuses && filter.statuses.length > 0) {
    query = query.where('status', 'in', filter.statuses);
  }
  if (filter.sinceMs !== undefined) {
    query = query.where('startedAt', '>=', filter.sinceMs);
  }
  if (filter.untilMs !== undefined) {
    query = query.where('startedAt', '<', filter.untilMs);
  }
  if (filter.nodePath !== undefined) {
    // JSON1 containment via correlated EXISTS. Same pattern as
    // `sm list --issue` (see src/cli/commands/list.ts).
    const target = filter.nodePath;
    query = query.where(({ exists, selectFrom }) =>
      exists(
        selectFrom(
          sql<{ value: string }>`json_each(state_executions.node_ids_json)`.as('je'),
        )
          .select(sql<number>`1`.as('one'))
          .where(sql.ref('je.value'), '=', target),
      ),
    );
  }

  // Stable sort: most-recent first.
  query = query.orderBy('startedAt', 'desc').orderBy('id', 'desc');

  if (filter.limit !== undefined) query = query.limit(filter.limit);

  const rows = await query.execute();
  return rows.map(rowToExecution);
}

function rowToExecution(row: {
  id: string;
  kind: 'action';
  extensionId: string;
  extensionVersion: string;
  nodeIdsJson: string;
  contentHash: string | null;
  status: 'completed' | 'failed' | 'cancelled';
  failureReason: string | null;
  exitCode: number | null;
  runner: string | null;
  startedAt: number;
  finishedAt: number;
  durationMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  reportPath: string | null;
  jobId: string | null;
}): ExecutionRecord {
  return {
    id: row.id,
    kind: row.kind,
    extensionId: row.extensionId,
    extensionVersion: row.extensionVersion,
    nodeIds: parseStringArray(row.nodeIdsJson),
    contentHash: row.contentHash,
    status: row.status,
    failureReason: row.failureReason as ExecutionFailureReason | null,
    exitCode: row.exitCode,
    runner: row.runner as 'cli' | 'skill' | 'in-process' | null,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    reportPath: row.reportPath,
    jobId: row.jobId,
  };
}

function parseStringArray(s: string): string[] {
  const parsed = JSON.parse(s) as unknown;
  return Array.isArray(parsed) ? (parsed as string[]) : [];
}

// --- Aggregations ----------------------------------------------------------

export interface IHistoryStatsRange {
  /** Inclusive lower bound. `null` = all-time. */
  sinceMs: number | null;
  /** Exclusive upper bound. */
  untilMs: number;
}

export type THistoryStatsPeriod = 'day' | 'week' | 'month';

/**
 * Compute the bucketed aggregations that back `sm history stats --json`.
 * The caller is responsible for `elapsedMs` and for serialising
 * `range.{since,until}` to ISO-8601 strings — this function returns the
 * window in Unix ms so callers can keep their boundaries exact.
 */
export async function aggregateHistoryStats(
  db: DbOrTx,
  range: IHistoryStatsRange,
  period: THistoryStatsPeriod,
  topN: number,
): Promise<Omit<HistoryStats, 'elapsedMs' | 'range'> & { rangeMs: { sinceMs: number | null; untilMs: number } }> {
  let query = db.selectFrom('state_executions').selectAll();
  if (range.sinceMs !== null) {
    query = query.where('startedAt', '>=', range.sinceMs);
  }
  query = query.where('startedAt', '<', range.untilMs);
  const rows = await query.execute();

  // Totals
  let executionsCount = 0;
  let completedCount = 0;
  let failedCount = 0;
  let tokensInTotal = 0;
  let tokensOutTotal = 0;
  let durationMsTotal = 0;

  // Per-action accumulators.
  const perAction = new Map<
    string,
    {
      actionId: string;
      actionVersion: string;
      executionsCount: number;
      tokensIn: number;
      tokensOut: number;
      durations: number[];
      failedCount: number;
    }
  >();

  // Per-period buckets.
  const perPeriod = new Map<
    number,
    { tokensIn: number; tokensOut: number; executionsCount: number }
  >();

  // Per-node accumulators.
  const perNode = new Map<
    string,
    { executionsCount: number; lastExecutedAt: number }
  >();

  // Per failure-reason accumulators.
  const perFailureReason: Record<ExecutionFailureReason, number> = {
    'runner-error': 0,
    'report-invalid': 0,
    'timeout': 0,
    'abandoned': 0,
    'job-file-missing': 0,
    'user-cancelled': 0,
  };

  const totals = { executionsCount, completedCount, failedCount, tokensInTotal, tokensOutTotal, durationMsTotal };
  for (const row of rows) {
    accumulateExecutionRow(row, totals, perFailureReason, perAction, perPeriod, perNode, period);
  }
  // Re-bind locals from the mutated totals object.
  executionsCount = totals.executionsCount;
  completedCount = totals.completedCount;
  failedCount = totals.failedCount;
  tokensInTotal = totals.tokensInTotal;
  tokensOutTotal = totals.tokensOutTotal;
  durationMsTotal = totals.durationMsTotal;

  // tokensPerAction sorted desc by tokensIn + tokensOut.
  const tokensPerAction: HistoryStatsTokensPerAction[] = Array.from(perAction.values())
    .map((acc) => ({
      actionId: acc.actionId,
      actionVersion: acc.actionVersion,
      executionsCount: acc.executionsCount,
      tokensIn: acc.tokensIn,
      tokensOut: acc.tokensOut,
      durationMsMean: meanDuration(acc.durations),
      durationMsMedian: medianDuration(acc.durations),
    }))
    .sort((a, b) => b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut));

  // executionsPerPeriod sorted asc by periodStart.
  const sortedBuckets = Array.from(perPeriod.entries()).sort((a, b) => a[0] - b[0]);
  const executionsPerPeriod: HistoryStatsExecutionsPerPeriod[] = sortedBuckets.map(
    ([startMs, acc]) => ({
      periodStart: new Date(startMs).toISOString(),
      periodUnit: period,
      executionsCount: acc.executionsCount,
      tokensIn: acc.tokensIn,
      tokensOut: acc.tokensOut,
    }),
  );

  // topNodes sorted desc by count, tie-break desc by lastExecutedAt.
  const topNodes: HistoryStatsTopNode[] = Array.from(perNode.entries())
    .map(([nodePath, acc]) => ({
      nodePath,
      executionsCount: acc.executionsCount,
      lastExecutedAt: acc.lastExecutedAt,
    }))
    .sort((a, b) => {
      if (b.executionsCount !== a.executionsCount) {
        return b.executionsCount - a.executionsCount;
      }
      return b.lastExecutedAt - a.lastExecutedAt;
    })
    .slice(0, topN);

  // Per-action error rate. Sorted desc by rate, tie-break asc by actionId.
  const perActionRates: HistoryStatsPerActionRate[] = Array.from(perAction.values())
    .map((acc) => ({
      actionId: acc.actionId,
      rate: acc.executionsCount === 0 ? 0 : acc.failedCount / acc.executionsCount,
      executionsCount: acc.executionsCount,
      failedCount: acc.failedCount,
    }))
    .sort((a, b) => {
      if (b.rate !== a.rate) return b.rate - a.rate;
      return a.actionId.localeCompare(b.actionId);
    });

  return {
    schemaVersion: 1,
    rangeMs: { sinceMs: range.sinceMs, untilMs: range.untilMs },
    totals: {
      executionsCount,
      completedCount,
      failedCount,
      tokensIn: tokensInTotal,
      tokensOut: tokensOutTotal,
      durationMsTotal,
    },
    tokensPerAction,
    executionsPerPeriod,
    topNodes,
    errorRates: {
      global: executionsCount === 0 ? 0 : failedCount / executionsCount,
      perAction: perActionRates,
      perFailureReason,
    },
  };
}

/**
 * UTC-bucketed start of the period containing `dateMs`. Returns Unix ms.
 *
 * - `day`:   floor to YYYY-MM-DDT00:00:00.000Z
 * - `week`:  floor to Monday 00:00 UTC
 * - `month`: floor to day-1 00:00 UTC
 */
export function bucketStartMs(dateMs: number, period: THistoryStatsPeriod): number {
  const d = new Date(dateMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();

  if (period === 'month') {
    return Date.UTC(y, m, 1, 0, 0, 0, 0);
  }

  if (period === 'day') {
    return Date.UTC(y, m, day, 0, 0, 0, 0);
  }

  // week: floor to Monday. JS getUTCDay() returns 0=Sun..6=Sat.
  // Monday-based offset: (day-of-week + 6) % 7 days back.
  const dow = d.getUTCDay();
  const offset = (dow + 6) % 7;
  return Date.UTC(y, m, day - offset, 0, 0, 0, 0);
}

interface IExecutionRowTotals {
  executionsCount: number;
  completedCount: number;
  failedCount: number;
  tokensInTotal: number;
  tokensOutTotal: number;
  durationMsTotal: number;
}

interface IPerActionAcc {
  actionId: string;
  actionVersion: string;
  executionsCount: number;
  tokensIn: number;
  tokensOut: number;
  durations: number[];
  failedCount: number;
}

/**
 * Fold one `state_executions` row into every accumulator the
 * `aggregateHistoryStats` query needs: totals, per-failure-reason
 * counts, per-action rollup, per-period bucket, per-node rollup. Pure
 * mutation of the supplied containers — caller iterates rows and emits
 * the final stats from the same containers afterward.
 *
 * Cyclomatic count comes from folding into 5 distinct accumulators in
 * one pass; per-accumulator helpers would split state mutation across
 * more files without making the algorithm clearer.
 */
// eslint-disable-next-line complexity
function accumulateExecutionRow(
  row: Selectable<IStateExecutionsTable>,
  totals: IExecutionRowTotals,
  perFailureReason: Record<ExecutionFailureReason, number>,
  perAction: Map<string, IPerActionAcc>,
  perPeriod: Map<number, { tokensIn: number; tokensOut: number; executionsCount: number }>,
  perNode: Map<string, { executionsCount: number; lastExecutedAt: number }>,
  period: THistoryStatsPeriod,
): void {
  totals.executionsCount += 1;
  const tIn = row.tokensIn ?? 0;
  const tOut = row.tokensOut ?? 0;
  totals.tokensInTotal += tIn;
  totals.tokensOutTotal += tOut;
  if (row.durationMs !== null) totals.durationMsTotal += row.durationMs;

  if (row.status === 'completed') totals.completedCount += 1;
  if (row.status === 'failed') totals.failedCount += 1;

  if (row.failureReason !== null) {
    const reason = row.failureReason as ExecutionFailureReason;
    if (FAILURE_REASONS.includes(reason)) perFailureReason[reason] += 1;
  }

  // Per-action rollup keyed by (id, version).
  const actionKey = `${row.extensionId}@${row.extensionVersion}`;
  let actionAcc = perAction.get(actionKey);
  if (!actionAcc) {
    actionAcc = {
      actionId: row.extensionId,
      actionVersion: row.extensionVersion,
      executionsCount: 0,
      tokensIn: 0,
      tokensOut: 0,
      durations: [],
      failedCount: 0,
    };
    perAction.set(actionKey, actionAcc);
  }
  actionAcc.executionsCount += 1;
  actionAcc.tokensIn += tIn;
  actionAcc.tokensOut += tOut;
  if (row.durationMs !== null) actionAcc.durations.push(row.durationMs);
  if (row.status === 'failed') actionAcc.failedCount += 1;

  // Per-period bucket.
  const bucketStart = bucketStartMs(row.startedAt, period);
  let periodAcc = perPeriod.get(bucketStart);
  if (!periodAcc) {
    periodAcc = { tokensIn: 0, tokensOut: 0, executionsCount: 0 };
    perPeriod.set(bucketStart, periodAcc);
  }
  periodAcc.executionsCount += 1;
  periodAcc.tokensIn += tIn;
  periodAcc.tokensOut += tOut;

  // Per-node rollup.
  for (const path of parseStringArray(row.nodeIdsJson)) {
    let nodeAcc = perNode.get(path);
    if (!nodeAcc) {
      nodeAcc = { executionsCount: 0, lastExecutedAt: 0 };
      perNode.set(path, nodeAcc);
    }
    nodeAcc.executionsCount += 1;
    if (row.startedAt > nodeAcc.lastExecutedAt) nodeAcc.lastExecutedAt = row.startedAt;
  }
}

function meanDuration(values: number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return Math.round(sum / values.length);
}

function medianDuration(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if ((sorted.length & 1) === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

// --- Stranded reference detection ----------------------------------------

/**
 * Find every node path referenced from the `state_*` zone that is NOT in
 * the live snapshot. Used by `persistScanResult` to keep `orphan` issues
 * surface-visible across scans (Step 5.9): the per-scan rename heuristic
 * only sees paths in `prior \ current` of the *immediately preceding*
 * scan, so a stale reference from two scans ago becomes invisible after
 * one more scan. This sweep catches any `state_*` row whose `node_id`
 * (or any element of the `node_ids_json` array) is not in `livePaths`.
 *
 * Returns paths in deterministic lex-asc order.
 */
export async function findStrandedStateOrphans(
  trx: DbOrTx,
  livePaths: Set<string>,
): Promise<string[]> {
  const stranded = new Set<string>();

  // state_jobs.node_id (simple column).
  const jobRows = await trx
    .selectFrom('state_jobs')
    .select(['nodeId'])
    .distinct()
    .execute();
  for (const r of jobRows) {
    if (!livePaths.has(r.nodeId)) stranded.add(r.nodeId);
  }

  // state_executions.node_ids_json (JSON array). Use json_each to
  // explode the array and select the distinct values in one shot.
  const execRows = await trx
    .selectFrom(
      sql<{ value: string }>`(
        SELECT DISTINCT je.value AS value
        FROM state_executions, json_each(state_executions.node_ids_json) je
      )`.as('execNodeIds'),
    )
    .select(['value'])
    .execute();
  for (const r of execRows) {
    if (!livePaths.has(r.value)) stranded.add(r.value);
  }

  // state_summaries.node_id (composite PK part).
  const summRows = await trx
    .selectFrom('state_summaries')
    .select(['nodeId'])
    .distinct()
    .execute();
  for (const r of summRows) {
    if (!livePaths.has(r.nodeId)) stranded.add(r.nodeId);
  }

  // state_enrichments.node_id (composite PK part).
  const enrichRows = await trx
    .selectFrom('state_enrichments')
    .select(['nodeId'])
    .distinct()
    .execute();
  for (const r of enrichRows) {
    if (!livePaths.has(r.nodeId)) stranded.add(r.nodeId);
  }

  // state_plugin_kvs.node_id (skip the empty-string sentinel for
  // plugin-global keys — that's not a node reference).
  const kvRows = await trx
    .selectFrom('state_plugin_kvs')
    .select(['nodeId'])
    .where('nodeId', '!=', '')
    .distinct()
    .execute();
  for (const r of kvRows) {
    if (!livePaths.has(r.nodeId)) stranded.add(r.nodeId);
  }

  return [...stranded].sort();
}

// --- FK migration ---------------------------------------------------------

export interface IMigrateNodeFksReport {
  jobs: number;
  executions: number;
  summaries: number;
  enrichments: number;
  pluginKvs: number;
  /**
   * Composite-PK collisions encountered when migrating
   * `state_summaries` / `state_enrichments` / `state_plugin_kvs` because a
   * row already existed at the destination PK. The pre-existing rows are
   * preserved — the migrating rows are dropped (deleted from `fromPath`
   * without a corresponding INSERT). One entry per dropped row, with the
   * affected PK fields included for diagnostic output.
   */
  collisions: Array<{
    table: 'state_summaries' | 'state_enrichments' | 'state_plugin_kvs';
    fromPath: string;
    toPath: string;
    keys: Record<string, string>;
  }>;
}

/**
 * Migrate every `state_*` reference to `fromPath` over to `toPath`. Runs
 * inside whatever transaction the caller passes (the rename heuristic
 * passes the same `Transaction<IDatabase>` it uses to write `scan_*`).
 *
 * Composite-PK semantics for the three tables that key on `node_id`:
 * `state_summaries` keys on `(node_id, summarizer_action_id)`,
 * `state_enrichments` on `(node_id, provider_id)`, and `state_plugin_kvs`
 * on `(plugin_id, node_id, key)`. A naive UPDATE would explode if a row
 * already exists at the destination PK. The conservative resolution is:
 * keep the destination row (it represents the live node's history) and
 * drop the migrating row. Each drop is reported as a `collision` so
 * callers can surface a diagnostic.
 *
 * `state_plugin_kvs.node_id` defaults to '' (sentinel for plugin-global
 * keys); we explicitly skip the sentinel when migrating.
 */
export async function migrateNodeFks(
  trx: DbOrTx,
  fromPath: string,
  toPath: string,
): Promise<IMigrateNodeFksReport> {
  if (fromPath === toPath) {
    return { jobs: 0, executions: 0, summaries: 0, enrichments: 0, pluginKvs: 0, collisions: [] };
  }

  const report: IMigrateNodeFksReport = {
    jobs: 0,
    executions: 0,
    summaries: 0,
    enrichments: 0,
    pluginKvs: 0,
    collisions: [],
  };

  // 1. state_jobs.node_id — simple column, simple UPDATE.
  const jobsResult = await trx
    .updateTable('state_jobs')
    .set({ nodeId: toPath })
    .where('nodeId', '=', fromPath)
    .executeTakeFirst();
  report.jobs = Number(jobsResult.numUpdatedRows ?? 0);

  // 2. state_executions.node_ids_json — JSON array; pull, replace, write.
  const execRows = await trx
    .selectFrom('state_executions')
    .select(['id', 'nodeIdsJson'])
    .where(({ exists, selectFrom }) =>
      exists(
        selectFrom(
          sql<{ value: string }>`json_each(state_executions.node_ids_json)`.as('je'),
        )
          .select(sql<number>`1`.as('one'))
          .where(sql.ref('je.value'), '=', fromPath),
      ),
    )
    .execute();

  for (const row of execRows) {
    const ids = parseStringArray(row.nodeIdsJson);
    let mutated = false;
    const updated = ids.map((p) => {
      if (p === fromPath) {
        mutated = true;
        return toPath;
      }
      return p;
    });
    if (mutated) {
      await trx
        .updateTable('state_executions')
        .set({ nodeIdsJson: JSON.stringify(updated) })
        .where('id', '=', row.id)
        .execute();
      report.executions += 1;
    }
  }

  // 3. state_summaries — composite PK (node_id, summarizer_action_id).
  const summaryRows = await trx
    .selectFrom('state_summaries')
    .selectAll()
    .where('nodeId', '=', fromPath)
    .execute();
  for (const row of summaryRows) {
    const collision = await trx
      .selectFrom('state_summaries')
      .select(['nodeId'])
      .where('nodeId', '=', toPath)
      .where('summarizerActionId', '=', row.summarizerActionId)
      .executeTakeFirst();
    await trx
      .deleteFrom('state_summaries')
      .where('nodeId', '=', fromPath)
      .where('summarizerActionId', '=', row.summarizerActionId)
      .execute();
    if (collision) {
      report.collisions.push({
        table: 'state_summaries',
        fromPath,
        toPath,
        keys: { summarizerActionId: row.summarizerActionId },
      });
      continue;
    }
    await trx
      .insertInto('state_summaries')
      .values({ ...row, nodeId: toPath })
      .execute();
    report.summaries += 1;
  }

  // 4. state_enrichments — composite PK (node_id, provider_id).
  const enrichmentRows = await trx
    .selectFrom('state_enrichments')
    .selectAll()
    .where('nodeId', '=', fromPath)
    .execute();
  for (const row of enrichmentRows) {
    const collision = await trx
      .selectFrom('state_enrichments')
      .select(['nodeId'])
      .where('nodeId', '=', toPath)
      .where('providerId', '=', row.providerId)
      .executeTakeFirst();
    await trx
      .deleteFrom('state_enrichments')
      .where('nodeId', '=', fromPath)
      .where('providerId', '=', row.providerId)
      .execute();
    if (collision) {
      report.collisions.push({
        table: 'state_enrichments',
        fromPath,
        toPath,
        keys: { providerId: row.providerId },
      });
      continue;
    }
    await trx
      .insertInto('state_enrichments')
      .values({ ...row, nodeId: toPath })
      .execute();
    report.enrichments += 1;
  }

  // 5. state_plugin_kvs — composite PK (plugin_id, node_id, key). Skip
  // the empty-string sentinel for plugin-global keys.
  if (fromPath !== '') {
    const kvRows = await trx
      .selectFrom('state_plugin_kvs')
      .selectAll()
      .where('nodeId', '=', fromPath)
      .execute();
    for (const row of kvRows) {
      const collision = await trx
        .selectFrom('state_plugin_kvs')
        .select(['nodeId'])
        .where('pluginId', '=', row.pluginId)
        .where('nodeId', '=', toPath)
        .where('key', '=', row.key)
        .executeTakeFirst();
      await trx
        .deleteFrom('state_plugin_kvs')
        .where('pluginId', '=', row.pluginId)
        .where('nodeId', '=', fromPath)
        .where('key', '=', row.key)
        .execute();
      if (collision) {
        report.collisions.push({
          table: 'state_plugin_kvs',
          fromPath,
          toPath,
          keys: { pluginId: row.pluginId, key: row.key },
        });
        continue;
      }
      await trx
        .insertInto('state_plugin_kvs')
        .values({ ...row, nodeId: toPath })
        .execute();
      report.pluginKvs += 1;
    }
  }

  return report;
}
