/**
 * Step 4.1 acceptance test. Round-trips a real `runScan` result through
 * `persistScanResult` and asserts:
 *   - happy path: the three `scan_*` tables hold the expected counts and
 *     a representative selection of fields survive the JSON-flattening
 *     round trip (e.g. denormalised counts on nodes, JSON columns parse
 *     back into the original arrays);
 *   - replace-all semantics: persisting an empty ScanResult after a
 *     populated one wipes every prior row across all three tables.
 *
 * Uses a temp file-based SQLite (one per `it`) — `SqliteStorageAdapter`
 * applies migrations on a short-lived raw `DatabaseSync` and then opens a
 * separate Kysely connection, which works with file paths but not
 * `:memory:` (each `DatabaseSync(':memory:')` is an isolated DB). See
 * `src/kernel/adapters/sqlite/storage-adapter.ts`.
 *
 * Uses the orchestrator (not the CLI) so we can inspect intermediate
 * state.
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createKernel, runScan } from '../kernel/index.js';
import { builtIns, listBuiltIns } from '../extensions/built-ins.js';
import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../kernel/adapters/sqlite/scan-persistence.js';

let fixture: string;
let dbRoot: string;
let dbCounter = 0;

function freshDbPath(label: string): string {
  dbCounter += 1;
  return join(dbRoot, `${label}-${dbCounter}.db`);
}

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-persist-'));
  dbRoot = mkdtempSync(join(tmpdir(), 'skill-map-persist-db-'));
  const write = (rel: string, content: string) => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };

  // Same shape as scan-e2e.test.ts so we exercise nodes (3), links
  // (frontmatter + slash + at-directive + supersedes inversion), and
  // issues (broken-ref + superseded). Keeps the fixture surface small
  // but representative.
  write(
    '.claude/agents/architect.md',
    [
      '---',
      'name: architect',
      'description: The architect',
      'metadata:',
      '  version: 1.0.0',
      '  related:',
      '    - .claude/commands/deploy.md',
      '---',
      '',
      'Run /deploy or /unknown, consult @backend-lead.',
    ].join('\n'),
  );
  write(
    '.claude/commands/deploy.md',
    [
      '---',
      'name: deploy',
      'description: Deploy',
      'metadata:',
      '  version: 1.0.0',
      '  supersededBy: .claude/commands/deploy-v2.md',
      '---',
      'Deploy body.',
    ].join('\n'),
  );
  write(
    '.claude/commands/rollback.md',
    ['---', 'name: Rollback', '---', 'Rollback body.'].join('\n'),
  );
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
  rmSync(dbRoot, { recursive: true, force: true });
});

describe('persistScanResult', () => {
  it('persists a populated ScanResult and round-trips representative fields', async () => {
    const kernel = createKernel();
    for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
    const result = await runScan(kernel, {
      roots: [fixture],
      extensions: builtIns(),
    });

    // Sanity: the fixture really does produce all three table populations.
    ok(result.nodes.length > 0, 'fixture should yield nodes');
    ok(result.links.length > 0, 'fixture should yield links');
    ok(result.issues.length > 0, 'fixture should yield issues');

    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('persist'), autoBackup: false });
    await adapter.init();
    try {
      await persistScanResult(adapter.db, result);

      const nodeRows = await adapter.db.selectFrom('scan_nodes').selectAll().execute();
      const linkRows = await adapter.db.selectFrom('scan_links').selectAll().execute();
      const issueRows = await adapter.db.selectFrom('scan_issues').selectAll().execute();

      strictEqual(nodeRows.length, result.nodes.length);
      strictEqual(linkRows.length, result.links.length);
      strictEqual(issueRows.length, result.issues.length);

      // Node round-trip: bytes triple-split + denormalised counts.
      const architect = result.nodes.find((n) => n.path === '.claude/agents/architect.md');
      ok(architect, 'orchestrator yields architect node');
      const architectRow = nodeRows.find((r) => r.path === '.claude/agents/architect.md');
      ok(architectRow, 'architect node persisted');
      strictEqual(architectRow!.bytesTotal, architect!.bytes.total);
      strictEqual(architectRow!.bytesFrontmatter, architect!.bytes.frontmatter);
      strictEqual(architectRow!.bytesBody, architect!.bytes.body);
      strictEqual(architectRow!.linksOutCount, architect!.linksOutCount);
      strictEqual(architectRow!.linksInCount, architect!.linksInCount);
      strictEqual(architectRow!.externalRefsCount, architect!.externalRefsCount);
      strictEqual(architectRow!.kind, 'agent');
      strictEqual(architectRow!.provider, 'claude');
      // frontmatterJson is the full YAML-derived object stringified.
      const frontmatter = JSON.parse(architectRow!.frontmatterJson) as Record<string, unknown>;
      strictEqual(frontmatter['name'], 'architect');

      // scannedAt is the spec-conformant integer Unix-ms — the
      // persistence layer no longer parses; the runtime emits ints.
      strictEqual(architectRow!.scannedAt, result.scannedAt);
      ok(Number.isInteger(result.scannedAt), 'scannedAt is an integer');

      // Link round-trip: the supersedes-inverted edge keeps source/target
      // and kind, sources[] survives the JSON column.
      const supersedesRow = linkRows.find(
        (r) => r.kind === 'supersedes' && r.targetPath === '.claude/commands/deploy.md',
      );
      ok(supersedesRow, 'supersedes inversion persisted');
      const sources = JSON.parse(supersedesRow!.sourcesJson) as string[];
      ok(Array.isArray(sources) && sources.length > 0, 'sourcesJson decodes to a non-empty array');

      // Issue round-trip: nodeIdsJson decodes back to the original array.
      const issueRow = issueRows[0]!;
      const nodeIds = JSON.parse(issueRow.nodeIdsJson) as string[];
      ok(Array.isArray(nodeIds) && nodeIds.length > 0, 'nodeIdsJson decodes to a non-empty array');
      const matchingIssue = result.issues.find((i) => i.ruleId === issueRow.ruleId);
      ok(matchingIssue, 'every persisted issue ruleId matches the source');
      deepStrictEqual(JSON.parse(issueRow.nodeIdsJson), matchingIssue!.nodeIds);
    } finally {
      await adapter.close();
    }
  });

  it('checkpoints the WAL: a fresh DatabaseSync sees the persisted rows immediately', async () => {
    // The writer's connection holds a WAL that, in steady-state, only
    // auto-checkpoints once it crosses ~1000 pages. Without an explicit
    // PRAGMA wal_checkpoint(TRUNCATE) at the end of persistScanResult,
    // a SECOND raw connection opening the same .db file sees stale state
    // (the rows are still in <db>-wal). With the checkpoint, the second
    // reader sees the canonical snapshot.
    const kernel = createKernel();
    for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
    const result = await runScan(kernel, {
      roots: [fixture],
      extensions: builtIns(),
    });
    ok(result.nodes.length > 0, 'fixture should yield nodes');

    const dbPath = freshDbPath('persist-wal-readers');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      await persistScanResult(adapter.db, result);
    } finally {
      await adapter.close();
    }

    // Open a brand-new raw connection. This mirrors what an external
    // tool (sqlitebrowser, DBeaver, an ad-hoc `node:sqlite` consumer)
    // would do: open the .db file, read scan_* directly. The CamelCase
    // plugin lives on the writer's Kysely; the reader uses snake_case
    // SQL identifiers as they exist on disk.
    const reader = new DatabaseSync(dbPath);
    try {
      const nodeCount = (
        reader.prepare('SELECT COUNT(*) AS n FROM scan_nodes').get() as { n: number }
      ).n;
      const linkCount = (
        reader.prepare('SELECT COUNT(*) AS n FROM scan_links').get() as { n: number }
      ).n;
      const issueCount = (
        reader.prepare('SELECT COUNT(*) AS n FROM scan_issues').get() as { n: number }
      ).n;
      strictEqual(nodeCount, result.nodes.length, 'reader sees the nodes');
      strictEqual(linkCount, result.links.length, 'reader sees the links');
      strictEqual(issueCount, result.issues.length, 'reader sees the issues');
    } finally {
      reader.close();
    }
  });

  it('checkpoints the WAL: <db>-wal is empty after persistScanResult + close', async () => {
    // Structural assertion that the PRAGMA wal_checkpoint(TRUNCATE)
    // ran. In TRUNCATE mode, the WAL file is truncated to zero bytes
    // (it may still exist as a 0-byte sidecar; some platforms / SQLite
    // builds remove it on close). We tolerate "doesn't exist" too.
    const kernel = createKernel();
    for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
    const result = await runScan(kernel, {
      roots: [fixture],
      extensions: builtIns(),
    });

    const dbPath = freshDbPath('persist-wal-truncated');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      await persistScanResult(adapter.db, result);
    } finally {
      await adapter.close();
    }

    const walPath = `${dbPath}-wal`;
    let walSize: number;
    try {
      walSize = statSync(walPath).size;
    } catch {
      // ENOENT is acceptable: SQLite may have removed the WAL on close.
      walSize = 0;
    }
    strictEqual(walSize, 0, `<db>-wal should be 0 bytes after checkpoint, got ${walSize}`);
  });

  it('replace-all: persisting an empty ScanResult wipes every scan_* table', async () => {
    const kernel = createKernel();
    for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
    const populated = await runScan(kernel, {
      roots: [fixture],
      extensions: builtIns(),
    });

    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('persist'), autoBackup: false });
    await adapter.init();
    try {
      await persistScanResult(adapter.db, populated);
      // Pre-condition: the populated snapshot is in.
      ok((await adapter.db.selectFrom('scan_nodes').selectAll().execute()).length > 0);
      ok((await adapter.db.selectFrom('scan_links').selectAll().execute()).length > 0);
      ok((await adapter.db.selectFrom('scan_issues').selectAll().execute()).length > 0);

      // Now persist an empty snapshot. scannedAt must be a non-negative
      // integer (Unix ms); everything else can be empty. Spec requires
      // `roots: minItems: 1`, so the synthetic envelope keeps `['.']`.
      const empty: typeof populated = {
        schemaVersion: 1,
        scannedAt: Date.now(),
        scope: 'project',
        roots: ['.'],
        providers: [],
        nodes: [],
        links: [],
        issues: [],
        stats: { filesWalked: 0, filesSkipped: 0, nodesCount: 0, linksCount: 0, issuesCount: 0, durationMs: 0 },
      };
      await persistScanResult(adapter.db, empty);

      strictEqual((await adapter.db.selectFrom('scan_nodes').selectAll().execute()).length, 0);
      strictEqual((await adapter.db.selectFrom('scan_links').selectAll().execute()).length, 0);
      strictEqual((await adapter.db.selectFrom('scan_issues').selectAll().execute()).length, 0);
    } finally {
      await adapter.close();
    }
  });

  it('segregates external pseudo-links: scan_links holds internal only, scan_nodes.external_refs_count holds the URL count', async () => {
    // Isolated fixture so nothing else writes to the DB or biases counts.
    const local = mkdtempSync(join(tmpdir(), 'skill-map-persist-urls-'));
    try {
      const writeLocal = (rel: string, content: string) => {
        const abs = join(local, rel);
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, content);
      };
      writeLocal(
        '.claude/agents/links.md',
        [
          '---',
          'name: links',
          'description: Has external URLs',
          '---',
          '',
          'See https://example.com and https://example.com/path.',
          'Dup: https://example.com#fragment.',
        ].join('\n'),
      );

      const kernel = createKernel();
      for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
      const result = await runScan(kernel, {
        roots: [local],
        extensions: builtIns(),
      });

      const node = result.nodes.find((n) => n.path === '.claude/agents/links.md');
      ok(node, 'links node was scanned');
      // Sanity: the orchestrator dropped pseudo-links before returning.
      strictEqual(
        result.links.filter((l) => l.target.startsWith('http')).length,
        0,
        'no external pseudo-links in result.links',
      );
      strictEqual(node!.externalRefsCount, 2, 'two distinct URLs counted (fragment dedup)');

      const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('persist'), autoBackup: false });
      await adapter.init();
      try {
        await persistScanResult(adapter.db, result);

        // scan_links for the URL-bearing node should match the internal
        // link count (which is 0 for this fixture).
        const linkRows = await adapter.db
          .selectFrom('scan_links')
          .selectAll()
          .where('sourcePath', '=', '.claude/agents/links.md')
          .execute();
        const internalForNode = result.links.filter(
          (l) => l.source === '.claude/agents/links.md',
        ).length;
        strictEqual(
          linkRows.length,
          internalForNode,
          'persisted scan_links matches internal-only count for source',
        );

        // scan_nodes.external_refs_count carries the URL count.
        const nodeRow = await adapter.db
          .selectFrom('scan_nodes')
          .select(['externalRefsCount'])
          .where('path', '=', '.claude/agents/links.md')
          .executeTakeFirstOrThrow();
        strictEqual(nodeRow.externalRefsCount, 2);
      } finally {
        await adapter.close();
      }
    } finally {
      rmSync(local, { recursive: true, force: true });
    }
  });

  it('persists scan_meta and loadScanResult returns the real envelope (no synthesis)', async () => {
    const kernel = createKernel();
    for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
    const result = await runScan(kernel, {
      roots: [fixture],
      extensions: builtIns(),
      scope: 'project',
    });

    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('persist'), autoBackup: false });
    await adapter.init();
    try {
      await persistScanResult(adapter.db, result);

      const metaRows = await adapter.db.selectFrom('scan_meta').selectAll().execute();
      strictEqual(metaRows.length, 1, 'scan_meta is single-row');
      const meta = metaRows[0]!;
      strictEqual(meta.id, 1);
      strictEqual(meta.scope, 'project');
      strictEqual(meta.scannedAt, result.scannedAt);
      deepStrictEqual(JSON.parse(meta.rootsJson), result.roots);
      deepStrictEqual(JSON.parse(meta.providersJson), result.providers);
      ok(meta.scannedByName.length > 0, 'scannedByName persisted');
      ok(meta.scannedByVersion.length > 0, 'scannedByVersion persisted');
      ok(meta.scannedBySpecVersion.length > 0, 'scannedBySpecVersion persisted');
      strictEqual(meta.statsFilesWalked, result.stats.filesWalked);
      strictEqual(meta.statsFilesSkipped, result.stats.filesSkipped);
      strictEqual(meta.statsDurationMs, result.stats.durationMs);

      const { loadScanResult } = await import('../kernel/adapters/sqlite/scan-load.js');
      const loaded = await loadScanResult(adapter.db);
      strictEqual(loaded.scannedAt, result.scannedAt);
      strictEqual(loaded.scope, result.scope);
      deepStrictEqual(loaded.roots, result.roots);
      deepStrictEqual(loaded.providers, result.providers);
      ok(loaded.scannedBy, 'scannedBy round-trips');
      strictEqual(loaded.scannedBy!.name, result.scannedBy!.name);
      strictEqual(loaded.scannedBy!.version, result.scannedBy!.version);
      strictEqual(loaded.scannedBy!.specVersion, result.scannedBy!.specVersion);
      strictEqual(loaded.stats.filesWalked, result.stats.filesWalked);
      strictEqual(loaded.stats.filesSkipped, result.stats.filesSkipped);
      strictEqual(loaded.stats.durationMs, result.stats.durationMs);
    } finally {
      await adapter.close();
    }
  });

  it('replace-all keeps scan_meta a single row across two consecutive scans', async () => {
    const kernel = createKernel();
    for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
    const first = await runScan(kernel, {
      roots: [fixture],
      extensions: builtIns(),
      scope: 'project',
    });

    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('persist'), autoBackup: false });
    await adapter.init();
    try {
      await persistScanResult(adapter.db, first);
      strictEqual((await adapter.db.selectFrom('scan_meta').selectAll().execute()).length, 1);

      const second = await runScan(kernel, {
        roots: [fixture],
        extensions: builtIns(),
        scope: 'project',
      });
      await persistScanResult(adapter.db, second);
      const rows = await adapter.db.selectFrom('scan_meta').selectAll().execute();
      strictEqual(rows.length, 1, 'still single-row after second persist');
      strictEqual(rows[0]!.scannedAt, second.scannedAt, 'meta reflects the latest scan');
    } finally {
      await adapter.close();
    }
  });

  it('loadScanResult on a freshly-migrated DB with empty scan_meta degrades to synthetic envelope', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('persist'), autoBackup: false });
    await adapter.init();
    try {
      const { loadScanResult } = await import('../kernel/adapters/sqlite/scan-load.js');
      const loaded = await loadScanResult(adapter.db);
      strictEqual(loaded.scope, 'project', 'fallback scope');
      deepStrictEqual(loaded.roots, ['.'], 'fallback roots satisfy minItems: 1');
      deepStrictEqual(loaded.providers, []);
      ok(Number.isInteger(loaded.scannedAt) && loaded.scannedAt > 0);
      strictEqual(loaded.stats.filesWalked, 0);
      strictEqual(loaded.stats.filesSkipped, 0);
      strictEqual(loaded.stats.durationMs, 0);
      strictEqual(loaded.nodes.length, 0);
      strictEqual(loaded.links.length, 0);
      strictEqual(loaded.issues.length, 0);
    } finally {
      await adapter.close();
    }
  });

  it('rejects a non-integer scannedAt without touching the DB', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('persist'), autoBackup: false });
    await adapter.init();
    try {
      // Cast to satisfy the typed signature while exercising the runtime
      // guard against a malformed caller (e.g. someone still passing the
      // pre-Step-4.7 ISO string after a downstream upgrade).
      const bad = {
        schemaVersion: 1 as const,
        scannedAt: 'not-a-date' as unknown as number,
        scope: 'project' as const,
        roots: ['.'],
        providers: [],
        nodes: [],
        links: [],
        issues: [],
        stats: { filesWalked: 0, filesSkipped: 0, nodesCount: 0, linksCount: 0, issuesCount: 0, durationMs: 0 },
      };
      await persistScanResult(adapter.db, bad).then(
        () => {
          throw new Error('expected persistScanResult to reject invalid scannedAt');
        },
        (err: Error) => {
          ok(
            /integer/i.test(err.message),
            `expected message about integer ms, got: ${err.message}`,
          );
        },
      );
    } finally {
      await adapter.close();
    }
  });
});
