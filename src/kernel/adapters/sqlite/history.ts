/**
 * History readers, writers, and FK-migration helpers for the `state_*`
 * zone. Backs `sm history`, `sm history stats`, the rename heuristic,
 * and `sm orphans`.
 *
 * Three responsibilities:
 *   1. `insertExecution`, write a single `state_executions` row (the
 *      `sm record` path writes through `jobs.recordTerminal` instead).
 *   2. `listExecutions`, read with filters (node, extension, status, time
 *      window). Backs `sm history`.
 *   3. `aggregateHistoryStats`, totals, per-extension, per-period, top
 *      nodes, error rates. Backs `sm history stats`.
 *   4. `migrateNodeFks`, repoint every `state_*` reference to a node
 *      from `fromPath` to `toPath`. Used by the rename heuristic
 *      (forward, inside the scan tx) and by `sm orphans reconcile` /
 *      `sm orphans undo-rename`.
 *
 * All mutating operations accept a `Kysely<IDatabase>` *or* a
 * `Transaction<IDatabase>` so callers can compose them inside a larger
 * tx (the rename heuristic does this).
 */

import { sql, type Insertable, type Kysely, type Selectable, type SelectQueryBuilder, type Transaction } from 'kysely';

import type {
  ExecutionFailureReason,
  ExecutionRecord,
  HistoryStats,
  HistoryStatsExecutionsPerPeriod,
  HistoryStatsPerExtensionRate,
  HistoryStatsTokensPerExtension,
  HistoryStatsTopNode,
} from '../../types.js';
import type {
  IHistoryStatsRange,
  IListExecutionsFilter,
  IMigrateNodeFksReport,
  THistoryStatsPeriod,
} from '../../types/storage.js';
import type { IDatabase, IStateExecutionsTable } from './schema.js';

export type {
  IHistoryStatsRange,
  IListExecutionsFilter,
  IMigrateNodeFksReport,
  THistoryStatsPeriod,
} from '../../types/storage.js';

type TDbOrTx = Kysely<IDatabase> | Transaction<IDatabase>;

const FAILURE_REASONS: readonly ExecutionFailureReason[] = [
  'runner-error',
  'report-invalid',
  'timeout',
  'abandoned',
  'job-file-missing',
  'user-failed',
];

// --- Inserts ---------------------------------------------------------------

export async function insertExecution(
  db: TDbOrTx,
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
    status: exec.status,
    startedAt: exec.startedAt,
    finishedAt: exec.finishedAt,
    ...projectExecutionOptionalAudit(exec),
    ...projectExecutionTokens(exec),
  };
}

function projectExecutionOptionalAudit(
  exec: ExecutionRecord,
): Pick<Insertable<IStateExecutionsTable>, 'contentHash' | 'failureReason' | 'exitCode' | 'runner' | 'durationMs' | 'reportJson' | 'jobId'> {
  return {
    contentHash: exec.contentHash ?? null,
    failureReason: exec.failureReason ?? null,
    exitCode: exec.exitCode ?? null,
    runner: exec.runner ?? null,
    durationMs: exec.durationMs ?? null,
    // Domain `ExecutionRecord.reportPath` (per execution-record.schema.json)
    // bridges to the `report_json` column under the DB-only job model.
    reportJson: exec.reportPath ?? null,
    jobId: exec.jobId ?? null,
  };
}

function projectExecutionTokens(
  exec: ExecutionRecord,
): Pick<Insertable<IStateExecutionsTable>, 'tokensIn' | 'tokensOut' | 'model'> {
  return {
    tokensIn: exec.tokensIn ?? null,
    tokensOut: exec.tokensOut ?? null,
    // Agent-self-reported metrics family: the model id rides with the
    // token counts (unverifiable by design, NULL when undeclared).
    model: exec.model ?? null,
  };
}

// --- Deletes ---------------------------------------------------------------

/**
 * Delete every `state_executions` row whose `node_ids_json` contains
 * `nodePath` (the Activity clear-all, `spec/provider-activity.md`
 * §DELETE /api/activity/node). The predicate is the same JSON1
 * correlated-EXISTS the `listExecutions` nodePath filter applies, so
 * the delete removes exactly the rows a per-node listing shows.
 */
export async function deleteExecutionsForNode(
  db: TDbOrTx,
  nodePath: string,
): Promise<number> {
  const result = await db
    .deleteFrom('state_executions')
    .where(({ exists, selectFrom }) =>
      exists(
        selectFrom(
          sql<{ value: string }>`json_each(state_executions.node_ids_json)`.as('je'),
        )
          .select(sql<number>`1`.as('one'))
          .where(sql.ref('je.value'), '=', nodePath),
      ),
    )
    .executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}

// --- Reads -----------------------------------------------------------------

export async function listExecutions(
  db: TDbOrTx,
  filter: IListExecutionsFilter = {},
): Promise<ExecutionRecord[]> {
  let query = db.selectFrom('state_executions').selectAll();
  query = applyExecutionFilters(query, filter);
  // Stable sort: most-recent first.
  query = query.orderBy('startedAt', 'desc').orderBy('id', 'desc');
  if (filter.limit !== undefined) query = query.limit(filter.limit);
  const rows = await query.execute();
  return rows.map(rowToExecution);
}

/**
 * Distinct node paths holding at least one `state_executions` row, any
 * status (the activity summary's `runNodes`, `spec/provider-activity.md`
 * §GET /api/activity/summary). JSON1 expansion of `node_ids_json` so a
 * multi-node execution contributes every path once.
 */
export async function listNodesWithRuns(db: TDbOrTx): Promise<string[]> {
  const rows = await db
    .selectFrom([
      'state_executions',
      sql<{ value: string }>`json_each(state_executions.node_ids_json)`.as('je'),
    ])
    .select(sql<string>`DISTINCT je.value`.as('nodePath'))
    .execute();
  return rows.map((r) => r.nodePath);
}

/**
 * Apply every optional filter from `IListExecutionsFilter` to a
 * Kysely SELECT. Each guard is one branch; folding them into the
 * caller would trip the lint cap and obscure that the function is a
 * flat "if-present-narrow" pipeline.
 */
function applyExecutionFilters<Q extends SelectQueryBuilder<IDatabase, 'state_executions', Selectable<IStateExecutionsTable>>>(
  query: Q,
  filter: IListExecutionsFilter,
): Q {
  let q = query;
  if (filter.extensionId !== undefined) {
    // Qualified-or-bare, the same grammar `sm check --analyzers` and
    // `sm findings --extension` use (`kernel/util/analyzer-filter.ts`):
    // rows persist the QUALIFIED id, so an exact `=` made a legitimate
    // bare id (`reference-broken` for `core/reference-broken`) return
    // an empty list with exit 0, i.e. a silent wrong answer.
    //
    // The second branch compares the segment after the FIRST `/`.
    // `instr` returns 0 when the id carries no slash, and
    // `substr(x, 0 + 1)` is then the whole string, so an unqualified
    // stored id still matches itself. Deliberately NOT `LIKE '%/' || ?`:
    // extension ids may contain `_`, which LIKE reads as a wildcard.
    const wanted = filter.extensionId;
    q = q.where((eb) =>
      eb.or([
        eb('extensionId', '=', wanted),
        eb(
          sql<string>`substr(state_executions.extension_id, instr(state_executions.extension_id, '/') + 1)`,
          '=',
          wanted,
        ),
      ]),
    ) as Q;
  }
  if (filter.statuses && filter.statuses.length > 0) q = q.where('status', 'in', filter.statuses) as Q;
  if (filter.sinceMs !== undefined) q = q.where('startedAt', '>=', filter.sinceMs) as Q;
  if (filter.untilMs !== undefined) q = q.where('startedAt', '<', filter.untilMs) as Q;
  if (filter.nodePath !== undefined) {
    // JSON1 containment via correlated EXISTS. Same pattern as
    // `sm list --issue` (see src/cli/commands/list.ts).
    const target = filter.nodePath;
    q = q.where(({ exists, selectFrom }) =>
      exists(
        selectFrom(
          sql<{ value: string }>`json_each(state_executions.node_ids_json)`.as('je'),
        )
          .select(sql<number>`1`.as('one'))
          .where(sql.ref('je.value'), '=', target),
      ),
    ) as Q;
  }
  return q;
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
  model: string | null;
  reportJson: string | null;
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
    runner: row.runner as 'agent' | 'in-process' | null,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    model: row.model,
    // The `report_json` column maps back onto the legacy domain field
    // `ExecutionRecord.reportPath` (schema rename to `report` is a later
    // Step 10 sub-step; the field name is preserved for now).
    reportPath: row.reportJson,
    jobId: row.jobId,
  };
}

function parseStringArray(s: string): string[] {
  const parsed = JSON.parse(s) as unknown;
  return Array.isArray(parsed) ? (parsed as string[]) : [];
}

// --- Aggregations ----------------------------------------------------------

/**
 * Compute the bucketed aggregations that back `sm history stats --json`.
 * The caller is responsible for `elapsedMs` and for serialising
 * `range.{since,until}` to ISO-8601 strings, this function returns the
 * window in Unix ms so callers can keep their boundaries exact.
 */
export async function aggregateHistoryStats(
  db: TDbOrTx,
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

  // Per-extension accumulators.
  const perExtension = new Map<
    string,
    {
      extensionId: string;
      extensionVersion: string;
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
    'user-failed': 0,
  };

  const totals = { executionsCount, completedCount, failedCount, tokensInTotal, tokensOutTotal, durationMsTotal };
  for (const row of rows) {
    accumulateExecutionRow(row, totals, perFailureReason, perExtension, perPeriod, perNode, period);
  }
  // Re-bind locals from the mutated totals object.
  executionsCount = totals.executionsCount;
  completedCount = totals.completedCount;
  failedCount = totals.failedCount;
  tokensInTotal = totals.tokensInTotal;
  tokensOutTotal = totals.tokensOutTotal;
  durationMsTotal = totals.durationMsTotal;

  // tokensPerExtension sorted desc by tokensIn + tokensOut.
  const tokensPerExtension: HistoryStatsTokensPerExtension[] = Array.from(perExtension.values())
    .map((acc) => ({
      extensionId: acc.extensionId,
      extensionVersion: acc.extensionVersion,
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

  // Per-extension error rate. Sorted desc by rate, tie-break asc by
  // extensionId.
  const perExtensionRates: HistoryStatsPerExtensionRate[] = Array.from(perExtension.values())
    .map((acc) => ({
      extensionId: acc.extensionId,
      rate: acc.executionsCount === 0 ? 0 : acc.failedCount / acc.executionsCount,
      executionsCount: acc.executionsCount,
      failedCount: acc.failedCount,
    }))
    .sort((a, b) => {
      if (b.rate !== a.rate) return b.rate - a.rate;
      return a.extensionId.localeCompare(b.extensionId);
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
    tokensPerExtension,
    executionsPerPeriod,
    topNodes,
    errorRates: {
      global: executionsCount === 0 ? 0 : failedCount / executionsCount,
      perExtension: perExtensionRates,
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

interface IPerExtensionAcc {
  extensionId: string;
  extensionVersion: string;
  executionsCount: number;
  tokensIn: number;
  tokensOut: number;
  durations: number[];
  failedCount: number;
}

/**
 * Fold one `state_executions` row into every accumulator the
 * `aggregateHistoryStats` query needs: totals, per-failure-reason
 * counts, per-extension rollup, per-period bucket, per-node rollup. Pure
 * mutation of the supplied containers, caller iterates rows and emits
 * the final stats from the same containers afterward.
 *
 * Cyclomatic count comes from folding into 5 distinct accumulators in
 * one pass; per-accumulator helpers would split state mutation across
 * more files without making the algorithm clearer.
 */
function accumulateExecutionRow(
  row: Selectable<IStateExecutionsTable>,
  totals: IExecutionRowTotals,
  perFailureReason: Record<ExecutionFailureReason, number>,
  perExtension: Map<string, IPerExtensionAcc>,
  perPeriod: Map<number, { tokensIn: number; tokensOut: number; executionsCount: number }>,
  perNode: Map<string, { executionsCount: number; lastExecutedAt: number }>,
  period: THistoryStatsPeriod,
): void {
  const tIn = row.tokensIn ?? 0;
  const tOut = row.tokensOut ?? 0;
  accumulateTotals(row, tIn, tOut, totals, perFailureReason);
  accumulatePerExtension(row, tIn, tOut, perExtension);
  accumulatePerPeriod(row, tIn, tOut, perPeriod, period);
  accumulatePerNode(row, perNode);
}

function accumulateTotals(
  row: Selectable<IStateExecutionsTable>,
  tIn: number,
  tOut: number,
  totals: IExecutionRowTotals,
  perFailureReason: Record<ExecutionFailureReason, number>,
): void {
  totals.executionsCount += 1;
  totals.tokensInTotal += tIn;
  totals.tokensOutTotal += tOut;
  if (row.durationMs !== null) totals.durationMsTotal += row.durationMs;
  if (row.status === 'completed') totals.completedCount += 1;
  if (row.status === 'failed') totals.failedCount += 1;
  if (row.failureReason !== null) {
    const reason = row.failureReason as ExecutionFailureReason;
    if (FAILURE_REASONS.includes(reason)) perFailureReason[reason] += 1;
  }
}

function accumulatePerExtension(
  row: Selectable<IStateExecutionsTable>,
  tIn: number,
  tOut: number,
  perExtension: Map<string, IPerExtensionAcc>,
): void {
  const extensionKey = `${row.extensionId}@${row.extensionVersion}`;
  let extensionAcc = perExtension.get(extensionKey);
  if (!extensionAcc) {
    extensionAcc = {
      extensionId: row.extensionId,
      extensionVersion: row.extensionVersion,
      executionsCount: 0,
      tokensIn: 0,
      tokensOut: 0,
      durations: [],
      failedCount: 0,
    };
    perExtension.set(extensionKey, extensionAcc);
  }
  extensionAcc.executionsCount += 1;
  extensionAcc.tokensIn += tIn;
  extensionAcc.tokensOut += tOut;
  if (row.durationMs !== null) extensionAcc.durations.push(row.durationMs);
  if (row.status === 'failed') extensionAcc.failedCount += 1;
}

function accumulatePerPeriod(
  row: Selectable<IStateExecutionsTable>,
  tIn: number,
  tOut: number,
  perPeriod: Map<number, { tokensIn: number; tokensOut: number; executionsCount: number }>,
  period: THistoryStatsPeriod,
): void {
  const bucketStart = bucketStartMs(row.startedAt, period);
  let periodAcc = perPeriod.get(bucketStart);
  if (!periodAcc) {
    periodAcc = { tokensIn: 0, tokensOut: 0, executionsCount: 0 };
    perPeriod.set(bucketStart, periodAcc);
  }
  periodAcc.executionsCount += 1;
  periodAcc.tokensIn += tIn;
  periodAcc.tokensOut += tOut;
}

function accumulatePerNode(
  row: Selectable<IStateExecutionsTable>,
  perNode: Map<string, { executionsCount: number; lastExecutedAt: number }>,
): void {
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
 * surface-visible across scans: the per-scan rename heuristic
 * only sees paths in `prior \ current` of the *immediately preceding*
 * scan, so a stale reference from two scans ago becomes invisible after
 * one more scan. This sweep catches any `state_*` row whose `node_id`
 * (or any element of the `node_ids_json` array) is not in `livePaths`.
 *
 * Returns paths in deterministic lex-asc order.
 */
export async function findStrandedStateOrphans(
  trx: TDbOrTx,
  livePaths: Set<string>,
): Promise<string[]> {
  // One UNION probe over the seven `state_*` reference sources instead
  // of seven separate round-trips (this runs unconditionally on every
  // persist, warm scans included). `UNION` (not `UNION ALL`) dedupes in
  // SQL, mirroring the Set the per-table collectors used to fill.
  // Notes preserved from the historical collectors:
  //   - `state_executions.node_ids_json` is a JSON array; `json_each`
  //     explodes it so every element participates.
  //   - `state_plugin_kvs` uses the empty-string sentinel for
  //     plugin-global keys; that's not a node reference, exclude it.
  const rows = await trx
    .selectFrom(
      sql<{ value: string }>`(
        SELECT node_id AS value FROM state_jobs
        UNION
        SELECT je.value FROM state_executions, json_each(state_executions.node_ids_json) je
        UNION
        SELECT node_id FROM state_summaries
        UNION
        SELECT node_id FROM state_findings
        UNION
        SELECT node_id FROM state_enrichments
        UNION
        SELECT node_id FROM state_plugin_kvs WHERE node_id != ''
        UNION
        SELECT node_path FROM state_node_favorites
      )`.as('stateRefs'),
    )
    .select(['value'])
    .execute();
  const stranded = new Set<string>();
  for (const r of rows) {
    if (!livePaths.has(r.value)) stranded.add(r.value);
  }
  return [...stranded].sort();
}

// --- FK migration ---------------------------------------------------------

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
  trx: TDbOrTx,
  fromPath: string,
  toPath: string,
): Promise<IMigrateNodeFksReport> {
  const report: IMigrateNodeFksReport = emptyMigrateReport();
  if (fromPath === toPath) return report;

  await migrateJobs(trx, fromPath, toPath, report);
  await migrateExecutions(trx, fromPath, toPath, report);
  await migrateSummaries(trx, fromPath, toPath, report);
  await migrateFindings(trx, fromPath, toPath, report);
  await migrateEnrichments(trx, fromPath, toPath, report);
  if (fromPath !== '') await migratePluginKvs(trx, fromPath, toPath, report);
  await migrateNodeFavorites(trx, fromPath, toPath, report);
  await migrateActivityStats(trx, fromPath, toPath, report);
  await migrateActivityPairs(trx, fromPath, toPath, report);
  return report;
}

function emptyMigrateReport(): IMigrateNodeFksReport {
  return {
    jobs: 0,
    executions: 0,
    summaries: 0,
    findings: 0,
    enrichments: 0,
    pluginKvs: 0,
    nodeFavorites: 0,
    activityStats: 0,
    activityPairs: 0,
    collisions: [],
  };
}

/** state_jobs.node_id, simple column, simple UPDATE. */
async function migrateJobs(
  trx: TDbOrTx,
  fromPath: string,
  toPath: string,
  report: IMigrateNodeFksReport,
): Promise<void> {
  const result = await trx
    .updateTable('state_jobs')
    .set({ nodeId: toPath })
    .where('nodeId', '=', fromPath)
    .executeTakeFirst();
  report.jobs = Number(result.numUpdatedRows ?? 0);
}

/** state_executions.node_ids_json, JSON array; pull, replace, write. */
async function migrateExecutions(
  trx: TDbOrTx,
  fromPath: string,
  toPath: string,
  report: IMigrateNodeFksReport,
): Promise<void> {
  const rows = await trx
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
  for (const row of rows) {
    const ids = parseStringArray(row.nodeIdsJson);
    let mutated = false;
    const updated = ids.map((p) => {
      if (p !== fromPath) return p;
      mutated = true;
      return toPath;
    });
    if (!mutated) continue;
    await trx
      .updateTable('state_executions')
      .set({ nodeIdsJson: JSON.stringify(updated) })
      .where('id', '=', row.id)
      .execute();
    report.executions += 1;
  }
}

/** state_summaries, composite PK (node_id, summarizer_action_id). */
async function migrateSummaries(
  trx: TDbOrTx,
  fromPath: string,
  toPath: string,
  report: IMigrateNodeFksReport,
): Promise<void> {
  const rows = await trx
    .selectFrom('state_summaries')
    .selectAll()
    .where('nodeId', '=', fromPath)
    .execute();
  for (const row of rows) {
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
}

/**
 * state_findings.node_id, integer surrogate PK, so a plain UPDATE cannot
 * collide (same shape as `state_jobs`, no composite-key drop path).
 */
async function migrateFindings(
  trx: TDbOrTx,
  fromPath: string,
  toPath: string,
  report: IMigrateNodeFksReport,
): Promise<void> {
  const result = await trx
    .updateTable('state_findings')
    .set({ nodeId: toPath })
    .where('nodeId', '=', fromPath)
    .executeTakeFirst();
  report.findings = Number(result.numUpdatedRows ?? 0);
}

/** state_enrichments, composite PK (node_id, provider_id). */
async function migrateEnrichments(
  trx: TDbOrTx,
  fromPath: string,
  toPath: string,
  report: IMigrateNodeFksReport,
): Promise<void> {
  const rows = await trx
    .selectFrom('state_enrichments')
    .selectAll()
    .where('nodeId', '=', fromPath)
    .execute();
  for (const row of rows) {
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
}

/** state_plugin_kvs, composite PK (plugin_id, node_id, key). */
async function migratePluginKvs(
  trx: TDbOrTx,
  fromPath: string,
  toPath: string,
  report: IMigrateNodeFksReport,
): Promise<void> {
  const rows = await trx
    .selectFrom('state_plugin_kvs')
    .selectAll()
    .where('nodeId', '=', fromPath)
    .execute();
  for (const row of rows) {
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

/**
 * state_node_favorites, single-column PK on node_path. Drop the
 * migrating row if the destination already holds a favorite
 * (preserve the live node's record), otherwise update in place.
 */
/**
 * state_activity_stats.node_path, simple PK: delete + reinsert at the
 * new path (favorites protocol). A destination row wins on collision.
 */
async function migrateActivityStats(
  trx: TDbOrTx,
  fromPath: string,
  toPath: string,
  report: IMigrateNodeFksReport,
): Promise<void> {
  const row = await trx
    .selectFrom('state_activity_stats')
    .selectAll()
    .where('nodePath', '=', fromPath)
    .executeTakeFirst();
  if (!row) return;
  const collision = await trx
    .selectFrom('state_activity_stats')
    .select(['nodePath'])
    .where('nodePath', '=', toPath)
    .executeTakeFirst();
  await trx.deleteFrom('state_activity_stats').where('nodePath', '=', fromPath).execute();
  if (collision) {
    report.collisions.push({ table: 'state_activity_stats', fromPath, toPath, keys: {} });
    return;
  }
  await trx
    .insertInto('state_activity_stats')
    .values({ ...row, nodePath: toPath })
    .execute();
  report.activityStats += 1;
}

/**
 * state_activity_pairs, composite PK `(parent, child_node_path)`: every
 * row naming the path on either side is repointed, row by row, so a
 * destination that already exists is reported as a collision (the
 * destination row wins) instead of tripping the PK.
 */
async function migrateActivityPairs(
  trx: TDbOrTx,
  fromPath: string,
  toPath: string,
  report: IMigrateNodeFksReport,
): Promise<void> {
  const rows = await trx
    .selectFrom('state_activity_pairs')
    .selectAll()
    .where((eb) => eb.or([eb('parent', '=', fromPath), eb('childNodePath', '=', fromPath)]))
    .execute();
  for (const row of rows) {
    const parent = row.parent === fromPath ? toPath : row.parent;
    const childNodePath = row.childNodePath === fromPath ? toPath : row.childNodePath;
    const collision = await trx
      .selectFrom('state_activity_pairs')
      .select(['parent'])
      .where('parent', '=', parent)
      .where('childNodePath', '=', childNodePath)
      .executeTakeFirst();
    await trx
      .deleteFrom('state_activity_pairs')
      .where('parent', '=', row.parent)
      .where('childNodePath', '=', row.childNodePath)
      .execute();
    if (collision) {
      report.collisions.push({
        table: 'state_activity_pairs',
        fromPath,
        toPath,
        keys: { parent, childNodePath },
      });
      continue;
    }
    await trx
      .insertInto('state_activity_pairs')
      .values({ parent, childNodePath, count: row.count, lastStartAt: row.lastStartAt })
      .execute();
    report.activityPairs += 1;
  }
}

async function migrateNodeFavorites(
  trx: TDbOrTx,
  fromPath: string,
  toPath: string,
  report: IMigrateNodeFksReport,
): Promise<void> {
  const favRow = await trx
    .selectFrom('state_node_favorites')
    .selectAll()
    .where('nodePath', '=', fromPath)
    .executeTakeFirst();
  if (!favRow) return;
  const collision = await trx
    .selectFrom('state_node_favorites')
    .select(['nodePath'])
    .where('nodePath', '=', toPath)
    .executeTakeFirst();
  await trx
    .deleteFrom('state_node_favorites')
    .where('nodePath', '=', fromPath)
    .execute();
  if (collision) {
    report.collisions.push({
      table: 'state_node_favorites',
      fromPath,
      toPath,
      keys: {},
    });
    return;
  }
  await trx
    .insertInto('state_node_favorites')
    .values({ nodePath: toPath, favoritedAt: favRow.favoritedAt })
    .execute();
  report.nodeFavorites += 1;
}
