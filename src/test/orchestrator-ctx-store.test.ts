/**
 * Spec § A.12 acceptance — `IExtractorContext.store` wiring.
 *
 * The orchestrator looks up the per-plugin storage wrapper from
 * `RunScanOptions.pluginStores` (keyed by `pluginId`) and attaches it
 * to the context handed to each extractor. These tests pin:
 *
 *   (a) `pluginStores` absent → `ctx.store` is `undefined` for every
 *       extractor (the legacy contract for plugins without storage).
 *   (b) `pluginStores` with an entry for the extractor's `pluginId` →
 *       `ctx.store` IS that wrapper. The extractor can call its
 *       methods and writes flow into the supplied persist callback.
 *   (c) Multiple plugins, multiple stores → each extractor gets the
 *       wrapper keyed by its own `pluginId` (no cross-plugin leakage).
 *   (d) `runExtractorsForNode` (the refresh path) honours the same
 *       wiring as the in-scan path.
 *
 * The probe extractors capture `ctx.store` and any persist calls
 * synchronously into per-test arrays; tests assert against those
 * arrays after the scan completes.
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  InMemoryProgressEmitter,
  createKernel,
  makeKvStoreWrapper,
  makeDedicatedStoreWrapper,
  runExtractorsForNode,
  runScan,
} from '../kernel/index.js';
import type {
  IPluginStore,
  IKvStoreWrapper,
  IDedicatedStoreWrapper,
} from '../kernel/index.js';
import { builtIns } from '../built-in-plugins/built-ins.js';
import type { IExtractor } from '../kernel/extensions/index.js';
import type { Node } from '../kernel/types.js';

let fixture: string;

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-ctx-store-'));
  const write = (rel: string, content: string): void => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };
  // Single skill node — the per-extractor wiring is what's under test;
  // any provider-classified file is sufficient.
  write(
    '.claude/skills/probe/SKILL.md',
    ['---', 'name: probe', 'description: D', '---', 'Body.'].join('\n'),
  );
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
});

/**
 * Probe extractor that captures `ctx.store` for the kind under test.
 * `pluginId` is parameterised so a single test can register two probes
 * from two different plugin namespaces and assert each one sees its
 * own wrapper.
 */
function buildProbe(
  pluginId: string,
): { extractor: IExtractor; seen: Array<{ pluginId: string; store: unknown }> } {
  const seen: Array<{ pluginId: string; store: unknown }> = [];
  const extractor: IExtractor = {
    kind: 'extractor',
    id: 'store-probe',
    pluginId,
    version: '1.0.0',
    emitsLinkKinds: ['references'],
    defaultConfidence: 'low',
    scope: 'body',
    extract: (ctx): void => {
      seen.push({ pluginId, store: ctx.store });
    },
  };
  return { extractor, seen };
}

describe('IExtractorContext.store wiring (spec § A.12)', () => {
  it('(a) pluginStores absent → ctx.store stays undefined', async () => {
    const { extractor, seen } = buildProbe('test-plugin');
    const kernel = createKernel();
    const baseline = builtIns();
    await runScan(kernel, {
      roots: [fixture],
      extensions: {
        providers: baseline.providers,
        extractors: [extractor],
        rules: [],
      },
    });
    strictEqual(seen.length, 1);
    strictEqual(seen[0]?.store, undefined);
  });

  it('(b) pluginStores entry matches pluginId → ctx.store is that wrapper, persist captures writes', async () => {
    const persisted: Array<{ key: string; value: unknown }> = [];
    const wrapper: IKvStoreWrapper = makeKvStoreWrapper({
      pluginId: 'test-plugin',
      schema: undefined,
      persist: (key, value) => {
        persisted.push({ key, value });
      },
    });

    const seen: Array<unknown> = [];
    const extractor: IExtractor = {
      kind: 'extractor',
      id: 'store-probe',
      pluginId: 'test-plugin',
      version: '1.0.0',
      emitsLinkKinds: ['references'],
      defaultConfidence: 'low',
      scope: 'body',
      extract: async (ctx): Promise<void> => {
        seen.push(ctx.store);
        const store = ctx.store as IKvStoreWrapper;
        await store.set('first-seen', { path: ctx.node.path });
      },
    };

    const kernel = createKernel();
    const baseline = builtIns();
    const pluginStores = new Map<string, IPluginStore>([['test-plugin', wrapper]]);
    await runScan(kernel, {
      roots: [fixture],
      extensions: {
        providers: baseline.providers,
        extractors: [extractor],
        rules: [],
      },
      pluginStores,
    });

    strictEqual(seen.length, 1);
    strictEqual(seen[0], wrapper, 'ctx.store should be the exact wrapper instance keyed by pluginId');
    deepStrictEqual(persisted, [
      { key: 'first-seen', value: { path: '.claude/skills/probe/SKILL.md' } },
    ]);
  });

  it('(c) Multiple plugins → each extractor receives only its own wrapper', async () => {
    const wrapperA: IKvStoreWrapper = makeKvStoreWrapper({
      pluginId: 'plugin-a',
      schema: undefined,
      persist: () => {},
    });
    const wrapperB: IDedicatedStoreWrapper = makeDedicatedStoreWrapper({
      pluginId: 'plugin-b',
      schemas: undefined,
      persist: () => {},
    });

    const probeA = buildProbe('plugin-a');
    const probeB = buildProbe('plugin-b');

    const kernel = createKernel();
    const baseline = builtIns();
    const pluginStores = new Map<string, IPluginStore>([
      ['plugin-a', wrapperA],
      ['plugin-b', wrapperB],
    ]);

    await runScan(kernel, {
      roots: [fixture],
      extensions: {
        providers: baseline.providers,
        extractors: [probeA.extractor, probeB.extractor],
        rules: [],
      },
      pluginStores,
    });

    strictEqual(probeA.seen.length, 1);
    strictEqual(probeA.seen[0]?.store, wrapperA);
    strictEqual(probeB.seen.length, 1);
    strictEqual(probeB.seen[0]?.store, wrapperB);
    // Cross-check: neither extractor saw the OTHER plugin's wrapper.
    // Cast through `unknown` because TS rejects an identity check
    // between the Mode A and Mode B shapes (their structural overlap
    // is empty).
    ok((probeA.seen[0]?.store as unknown) !== (wrapperB as unknown));
    ok((probeB.seen[0]?.store as unknown) !== (wrapperA as unknown));
  });

  it('(c2) Plugin without an entry in pluginStores → ctx.store stays undefined for that one only', async () => {
    const wrapperA: IKvStoreWrapper = makeKvStoreWrapper({
      pluginId: 'plugin-a',
      schema: undefined,
      persist: () => {},
    });

    const probeA = buildProbe('plugin-a');
    const probeOrphan = buildProbe('plugin-without-store');

    const kernel = createKernel();
    const baseline = builtIns();
    const pluginStores = new Map<string, IPluginStore>([['plugin-a', wrapperA]]);

    await runScan(kernel, {
      roots: [fixture],
      extensions: {
        providers: baseline.providers,
        extractors: [probeA.extractor, probeOrphan.extractor],
        rules: [],
      },
      pluginStores,
    });

    strictEqual(probeA.seen[0]?.store, wrapperA);
    strictEqual(probeOrphan.seen[0]?.store, undefined);
  });

  it('(d) runExtractorsForNode honours pluginStores the same way', async () => {
    const persisted: Array<{ key: string; value: unknown }> = [];
    const wrapper: IKvStoreWrapper = makeKvStoreWrapper({
      pluginId: 'refresh-plugin',
      schema: undefined,
      persist: (key, value) => {
        persisted.push({ key, value });
      },
    });

    const extractor: IExtractor = {
      kind: 'extractor',
      id: 'refresh-probe',
      pluginId: 'refresh-plugin',
      version: '1.0.0',
      emitsLinkKinds: ['references'],
      defaultConfidence: 'low',
      scope: 'body',
      extract: async (ctx): Promise<void> => {
        const store = ctx.store as IKvStoreWrapper;
        await store.set('via-refresh', { nodePath: ctx.node.path });
      },
    };

    const node: Node = {
      path: 'fake/node.md',
      kind: 'skill',
      provider: 'claude',
      bodyHash: 'hash-body',
      frontmatterHash: 'hash-fm',
      bytes: { frontmatter: 0, body: 0, total: 0 },
      linksOutCount: 0,
      linksInCount: 0,
      externalRefsCount: 0,
      frontmatter: {},
    };

    await runExtractorsForNode({
      extractors: [extractor],
      node,
      body: 'body',
      frontmatter: {},
      bodyHash: 'hash-body',
      emitter: new InMemoryProgressEmitter(),
      pluginStores: new Map<string, IPluginStore>([['refresh-plugin', wrapper]]),
    });

    deepStrictEqual(persisted, [
      { key: 'via-refresh', value: { nodePath: 'fake/node.md' } },
    ]);
  });
});
