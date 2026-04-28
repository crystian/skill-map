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
 *   - `composeRenderers({ noBuiltIns: true })` returns plugin
 *     renderers only (no built-ins)
 */

import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  composeRenderers,
  composeScanExtensions,
  emptyPluginRuntime,
  loadPluginRuntime,
} from '../cli/util/plugin-runtime.js';

let root: string;
let counter = 0;

function freshDir(label: string): string {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function plantDetector(pluginsDir: string, id: string): void {
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
      kind: 'detector',
      version: '1.0.0',
      emitsLinkKinds: ['references'],
      defaultConfidence: 'high',
      scope: 'body',
      detect() { return []; },
    };`,
  );
}

function plantRenderer(pluginsDir: string, id: string, format: string): void {
  const dir = join(pluginsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({
      id,
      version: '1.0.0',
      specCompat: '>=0.0.0',
      extensions: ['./r.mjs'],
    }),
  );
  writeFileSync(
    join(dir, 'r.mjs'),
    `export default {
      id: '${id}-r',
      kind: 'renderer',
      version: '1.0.0',
      format: '${format}',
      render() { return ''; },
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
    plantDetector(customDir, 'custom-only');

    const bundle = await loadPluginRuntime({ scope: 'project', pluginDir: customDir });
    assert.equal(bundle.discovered.length, 1);
    assert.equal(bundle.discovered[0]!.id, 'custom-only');
    assert.equal(bundle.extensions.detectors.length, 1);
    assert.equal(bundle.extensions.detectors[0]!.id, 'custom-only-d');
  });

  it('scope=global reads only the user-level plugins folder', async () => {
    const globalRoot = freshDir('global-home');
    const globalPlugins = join(globalRoot, '.skill-map', 'plugins');
    mkdirSync(globalPlugins, { recursive: true });
    plantDetector(globalPlugins, 'global-plugin');

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
      adapters: [],
      detectors: [],
      rules: [],
      renderers: [],
      audits: [],
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
    assert.ok(composed.adapters.length >= 1, 'expected at least the claude adapter');
    assert.ok(composed.detectors.length >= 1, 'expected at least one built-in detector');
    assert.ok(composed.rules.length >= 1, 'expected at least one built-in rule');
  });

  it('composeRenderers({ noBuiltIns: true }) excludes built-in renderers', async () => {
    const customDir = freshDir('renderer-only');
    plantRenderer(customDir, 'custom-renderer', 'csv');
    const bundle = await loadPluginRuntime({ scope: 'project', pluginDir: customDir });

    const noBi = composeRenderers({ noBuiltIns: true, pluginRuntime: bundle });
    assert.equal(noBi.length, 1);
    assert.equal(noBi[0]!.format, 'csv');

    const withBi = composeRenderers({ pluginRuntime: bundle });
    assert.ok(withBi.length >= 2, 'expected built-in ascii + plugin csv');
    assert.ok(withBi.some((r) => r.format === 'ascii'));
    assert.ok(withBi.some((r) => r.format === 'csv'));
  });

  it('failed plugins surface in warnings, not extensions', async () => {
    const dir = freshDir('mixed');
    // Bad plugin
    const bad = join(dir, 'broken');
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, 'plugin.json'), '{ malformed');
    // Good plugin alongside
    plantDetector(dir, 'good');

    const bundle = await loadPluginRuntime({ scope: 'project', pluginDir: dir });
    assert.equal(bundle.discovered.length, 2);
    assert.equal(bundle.extensions.detectors.length, 1, 'only the good plugin loaded');
    assert.equal(bundle.warnings.length, 1, 'one warning for the broken plugin');
    assert.match(bundle.warnings[0]!, /broken: invalid-manifest/);
  });
});
