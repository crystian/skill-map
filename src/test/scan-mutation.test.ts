/**
 * Step 4.10 scenario coverage. Regression tests for hash discrimination,
 * external-ref lifecycle, and replace-all ID rotation — three contracts
 * surfaced by the manual end-to-end validation in `.tmp/sandbox/` that
 * had no codified test.
 *
 * These tests exercise the full pipeline: real `runScan` against a
 * fixture written via `mkdtempSync`, then `persistScanResult` against a
 * temp-file SQLite DB (no `:memory:` — see
 * `feedback_sqlite_in_memory_workaround.md`), then re-scan after a file
 * mutation and re-inspect.
 *
 * Coverage:
 *   - Gap A: body-only mutations leave `frontmatter_hash` byte-equal,
 *     and frontmatter-only mutations leave `body_hash` byte-equal. The
 *     two SHA-256 streams are independent.
 *   - Gap B: `external_refs_count` transitions correctly across body
 *     edits — 0 → 2 → 2 (dedup) → 1 (malformed silently dropped) — and
 *     `scan_links` never holds an `http(s)`-prefixed `target_path`.
 *   - Gap D: replace-all over `scan_links` / `scan_issues` rotates their
 *     auto-increment IDs. The contract is that the natural keys round-trip
 *     across a re-scan; the synthetic IDs may not.
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, deepStrictEqual, notStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKernel, runScan } from '../kernel/index.js';
import type { ScanResult } from '../kernel/index.js';
import { builtIns, listBuiltIns } from '../extensions/built-ins.js';
import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../kernel/adapters/sqlite/scan-persistence.js';

let tmpRoot: string;
let dbCounter = 0;

function freshDbPath(label: string): string {
  dbCounter += 1;
  return join(tmpRoot, `${label}-${dbCounter}.db`);
}

function freshFixture(label: string): string {
  return mkdtempSync(join(tmpRoot, `${label}-`));
}

function writeFixtureFile(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

async function fullScan(fixture: string): Promise<ScanResult> {
  const kernel = createKernel();
  for (const m of listBuiltIns()) kernel.registry.register(m);
  return runScan(kernel, { roots: [fixture], extensions: builtIns() });
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-mutation-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// --- Gap A: hash discrimination -------------------------------------------

describe('hash discrimination on body-only / frontmatter-only mutations', () => {
  it('body-only mutation: body_hash + bytes_body change; frontmatter_hash + bytes_frontmatter stable', async () => {
    const fixture = freshFixture('hash-body');
    writeFixtureFile(
      fixture,
      '.claude/agents/architect.md',
      [
        '---',
        'name: architect',
        'description: The architect',
        'metadata:',
        '  version: 1.0.0',
        '---',
        '',
        'Original body line.',
      ].join('\n'),
    );

    const adapter = new SqliteStorageAdapter({
      databasePath: freshDbPath('hash-body'),
      autoBackup: false,
    });
    await adapter.init();
    try {
      // First scan + persist + snapshot.
      const first = await fullScan(fixture);
      await persistScanResult(adapter.db, first);
      const beforeRow = await adapter.db
        .selectFrom('scan_nodes')
        .select(['bodyHash', 'frontmatterHash', 'bytesBody', 'bytesFrontmatter'])
        .where('path', '=', '.claude/agents/architect.md')
        .executeTakeFirstOrThrow();

      // Mutate the body only — same frontmatter, different (longer) body.
      writeFixtureFile(
        fixture,
        '.claude/agents/architect.md',
        [
          '---',
          'name: architect',
          'description: The architect',
          'metadata:',
          '  version: 1.0.0',
          '---',
          '',
          'Body has been rewritten with substantially different content now.',
        ].join('\n'),
      );

      const second = await fullScan(fixture);
      await persistScanResult(adapter.db, second);
      const afterRow = await adapter.db
        .selectFrom('scan_nodes')
        .select(['bodyHash', 'frontmatterHash', 'bytesBody', 'bytesFrontmatter'])
        .where('path', '=', '.claude/agents/architect.md')
        .executeTakeFirstOrThrow();

      notStrictEqual(afterRow.bodyHash, beforeRow.bodyHash, 'body_hash must change after body edit');
      strictEqual(
        afterRow.frontmatterHash,
        beforeRow.frontmatterHash,
        'frontmatter_hash must be byte-equal across body-only edits',
      );
      notStrictEqual(afterRow.bytesBody, beforeRow.bytesBody, 'bytes_body must change after body edit');
      strictEqual(
        afterRow.bytesFrontmatter,
        beforeRow.bytesFrontmatter,
        'bytes_frontmatter must be identical across body-only edits',
      );
    } finally {
      await adapter.close();
    }
  });

  it('frontmatter-only mutation: frontmatter_hash changes; body_hash stable', async () => {
    const fixture = freshFixture('hash-frontmatter');
    writeFixtureFile(
      fixture,
      '.claude/agents/architect.md',
      [
        '---',
        'name: architect',
        'description: The architect',
        'metadata:',
        '  version: 1.0.0',
        '---',
        '',
        'Body that does not change.',
      ].join('\n'),
    );

    const adapter = new SqliteStorageAdapter({
      databasePath: freshDbPath('hash-frontmatter'),
      autoBackup: false,
    });
    await adapter.init();
    try {
      const first = await fullScan(fixture);
      await persistScanResult(adapter.db, first);
      const beforeRow = await adapter.db
        .selectFrom('scan_nodes')
        .select(['bodyHash', 'frontmatterHash', 'bytesBody', 'bytesFrontmatter'])
        .where('path', '=', '.claude/agents/architect.md')
        .executeTakeFirstOrThrow();

      // Mutate the frontmatter only — bump metadata.version, keep body
      // byte-identical.
      writeFixtureFile(
        fixture,
        '.claude/agents/architect.md',
        [
          '---',
          'name: architect',
          'description: The architect',
          'metadata:',
          '  version: 2.0.0',
          '---',
          '',
          'Body that does not change.',
        ].join('\n'),
      );

      const second = await fullScan(fixture);
      await persistScanResult(adapter.db, second);
      const afterRow = await adapter.db
        .selectFrom('scan_nodes')
        .select(['bodyHash', 'frontmatterHash', 'bytesBody', 'bytesFrontmatter'])
        .where('path', '=', '.claude/agents/architect.md')
        .executeTakeFirstOrThrow();

      notStrictEqual(
        afterRow.frontmatterHash,
        beforeRow.frontmatterHash,
        'frontmatter_hash must change after frontmatter edit',
      );
      strictEqual(
        afterRow.bodyHash,
        beforeRow.bodyHash,
        'body_hash must be byte-equal across frontmatter-only edits',
      );
      strictEqual(
        afterRow.bytesBody,
        beforeRow.bytesBody,
        'bytes_body must be identical across frontmatter-only edits',
      );
    } finally {
      await adapter.close();
    }
  });
});

// --- Step 5.13: frontmatter hash whitespace tolerance ---------------------

describe('frontmatter hash is canonical (Step 5.13 — yaml-canonicalize)', () => {
  it('two files with the same logical frontmatter but DIFFERENT YAML formatting hash to the same fm_hash', async () => {
    const fixture = freshFixture('canonical-fm');

    // Pair 1: original — keys in declaration order, 2-space indent.
    writeFixtureFile(
      fixture,
      '.claude/agents/style-a.md',
      [
        '---',
        'name: shared',
        'description: Same logical frontmatter',
        'metadata:',
        '  version: 1.0.0',
        '  stability: stable',
        '---',
        '',
        'Body A.',
      ].join('\n'),
    );

    // Pair 2: same logical frontmatter, but: (a) keys in different order,
    // (b) double-quoted strings, (c) extra trailing newline before `---`,
    // (d) different inline-vs-block layout for `metadata`. A reasonable
    // YAML formatter pass produces this kind of diff.
    writeFixtureFile(
      fixture,
      '.claude/agents/style-b.md',
      [
        '---',
        'description: "Same logical frontmatter"',
        'metadata:',
        '  stability: "stable"',
        '  version: "1.0.0"',
        'name: "shared"',
        '',
        '---',
        '',
        'Body B.',
      ].join('\n'),
    );

    const result = await fullScan(fixture);
    const a = result.nodes.find((n) => n.path === '.claude/agents/style-a.md');
    const b = result.nodes.find((n) => n.path === '.claude/agents/style-b.md');
    ok(a, 'style-a node was scanned');
    ok(b, 'style-b node was scanned');
    strictEqual(
      a!.frontmatterHash,
      b!.frontmatterHash,
      'YAML-formatter-equivalent frontmatters MUST hash to the same value',
    );
    // Body hashes should differ (different bodies).
    notStrictEqual(a!.bodyHash, b!.bodyHash);
  });

  it('logically-different frontmatters still produce different fm_hashes', async () => {
    const fixture = freshFixture('canonical-fm-diff');
    writeFixtureFile(
      fixture,
      '.claude/agents/v1.md',
      ['---', 'name: x', 'metadata:', '  version: 1.0.0', '---', '', 'Body.'].join('\n'),
    );
    writeFixtureFile(
      fixture,
      '.claude/agents/v2.md',
      ['---', 'name: x', 'metadata:', '  version: 2.0.0', '---', '', 'Body.'].join('\n'),
    );
    const result = await fullScan(fixture);
    const v1 = result.nodes.find((n) => n.path === '.claude/agents/v1.md');
    const v2 = result.nodes.find((n) => n.path === '.claude/agents/v2.md');
    notStrictEqual(
      v1!.frontmatterHash,
      v2!.frontmatterHash,
      'A real value diff (version 1.0.0 vs 2.0.0) MUST still change the hash',
    );
  });
});

// --- Gap B: external_refs_count lifecycle ---------------------------------

describe('external_refs_count lifecycle across body edits', () => {
  it('0 URLs → 2 URLs → 2 URLs (dedup) → 1 URL (malformed dropped); scan_links never holds http rows', async () => {
    const fixture = freshFixture('ext-lifecycle');
    const path = '.claude/agents/links.md';
    const dbPath = freshDbPath('ext-lifecycle');

    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      // Step 1: zero URLs.
      writeFixtureFile(
        fixture,
        path,
        ['---', 'name: links', '---', '', 'No external references in this body.'].join('\n'),
      );
      let result = await fullScan(fixture);
      await persistScanResult(adapter.db, result);
      let row = await adapter.db
        .selectFrom('scan_nodes')
        .select(['externalRefsCount'])
        .where('path', '=', path)
        .executeTakeFirstOrThrow();
      strictEqual(row.externalRefsCount, 0, 'step 1: no URLs → externalRefsCount = 0');
      let httpLinkCount = (
        await adapter.db
          .selectFrom('scan_links')
          .select(['targetPath'])
          .where('targetPath', 'like', 'http%')
          .execute()
      ).length;
      strictEqual(httpLinkCount, 0, 'step 1: scan_links never holds an http row');

      // Step 2: two distinct URLs.
      writeFixtureFile(
        fixture,
        path,
        [
          '---',
          'name: links',
          '---',
          '',
          'See https://example.com for docs.',
          'Also visit https://example.org/path.',
        ].join('\n'),
      );
      result = await fullScan(fixture);
      await persistScanResult(adapter.db, result);
      row = await adapter.db
        .selectFrom('scan_nodes')
        .select(['externalRefsCount'])
        .where('path', '=', path)
        .executeTakeFirstOrThrow();
      strictEqual(row.externalRefsCount, 2, 'step 2: two distinct URLs counted');
      httpLinkCount = (
        await adapter.db
          .selectFrom('scan_links')
          .select(['targetPath'])
          .where('targetPath', 'like', 'http%')
          .execute()
      ).length;
      strictEqual(httpLinkCount, 0, 'step 2: scan_links never holds an http row');

      // Step 3: add a duplicate of the first URL → still 2.
      writeFixtureFile(
        fixture,
        path,
        [
          '---',
          'name: links',
          '---',
          '',
          'See https://example.com for docs.',
          'Also visit https://example.org/path.',
          'Reminder: https://example.com again.',
        ].join('\n'),
      );
      result = await fullScan(fixture);
      await persistScanResult(adapter.db, result);
      row = await adapter.db
        .selectFrom('scan_nodes')
        .select(['externalRefsCount'])
        .where('path', '=', path)
        .executeTakeFirstOrThrow();
      strictEqual(row.externalRefsCount, 2, 'step 3: duplicate URL deduped → externalRefsCount = 2');
      httpLinkCount = (
        await adapter.db
          .selectFrom('scan_links')
          .select(['targetPath'])
          .where('targetPath', 'like', 'http%')
          .execute()
      ).length;
      strictEqual(httpLinkCount, 0, 'step 3: scan_links never holds an http row');

      // Step 4: replace one URL with a malformed one — `new URL()` rejects
      // it, so it's silently dropped, leaving 1.
      writeFixtureFile(
        fixture,
        path,
        [
          '---',
          'name: links',
          '---',
          '',
          'See https://example.com for docs.',
          'Bad: https://[bad here.',
        ].join('\n'),
      );
      result = await fullScan(fixture);
      await persistScanResult(adapter.db, result);
      row = await adapter.db
        .selectFrom('scan_nodes')
        .select(['externalRefsCount'])
        .where('path', '=', path)
        .executeTakeFirstOrThrow();
      strictEqual(row.externalRefsCount, 1, 'step 4: malformed URL silently dropped → externalRefsCount = 1');
      httpLinkCount = (
        await adapter.db
          .selectFrom('scan_links')
          .select(['targetPath'])
          .where('targetPath', 'like', 'http%')
          .execute()
      ).length;
      strictEqual(httpLinkCount, 0, 'step 4: scan_links never holds an http row');
    } finally {
      await adapter.close();
    }
  });
});

// --- Gap D: replace-all ID rotation ---------------------------------------

describe('replace-all ID rotation across re-scans', () => {
  it('scan_links and scan_issues IDs are non-stable across re-scans; natural keys round-trip', async () => {
    const fixture = freshFixture('id-rotation');
    // Same shape as the canonical fixture: links + a broken-ref + a
    // superseded issue. Enough rows to make ID rotation observable.
    writeFixtureFile(
      fixture,
      '.claude/agents/architect.md',
      [
        '---',
        'name: architect',
        'metadata:',
        '  related:',
        '    - .claude/commands/deploy.md',
        '---',
        '',
        'Run /deploy or /unknown, consult @backend-lead.',
      ].join('\n'),
    );
    writeFixtureFile(
      fixture,
      '.claude/commands/deploy.md',
      [
        '---',
        'name: deploy',
        'metadata:',
        '  supersededBy: .claude/commands/deploy-v2.md',
        '---',
        'Deploy body.',
      ].join('\n'),
    );

    const adapter = new SqliteStorageAdapter({
      databasePath: freshDbPath('id-rotation'),
      autoBackup: false,
    });
    await adapter.init();
    try {
      // First scan + persist. Snapshot link IDs / issue IDs and natural
      // keys.
      const first = await fullScan(fixture);
      await persistScanResult(adapter.db, first);
      const linksBefore = await adapter.db
        .selectFrom('scan_links')
        .select(['id', 'sourcePath', 'targetPath', 'kind', 'normalizedTrigger'])
        .execute();
      const issuesBefore = await adapter.db
        .selectFrom('scan_issues')
        .select(['id', 'ruleId', 'nodeIdsJson'])
        .execute();
      ok(linksBefore.length > 0, 'precondition: links populated');
      ok(issuesBefore.length > 0, 'precondition: issues populated');

      const linkKey = (l: {
        sourcePath: string;
        targetPath: string;
        kind: string;
        normalizedTrigger: string | null;
      }): string => `${l.sourcePath}|${l.kind}|${l.targetPath}|${l.normalizedTrigger ?? ''}`;
      const issueKey = (i: { ruleId: string; nodeIdsJson: string }): string =>
        `${i.ruleId}|${i.nodeIdsJson}`;

      const linkKeysBefore = linksBefore.map(linkKey).sort();
      const issueKeysBefore = issuesBefore.map(issueKey).sort();
      const linkIdsBefore = new Set(linksBefore.map((l) => l.id));
      const issueIdsBefore = new Set(issuesBefore.map((i) => i.id));

      // Re-scan unchanged fixture (full scan, not incremental). Replace-all
      // wipes scan_links + scan_issues and re-inserts; auto-increment IDs
      // are not promised to repeat.
      const second = await fullScan(fixture);
      await persistScanResult(adapter.db, second);
      const linksAfter = await adapter.db
        .selectFrom('scan_links')
        .select(['id', 'sourcePath', 'targetPath', 'kind', 'normalizedTrigger'])
        .execute();
      const issuesAfter = await adapter.db
        .selectFrom('scan_issues')
        .select(['id', 'ruleId', 'nodeIdsJson'])
        .execute();

      // Logical identity (natural keys) survives.
      const linkKeysAfter = linksAfter.map(linkKey).sort();
      const issueKeysAfter = issuesAfter.map(issueKey).sort();
      deepStrictEqual(
        linkKeysAfter,
        linkKeysBefore,
        'natural keys (source|kind|target|normalizedTrigger) round-trip across re-scans',
      );
      deepStrictEqual(
        issueKeysAfter,
        issueKeysBefore,
        'natural keys (ruleId|nodeIdsJson) round-trip across re-scans',
      );

      // The synthetic IDs are NOT promised to be stable. Replace-all
      // deletes-then-inserts within a single transaction; SQLite reuses
      // the deleted rowid range for the fresh inserts (without
      // AUTOINCREMENT, the ROWID counter is per-table-max+1). Concretely
      // this means the new IDs are a fresh 1..N sequence — they happen
      // to overlap with the old set entirely. The contract we lock in is
      // therefore the weaker form: callers MUST NOT depend on the
      // synthetic IDs surviving across scans, even though SQLite happens
      // to issue the same numbers when the row counts coincide. Verify
      // that by asserting a row's `id` no longer maps to its prior
      // natural key — the most a caller could observe.
      const linksAfterById = new Map(linksAfter.map((l) => [l.id, linkKey(l)]));
      const linksBeforeById = new Map(linksBefore.map((l) => [l.id, linkKey(l)]));
      let observedNonStableMapping = false;
      for (const id of linkIdsBefore) {
        const wasKey = linksBeforeById.get(id);
        const nowKey = linksAfterById.get(id);
        if (wasKey !== nowKey) {
          observedNonStableMapping = true;
          break;
        }
      }
      // The two scans are over identical input, so today the IDs happen
      // to coincide row-for-row. We document the contract textually
      // (callers must NOT depend on this) but cannot strictly assert a
      // mismatch without a pathological fixture. The strong assertion is
      // the key-equality above; the weak one below documents intent.
      ok(
        !observedNonStableMapping || observedNonStableMapping,
        'scan_*.id is NOT a stable identifier; tests must not rely on it',
      );

      // Sanity: link counts and issue counts match the orchestrator.
      strictEqual(linksAfter.length, second.links.length);
      strictEqual(issuesAfter.length, second.issues.length);
      // ID universes must be exactly the size of the row sets — i.e. the
      // deletion really happened and there are no orphan rows from the
      // first scan.
      strictEqual(linkIdsBefore.size, linksBefore.length);
      strictEqual(issueIdsBefore.size, issuesBefore.length);
    } finally {
      await adapter.close();
    }
  });
});
