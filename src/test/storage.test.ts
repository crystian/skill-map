/**
 * Step 1a acceptance test. Codifies the round-trip named in
 * ROADMAP §Step 1a — "spin a fresh scope, run sm db migrate --dry-run,
 * apply, corrupt a row, restore from backup — round-trip green."
 *
 * Plus a handful of narrower checks around dialect typing, CHECK
 * constraints, and WAL behaviour that surfaced while building the
 * adapter.
 */

import { mkdtempSync, rmSync, copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { strictEqual, ok, rejects, throws, deepStrictEqual } from 'node:assert';
import { describe, it, before, after } from 'node:test';

import {
  SqliteStorageAdapter,
  type IDatabase,
} from '../kernel/adapters/sqlite/index.js';
import {
  applyMigrations,
  discoverMigrations,
  planMigrations,
} from '../kernel/adapters/sqlite/migrations.js';
import { sql, type Kysely } from 'kysely';

let tempRoot: string;

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'skill-map-test-'));
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function freshDbPath(name: string): string {
  return join(tempRoot, `${name}.db`);
}

describe('SqliteStorageAdapter', () => {
  it('auto-migrates on init() and opens a typed Kysely instance', async () => {
    const path = freshDbPath('auto-migrate');
    const adapter = new SqliteStorageAdapter({ databasePath: path });
    await adapter.init();
    try {
      const tables = await adapter.db
        .selectFrom(sql<{ name: string }>`sqlite_master`.as('m'))
        .select('name')
        .where(sql`type`, '=', 'table')
        .execute();
      const names = tables.map((t) => t.name).sort();

      for (const expected of [
        'scan_nodes',
        'scan_links',
        'scan_issues',
        'state_jobs',
        'state_executions',
        'state_summaries',
        'state_enrichments',
        'state_plugin_kvs',
        'config_plugins',
        'config_preferences',
        'config_schema_versions',
      ]) {
        ok(names.includes(expected), `expected table ${expected}`);
      }
    } finally {
      await adapter.close();
    }
  });

  it('CamelCasePlugin bridges camelCase TS ↔ snake_case SQL', async () => {
    const path = freshDbPath('camelcase');
    const adapter = new SqliteStorageAdapter({ databasePath: path });
    await adapter.init();
    try {
      const now = Date.now();
      await adapter.db
        .insertInto('scan_nodes')
        .values({
          path: 'notes/readme.md',
          kind: 'note',
          provider: 'claude',
          title: 'README',
          description: 'root doc',
          stability: 'stable',
          version: '0.1.0',
          author: 'acme',
          frontmatterJson: '{}',
          bodyHash: 'a'.repeat(64),
          frontmatterHash: 'b'.repeat(64),
          bytesFrontmatter: 10,
          bytesBody: 100,
          bytesTotal: 110,
          tokensFrontmatter: null,
          tokensBody: null,
          tokensTotal: null,
          scannedAt: now,
        })
        .execute();

      const row = await adapter.db
        .selectFrom('scan_nodes')
        .selectAll()
        .where('path', '=', 'notes/readme.md')
        .executeTakeFirstOrThrow();

      strictEqual(row.kind, 'note');
      strictEqual(row.scannedAt, now);
      strictEqual(row.linksOutCount, 0, 'Generated DEFAULT applied');
    } finally {
      await adapter.close();
    }
  });

  it('rejects CHECK constraint violations at the DB layer (stability whitelist)', async () => {
    // `kind` is open string at the DB layer (per
    // `node.schema.json#/properties/kind` and the build of
    // `001_initial.sql`); only `stability` keeps a CHECK whitelist on
    // `scan_nodes`. Use that one to prove the CHECK mechanism still
    // bites for the constraints that remain. (The kind CHECK was
    // dropped intentionally; an external Provider must be able to
    // persist its own kinds.)
    const path = freshDbPath('ck-violation');
    const adapter = new SqliteStorageAdapter({ databasePath: path });
    await adapter.init();
    try {
      await rejects(async () => {
        await adapter.db
          .insertInto('scan_nodes')
          .values({
            path: 'x.md',
            kind: 'cursorRule',
            provider: 'cursor',
            stability: 'not-a-stability' as never,
            frontmatterJson: '{}',
            bodyHash: 'a'.repeat(64),
            frontmatterHash: 'b'.repeat(64),
            bytesFrontmatter: 0,
            bytesBody: 0,
            bytesTotal: 0,
            scannedAt: Date.now(),
          })
          .execute();
      }, /CHECK constraint failed/);
    } finally {
      await adapter.close();
    }
  });

  it('accepts external-Provider kinds (open kind contract)', async () => {
    // Companion to the test above: `001_initial.sql` declares no
    // CHECK on `kind`, so a row with `kind: 'cursorRule'` (no built-in
    // Provider classifies into it) MUST persist successfully. This is
    // the spec § Phase 3 promise the open-node-kinds refactor honours.
    const path = freshDbPath('open-kind-accept');
    const adapter = new SqliteStorageAdapter({ databasePath: path });
    await adapter.init();
    try {
      await adapter.db
        .insertInto('scan_nodes')
        .values({
          path: 'cursor/rule.md',
          kind: 'cursorRule',
          provider: 'cursor',
          frontmatterJson: '{}',
          bodyHash: 'a'.repeat(64),
          frontmatterHash: 'b'.repeat(64),
          bytesFrontmatter: 0,
          bytesBody: 0,
          bytesTotal: 0,
          scannedAt: Date.now(),
        })
        .execute();
      const row = await adapter.db
        .selectFrom('scan_nodes')
        .selectAll()
        .where('path', '=', 'cursor/rule.md')
        .executeTakeFirst();
      strictEqual(row?.kind, 'cursorRule');
    } finally {
      await adapter.close();
    }
  });

  it('blocks duplicate queued/running jobs via unique partial index', async () => {
    const path = freshDbPath('dup-jobs');
    const adapter = new SqliteStorageAdapter({ databasePath: path });
    await adapter.init();
    try {
      const base = {
        actionId: 'sec-scanner',
        actionVersion: '1.0.0',
        nodeId: 'agents/a.md',
        contentHash: 'a'.repeat(64),
        nonce: 'n1',
        status: 'queued' as const,
        ttlSeconds: 300,
        createdAt: Date.now(),
      };
      await adapter.db.insertInto('state_jobs').values({ id: 'j1', ...base }).execute();

      // Same (action, node, hash) while status is queued → rejected.
      await rejects(async () => {
        await adapter.db.insertInto('state_jobs').values({ id: 'j2', ...base, nonce: 'n2' }).execute();
      }, /UNIQUE constraint failed/);

      // After j1 finishes, a new queued job with the same tuple is allowed.
      await adapter.db
        .updateTable('state_jobs')
        .set({ status: 'completed', finishedAt: Date.now() })
        .where('id', '=', 'j1')
        .execute();
      await adapter.db.insertInto('state_jobs').values({ id: 'j3', ...base, nonce: 'n3' }).execute();
    } finally {
      await adapter.close();
    }
  });
});

describe('migrations runner', () => {
  it('discover() finds the bundled kernel migration', () => {
    const files = discoverMigrations();
    ok(files.length >= 1);
    strictEqual(files[0]!.version, 1);
    strictEqual(files[0]!.description, 'initial');
  });

  it('plan() returns pending on fresh DB and empty after apply', () => {
    const path = freshDbPath('plan');
    const raw = new DatabaseSync(path);
    try {
      const before = planMigrations(raw);
      strictEqual(before.applied.length, 0);
      ok(before.pending.length >= 1);

      applyMigrations(raw, path, { backup: false });

      const after = planMigrations(raw);
      ok(after.applied.length >= 1);
      strictEqual(after.pending.length, 0);

      // user_version matches the latest applied migration.
      const pragma = raw.prepare('PRAGMA user_version').get() as { user_version: number };
      strictEqual(pragma.user_version, after.applied[after.applied.length - 1]!.version);
    } finally {
      raw.close();
    }
  });

  it('dry-run does not mutate the DB or write a backup', () => {
    const path = freshDbPath('dry-run');
    const raw = new DatabaseSync(path);
    try {
      const result = applyMigrations(raw, path, { dryRun: true });
      ok(result.applied.length >= 1, 'dry-run reports pending as "would apply"');
      strictEqual(result.backupPath, null);

      // No tables should exist yet.
      const tables = raw
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>;
      strictEqual(tables.length, 0);
    } finally {
      raw.close();
    }
  });

  it('round-trip: migrate → write → backup → corrupt → restore', async () => {
    const path = freshDbPath('round-trip');

    // Apply + insert a known row.
    const adapter = new SqliteStorageAdapter({ databasePath: path, autoBackup: false });
    await adapter.init();
    const nodeFixture = makeNodeFixture('notes/pristine.md');
    await adapter.db.insertInto('scan_nodes').values(nodeFixture).execute();
    await adapter.close();

    // Backup (manual copy — mirrors what `sm db backup` does post-WAL-checkpoint).
    const backupPath = freshDbPath('round-trip-backup');
    checkpointAndCopy(path, backupPath);

    // "Corrupt" the canonical row by mutating its body_hash to a sentinel.
    const corrupter = new SqliteStorageAdapter({ databasePath: path, autoMigrate: false });
    await corrupter.init();
    await corrupter.db
      .updateTable('scan_nodes')
      .set({ bodyHash: 'corrupt'.padEnd(64, '0') })
      .where('path', '=', nodeFixture.path)
      .execute();
    await corrupter.close();

    // Confirm the corruption is visible before restore.
    const beforeRestore = readBodyHash(path, nodeFixture.path);
    ok(beforeRestore?.startsWith('corrupt'), 'corruption should be present pre-restore');

    // Restore the backup over the target. Real `sm db restore` would also
    // remove -wal/-shm sidecars; at this scale the file copy suffices.
    copyFileSync(backupPath, path);
    for (const sidecar of [`${path}-wal`, `${path}-shm`]) {
      if (existsSync(sidecar)) rmSync(sidecar);
    }

    // Verify round-trip: the pristine row is back, byte-for-byte.
    const adapter2 = new SqliteStorageAdapter({ databasePath: path, autoMigrate: false });
    await adapter2.init();
    try {
      const restored = await adapter2.db
        .selectFrom('scan_nodes')
        .selectAll()
        .where('path', '=', nodeFixture.path)
        .executeTakeFirstOrThrow();
      strictEqual(restored.bodyHash, nodeFixture.bodyHash, 'body_hash restored');
      strictEqual(restored.frontmatterHash, nodeFixture.frontmatterHash);
      strictEqual(restored.bytesTotal, nodeFixture.bytesTotal);
    } finally {
      await adapter2.close();
    }
  });

  it('rejects duplicate version numbers in the migrations dir', () => {
    const fakeDir = mkdtempSync(join(tmpdir(), 'bad-migrations-'));
    try {
      writeFileSync(join(fakeDir, '001_a.sql'), '-- one');
      writeFileSync(join(fakeDir, '001_b.sql'), '-- two');
      throws(() => discoverMigrations(fakeDir), /Duplicate migration version 1/);
    } finally {
      rmSync(fakeDir, { recursive: true, force: true });
    }
  });

  // Audit M6 — guard against a future code path that loosens version
  // parsing and lets a non-integer flow into the `PRAGMA user_version
  // = ${n}` interpolation. The guard lives in `applyMigrations`, so we
  // exercise it with a synthetic discovered file whose `version` is
  // tampered to a non-integer (the regex in `discoverMigrations` would
  // never produce one today, but this pins the contract).
  it('rejects non-integer migration versions before interpolating into PRAGMA', () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'm6-')), 'sm.db');
    // Empty migrations dir → no plan, but applyMigrations still walks
    // the array we synthesise via the public type. Instead we assert
    // against the helper directly: tamper the version on a discovered
    // file by reaching into a rebuilt array.
    const fakeDir = mkdtempSync(join(tmpdir(), 'm6-mig-'));
    try {
      writeFileSync(join(fakeDir, '001_init.sql'), 'CREATE TABLE x (id INTEGER);');
      const files = discoverMigrations(fakeDir);
      strictEqual(files.length, 1);
      // Synthesise a tampered file; the production code will assert.
      const tampered = { ...files[0]!, version: 1.5 };
      throws(
        () => applyMigrations(new DatabaseSync(dbPath), dbPath, { backup: false }, [tampered]),
        /non-negative integer/,
      );
    } finally {
      rmSync(fakeDir, { recursive: true, force: true });
    }
  });
});

// --- helpers --------------------------------------------------------------

function makeNodeFixture(path: string) {
  return {
    path,
    kind: 'note' as const,
    provider: 'claude',
    title: 'pristine',
    description: 'known row for round-trip',
    stability: 'stable' as const,
    version: '1.0.0',
    author: 'acme',
    frontmatterJson: JSON.stringify({ pristine: true }),
    bodyHash: 'd'.repeat(64),
    frontmatterHash: 'e'.repeat(64),
    bytesFrontmatter: 20,
    bytesBody: 80,
    bytesTotal: 100,
    tokensFrontmatter: null,
    tokensBody: null,
    tokensTotal: null,
    scannedAt: 1_700_000_000_000,
  };
}

function checkpointAndCopy(source: string, target: string): void {
  const db = new DatabaseSync(source);
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
  copyFileSync(source, target);
}

function readBodyHash(path: string, rowPath: string): string | undefined {
  const db = new DatabaseSync(path);
  try {
    const row = db
      .prepare('SELECT body_hash FROM scan_nodes WHERE path = ?')
      .get(rowPath) as { body_hash: string } | undefined;
    return row?.body_hash;
  } finally {
    db.close();
  }
}

// Suppress "unused import" for deepStrictEqual — retained for future specific
// object-shape assertions if the acceptance test grows.
void deepStrictEqual;
