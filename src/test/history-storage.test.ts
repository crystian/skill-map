/**
 * Step 5.2 acceptance tests for the history storage helpers
 * (`src/kernel/adapters/sqlite/history.ts`):
 *
 *   - insertExecution + listExecutions round-trip with each filter axis;
 *   - aggregateHistoryStats: totals, tokens-per-action sort,
 *     bucketing UTC for day/week/month, top-nodes tie-break, and the
 *     full per-failure-reason key set always present;
 *   - migrateNodeFks: covers the three FK shapes (simple column,
 *     JSON-array contents, composite PK delete+insert) including the
 *     conservative composite-PK collision behaviour.
 */

import { after, before, describe, it } from 'node:test';
import {
  deepStrictEqual,
  ok,
  strictEqual,
} from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import {
  aggregateHistoryStats,
  bucketStartMs,
  insertExecution,
  listExecutions,
  migrateNodeFks,
} from '../kernel/adapters/sqlite/history.js';
import type { ExecutionRecord } from '../kernel/types.js';

let dbRoot: string;
let dbCounter = 0;

function freshDbPath(label: string): string {
  dbCounter += 1;
  return join(dbRoot, `${label}-${dbCounter}.db`);
}

before(() => {
  dbRoot = mkdtempSync(join(tmpdir(), 'skill-map-history-'));
});

after(() => {
  rmSync(dbRoot, { recursive: true, force: true });
});

function makeExec(partial: Partial<ExecutionRecord> & Pick<ExecutionRecord, 'id' | 'startedAt'>): ExecutionRecord {
  return {
    kind: 'action',
    extensionId: 'a1',
    extensionVersion: '1.0.0',
    nodeIds: ['skills/foo.md'],
    contentHash: null,
    status: 'completed',
    failureReason: null,
    exitCode: 0,
    runner: 'cli',
    finishedAt: partial.startedAt + 1000,
    durationMs: 1000,
    tokensIn: 100,
    tokensOut: 50,
    reportPath: null,
    jobId: null,
    ...partial,
  };
}

describe('insertExecution + listExecutions', () => {
  it('round-trips a populated record across every field', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('rt'), autoBackup: false });
    await adapter.init();
    try {
      const exec = makeExec({ id: 'e1', startedAt: 1_000_000 });
      await insertExecution(adapter.db, exec);

      const rows = await listExecutions(adapter.db);
      strictEqual(rows.length, 1);
      const r = rows[0]!;
      strictEqual(r.id, 'e1');
      strictEqual(r.kind, 'action');
      strictEqual(r.extensionId, 'a1');
      strictEqual(r.extensionVersion, '1.0.0');
      deepStrictEqual(r.nodeIds, ['skills/foo.md']);
      strictEqual(r.status, 'completed');
      strictEqual(r.runner, 'cli');
      strictEqual(r.startedAt, 1_000_000);
      strictEqual(r.finishedAt, 1_001_000);
      strictEqual(r.durationMs, 1000);
      strictEqual(r.tokensIn, 100);
      strictEqual(r.tokensOut, 50);
    } finally {
      await adapter.close();
    }
  });

  it('filters by nodePath, actionId, statuses, sinceMs/untilMs, and limit', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('filters'), autoBackup: false });
    await adapter.init();
    try {
      // 5 executions: span 2 actions, 2 statuses, 2 distinct node paths.
      await insertExecution(adapter.db, makeExec({ id: 'e1', startedAt: 1000, extensionId: 'a1', nodeIds: ['skills/foo.md'], status: 'completed' }));
      await insertExecution(adapter.db, makeExec({ id: 'e2', startedAt: 2000, extensionId: 'a1', nodeIds: ['skills/bar.md'], status: 'failed', failureReason: 'timeout' }));
      await insertExecution(adapter.db, makeExec({ id: 'e3', startedAt: 3000, extensionId: 'a2', nodeIds: ['skills/foo.md'], status: 'cancelled', failureReason: 'user-cancelled' }));
      await insertExecution(adapter.db, makeExec({ id: 'e4', startedAt: 4000, extensionId: 'a2', nodeIds: ['skills/foo.md', 'skills/bar.md'], status: 'completed' }));
      await insertExecution(adapter.db, makeExec({ id: 'e5', startedAt: 5000, extensionId: 'a2', nodeIds: [], status: 'completed' }));

      // nodePath
      const fooRows = await listExecutions(adapter.db, { nodePath: 'skills/foo.md' });
      deepStrictEqual(
        fooRows.map((r) => r.id).sort(),
        ['e1', 'e3', 'e4'],
      );

      // actionId
      const a1 = await listExecutions(adapter.db, { actionId: 'a1' });
      deepStrictEqual(a1.map((r) => r.id).sort(), ['e1', 'e2']);

      // statuses
      const failedOrCancelled = await listExecutions(adapter.db, { statuses: ['failed', 'cancelled'] });
      deepStrictEqual(failedOrCancelled.map((r) => r.id).sort(), ['e2', 'e3']);

      // sinceMs (inclusive) + untilMs (exclusive)
      const window = await listExecutions(adapter.db, { sinceMs: 2000, untilMs: 4000 });
      deepStrictEqual(window.map((r) => r.id).sort(), ['e2', 'e3']);

      // limit
      const limit2 = await listExecutions(adapter.db, { limit: 2 });
      strictEqual(limit2.length, 2);
      // most-recent-first: e5 then e4.
      deepStrictEqual(limit2.map((r) => r.id), ['e5', 'e4']);
    } finally {
      await adapter.close();
    }
  });
});

describe('bucketStartMs', () => {
  it('day: floors to UTC 00:00:00 of the same date', () => {
    const ms = Date.UTC(2026, 3, 26, 23, 30, 15, 500);
    strictEqual(bucketStartMs(ms, 'day'), Date.UTC(2026, 3, 26, 0, 0, 0, 0));
    // Just past midnight UTC moves into the new day.
    const ms2 = Date.UTC(2026, 3, 27, 0, 30, 0, 0);
    strictEqual(bucketStartMs(ms2, 'day'), Date.UTC(2026, 3, 27, 0, 0, 0, 0));
  });

  it('week: floors to Monday 00:00 UTC', () => {
    // 2026-04-26 is a Sunday → Monday-anchored week starts 2026-04-20.
    const sunday = Date.UTC(2026, 3, 26, 12, 0, 0, 0);
    strictEqual(bucketStartMs(sunday, 'week'), Date.UTC(2026, 3, 20, 0, 0, 0, 0));
    // Monday itself is its own bucket start.
    const monday = Date.UTC(2026, 3, 20, 0, 0, 0, 0);
    strictEqual(bucketStartMs(monday, 'week'), monday);
    // Wednesday rolls back to Monday of same week.
    const wed = Date.UTC(2026, 3, 22, 9, 0, 0, 0);
    strictEqual(bucketStartMs(wed, 'week'), Date.UTC(2026, 3, 20, 0, 0, 0, 0));
  });

  it('month: floors to day-1 00:00 UTC', () => {
    const ms = Date.UTC(2026, 3, 26, 12, 0, 0, 0);
    strictEqual(bucketStartMs(ms, 'month'), Date.UTC(2026, 3, 1, 0, 0, 0, 0));
  });
});

describe('aggregateHistoryStats', () => {
  it('produces totals, per-action, per-period, top-nodes, and the full failure-reason key set', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('agg'), autoBackup: false });
    await adapter.init();
    try {
      // 3 completed (a1) + 1 failed (a2) + 1 failed (a1) = 5 total, 2 failed.
      // Tokens spread to exercise sort. Two distinct nodes; foo.md most-frequent.
      const t0 = Date.UTC(2026, 3, 26, 10, 0, 0, 0);
      const day = 24 * 60 * 60 * 1000;
      await insertExecution(adapter.db, makeExec({ id: 'e1', startedAt: t0,         extensionId: 'a1', tokensIn: 10, tokensOut: 20, durationMs: 100,  nodeIds: ['skills/foo.md'] }));
      await insertExecution(adapter.db, makeExec({ id: 'e2', startedAt: t0 + day,   extensionId: 'a1', tokensIn: 10, tokensOut: 20, durationMs: 200,  nodeIds: ['skills/foo.md'] }));
      await insertExecution(adapter.db, makeExec({ id: 'e3', startedAt: t0 + 2*day, extensionId: 'a1', tokensIn: 10, tokensOut: 20, durationMs: 300,  status: 'failed', failureReason: 'runner-error', nodeIds: ['skills/bar.md'] }));
      await insertExecution(adapter.db, makeExec({ id: 'e4', startedAt: t0 + 3*day, extensionId: 'a2', tokensIn: 1,  tokensOut: 1,  durationMs: 50,   status: 'failed', failureReason: 'timeout',       nodeIds: ['skills/foo.md'] }));
      await insertExecution(adapter.db, makeExec({ id: 'e5', startedAt: t0 + 4*day, extensionId: 'a2', tokensIn: 1,  tokensOut: 1,  durationMs: 50,                     nodeIds: ['skills/foo.md'] }));

      const stats = await aggregateHistoryStats(
        adapter.db,
        { sinceMs: t0 - day, untilMs: t0 + 5 * day },
        'day',
        10,
      );

      // Totals
      strictEqual(stats.totals.executionsCount, 5);
      strictEqual(stats.totals.completedCount, 3);
      strictEqual(stats.totals.failedCount, 2);
      strictEqual(stats.totals.tokensIn, 32);
      strictEqual(stats.totals.tokensOut, 62);
      strictEqual(stats.totals.durationMsTotal, 700);

      // Per-action sorted desc by tokens (a1 has more).
      strictEqual(stats.tokensPerAction.length, 2);
      strictEqual(stats.tokensPerAction[0]!.actionId, 'a1');
      strictEqual(stats.tokensPerAction[0]!.executionsCount, 3);
      strictEqual(stats.tokensPerAction[0]!.tokensIn, 30);
      strictEqual(stats.tokensPerAction[0]!.tokensOut, 60);
      strictEqual(stats.tokensPerAction[0]!.durationMsMean, 200);
      strictEqual(stats.tokensPerAction[0]!.durationMsMedian, 200);

      // Per-period: 5 day buckets (one execution per day).
      strictEqual(stats.executionsPerPeriod.length, 5);
      // Day buckets are sorted asc; first is the t0-day bucket.
      strictEqual(stats.executionsPerPeriod[0]!.periodStart, new Date(Date.UTC(2026, 3, 26, 0, 0, 0, 0)).toISOString());
      strictEqual(stats.executionsPerPeriod[0]!.executionsCount, 1);

      // Top nodes: foo.md (4) > bar.md (1).
      strictEqual(stats.topNodes[0]!.nodePath, 'skills/foo.md');
      strictEqual(stats.topNodes[0]!.executionsCount, 4);
      strictEqual(stats.topNodes[1]!.nodePath, 'skills/bar.md');
      strictEqual(stats.topNodes[1]!.executionsCount, 1);

      // Error rates: 2/5 = 0.4 global; per failure reason has all 6 keys.
      strictEqual(stats.errorRates.global, 2 / 5);
      strictEqual(stats.errorRates.perFailureReason['runner-error'], 1);
      strictEqual(stats.errorRates.perFailureReason['timeout'], 1);
      strictEqual(stats.errorRates.perFailureReason['report-invalid'], 0);
      strictEqual(stats.errorRates.perFailureReason['abandoned'], 0);
      strictEqual(stats.errorRates.perFailureReason['job-file-missing'], 0);
      strictEqual(stats.errorRates.perFailureReason['user-cancelled'], 0);

      // Per-action failure rates: a1 → 1/3, a2 → 1/2, sorted desc by rate.
      strictEqual(stats.errorRates.perAction[0]!.actionId, 'a2');
      strictEqual(stats.errorRates.perAction[0]!.rate, 1 / 2);
      strictEqual(stats.errorRates.perAction[1]!.actionId, 'a1');
      strictEqual(stats.errorRates.perAction[1]!.rate, 1 / 3);
    } finally {
      await adapter.close();
    }
  });

  it('topNodes: tie-break by lastExecutedAt desc when counts match', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('topnodes'), autoBackup: false });
    await adapter.init();
    try {
      const t0 = 1_000_000;
      // Two nodes with identical execution count (1); the one executed
      // later wins the tie.
      await insertExecution(adapter.db, makeExec({ id: 'e1', startedAt: t0,        nodeIds: ['skills/older.md'] }));
      await insertExecution(adapter.db, makeExec({ id: 'e2', startedAt: t0 + 5000, nodeIds: ['skills/newer.md'] }));

      const stats = await aggregateHistoryStats(
        adapter.db,
        { sinceMs: null, untilMs: t0 + 10_000 },
        'day',
        10,
      );
      strictEqual(stats.topNodes[0]!.nodePath, 'skills/newer.md');
      strictEqual(stats.topNodes[1]!.nodePath, 'skills/older.md');
    } finally {
      await adapter.close();
    }
  });

  it('empty window: zero counts, zero global error rate, no buckets, no top nodes — all 6 failure-reason keys still present', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('empty'), autoBackup: false });
    await adapter.init();
    try {
      const stats = await aggregateHistoryStats(
        adapter.db,
        { sinceMs: null, untilMs: Date.now() },
        'month',
        10,
      );
      strictEqual(stats.totals.executionsCount, 0);
      strictEqual(stats.errorRates.global, 0);
      strictEqual(stats.executionsPerPeriod.length, 0);
      strictEqual(stats.topNodes.length, 0);
      // All 6 keys present and zero — predictable shape for dashboards.
      strictEqual(Object.keys(stats.errorRates.perFailureReason).length, 6);
      for (const v of Object.values(stats.errorRates.perFailureReason)) {
        strictEqual(v, 0);
      }
    } finally {
      await adapter.close();
    }
  });
});

describe('migrateNodeFks', () => {
  it('migrates state_jobs.node_id (simple column UPDATE)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('jobs'), autoBackup: false });
    await adapter.init();
    try {
      const now = Date.now();
      await adapter.db.insertInto('state_jobs').values({
        id: 'j1',
        actionId: 'a1',
        actionVersion: '1.0.0',
        nodeId: 'skills/old.md',
        contentHash: 'h',
        nonce: 'n',
        status: 'queued',
        ttlSeconds: 60,
        createdAt: now,
      }).execute();
      const report = await migrateNodeFks(adapter.db, 'skills/old.md', 'skills/new.md');
      strictEqual(report.jobs, 1);
      const job = await adapter.db.selectFrom('state_jobs').selectAll().where('id', '=', 'j1').executeTakeFirstOrThrow();
      strictEqual(job.nodeId, 'skills/new.md');
    } finally {
      await adapter.close();
    }
  });

  it('migrates state_executions.node_ids_json (JSON array rewrite, leaves siblings alone)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('execs'), autoBackup: false });
    await adapter.init();
    try {
      await insertExecution(adapter.db, makeExec({ id: 'e1', startedAt: 1000, nodeIds: ['skills/old.md'] }));
      await insertExecution(adapter.db, makeExec({ id: 'e2', startedAt: 2000, nodeIds: ['skills/old.md', 'skills/keep.md'] }));
      await insertExecution(adapter.db, makeExec({ id: 'e3', startedAt: 3000, nodeIds: ['skills/keep.md'] }));

      const report = await migrateNodeFks(adapter.db, 'skills/old.md', 'skills/new.md');
      strictEqual(report.executions, 2, 'two rows mutated, e3 untouched');

      const rows = await listExecutions(adapter.db);
      const e1 = rows.find((r) => r.id === 'e1')!;
      const e2 = rows.find((r) => r.id === 'e2')!;
      const e3 = rows.find((r) => r.id === 'e3')!;
      deepStrictEqual(e1.nodeIds, ['skills/new.md']);
      deepStrictEqual(e2.nodeIds, ['skills/new.md', 'skills/keep.md']);
      deepStrictEqual(e3.nodeIds, ['skills/keep.md']);
    } finally {
      await adapter.close();
    }
  });

  it('migrates state_summaries with composite PK (delete+insert at new node_id)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('summ'), autoBackup: false });
    await adapter.init();
    try {
      await adapter.db.insertInto('state_summaries').values({
        nodeId: 'skills/old.md',
        kind: 'skill',
        summarizerActionId: 'sum-1',
        summarizerVersion: '1.0.0',
        bodyHashAtGeneration: 'h',
        generatedAt: Date.now(),
        summaryJson: '{}',
      }).execute();

      const report = await migrateNodeFks(adapter.db, 'skills/old.md', 'skills/new.md');
      strictEqual(report.summaries, 1);
      strictEqual(report.collisions.length, 0);

      const newRow = await adapter.db.selectFrom('state_summaries').selectAll().where('nodeId', '=', 'skills/new.md').executeTakeFirstOrThrow();
      strictEqual(newRow.summarizerActionId, 'sum-1');
      const oldGone = await adapter.db.selectFrom('state_summaries').selectAll().where('nodeId', '=', 'skills/old.md').execute();
      strictEqual(oldGone.length, 0);
    } finally {
      await adapter.close();
    }
  });

  it('migrates state_enrichments with composite PK (delete+insert)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('enrich'), autoBackup: false });
    await adapter.init();
    try {
      await adapter.db.insertInto('state_enrichments').values({
        nodeId: 'skills/old.md',
        providerId: 'p1',
        dataJson: '{}',
        verified: 1,
        fetchedAt: Date.now(),
        staleAfter: null,
      }).execute();
      const report = await migrateNodeFks(adapter.db, 'skills/old.md', 'skills/new.md');
      strictEqual(report.enrichments, 1);
      const newRow = await adapter.db.selectFrom('state_enrichments').selectAll().where('nodeId', '=', 'skills/new.md').executeTakeFirstOrThrow();
      strictEqual(newRow.providerId, 'p1');
    } finally {
      await adapter.close();
    }
  });

  it('migrates state_plugin_kvs with composite PK (skips empty-string sentinel scope)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('kv'), autoBackup: false });
    await adapter.init();
    try {
      const now = Date.now();
      // Per-node row that should migrate.
      await adapter.db.insertInto('state_plugin_kvs').values({
        pluginId: 'pi',
        nodeId: 'skills/old.md',
        key: 'k',
        valueJson: '"v"',
        updatedAt: now,
      }).execute();
      // Plugin-global row (sentinel '') — must NOT migrate.
      await adapter.db.insertInto('state_plugin_kvs').values({
        pluginId: 'pi',
        nodeId: '',
        key: 'global',
        valueJson: '"g"',
        updatedAt: now,
      }).execute();

      const report = await migrateNodeFks(adapter.db, 'skills/old.md', 'skills/new.md');
      strictEqual(report.pluginKvs, 1);

      const newRow = await adapter.db.selectFrom('state_plugin_kvs').selectAll().where('nodeId', '=', 'skills/new.md').executeTakeFirstOrThrow();
      strictEqual(newRow.key, 'k');
      const sentinel = await adapter.db.selectFrom('state_plugin_kvs').selectAll().where('nodeId', '=', '').executeTakeFirstOrThrow();
      strictEqual(sentinel.key, 'global', 'sentinel row preserved');
    } finally {
      await adapter.close();
    }
  });

  it('composite-PK collision: keeps the destination row and reports the dropped row', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('collision'), autoBackup: false });
    await adapter.init();
    try {
      // Two summaries: same summarizer_action_id at old.md and new.md.
      // Migration must drop the old.md row (collision) and keep new.md
      // (it represents the live node's history).
      await adapter.db.insertInto('state_summaries').values([
        {
          nodeId: 'skills/old.md',
          kind: 'skill',
          summarizerActionId: 'sum-1',
          summarizerVersion: '1.0.0',
          bodyHashAtGeneration: 'h-old',
          generatedAt: 1000,
          summaryJson: '{"v":"old"}',
        },
        {
          nodeId: 'skills/new.md',
          kind: 'skill',
          summarizerActionId: 'sum-1',
          summarizerVersion: '1.0.0',
          bodyHashAtGeneration: 'h-new',
          generatedAt: 2000,
          summaryJson: '{"v":"new"}',
        },
      ]).execute();

      const report = await migrateNodeFks(adapter.db, 'skills/old.md', 'skills/new.md');
      strictEqual(report.summaries, 0, 'no row migrated through');
      strictEqual(report.collisions.length, 1);
      const c = report.collisions[0]!;
      strictEqual(c.table, 'state_summaries');
      strictEqual(c.fromPath, 'skills/old.md');
      strictEqual(c.toPath, 'skills/new.md');
      strictEqual(c.keys['summarizerActionId'], 'sum-1');

      // The pre-existing destination row survives untouched.
      const surviving = await adapter.db.selectFrom('state_summaries').selectAll().where('nodeId', '=', 'skills/new.md').executeTakeFirstOrThrow();
      strictEqual(surviving.bodyHashAtGeneration, 'h-new');
      // The old-path row is gone.
      const old = await adapter.db.selectFrom('state_summaries').selectAll().where('nodeId', '=', 'skills/old.md').execute();
      strictEqual(old.length, 0);
    } finally {
      await adapter.close();
    }
  });

  it('no-op when fromPath === toPath (defensive guard)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('noop'), autoBackup: false });
    await adapter.init();
    try {
      const report = await migrateNodeFks(adapter.db, 'skills/x.md', 'skills/x.md');
      strictEqual(report.jobs, 0);
      strictEqual(report.executions, 0);
      strictEqual(report.summaries, 0);
      strictEqual(report.enrichments, 0);
      strictEqual(report.pluginKvs, 0);
      strictEqual(report.collisions.length, 0);
    } finally {
      await adapter.close();
    }
  });
});
