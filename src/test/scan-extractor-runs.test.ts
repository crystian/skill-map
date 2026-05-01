/**
 * Phase 4 / A.9 — fine-grained Extractor scan cache via
 * `scan_extractor_runs(node_path, extractor_id, body_hash_at_run, ran_at)`.
 *
 * The orchestrator's incremental cache previously hit at the node level
 * (body+frontmatter hashes match → reuse the prior node row + its links).
 * That model silently bypassed any Extractor newly registered between
 * scans: the cache treated "node unchanged" as "all extractor outputs
 * unchanged", even though the new extractor never ran on that node.
 *
 * A.9 layers a per-`(node, extractor)` cache row on top: a node-level
 * cache hit is upgraded to a full skip ONLY when every currently-
 * registered extractor has a row matching the prior body hash. A new
 * extractor registered between scans yields a partial hit — only the
 * newcomer runs over the cached node; the rest of the cache is preserved.
 * Removing an extractor cleans its rows + drops links whose sources are
 * exclusively that extractor (the persist-side replace-all does both
 * jobs naturally).
 *
 * These tests pin the five scenarios called out in the design:
 *
 *   1. New extractor registered → runs only on cached nodes; existing
 *      extractors do NOT re-run.
 *   2. Extractor uninstalled → its rows are dropped from
 *      `scan_extractor_runs` and links whose sources are ONLY that
 *      extractor disappear from the graph.
 *   3. Identical second scan → zero `extract()` invocations on the
 *      second pass (full cache hit).
 *   4. Body change → every applicable extractor re-runs on the modified
 *      node; siblings stay cached.
 *   5. Sources merge → a link with two sources (one cached, one
 *      uninstalled) survives with the cached source still attributed,
 *      because the persist-side replace-all preserves the link row's
 *      `sources_json` verbatim — only the uninstalled extractor's
 *      `scan_extractor_runs` row disappears.
 *
 * Uses temp file-based SQLite DBs (not `:memory:`, per
 * `feedback_sqlite_in_memory_workaround.md`).
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createKernel,
  runScanWithRenames,
  type IExtractorRunRecord,
  type Link,
  type ScanResult,
} from '../kernel/index.js';
import { builtIns } from '../built-in-plugins/built-ins.js';
import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../kernel/adapters/sqlite/scan-persistence.js';
import {
  loadExtractorRuns,
  loadScanResult,
} from '../kernel/adapters/sqlite/scan-load.js';
import type { IExtractor, IProvider, IRule } from '../kernel/extensions/index.js';

interface IScanExtensionsLite {
  providers: IProvider[];
  extractors: IExtractor[];
  rules: IRule[];
}

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
      '---',
      '',
      'Run /deploy now.',
    ].join('\n'),
  );
  writeFixtureFile(
    root,
    '.claude/commands/deploy.md',
    ['---', 'name: deploy', 'description: Deploy', '---', 'Deploy body.'].join('\n'),
  );
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-extractor-runs-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/**
 * Build a probe extractor whose `extract()` records every node it sees.
 * Mirrors the helper from `extractor-applicable-kinds.test.ts` but exposes
 * the call list directly so the A.9 tests can assert "ran" / "did not run"
 * without a separate progress emitter wiring.
 */
function buildProbeExtractor(opts: {
  id: string;
  pluginId: string;
  emitLinks?: boolean;
  manualSources?: string[];
}): { extractor: IExtractor; seenPaths: string[] } {
  const seenPaths: string[] = [];
  const extractor: IExtractor = {
    kind: 'extractor',
    id: opts.id,
    pluginId: opts.pluginId,
    version: '1.0.0',
    emitsLinkKinds: ['references'],
    defaultConfidence: 'low',
    scope: 'body',
    extract: (ctx): void => {
      seenPaths.push(ctx.node.path);
      if (opts.emitLinks) {
        ctx.emitLink({
          source: ctx.node.path,
          target: `${opts.id}-target.md`,
          kind: 'references',
          confidence: 'low',
          sources: opts.manualSources ?? [opts.id],
        });
      }
    },
  };
  return { extractor, seenPaths };
}

interface IRunOnceArgs {
  fixture: string;
  dbPath: string;
  extensions: IScanExtensionsLite;
  enableCache?: boolean;
  withFineGrainedCache?: boolean;
}

interface IRunOnceResult {
  result: ScanResult;
  extractorRuns: IExtractorRunRecord[];
  priorRuns?: Map<string, Map<string, string>>;
}

/**
 * Single-scan helper that mirrors the CLI flow: load prior + prior runs,
 * run the orchestrator with the cache wired up, persist back. Returns the
 * resulting ScanResult and the runs the orchestrator emitted, so tests
 * can assert both surfaces.
 */
async function runOnce(args: IRunOnceArgs): Promise<IRunOnceResult> {
  const kernel = createKernel();
  const adapter = new SqliteStorageAdapter({
    databasePath: args.dbPath,
    autoBackup: false,
  });
  await adapter.init();
  try {
    const loaded = await loadScanResult(adapter.db);
    const prior = loaded.nodes.length > 0 ? loaded : null;
    const priorRuns = args.withFineGrainedCache
      ? await loadExtractorRuns(adapter.db)
      : undefined;
    const runOptions: Parameters<typeof runScanWithRenames>[1] = {
      roots: [args.fixture],
      extensions: args.extensions,
    };
    if (prior) {
      runOptions.priorSnapshot = prior;
      runOptions.enableCache = args.enableCache === true;
    }
    if (priorRuns) runOptions.priorExtractorRuns = priorRuns;
    const ran = await runScanWithRenames(kernel, runOptions);
    await persistScanResult(adapter.db, ran.result, ran.renameOps, ran.extractorRuns);
    const out: IRunOnceResult = {
      result: ran.result,
      extractorRuns: ran.extractorRuns,
    };
    if (priorRuns) out.priorRuns = priorRuns;
    return out;
  } finally {
    await adapter.close();
  }
}

describe('scan_extractor_runs — fine-grained Extractor cache', () => {
  it('Test 1 — new extractor registered between scans runs ONLY on cached nodes; pre-existing extractors do not re-run', async () => {
    const fixture = freshFixture('new-extractor');
    fullFixture(fixture);
    const dbPath = freshDbPath('new-extractor');

    // First scan: built-ins only.
    const baseline = builtIns();
    await runOnce({
      fixture,
      dbPath,
      extensions: baseline,
      withFineGrainedCache: true,
    });

    // Second scan: register a NEW probe extractor in addition to the
    // built-ins. With `enableCache: true` the body / frontmatter hashes
    // still match → A.9 partial cache: only the probe runs on every
    // node. The built-in extractors must NOT see any node again.
    const probe = buildProbeExtractor({ id: 'probe', pluginId: 'test' });
    const builtInProbes: Array<{ id: string; calls: string[] }> = [];
    const wrappedBuiltIns: IExtractor[] = baseline.extractors.map((ex) => {
      const calls: string[] = [];
      builtInProbes.push({ id: ex.id, calls });
      const wrapped: IExtractor = {
        ...ex,
        extract: async (ctx) => {
          calls.push(ctx.node.path);
          await ex.extract(ctx);
        },
      };
      return wrapped;
    });

    const second = await runOnce({
      fixture,
      dbPath,
      extensions: {
        providers: baseline.providers,
        extractors: [...wrappedBuiltIns, probe.extractor],
        rules: baseline.rules,
      },
      enableCache: true,
      withFineGrainedCache: true,
    });

    // The probe ran on every node (newly registered → missing for all).
    deepStrictEqual(
      [...probe.seenPaths].sort(),
      ['.claude/agents/architect.md', '.claude/commands/deploy.md'],
      'probe extractor ran on every cached node',
    );
    // No built-in extractor saw any node — they were full-cache-hit
    // for every node body that hadn't changed since the first scan.
    for (const built of builtInProbes) {
      strictEqual(
        built.calls.length,
        0,
        `built-in extractor "${built.id}" must NOT re-run when only a new extractor was added (saw ${built.calls.length} invocation(s))`,
      );
    }

    // The DB now carries one row per (node, extractor) for every
    // currently-registered extractor — including the probe.
    const runRows = second.extractorRuns;
    const probeRows = runRows.filter((r) => r.extractorId === 'test/probe');
    strictEqual(probeRows.length, 2, 'probe ran on both nodes');
    for (const built of baseline.extractors) {
      const qualified = `${built.pluginId}/${built.id}`;
      const rows = runRows.filter((r) => r.extractorId === qualified);
      strictEqual(rows.length, 2, `built-in ${qualified} carries forward both nodes`);
    }
  });

  it('Test 2 — uninstalled extractor: rows + sole-source links disappear; surviving links keep their cached attribution', async () => {
    const fixture = freshFixture('uninstall');
    fullFixture(fixture);
    const dbPath = freshDbPath('uninstall');

    // First scan: built-ins + a probe that emits one extra link per
    // node attributed solely to itself.
    const baseline = builtIns();
    const proberA = buildProbeExtractor({
      id: 'temp-extractor',
      pluginId: 'test',
      emitLinks: true,
    });
    const first = await runOnce({
      fixture,
      dbPath,
      extensions: {
        providers: baseline.providers,
        extractors: [...baseline.extractors, proberA.extractor],
        rules: baseline.rules,
      },
      withFineGrainedCache: true,
    });

    // Sanity: the probe's links were persisted with sources=['temp-extractor'].
    const tempLinksFirst = first.result.links.filter(
      (l) => l.sources.length === 1 && l.sources[0] === 'temp-extractor',
    );
    ok(tempLinksFirst.length > 0, 'precondition: temp-extractor emitted links');

    // Second scan: drop the probe entirely. The extractor is no longer
    // registered; A.9 cleanup must (a) remove its `scan_extractor_runs`
    // rows (replace-all on persist) and (b) drop its sole-source links
    // from the cached node graph.
    const second = await runOnce({
      fixture,
      dbPath,
      extensions: baseline,
      enableCache: true,
      withFineGrainedCache: true,
    });

    // The probe's runs disappeared from the DB.
    const tempRuns = second.extractorRuns.filter(
      (r) => r.extractorId === 'test/temp-extractor',
    );
    strictEqual(tempRuns.length, 0, 'uninstalled extractor leaves zero runs in scan_extractor_runs');

    // The probe's links disappeared from the merged graph.
    const tempLinksSecond = second.result.links.filter(
      (l) => l.sources.length === 1 && l.sources[0] === 'temp-extractor',
    );
    strictEqual(
      tempLinksSecond.length,
      0,
      'links attributed solely to the uninstalled extractor must vanish',
    );

    // Built-in links survived intact — different sources, same set of
    // (source, target, kind) tuples.
    const linkKey = (l: Link): string => `${l.source}|${l.kind}|${l.target}`;
    const firstKeys = first.result.links
      .filter((l) => !l.sources.includes('temp-extractor'))
      .map(linkKey)
      .sort();
    const secondKeys = second.result.links.map(linkKey).sort();
    deepStrictEqual(secondKeys, firstKeys, 'non-temp links round-trip');
  });

  it('Test 3 — full cache hit: identical second scan invokes zero extract() calls', async () => {
    const fixture = freshFixture('full-cache');
    fullFixture(fixture);
    const dbPath = freshDbPath('full-cache');

    // First scan to populate the DB and the runs table.
    const baseline = builtIns();
    await runOnce({
      fixture,
      dbPath,
      extensions: baseline,
      withFineGrainedCache: true,
    });

    // Second scan: wrap every built-in extractor so we can count calls.
    const calls: Array<{ id: string; path: string }> = [];
    const wrapped: IExtractor[] = baseline.extractors.map((ex) => ({
      ...ex,
      extract: async (ctx) => {
        calls.push({ id: ex.id, path: ctx.node.path });
        await ex.extract(ctx);
      },
    }));
    await runOnce({
      fixture,
      dbPath,
      extensions: {
        providers: baseline.providers,
        extractors: wrapped,
        rules: baseline.rules,
      },
      enableCache: true,
      withFineGrainedCache: true,
    });

    strictEqual(
      calls.length,
      0,
      `expected zero extract() calls on a full cache hit; saw ${calls.length}: ${calls.map((c) => `${c.id}@${c.path}`).join(', ')}`,
    );
  });

  it('Test 4 — body change: every applicable extractor re-runs on the modified node; siblings stay cached', async () => {
    const fixture = freshFixture('body-change');
    fullFixture(fixture);
    const dbPath = freshDbPath('body-change');

    const baseline = builtIns();
    await runOnce({
      fixture,
      dbPath,
      extensions: baseline,
      withFineGrainedCache: true,
    });

    // Mutate one file. The other stays bit-identical.
    writeFixtureFile(
      fixture,
      '.claude/agents/architect.md',
      [
        '---',
        'name: architect',
        'description: The architect',
        '---',
        '',
        'Run /rollback now (different body).',
      ].join('\n'),
    );

    // Wrap built-ins so we can see which nodes each extractor visited.
    const callsByExtractor = new Map<string, string[]>();
    const wrapped: IExtractor[] = baseline.extractors.map((ex) => ({
      ...ex,
      extract: async (ctx) => {
        const list = callsByExtractor.get(ex.id) ?? [];
        list.push(ctx.node.path);
        callsByExtractor.set(ex.id, list);
        await ex.extract(ctx);
      },
    }));

    await runOnce({
      fixture,
      dbPath,
      extensions: {
        providers: baseline.providers,
        extractors: wrapped,
        rules: baseline.rules,
      },
      enableCache: true,
      withFineGrainedCache: true,
    });

    const architectPath = '.claude/agents/architect.md';
    const deployPath = '.claude/commands/deploy.md';

    // Every applicable extractor visited the changed file exactly once,
    // and never visited the unchanged sibling.
    for (const ex of baseline.extractors) {
      // applicableKinds may exclude some kinds — only assert against
      // those whose filter accepts both 'agent' (architect) and 'command'
      // (deploy). The four built-ins all apply universally.
      const calls = callsByExtractor.get(ex.id) ?? [];
      ok(
        calls.includes(architectPath),
        `extractor ${ex.id} should visit the modified architect node`,
      );
      ok(
        !calls.includes(deployPath),
        `extractor ${ex.id} must NOT re-run on the unchanged deploy node (saw ${calls.length} call(s))`,
      );
    }
  });

  it('Test 5 — link with multiple sources: surviving cached source keeps the link; obsolete short ids are stripped from sources[]', async () => {
    // Build a fixture and a custom probe whose emitted link declares two
    // sources: itself + an existing built-in. After uninstalling the
    // probe, A.9's reuse filter keeps the link because the built-in
    // source is still cached (`slash` extractor still registered AND
    // its `scan_extractor_runs` row covers the unchanged body), but
    // strips the probe's short id from `link.sources` so the persisted
    // row stops claiming attribution from an extractor the user
    // removed. Both behaviours together: the relationship survives,
    // the audit trail no longer references a non-existent contributor.
    const fixture = freshFixture('sources-merge');
    fullFixture(fixture);
    const dbPath = freshDbPath('sources-merge');

    const baseline = builtIns();
    // Probe declares both `slash` (a built-in's short id) and itself as
    // sources on the link it emits, so the link survives partial-cache
    // filtering as long as `slash` is still cached.
    const probe = buildProbeExtractor({
      id: 'co-emitter',
      pluginId: 'test',
      emitLinks: true,
      manualSources: ['slash', 'co-emitter'],
    });

    const first = await runOnce({
      fixture,
      dbPath,
      extensions: {
        providers: baseline.providers,
        extractors: [...baseline.extractors, probe.extractor],
        rules: baseline.rules,
      },
      withFineGrainedCache: true,
    });
    const sharedFirst = first.result.links.filter(
      (l) =>
        l.sources.includes('slash') && l.sources.includes('co-emitter'),
    );
    ok(sharedFirst.length > 0, 'precondition: co-sourced link emitted');

    // Uninstall the probe. Cached node still has links whose sources
    // include `slash` (built-in, still registered) AND `co-emitter`
    // (uninstalled). The reuse filter keeps the link because at least
    // one source is still cached, AND filters the obsolete short id
    // out of the persisted `sources[]`.
    const second = await runOnce({
      fixture,
      dbPath,
      extensions: baseline,
      enableCache: true,
      withFineGrainedCache: true,
    });

    // Find the link the probe co-sourced via its `slash` cohabitant.
    // (Path / target identity is preserved across the two scans because
    // the probe's `extract` always emits `<node.path> → co-emitter-target.md`
    // with `kind: 'references'`.)
    const survivingLinks = second.result.links.filter(
      (l) =>
        l.target === 'co-emitter-target.md' && l.kind === 'references',
    );
    strictEqual(
      survivingLinks.length,
      sharedFirst.length,
      'co-sourced link survives — `slash` is still cached so the relationship persists',
    );
    for (const link of survivingLinks) {
      ok(
        link.sources.includes('slash'),
        'cached source `slash` stays attributed',
      );
      ok(
        !link.sources.includes('co-emitter'),
        'obsolete short id `co-emitter` is stripped from sources',
      );
    }

    // The probe's `scan_extractor_runs` rows are gone.
    const probeRows = second.extractorRuns.filter(
      (r) => r.extractorId === 'test/co-emitter',
    );
    strictEqual(probeRows.length, 0, 'probe runs gone after uninstall');
  });

  it('persists the runs table: rows match the orchestrator return and survive a load round-trip', async () => {
    // A small belt-and-braces around `loadExtractorRuns` so the storage
    // adapter and the orchestrator agree on what landed in the DB.
    const fixture = freshFixture('round-trip');
    fullFixture(fixture);
    const dbPath = freshDbPath('round-trip');

    const baseline = builtIns();
    const first = await runOnce({
      fixture,
      dbPath,
      extensions: baseline,
      withFineGrainedCache: true,
    });

    // Reload the runs table directly through the storage helper.
    const adapter = new SqliteStorageAdapter({
      databasePath: dbPath,
      autoBackup: false,
    });
    await adapter.init();
    let reloaded: Map<string, Map<string, string>>;
    try {
      reloaded = await loadExtractorRuns(adapter.db);
    } finally {
      await adapter.close();
    }

    // Same number of (node, extractor) pairs as the orchestrator emitted.
    let reloadedCount = 0;
    for (const inner of reloaded.values()) reloadedCount += inner.size;
    strictEqual(
      reloadedCount,
      first.extractorRuns.length,
      'every emitted run row round-trips through the DB',
    );

    // Each pair from the return value can be located in the reloaded map.
    for (const record of first.extractorRuns) {
      const inner = reloaded.get(record.nodePath);
      ok(inner, `loaded runs map carries node ${record.nodePath}`);
      strictEqual(
        inner!.get(record.extractorId),
        record.bodyHashAtRun,
        `body hash matches for (${record.nodePath}, ${record.extractorId})`,
      );
    }
  });
});
