/**
 * Acceptance tests for the activity-stats checkpoint namespace
 * (`port.activity` on `SqliteStorageAdapter`, `spec/db-schema.md`
 * §state_activity_stats) and its participation in the rename heuristic
 * (`migrateNodeFks` in `src/kernel/adapters/sqlite/history.ts`).
 *
 * Coverage:
 *   - upsertNodes / upsertPairs / loadAll round-trip, JSON columns decoded;
 *   - a second upsert of the same key replaces the row (no duplicates);
 *   - deleteNode drops the node row and every pair naming it on either side;
 *   - rename heuristic moves the node row and repoints pairs on both sides;
 *   - rename heuristic reports collisions and keeps the destination rows.
 */

import { after, before, describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SqliteStorageAdapter } from '../index.js';
import { migrateNodeFks } from '../history.js';
import type { IActivityPairRow, IActivityStatsRow } from '../../../types/storage.js';

let dbRoot: string;
let dbCounter = 0;

function freshDbPath(label: string): string {
  dbCounter += 1;
  return join(dbRoot, `${label}-${dbCounter}.db`);
}

before(() => {
  dbRoot = mkdtempSync(join(tmpdir(), 'skill-map-activity-stats-'));
});

after(() => {
  rmSync(dbRoot, { recursive: true, force: true });
});

function nodeRow(overrides: Partial<IActivityStatsRow> = {}): IActivityStatsRow {
  return {
    nodePath: 'skills/deploy/SKILL.md',
    count: 2,
    firstSeenAt: 1000,
    lastStartAt: 2000,
    lastOwner: 'main:s1',
    owners: ['main:s1', 'main:s2'],
    recent: [
      { at: 2000, owner: 'main:s2', detail: 'Skill' },
      { at: 1000, owner: 'main:s1', kind: 'read', caller: 'agents/reviewer.md' },
    ],
    toolUses: 3,
    tokens: 400,
    summarizedRuns: 1,
    ...overrides,
  };
}

function pairRow(overrides: Partial<IActivityPairRow> = {}): IActivityPairRow {
  return {
    parent: 'agents/reviewer.md',
    childNodePath: 'skills/deploy/SKILL.md',
    count: 1,
    lastStartAt: 1500,
    ...overrides,
  };
}

async function openAdapter(label: string): Promise<SqliteStorageAdapter> {
  const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath(label), autoBackup: false });
  await adapter.init();
  return adapter;
}

describe('port.activity checkpoint', () => {
  it('upsert + loadAll round-trips both tables with the JSON columns decoded', async () => {
    const adapter = await openAdapter('roundtrip');
    try {
      await adapter.activity.upsertNodes([nodeRow()]);
      await adapter.activity.upsertPairs([pairRow()]);
      const loaded = await adapter.activity.loadAll();
      deepStrictEqual(loaded.nodes, [nodeRow()]);
      deepStrictEqual(loaded.pairs, [pairRow()]);
    } finally {
      await adapter.close();
    }
  });

  it('a second upsert of the same key replaces the row', async () => {
    const adapter = await openAdapter('replace');
    try {
      await adapter.activity.upsertNodes([nodeRow({ count: 1 })]);
      await adapter.activity.upsertNodes([nodeRow({ count: 5, lastOwner: null, owners: [] })]);
      await adapter.activity.upsertPairs([pairRow({ count: 1 })]);
      await adapter.activity.upsertPairs([pairRow({ count: 4 })]);
      const loaded = await adapter.activity.loadAll();
      strictEqual(loaded.nodes.length, 1);
      strictEqual(loaded.nodes[0]?.count, 5);
      strictEqual(loaded.nodes[0]?.lastOwner, null);
      strictEqual(loaded.pairs.length, 1);
      strictEqual(loaded.pairs[0]?.count, 4);
    } finally {
      await adapter.close();
    }
  });

  it('deleteNode drops the node row and every pair naming it on either side', async () => {
    const adapter = await openAdapter('delete');
    try {
      await adapter.activity.upsertNodes([nodeRow(), nodeRow({ nodePath: 'other.md' })]);
      await adapter.activity.upsertPairs([
        pairRow(), // child = deploy
        pairRow({ parent: 'skills/deploy/SKILL.md', childNodePath: 'other.md' }), // parent = deploy
        pairRow({ parent: 'main:s1', childNodePath: 'other.md' }), // untouched
      ]);
      await adapter.activity.deleteNode('skills/deploy/SKILL.md');
      const loaded = await adapter.activity.loadAll();
      deepStrictEqual(
        loaded.nodes.map((r) => r.nodePath),
        ['other.md'],
      );
      deepStrictEqual(loaded.pairs, [pairRow({ parent: 'main:s1', childNodePath: 'other.md' })]);
      // Idempotent.
      await adapter.activity.deleteNode('skills/deploy/SKILL.md');
    } finally {
      await adapter.close();
    }
  });
});

describe('rename heuristic over the activity checkpoint', () => {
  it('moves the node row and repoints pairs on both sides', async () => {
    const adapter = await openAdapter('rename');
    try {
      await adapter.activity.upsertNodes([nodeRow()]);
      await adapter.activity.upsertPairs([
        pairRow(), // child = deploy
        pairRow({ parent: 'skills/deploy/SKILL.md', childNodePath: 'other.md' }), // parent = deploy
      ]);
      const report = await migrateNodeFks(adapter.db, 'skills/deploy/SKILL.md', 'skills/ship/SKILL.md');
      strictEqual(report.activityStats, 1);
      strictEqual(report.activityPairs, 2);
      strictEqual(report.collisions.length, 0);
      const loaded = await adapter.activity.loadAll();
      deepStrictEqual(loaded.nodes, [nodeRow({ nodePath: 'skills/ship/SKILL.md' })]);
      deepStrictEqual(
        loaded.pairs.map((p) => `${p.parent}>>${p.childNodePath}`).sort(),
        ['agents/reviewer.md>>skills/ship/SKILL.md', 'skills/ship/SKILL.md>>other.md'],
      );
    } finally {
      await adapter.close();
    }
  });

  it('reports collisions and keeps the destination rows', async () => {
    const adapter = await openAdapter('collision');
    try {
      await adapter.activity.upsertNodes([
        nodeRow({ count: 1 }),
        nodeRow({ nodePath: 'skills/ship/SKILL.md', count: 9 }),
      ]);
      await adapter.activity.upsertPairs([
        pairRow({ count: 1 }),
        pairRow({ childNodePath: 'skills/ship/SKILL.md', count: 9 }),
      ]);
      const report = await migrateNodeFks(adapter.db, 'skills/deploy/SKILL.md', 'skills/ship/SKILL.md');
      strictEqual(report.activityStats, 0);
      strictEqual(report.activityPairs, 0);
      deepStrictEqual(
        report.collisions.map((c) => c.table).sort(),
        ['state_activity_pairs', 'state_activity_stats'],
      );
      const loaded = await adapter.activity.loadAll();
      deepStrictEqual(loaded.nodes.map((r) => [r.nodePath, r.count]), [['skills/ship/SKILL.md', 9]]);
      deepStrictEqual(loaded.pairs.map((p) => [p.childNodePath, p.count]), [['skills/ship/SKILL.md', 9]]);
    } finally {
      await adapter.close();
    }
  });
});
