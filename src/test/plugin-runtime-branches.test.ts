/**
 * Step 9.1 follow-up — branch coverage for plugin-runtime.ts. The
 * happy path (scope='project', no pluginDir) is exercised by the
 * end-to-end tests in `plugin-runtime.test.ts`. This file targets the
 * remaining branches:
 *
 *   - `pluginDir` override skips the project + user search paths
 *   - `scope: 'global'` reads only the user-level plugin folder
 *   - `emptyPluginRuntime()` returns the canonical zero-bundle shape
 *   - `composeScanExtensions({ noBuiltIns: true, ... })` returns
 *     `undefined` when no plugin extensions exist (orchestrator
 *     follows its zero-extension code path)
 *   - `composeFormatters({ noBuiltIns: true })` returns plugin
 *     formatters only (no built-ins)
 */

import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  composeFormatters,
  composeScanExtensions,
  emptyPluginRuntime,
  filterBuiltInManifests,
  loadPluginRuntime,
} from '../cli/util/plugin-runtime.js';
import { listBuiltIns } from '../extensions/built-ins.js';

let root: string;
let counter = 0;

function freshDir(label: string): string {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function plantExtractor(pluginsDir: string, id: string): void {
  const dir = join(pluginsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({
      id,
      version: '1.0.0',
      specCompat: '>=0.0.0',
      extensions: ['./d.mjs'],
    }),
  );
  writeFileSync(
    join(dir, 'd.mjs'),
    `export default {
      id: '${id}-d',
      kind: 'extractor',
      version: '1.0.0',
      emitsLinkKinds: ['references'],
      defaultConfidence: 'high',
      scope: 'body',
      extract() {},
    };`,
  );
}

function plantFormatter(pluginsDir: string, id: string, formatId: string): void {
  const dir = join(pluginsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({
      id,
      version: '1.0.0',
      specCompat: '>=0.0.0',
      extensions: ['./f.mjs'],
    }),
  );
  writeFileSync(
    join(dir, 'f.mjs'),
    `export default {
      id: '${id}-f',
      kind: 'formatter',
      version: '1.0.0',
      formatId: '${formatId}',
      format() { return ''; },
    };`,
  );
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-plugin-rt-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('plugin-runtime — branch coverage', () => {
  it('pluginDir override skips project + user search paths', async () => {
    const customDir = freshDir('custom');
    plantExtractor(customDir, 'custom-only');

    const bundle = await loadPluginRuntime({ scope: 'project', pluginDir: customDir });
    assert.equal(bundle.discovered.length, 1);
    assert.equal(bundle.discovered[0]!.id, 'custom-only');
    assert.equal(bundle.extensions.extractors.length, 1);
    assert.equal(bundle.extensions.extractors[0]!.id, 'custom-only-d');
  });

  it('scope=global reads only the user-level plugins folder', async () => {
    const globalRoot = freshDir('global-home');
    const globalPlugins = join(globalRoot, '.skill-map', 'plugins');
    mkdirSync(globalPlugins, { recursive: true });
    plantExtractor(globalPlugins, 'global-plugin');

    // Override $HOME so the helper resolves ~/.skill-map/plugins under
    // our temp dir.
    const origHome = process.env['HOME'];
    process.env['HOME'] = globalRoot;
    const origCwd = process.cwd();
    process.chdir(freshDir('cwd-empty'));
    try {
      const bundle = await loadPluginRuntime({ scope: 'global' });
      assert.equal(bundle.discovered.length, 1);
      assert.equal(bundle.discovered[0]!.id, 'global-plugin');
    } finally {
      process.chdir(origCwd);
      if (origHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = origHome;
    }
  });

  it('emptyPluginRuntime() returns the canonical zero-bundle shape', () => {
    const empty = emptyPluginRuntime();
    assert.deepEqual(empty.extensions, {
      providers: [],
      extractors: [],
      rules: [],
      formatters: [],
      hooks: [],
    });
    assert.deepEqual(empty.manifests, []);
    assert.deepEqual(empty.warnings, []);
    assert.deepEqual(empty.discovered, []);
  });

  it('composeScanExtensions({ noBuiltIns, empty plugins }) returns undefined', () => {
    const composed = composeScanExtensions({
      noBuiltIns: true,
      pluginRuntime: emptyPluginRuntime(),
    });
    assert.equal(composed, undefined, 'kernel-empty-boot path expects undefined');
  });

  it('composeScanExtensions with built-ins returns the full set', () => {
    const composed = composeScanExtensions({
      noBuiltIns: false,
      pluginRuntime: emptyPluginRuntime(),
    });
    assert.ok(composed);
    assert.ok(composed.providers.length >= 1, 'expected at least the claude provider');
    assert.ok(composed.extractors.length >= 1, 'expected at least one built-in extractor');
    assert.ok(composed.rules.length >= 1, 'expected at least one built-in rule');
  });

  it('composeFormatters({ noBuiltIns: true }) excludes built-in formatters', async () => {
    const customDir = freshDir('formatter-only');
    plantFormatter(customDir, 'custom-formatter', 'csv');
    const bundle = await loadPluginRuntime({ scope: 'project', pluginDir: customDir });

    const noBi = composeFormatters({ noBuiltIns: true, pluginRuntime: bundle });
    assert.equal(noBi.length, 1);
    assert.equal(noBi[0]!.formatId, 'csv');

    const withBi = composeFormatters({ pluginRuntime: bundle });
    assert.ok(withBi.length >= 2, 'expected built-in ascii + plugin csv');
    assert.ok(withBi.some((f) => f.formatId === 'ascii'));
    assert.ok(withBi.some((f) => f.formatId === 'csv'));
  });

  // Spec § A.7 — granularity. The runtime composer is the layer where
  // per-extension toggles for granularity=extension bundles take effect
  // (the loader's pre-import resolveEnabled is coarse / bundle-level).
  // Four cases cover the model:
  //   (a) disable the whole `claude` bundle → none of its 4 extensions reach scan.
  //   (b) disable `core/superseded` → only that rule disappears; the other
  //       core extensions stay live.
  //   (c) default — every built-in runs.
  //   (d) `--no-built-ins` overrides everything.
  describe('granularity — built-in toggle filter', () => {
    it('(a) disable claude → all 4 claude extensions skip compose', () => {
      const bundle = emptyPluginRuntime();
      bundle.resolveEnabled = (id: string) => id !== 'claude';
      const composed = composeScanExtensions({ noBuiltIns: false, pluginRuntime: bundle });
      assert.ok(composed, 'core extensions still keep the pipeline non-empty');
      // claude provider is the only provider built-in; disabling claude
      // empties the provider bucket entirely.
      assert.equal(composed.providers.length, 0, 'no provider survives — claude is the only built-in provider');
      // claude extractors (frontmatter, slash, at-directive) gone; the
      // core external-url-counter extractor remains.
      const extractorIds = composed.extractors.map((d) => d.id).sort();
      assert.deepEqual(extractorIds, ['external-url-counter']);
      // core/* rules unaffected.
      assert.ok(composed.rules.length >= 5, 'every core rule should survive');
    });

    it('(b) disable core/superseded → only that rule skips; other 6 core extensions stay', () => {
      const bundle = emptyPluginRuntime();
      bundle.resolveEnabled = (id: string) => id !== 'core/superseded';
      const composed = composeScanExtensions({ noBuiltIns: false, pluginRuntime: bundle });
      assert.ok(composed);
      const ruleIds = composed.rules.map((r) => r.id).sort();
      // The 5 built-in rules are: trigger-collision, broken-ref,
      // superseded, link-conflict, validate-all. Disabling
      // `core/superseded` drops only one.
      assert.deepEqual(ruleIds, ['broken-ref', 'link-conflict', 'trigger-collision', 'validate-all']);
      // claude bundle untouched.
      assert.equal(composed.providers.length, 1);
      assert.equal(composed.extractors.length, 4, 'all 4 extractors stay');
      // Formatter composer also respects the filter.
      const formatters = composeFormatters({ pluginRuntime: bundle });
      assert.equal(formatters.length, 1, 'ascii formatter still on; superseded toggle is unrelated');
    });

    it('(c) default — every built-in runs', () => {
      const composed = composeScanExtensions({
        noBuiltIns: false,
        pluginRuntime: emptyPluginRuntime(),
      });
      assert.ok(composed);
      assert.equal(composed.providers.length, 1, 'claude provider loaded');
      assert.equal(composed.extractors.length, 4, 'all 4 extractors loaded');
      assert.equal(composed.rules.length, 5, 'all 5 rules loaded');
      const formatters = composeFormatters({ pluginRuntime: emptyPluginRuntime() });
      assert.equal(formatters.length, 1, 'ascii formatter loaded');
    });

    it('(d) --no-built-ins overrides per-extension config (everything off)', () => {
      const bundle = emptyPluginRuntime();
      // Every id enabled at the resolver level — the macro flag must
      // still win and produce an empty pipeline.
      bundle.resolveEnabled = () => true;
      const composed = composeScanExtensions({ noBuiltIns: true, pluginRuntime: bundle });
      assert.equal(composed, undefined, '--no-built-ins + empty plugin runtime → undefined (zero-extension)');
      const formatters = composeFormatters({ noBuiltIns: true, pluginRuntime: bundle });
      assert.equal(formatters.length, 0);
    });

    it('filterBuiltInManifests honours bundle vs extension granularity', () => {
      const all = listBuiltIns();
      // Disable claude (bundle granularity) AND core/superseded
      // (extension granularity); everything else stays.
      const survivors = filterBuiltInManifests(all, (id: string) => {
        if (id === 'claude') return false;
        if (id === 'core/superseded') return false;
        return true;
      });
      const surviveIds = survivors.map((m) => `${m.pluginId}/${m.id}`).sort();
      assert.equal(surviveIds.includes('claude/claude'), false);
      assert.equal(surviveIds.includes('claude/slash'), false);
      assert.equal(surviveIds.includes('core/superseded'), false);
      assert.ok(surviveIds.includes('core/broken-ref'));
      assert.ok(surviveIds.includes('core/external-url-counter'));
      assert.ok(surviveIds.includes('core/ascii'));
    });
  });

  it('failed plugins surface in warnings, not extensions', async () => {
    const dir = freshDir('mixed');
    // Bad plugin
    const bad = join(dir, 'broken');
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, 'plugin.json'), '{ malformed');
    // Good plugin alongside
    plantExtractor(dir, 'good');

    const bundle = await loadPluginRuntime({ scope: 'project', pluginDir: dir });
    assert.equal(bundle.discovered.length, 2);
    assert.equal(bundle.extensions.extractors.length, 1, 'only the good plugin loaded');
    assert.equal(bundle.warnings.length, 1, 'one warning for the broken plugin');
    assert.match(bundle.warnings[0]!, /broken: invalid-manifest/);
  });
});
