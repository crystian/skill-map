/**
 * Step 4.4 acceptance tests for `sm scan --changed` (incremental) and
 * `sm scan -n / --dry-run` (in-memory, no DB writes).
 *
 * Coverage:
 *   - `loadScanResult` round-trips persisted snapshots faithfully (modulo
 *     the documented external-pseudo-link omission — they were never
 *     persisted, so the loader returns zero of them).
 *   - Unchanged files are reused from the prior snapshot (cached:true on
 *     scan.progress) and the merged ScanResult is byte-equal to a full
 *     scan of the same fixture (modulo `scannedAt` and `durationMs`).
 *   - A modified file is reprocessed alone; unchanged siblings stay
 *     cached and their prior internal links survive.
 *   - A deleted file disappears from the result; rules re-run over the
 *     merged graph and broken-ref fires on dangling references.
 *   - `externalRefsCount` survives across an incremental scan because it
 *     is preserved on the cached node row (no pseudo-links to rebuild).
 *   - `--dry-run` leaves the on-disk DB untouched: a second dry-run with
 *     a mutated fixture must not overwrite the first persisted snapshot.
 *   - `--changed` against an empty DB degrades to a full scan (no crash,
 *     same shape as a regular `runScan`).
 *
 * Uses temp file-based SQLite DBs (not `:memory:`, per
 * `feedback_sqlite_in_memory_workaround.md`).
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKernel, runScan, InMemoryProgressEmitter } from '../kernel/index.js';
import type { ScanResult } from '../kernel/index.js';
import { builtIns, listBuiltIns } from '../built-in-plugins/built-ins.js';
import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../kernel/adapters/sqlite/scan-persistence.js';
import { loadScanResult } from '../kernel/adapters/sqlite/scan-load.js';
import type { ProgressEvent } from '../kernel/ports/progress-emitter.js';

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

function fullFixture(root: string): void {
  writeFixtureFile(
    root,
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
  writeFixtureFile(
    root,
    '.claude/commands/deploy.md',
    [
      '---',
      'name: deploy',
      'description: Deploy',
      'metadata:',
      '  version: 1.0.0',
      '---',
      'Deploy body.',
    ].join('\n'),
  );
  writeFixtureFile(
    root,
    '.claude/commands/rollback.md',
    ['---', 'name: Rollback', '---', 'Rollback body.'].join('\n'),
  );
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-incremental-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

async function fullScan(fixture: string): Promise<ScanResult> {
  const kernel = createKernel();
  for (const m of listBuiltIns()) kernel.registry.register(m);
  return runScan(kernel, { roots: [fixture], extensions: builtIns() });
}

async function incrementalScan(
  fixture: string,
  prior: ScanResult,
  emitter?: InMemoryProgressEmitter,
): Promise<ScanResult> {
  const kernel = createKernel();
  for (const m of listBuiltIns()) kernel.registry.register(m);
  const opts: Parameters<typeof runScan>[1] = {
    roots: [fixture],
    extensions: builtIns(),
    priorSnapshot: prior,
    // Step 5.8: cache reuse is opt-in. The incremental tests below
    // assert on `cached: true` events, so flip the flag explicitly.
    enableCache: true,
  };
  if (emitter) opts.emitter = emitter;
  return runScan(kernel, opts);
}

describe('loadScanResult', () => {
  it('round-trips a persisted ScanResult: nodes, internal links, issues match', async () => {
    const fixture = freshFixture('roundtrip');
    fullFixture(fixture);
    // Add a URL so externalRefsCount > 0 — the loader must surface that
    // count from the persisted node row even though no pseudo-link is
    // reconstructed.
    writeFixtureFile(
      fixture,
      '.claude/agents/with-url.md',
      [
        '---',
        'name: with-url',
        '---',
        '',
        'See https://example.com/docs for more.',
      ].join('\n'),
    );

    const original = await fullScan(fixture);
    const adapter = new SqliteStorageAdapter({
      databasePath: freshDbPath('roundtrip'),
      autoBackup: false,
    });
    await adapter.init();
    let loaded: ScanResult;
    try {
      await persistScanResult(adapter.db, original);
      loaded = await loadScanResult(adapter.db);
    } finally {
      await adapter.close();
    }

    // Nodes match by path; representative fields round-trip.
    strictEqual(loaded.nodes.length, original.nodes.length);
    const sortByPath = (a: { path: string }, b: { path: string }): number =>
      a.path.localeCompare(b.path);
    const orig = [...original.nodes].sort(sortByPath);
    const back = [...loaded.nodes].sort(sortByPath);
    for (let i = 0; i < orig.length; i++) {
      const a = orig[i]!;
      const b = back[i]!;
      strictEqual(b.path, a.path);
      strictEqual(b.kind, a.kind);
      strictEqual(b.provider, a.provider);
      strictEqual(b.bodyHash, a.bodyHash);
      strictEqual(b.frontmatterHash, a.frontmatterHash);
      strictEqual(b.linksOutCount, a.linksOutCount);
      strictEqual(b.linksInCount, a.linksInCount);
      strictEqual(b.externalRefsCount, a.externalRefsCount);
      deepStrictEqual(b.bytes, a.bytes);
      deepStrictEqual(b.tokens, a.tokens);
      deepStrictEqual(b.frontmatter, a.frontmatter);
    }

    // Internal links: count matches and each (source, target, kind) tuple
    // round-trips.
    strictEqual(loaded.links.length, original.links.length);
    const linkKey = (l: { source: string; target: string; kind: string }): string =>
      `${l.source}|${l.kind}|${l.target}`;
    const origLinks = original.links.map(linkKey).sort();
    const backLinks = loaded.links.map(linkKey).sort();
    deepStrictEqual(backLinks, origLinks);

    // Issues: count + ruleIds round-trip.
    strictEqual(loaded.issues.length, original.issues.length);
    const origRules = original.issues.map((i) => i.ruleId).sort();
    const backRules = loaded.issues.map((i) => i.ruleId).sort();
    deepStrictEqual(backRules, origRules);

    // Documented omission: external pseudo-links never persist, so the
    // loaded result.links carries zero of them — but the count survives.
    const url = loaded.nodes.find((n) => n.path === '.claude/agents/with-url.md');
    ok(url, 'with-url node round-tripped');
    strictEqual(url!.externalRefsCount, 1);
    strictEqual(
      loaded.links.filter((l) => l.target.startsWith('http')).length,
      0,
      'no external pseudo-links in loaded.links',
    );
  });
});

describe('incremental scan via priorSnapshot', () => {
  it('reuses every node when the fixture is unchanged (all cached)', async () => {
    const fixture = freshFixture('unchanged');
    fullFixture(fixture);

    const first = await fullScan(fixture);
    ok(first.nodes.length > 0);

    const events: ProgressEvent[] = [];
    const emitter = new InMemoryProgressEmitter();
    emitter.subscribe((e) => events.push(e));
    const second = await incrementalScan(fixture, first, emitter);

    // Every scan.progress event should carry cached:true.
    const progress = events.filter((e) => e.type === 'scan.progress');
    strictEqual(progress.length, first.nodes.length);
    for (const ev of progress) {
      const data = ev.data as { cached: boolean };
      strictEqual(data.cached, true);
    }

    // Final result is byte-equal to the first scan modulo scannedAt and
    // durationMs.
    strictEqual(second.nodes.length, first.nodes.length);
    strictEqual(second.links.length, first.links.length);
    strictEqual(second.issues.length, first.issues.length);
    const norm = (n: { path: string; bodyHash: string; linksOutCount: number; linksInCount: number; externalRefsCount: number }): string =>
      `${n.path}|${n.bodyHash}|${n.linksOutCount}|${n.linksInCount}|${n.externalRefsCount}`;
    deepStrictEqual(
      second.nodes.map(norm).sort(),
      first.nodes.map(norm).sort(),
    );
    const linkKey = (l: { source: string; target: string; kind: string }): string =>
      `${l.source}|${l.kind}|${l.target}`;
    deepStrictEqual(
      second.links.map(linkKey).sort(),
      first.links.map(linkKey).sort(),
    );
  });

  it('reprocesses only the modified node; unchanged siblings stay cached', async () => {
    const fixture = freshFixture('modified');
    fullFixture(fixture);
    const first = await fullScan(fixture);
    const architectFirst = first.nodes.find((n) => n.path === '.claude/agents/architect.md');
    ok(architectFirst);

    // Mutate one file's body; everything else stays bit-identical.
    writeFixtureFile(
      fixture,
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
        'Run /deploy and /rollback now. No further consultation needed.',
      ].join('\n'),
    );

    const events: ProgressEvent[] = [];
    const emitter = new InMemoryProgressEmitter();
    emitter.subscribe((e) => events.push(e));
    const second = await incrementalScan(fixture, first, emitter);

    const progress = events.filter((e) => e.type === 'scan.progress');
    const cachedPaths = new Set<string>();
    const reprocessedPaths = new Set<string>();
    for (const ev of progress) {
      const data = ev.data as { cached: boolean; path: string };
      if (data.cached) cachedPaths.add(data.path);
      else reprocessedPaths.add(data.path);
    }
    deepStrictEqual([...reprocessedPaths].sort(), ['.claude/agents/architect.md']);
    ok(cachedPaths.has('.claude/commands/deploy.md'));
    ok(cachedPaths.has('.claude/commands/rollback.md'));

    // The architect node has a fresh bodyHash; cached nodes keep theirs.
    const architectSecond = second.nodes.find(
      (n) => n.path === '.claude/agents/architect.md',
    );
    ok(architectSecond);
    ok(architectSecond!.bodyHash !== architectFirst!.bodyHash);
    const deployFirst = first.nodes.find(
      (n) => n.path === '.claude/commands/deploy.md',
    );
    const deploySecond = second.nodes.find(
      (n) => n.path === '.claude/commands/deploy.md',
    );
    ok(deployFirst && deploySecond);
    strictEqual(deploySecond!.bodyHash, deployFirst!.bodyHash);

    // Architect's outbound links are now /deploy + /rollback (no @handle).
    const linkKey = (l: { source: string; target: string; kind: string }): string =>
      `${l.source}|${l.kind}|${l.target}`;
    const fromArchitect = second.links
      .filter((l) => l.source === '.claude/agents/architect.md')
      .map(linkKey)
      .sort();
    ok(
      fromArchitect.some((s) => s.endsWith('|invokes|/deploy')),
      'architect emits /deploy after edit',
    );
    ok(
      fromArchitect.some((s) => s.endsWith('|invokes|/rollback')),
      'architect emits /rollback after edit',
    );
    ok(
      !fromArchitect.some((s) => s.endsWith('|mentions|@backend-lead')),
      '@backend-lead mention removed by edit',
    );

    // Unchanged sources keep their previously-detected internal links.
    const fromDeployFirst = first.links
      .filter((l) => l.source === '.claude/commands/deploy.md')
      .map(linkKey)
      .sort();
    const fromDeploySecond = second.links
      .filter((l) => l.source === '.claude/commands/deploy.md')
      .map(linkKey)
      .sort();
    deepStrictEqual(fromDeploySecond, fromDeployFirst);
  });

  it('drops a deleted node from the merged result', async () => {
    const fixture = freshFixture('deleted');
    fullFixture(fixture);
    const first = await fullScan(fixture);
    ok(first.nodes.find((n) => n.path === '.claude/commands/deploy.md'));

    // Delete deploy.md — architect.md still has a frontmatter.related
    // pointing at it, so broken-ref must fire on the merged graph.
    unlinkSync(join(fixture, '.claude/commands/deploy.md'));

    const second = await incrementalScan(fixture, first);

    ok(
      !second.nodes.find((n) => n.path === '.claude/commands/deploy.md'),
      'deploy.md is gone from the merged result',
    );
    // Rules re-ran over the merged graph; broken-ref fires on the
    // dangling reference from architect.md.
    const brokenRefs = second.issues.filter((i) => i.ruleId === 'broken-ref');
    ok(
      brokenRefs.some((i) =>
        i.nodeIds.includes('.claude/agents/architect.md'),
      ),
      'broken-ref fires on architect after deploy.md is deleted',
    );
  });

  it('preserves externalRefsCount across an unchanged incremental scan', async () => {
    const fixture = freshFixture('external');
    writeFixtureFile(
      fixture,
      '.claude/agents/links.md',
      [
        '---',
        'name: links',
        '---',
        '',
        'See https://example.com and https://example.com/path.',
      ].join('\n'),
    );

    const first = await fullScan(fixture);
    const linksFirst = first.nodes.find((n) => n.path === '.claude/agents/links.md');
    ok(linksFirst);
    strictEqual(linksFirst!.externalRefsCount, 2);

    // Round-trip through DB so the prior we feed back has zero external
    // pseudo-links (the persistence-realistic shape — exactly what
    // `--changed` will load in production).
    const adapter = new SqliteStorageAdapter({
      databasePath: freshDbPath('external'),
      autoBackup: false,
    });
    await adapter.init();
    let priorFromDb: ScanResult;
    try {
      await persistScanResult(adapter.db, first);
      priorFromDb = await loadScanResult(adapter.db);
    } finally {
      await adapter.close();
    }
    strictEqual(
      priorFromDb.links.filter((l) => l.target.startsWith('http')).length,
      0,
      'persisted-and-loaded prior has no external pseudo-links',
    );

    const second = await incrementalScan(fixture, priorFromDb);
    const linksSecond = second.nodes.find(
      (n) => n.path === '.claude/agents/links.md',
    );
    ok(linksSecond);
    strictEqual(
      linksSecond!.externalRefsCount,
      2,
      'externalRefsCount survives even though no pseudo-link was reconstructed',
    );
  });

  it('--dry-run equivalent: persisting first then NOT persisting a second scan leaves the DB on the first snapshot', async () => {
    const fixture = freshFixture('dryrun');
    fullFixture(fixture);
    const first = await fullScan(fixture);

    const dbPath = freshDbPath('dryrun');
    const adapter = new SqliteStorageAdapter({
      databasePath: dbPath,
      autoBackup: false,
    });
    await adapter.init();
    try {
      await persistScanResult(adapter.db, first);
    } finally {
      await adapter.close();
    }

    // Mutate the fixture, run a second scan — but DO NOT persist (the
    // dry-run code path in ScanCommand). The on-disk DB must still
    // reflect the first snapshot.
    writeFixtureFile(
      fixture,
      '.claude/agents/architect.md',
      [
        '---',
        'name: architect',
        'description: NEW DESCRIPTION',
        '---',
        '',
        'Body changed.',
      ].join('\n'),
    );
    await fullScan(fixture); // computed, intentionally discarded

    // Re-open the DB and verify it still holds the first snapshot's
    // architect node (old description, old bodyHash).
    const verify = new SqliteStorageAdapter({
      databasePath: dbPath,
      autoBackup: false,
    });
    await verify.init();
    try {
      const reloaded = await loadScanResult(verify.db);
      const architect = reloaded.nodes.find(
        (n) => n.path === '.claude/agents/architect.md',
      );
      ok(architect);
      strictEqual(architect!.description, 'The architect');
      const architectFirst = first.nodes.find(
        (n) => n.path === '.claude/agents/architect.md',
      );
      strictEqual(architect!.bodyHash, architectFirst!.bodyHash);
    } finally {
      await verify.close();
    }
  });

  it('preserves supersedes-inversion links from cached nodes (B3 regression)', async () => {
    // The frontmatter extractor emits an inverted `supersedes` link when a
    // node carries `metadata.supersededBy: <newer>`: source = <newer>,
    // target = <this-node>. The cached-reuse filter previously keyed
    // prior links by `link.source === node.path`, which dropped these
    // inverted edges (their source is a DIFFERENT node — typically the
    // supersedor that may not even exist on disk).
    const fixture = freshFixture('supersedes-inversion');
    // A is the OLDER node — it points forward at B via `supersededBy`.
    writeFixtureFile(
      fixture,
      '.claude/agents/a.md',
      [
        '---',
        'name: a',
        'metadata:',
        '  supersededBy: .claude/agents/b.md',
        '---',
        '',
        'Old A.',
      ].join('\n'),
    );
    // B is the NEWER node. It does NOT need to advertise `supersedes` —
    // the inverted edge is emitted purely from A's frontmatter.
    writeFixtureFile(
      fixture,
      '.claude/agents/b.md',
      ['---', 'name: b', '---', '', 'New B.'].join('\n'),
    );

    const first = await fullScan(fixture);
    const supersedes = first.links.filter((l) => l.kind === 'supersedes');
    strictEqual(supersedes.length, 1, 'precondition: full scan emits exactly one supersedes link');
    strictEqual(supersedes[0]!.source, '.claude/agents/b.md');
    strictEqual(supersedes[0]!.target, '.claude/agents/a.md');

    const second = await incrementalScan(fixture, first);
    strictEqual(
      second.links.length,
      first.links.length,
      `incremental scan must preserve link count (was ${first.links.length}, got ${second.links.length})`,
    );
    const supersedesAfter = second.links.filter((l) => l.kind === 'supersedes');
    strictEqual(supersedesAfter.length, 1, 'inverted supersedes link survived incremental scan');
    strictEqual(supersedesAfter[0]!.source, '.claude/agents/b.md');
    strictEqual(supersedesAfter[0]!.target, '.claude/agents/a.md');
  });

  it('full scan and incremental scan over identical input yield set-equal links (structural invariant)', async () => {
    // Codifies the invariant the supersedes-inversion bug violated. Use a
    // fixture that exercises every extractor: forward `supersedes`,
    // inverted `supersededBy`, slash, at-directive, and frontmatter
    // requires/related. Both scans must yield the same set of (source,
    // kind, target) tuples — incremental reuse must not lose links.
    const fixture = freshFixture('set-equal');
    writeFixtureFile(
      fixture,
      '.claude/agents/architect.md',
      [
        '---',
        'name: architect',
        'metadata:',
        '  related:',
        '    - .claude/commands/deploy.md',
        '  supersedes:',
        '    - .claude/agents/architect-old.md',
        '---',
        '',
        'Run /deploy and consult @backend-lead.',
      ].join('\n'),
    );
    writeFixtureFile(
      fixture,
      '.claude/agents/architect-old.md',
      [
        '---',
        'name: architect-old',
        'metadata:',
        '  supersededBy: .claude/agents/architect.md',
        '---',
        '',
        'Legacy.',
      ].join('\n'),
    );
    writeFixtureFile(
      fixture,
      '.claude/commands/deploy.md',
      ['---', 'name: deploy', '---', 'Deploy body.'].join('\n'),
    );

    const first = await fullScan(fixture);
    const second = await incrementalScan(fixture, first);

    const linkKey = (l: { source: string; kind: string; target: string }): string =>
      `${l.source}|${l.kind}|${l.target}`;
    const firstKeys = first.links.map(linkKey).sort();
    const secondKeys = second.links.map(linkKey).sort();
    deepStrictEqual(
      secondKeys,
      firstKeys,
      'incremental link set must equal full-scan link set over identical input',
    );
  });

  it('--changed degrade: empty prior snapshot ⇒ behaves like a full scan', async () => {
    const fixture = freshFixture('degrade');
    fullFixture(fixture);

    // An empty prior is what loadScanResult returns over an empty DB.
    const dbPath = freshDbPath('degrade');
    const adapter = new SqliteStorageAdapter({
      databasePath: dbPath,
      autoBackup: false,
    });
    await adapter.init();
    let emptyPrior: ScanResult;
    try {
      emptyPrior = await loadScanResult(adapter.db);
    } finally {
      await adapter.close();
    }
    strictEqual(emptyPrior.nodes.length, 0);
    strictEqual(emptyPrior.links.length, 0);

    // The CLI's degrade rule turns an empty snapshot into a null prior;
    // we exercise the orchestrator with both shapes to prove they
    // coincide.
    const fromNull = await fullScan(fixture);
    const fromEmpty = await incrementalScan(fixture, emptyPrior);

    strictEqual(fromEmpty.nodes.length, fromNull.nodes.length);
    strictEqual(fromEmpty.links.length, fromNull.links.length);
    strictEqual(fromEmpty.issues.length, fromNull.issues.length);
    const linkKey = (l: { source: string; target: string; kind: string }): string =>
      `${l.source}|${l.kind}|${l.target}`;
    deepStrictEqual(
      fromEmpty.links.map(linkKey).sort(),
      fromNull.links.map(linkKey).sort(),
    );
  });

  it('deletion-driven dynamic broken-ref re-evaluation: full scan after delete also fires the rule on the deleted target', async () => {
    // Companion to the "drops a deleted node" test above. That one
    // exercises the INCREMENTAL path (the more interesting one — the
    // surviving node is cached, no extractor re-runs against it, yet the
    // rule still sees the missing target). This one exercises the FULL
    // scan path to lock in the same invariant from the other side: rules
    // always run over the merged graph, regardless of whether nodes came
    // from the cache or from a fresh extractor pass.
    //
    // The default fixture's architect already has /unknown + @backend-lead
    // dangling, so we can't simply assert "broken-ref appears after delete"
    // — we must assert specifically that broken-ref fires AGAINST the
    // deleted target (data.target).
    const fixture = freshFixture('deleted-full');
    fullFixture(fixture);
    const first = await fullScan(fixture);
    ok(first.nodes.find((n) => n.path === '.claude/commands/deploy.md'));
    // Predicate: a broken-ref whose target is the deploy command (path or
    // slash trigger). Both forms exist on architect:
    //   - frontmatter.related → `.claude/commands/deploy.md` (path-style)
    //   - body `/deploy` (trigger-style, target stored as `/deploy`)
    const targetsDeploy = (issue: { data?: unknown }): boolean => {
      const data = issue.data as { target?: string } | undefined;
      const t = data?.target;
      return t === '.claude/commands/deploy.md' || t === '/deploy';
    };
    const brokenRefsFirst = first.issues.filter((i) => i.ruleId === 'broken-ref');
    ok(
      !brokenRefsFirst.some(targetsDeploy),
      'precondition: no broken-ref targets deploy while deploy.md exists',
    );

    unlinkSync(join(fixture, '.claude/commands/deploy.md'));

    const second = await fullScan(fixture);
    ok(
      !second.nodes.find((n) => n.path === '.claude/commands/deploy.md'),
      'deploy.md is gone from the full-scan result',
    );
    const brokenRefsSecond = second.issues.filter((i) => i.ruleId === 'broken-ref');
    const fromArchitectAtDeploy = brokenRefsSecond.filter(
      (i) => i.nodeIds.includes('.claude/agents/architect.md') && targetsDeploy(i),
    );
    ok(
      fromArchitectAtDeploy.length > 0,
      'broken-ref fires on architect→deploy after deploy.md is deleted (full scan path)',
    );
  });
});

// --- Gap G: trigger-collision interacts with --changed --------------------

describe('trigger-collision rule under --changed', () => {
  function plantCollidingCommands(root: string, deployDescription: string): void {
    // Two commands both advertising `name: deploy` — the canonical
    // collision case from Step 4.9. The advertiser-detection branch of
    // the rule fires regardless of any invocation links.
    writeFixtureFile(
      root,
      '.claude/commands/deploy-a.md',
      [
        '---',
        'name: deploy',
        `description: ${deployDescription}`,
        '---',
        'Deploy A body.',
      ].join('\n'),
    );
    writeFixtureFile(
      root,
      '.claude/commands/deploy-b.md',
      ['---', 'name: deploy', 'description: Deploy B', '---', 'Deploy B body.'].join('\n'),
    );
  }

  it('full scan flags two advertisers as a collision (precondition)', async () => {
    const fixture = freshFixture('collision-full');
    plantCollidingCommands(fixture, 'Deploy A');
    const first = await fullScan(fixture);
    const collisions = first.issues.filter((i) => i.ruleId === 'trigger-collision');
    strictEqual(collisions.length, 1, 'two advertisers → exactly one trigger-collision issue');
    ok(
      collisions[0]!.nodeIds.includes('.claude/commands/deploy-a.md'),
      'collision references deploy-a',
    );
    ok(
      collisions[0]!.nodeIds.includes('.claude/commands/deploy-b.md'),
      'collision references deploy-b',
    );
  });

  it('--changed: editing one advertiser (description only, name unchanged) keeps the collision firing', async () => {
    const fixture = freshFixture('collision-edit');
    plantCollidingCommands(fixture, 'Deploy A');
    const first = await fullScan(fixture);
    const firstCollisions = first.issues.filter((i) => i.ruleId === 'trigger-collision');
    strictEqual(firstCollisions.length, 1, 'precondition: full scan emits exactly one collision');

    // Mutate the description on ONE advertiser. The frontmatter still
    // declares `name: deploy`; both nodes still advertise the same trigger.
    writeFixtureFile(
      fixture,
      '.claude/commands/deploy-a.md',
      [
        '---',
        'name: deploy',
        'description: Deploy A — revised',
        '---',
        'Deploy A body.',
      ].join('\n'),
    );

    const second = await incrementalScan(fixture, first);
    const secondCollisions = second.issues.filter((i) => i.ruleId === 'trigger-collision');
    strictEqual(
      secondCollisions.length,
      1,
      'incremental scan: collision still fires when the colliders survive',
    );
    ok(
      secondCollisions[0]!.nodeIds.includes('.claude/commands/deploy-a.md'),
      'collision still references deploy-a after edit',
    );
    ok(
      secondCollisions[0]!.nodeIds.includes('.claude/commands/deploy-b.md'),
      'collision still references deploy-b (cached node) after edit',
    );
  });

  it('--changed: deleting one advertiser clears the collision', async () => {
    const fixture = freshFixture('collision-delete');
    plantCollidingCommands(fixture, 'Deploy A');
    const first = await fullScan(fixture);
    strictEqual(
      first.issues.filter((i) => i.ruleId === 'trigger-collision').length,
      1,
      'precondition: full scan emits the collision',
    );

    // Remove one of the two competitors. The remaining single advertiser
    // is no longer in conflict with anyone.
    unlinkSync(join(fixture, '.claude/commands/deploy-b.md'));

    const second = await incrementalScan(fixture, first);
    const secondCollisions = second.issues.filter((i) => i.ruleId === 'trigger-collision');
    strictEqual(
      secondCollisions.length,
      0,
      'incremental scan: collision must clear when one of the colliders is deleted',
    );
    ok(
      !second.nodes.find((n) => n.path === '.claude/commands/deploy-b.md'),
      'deploy-b really is gone from the merged result',
    );
  });
});
