/**
 * Acceptance tests for the favorites storage namespace
 * (`port.favorites` on `SqliteStorageAdapter`) and its participation
 * in the rename heuristic (`migrateNodeFks` in
 * `src/kernel/adapters/sqlite/history.ts`).
 *
 * Coverage:
 *   - set / unset / listPaths CRUD;
 *   - set is idempotent and refreshes `favoritedAt`;
 *   - rename heuristic preserves a favorite when the underlying file moves;
 *   - rename heuristic reports a collision when both paths already hold
 *     a favorite at migration time, preserving the destination row.
 */

import {afterAll as after,beforeAll as before, describe, it } from 'bun:test';
import { ok, strictEqual } from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import { migrateNodeFks } from '../kernel/adapters/sqlite/history.js';

let dbRoot: string;
let dbCounter = 0;

function freshDbPath(label: string): string {
  dbCounter += 1;
  return join(dbRoot, `${label}-${dbCounter}.db`);
}

before(() => {
  dbRoot = mkdtempSync(join(tmpdir(), 'skill-map-favorites-'));
});

after(() => {
  rmSync(dbRoot, { recursive: true, force: true });
});

describe('port.favorites CRUD', () => {
  it('set + listPaths exposes the favorited path', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('crud'), autoBackup: false });
    await adapter.init();
    try {
      await adapter.favorites.set('skills/foo.md');
      const paths = await adapter.favorites.listPaths();
      ok(paths instanceof Set);
      strictEqual(paths.size, 1);
      ok(paths.has('skills/foo.md'));
    } finally {
      await adapter.close();
    }
  });

  it('set is idempotent — second call refreshes favoritedAt without erroring', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('idem'), autoBackup: false });
    await adapter.init();
    try {
      await adapter.favorites.set('skills/foo.md');
      const firstRow = await adapter.db
        .selectFrom('state_node_favorites')
        .selectAll()
        .where('nodePath', '=', 'skills/foo.md')
        .executeTakeFirstOrThrow();
      // Wait at least one ms so the timestamp can change.
      await new Promise((r) => setTimeout(r, 5));
      await adapter.favorites.set('skills/foo.md');
      const secondRow = await adapter.db
        .selectFrom('state_node_favorites')
        .selectAll()
        .where('nodePath', '=', 'skills/foo.md')
        .executeTakeFirstOrThrow();
      ok(
        secondRow.favoritedAt >= firstRow.favoritedAt,
        'favoritedAt should be refreshed (or equal) on second set',
      );
      const paths = await adapter.favorites.listPaths();
      strictEqual(paths.size, 1, 'no duplicate row');
    } finally {
      await adapter.close();
    }
  });

  it('unset drops the row; second unset is a no-op', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('unset'), autoBackup: false });
    await adapter.init();
    try {
      await adapter.favorites.set('skills/foo.md');
      await adapter.favorites.unset('skills/foo.md');
      const paths = await adapter.favorites.listPaths();
      strictEqual(paths.size, 0);
      // Idempotent — does not throw.
      await adapter.favorites.unset('skills/foo.md');
    } finally {
      await adapter.close();
    }
  });
});

describe('migrateNodeFks rename heuristic — state_node_favorites', () => {
  it('migrates the row from oldPath to newPath', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('rename'), autoBackup: false });
    await adapter.init();
    try {
      await adapter.favorites.set('skills/old.md');

      const report = await migrateNodeFks(adapter.db, 'skills/old.md', 'skills/new.md');
      strictEqual(report.nodeFavorites, 1);
      strictEqual(report.collisions.length, 0);

      const paths = await adapter.favorites.listPaths();
      strictEqual(paths.size, 1);
      ok(paths.has('skills/new.md'));
      ok(!paths.has('skills/old.md'), 'old path is gone');
    } finally {
      await adapter.close();
    }
  });

  it('collision: keeps the destination favorite and reports the dropped row', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('collision'), autoBackup: false });
    await adapter.init();
    try {
      // Both paths already favorited; migrating old.md → new.md must drop
      // the migrating row and keep the destination row (live node's
      // favorite survives).
      await adapter.db.insertInto('state_node_favorites').values([
        { nodePath: 'skills/old.md', favoritedAt: 1000 },
        { nodePath: 'skills/new.md', favoritedAt: 2000 },
      ]).execute();

      const report = await migrateNodeFks(adapter.db, 'skills/old.md', 'skills/new.md');
      strictEqual(report.nodeFavorites, 0, 'no row migrated through');
      strictEqual(report.collisions.length, 1);
      const c = report.collisions[0]!;
      strictEqual(c.table, 'state_node_favorites');
      strictEqual(c.fromPath, 'skills/old.md');
      strictEqual(c.toPath, 'skills/new.md');

      const surviving = await adapter.db
        .selectFrom('state_node_favorites')
        .selectAll()
        .where('nodePath', '=', 'skills/new.md')
        .executeTakeFirstOrThrow();
      strictEqual(surviving.favoritedAt, 2000);
      const old = await adapter.db
        .selectFrom('state_node_favorites')
        .selectAll()
        .where('nodePath', '=', 'skills/old.md')
        .execute();
      strictEqual(old.length, 0);
    } finally {
      await adapter.close();
    }
  });

  it('no-op when fromPath === toPath', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('noop'), autoBackup: false });
    await adapter.init();
    try {
      await adapter.favorites.set('skills/foo.md');
      const report = await migrateNodeFks(adapter.db, 'skills/foo.md', 'skills/foo.md');
      strictEqual(report.nodeFavorites, 0);
    } finally {
      await adapter.close();
    }
  });
});
