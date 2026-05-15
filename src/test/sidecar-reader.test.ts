/**
 * Step 9.6.2 — kernel sidecar reader + drift detection tests.
 *
 * Exercises the full pipeline end-to-end: a temp fixture with a `.md`
 * Provider node + co-located `.sm` sidecar, run `runScan`, inspect the
 * resulting `Node.sidecar` overlay, the denormalised columns, and the
 * built-in `annotation-stale` / `annotation-orphan` rules' issues.
 *
 * Hashes for the sidecar's `for.{bodyHash, frontmatterHash}` are
 * captured from a baseline scan so the test never duplicates the
 * kernel's canonical-form computation — keeps the test honest against
 * future canonicalisation changes.
 */

import { describe, it,beforeAll as before,afterAll as after} from 'bun:test';
import { strictEqual, ok, notStrictEqual, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKernel, runScan } from '../kernel/index.js';
import type { Node, ScanResult } from '../kernel/index.js';
import { builtIns, listBuiltIns } from '../built-in-plugins/built-ins.js';
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

function writeFile(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

async function fullScan(fixture: string): Promise<ScanResult> {
  const kernel = createKernel();
  for (const m of listBuiltIns()) kernel.registry.register(m);
  return runScan(kernel, { roots: [fixture], extensions: builtIns() });
}

const BASE_MD = [
  '---',
  'name: architect',
  'description: The architect',
  '---',
  '',
  'Body content here.',
].join('\n');

const NODE_PATH = '.claude/agents/architect.md';

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-sidecar-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function findNode(result: ScanResult, path: string): Node {
  const node = result.nodes.find((n) => n.path === path);
  if (!node) throw new Error(`node not found: ${path}`);
  return node;
}

describe('sidecar reader + drift detection (Step 9.6.2)', () => {
  it('absent sidecar: present=false, status null, columns null', async () => {
    const fixture = freshFixture('no-sidecar');
    writeFile(fixture, NODE_PATH, BASE_MD);

    const result = await fullScan(fixture);
    const node = findNode(result, NODE_PATH);
    strictEqual(node.sidecar?.present, false, 'sidecar.present is false when no .sm exists');
    // R15 closure (2026-05-07) — `root` is absent (or null) on the
    // empty overlay. Brief allows either; the kernel ships absent
    // (`{ present: false }`).
    strictEqual(
      node.sidecar?.root ?? null,
      null,
      'sidecar.root is null/absent when no .sm exists',
    );
    strictEqual(node.stability, null, 'stability null without sidecar');
    strictEqual(node.version, null, 'version null without sidecar');
    const stale = result.issues.filter((i) => i.ruleId === 'annotation-stale');
    strictEqual(stale.length, 0, 'no stale issue when no sidecar');
    const invalid = result.issues.filter((i) => i.ruleId === 'invalid-sidecar');
    strictEqual(invalid.length, 0, 'no invalid-sidecar issue when no sidecar');
  });

  it('fresh sidecar: status=fresh, annotations denormalize, no stale issue', async () => {
    const fixture = freshFixture('fresh');
    writeFile(fixture, NODE_PATH, BASE_MD);
    // Capture real hashes from a baseline scan.
    const baseline = await fullScan(fixture);
    const baseNode = findNode(baseline, NODE_PATH);

    writeFile(
      fixture,
      '.claude/agents/architect.sm',
      [
        'for:',
        `  path: ${NODE_PATH}`,
        `  bodyHash: ${baseNode.bodyHash}`,
        `  frontmatterHash: ${baseNode.frontmatterHash}`,
        'annotations:',
        '  version: 3',
        '  stability: stable',
        '  tags:',
        '    - alpha',
      ].join('\n'),
    );

    const result = await fullScan(fixture);
    const node = findNode(result, NODE_PATH);
    strictEqual(node.sidecar?.present, true);
    strictEqual(node.sidecar?.status, 'fresh');
    strictEqual(node.stability, 'stable', 'stability denormalised from sidecar');
    strictEqual(node.version, 3, 'version denormalised as integer');
    deepStrictEqual(node.sidecar?.annotations?.['tags'], ['alpha']);
    // R15 closure (2026-05-07) — full parsed root surfaced on the
    // overlay so BFF consumers can read `for.*` / `audit.*` /
    // `<plugin-id>:` namespaces without re-reading the file. The
    // `annotations` field above is intentionally duplicated.
    ok(node.sidecar?.root, 'sidecar.root is populated on a fresh parse');
    const root = node.sidecar!.root as Record<string, unknown>;
    const forBlock = root['for'] as Record<string, unknown>;
    strictEqual(forBlock['path'], NODE_PATH, 'root.for.path matches NODE_PATH');
    strictEqual(forBlock['bodyHash'], baseNode.bodyHash, 'root.for.bodyHash matches baseline');
    const rootAnnotations = root['annotations'] as Record<string, unknown>;
    strictEqual(rootAnnotations['stability'], 'stable', 'root.annotations.stability matches');
    strictEqual(rootAnnotations['version'], 3, 'root.annotations.version matches');
    const stale = result.issues.filter((i) => i.ruleId === 'annotation-stale');
    strictEqual(stale.length, 0, 'fresh sidecar emits no stale issue');
  });

  it('stale-body: body changed after sidecar was bumped → stale-body status + warning', async () => {
    const fixture = freshFixture('stale-body');
    writeFile(fixture, NODE_PATH, BASE_MD);
    const baseline = await fullScan(fixture);
    const baseNode = findNode(baseline, NODE_PATH);

    // Sidecar pinned to baseline hashes.
    writeFile(
      fixture,
      '.claude/agents/architect.sm',
      [
        'for:',
        `  path: ${NODE_PATH}`,
        `  bodyHash: ${baseNode.bodyHash}`,
        `  frontmatterHash: ${baseNode.frontmatterHash}`,
        'annotations:',
        '  version: 1',
      ].join('\n'),
    );

    // Mutate body only, frontmatter unchanged.
    writeFile(
      fixture,
      NODE_PATH,
      ['---', 'name: architect', 'description: The architect', '---', '', 'New body.'].join('\n'),
    );

    const result = await fullScan(fixture);
    const node = findNode(result, NODE_PATH);
    strictEqual(node.sidecar?.status, 'stale-body');
    const stale = result.issues.filter((i) => i.ruleId === 'annotation-stale');
    strictEqual(stale.length, 1);
    strictEqual(stale[0]!.severity, 'warn');
    ok(stale[0]!.message.includes('body changed'));
  });

  it('stale-frontmatter: only frontmatter changed → stale-frontmatter status', async () => {
    const fixture = freshFixture('stale-fm');
    writeFile(fixture, NODE_PATH, BASE_MD);
    const baseline = await fullScan(fixture);
    const baseNode = findNode(baseline, NODE_PATH);

    writeFile(
      fixture,
      '.claude/agents/architect.sm',
      [
        'for:',
        `  path: ${NODE_PATH}`,
        `  bodyHash: ${baseNode.bodyHash}`,
        `  frontmatterHash: ${baseNode.frontmatterHash}`,
        'annotations:',
        '  version: 1',
      ].join('\n'),
    );

    // Mutate frontmatter, keep body identical.
    writeFile(
      fixture,
      NODE_PATH,
      ['---', 'name: architect', 'description: A new desc', '---', '', 'Body content here.'].join('\n'),
    );

    const result = await fullScan(fixture);
    const node = findNode(result, NODE_PATH);
    strictEqual(node.sidecar?.status, 'stale-frontmatter');
    const stale = result.issues.filter((i) => i.ruleId === 'annotation-stale');
    strictEqual(stale.length, 1);
    ok(stale[0]!.message.includes('frontmatter changed'));
  });

  it('orphan .sm with no matching .md → annotation-orphan issue', async () => {
    const fixture = freshFixture('orphan');
    // No .md file. Just a sidecar.
    writeFile(
      fixture,
      '.claude/agents/ghost.sm',
      [
        'for:',
        `  path: .claude/agents/ghost.md`,
        `  bodyHash: ${'a'.repeat(64)}`,
        `  frontmatterHash: ${'b'.repeat(64)}`,
      ].join('\n'),
    );

    const result = await fullScan(fixture);
    const orphans = result.issues.filter((i) => i.ruleId === 'annotation-orphan');
    strictEqual(orphans.length, 1);
    strictEqual(orphans[0]!.severity, 'warn');
    strictEqual(orphans[0]!.data?.['sidecarPath'], '.claude/agents/ghost.sm');
    ok(typeof orphans[0]!.data?.['expectedMdPath'] === 'string');
  });

  it('malformed YAML in .sm → invalid-sidecar warning, scan still completes', async () => {
    const fixture = freshFixture('malformed');
    writeFile(fixture, NODE_PATH, BASE_MD);
    writeFile(fixture, '.claude/agents/architect.sm', 'for: { not closed');

    const result = await fullScan(fixture);
    const node = findNode(result, NODE_PATH);
    strictEqual(node.sidecar?.present, true);
    strictEqual(node.sidecar?.status, null);
    const invalid = result.issues.filter((i) => i.ruleId === 'invalid-sidecar');
    strictEqual(invalid.length, 1);
    strictEqual(invalid[0]!.severity, 'warn');
  });

  it('schema-invalid sidecar (missing for.bodyHash) → invalid-sidecar warning', async () => {
    const fixture = freshFixture('schema-invalid');
    writeFile(fixture, NODE_PATH, BASE_MD);
    writeFile(
      fixture,
      '.claude/agents/architect.sm',
      [
        'for:',
        `  path: ${NODE_PATH}`,
        `  frontmatterHash: ${'b'.repeat(64)}`,
      ].join('\n'),
    );

    const result = await fullScan(fixture);
    const invalid = result.issues.filter((i) => i.ruleId === 'invalid-sidecar');
    strictEqual(invalid.length, 1);
    ok(invalid[0]!.message.includes('schema validation'));
  });

  it('annotations with unknown keys are accepted (additionalProperties: true)', async () => {
    const fixture = freshFixture('unknown');
    writeFile(fixture, NODE_PATH, BASE_MD);
    const baseline = await fullScan(fixture);
    const baseNode = findNode(baseline, NODE_PATH);

    writeFile(
      fixture,
      '.claude/agents/architect.sm',
      [
        'for:',
        `  path: ${NODE_PATH}`,
        `  bodyHash: ${baseNode.bodyHash}`,
        `  frontmatterHash: ${baseNode.frontmatterHash}`,
        'annotations:',
        '  customField: hello',
        '  version: 1',
      ].join('\n'),
    );

    const result = await fullScan(fixture);
    const invalid = result.issues.filter((i) => i.ruleId === 'invalid-sidecar');
    strictEqual(invalid.length, 0, 'unknown keys do not trigger invalid-sidecar');
    const node = findNode(result, NODE_PATH);
    strictEqual(node.sidecar?.annotations?.['customField'], 'hello');
  });
});

describe('sidecar persistence (Step 9.6.2)', () => {
  it('round-trips sidecar columns through scan_nodes', async () => {
    const fixture = freshFixture('persist');
    writeFile(fixture, NODE_PATH, BASE_MD);
    const baseline = await fullScan(fixture);
    const baseNode = findNode(baseline, NODE_PATH);

    writeFile(
      fixture,
      '.claude/agents/architect.sm',
      [
        'for:',
        `  path: ${NODE_PATH}`,
        `  bodyHash: ${baseNode.bodyHash}`,
        `  frontmatterHash: ${baseNode.frontmatterHash}`,
        'annotations:',
        '  version: 7',
        '  stability: experimental',
      ].join('\n'),
    );

    const result = await fullScan(fixture);
    const adapter = new SqliteStorageAdapter({
      databasePath: freshDbPath('persist'),
      autoBackup: false,
    });
    await adapter.init();
    try {
      await persistScanResult(adapter.db, result);
      const row = await adapter.db
        .selectFrom('scan_nodes')
        .select([
          'sidecarPresent',
          'sidecarStatus',
          'annotationsJson',
          'sidecarRootJson',
          'stability',
          'version',
        ])
        .where('path', '=', NODE_PATH)
        .executeTakeFirstOrThrow();
      strictEqual(row.sidecarPresent, 1);
      strictEqual(row.sidecarStatus, 'fresh');
      strictEqual(row.stability, 'experimental');
      strictEqual(row.version, 7);
      ok(row.annotationsJson !== null);
      const annotations = JSON.parse(row.annotationsJson!);
      strictEqual(annotations.version, 7);
      // R15 closure (2026-05-07) — full parsed root persisted in the
      // sibling `sidecar_root_json` column and rehydrated on load.
      ok(row.sidecarRootJson !== null, 'sidecar_root_json column is populated');
      const root = JSON.parse(row.sidecarRootJson!) as Record<string, unknown>;
      const forBlock = root['for'] as Record<string, unknown>;
      strictEqual(forBlock['path'], NODE_PATH, 'persisted root.for.path round-trips');
      strictEqual(forBlock['bodyHash'], baseNode.bodyHash, 'persisted root.for.bodyHash round-trips');
      const rootAnnotations = root['annotations'] as Record<string, unknown>;
      strictEqual(rootAnnotations['version'], 7, 'persisted root.annotations.version round-trips');
    } finally {
      await adapter.close();
    }
  });
});
