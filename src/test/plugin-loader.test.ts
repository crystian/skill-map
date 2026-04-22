/**
 * Step 1b acceptance test. Codifies the ROADMAP §Step 1b criterion:
 * dropping a bogus plugin (bad manifest, wrong specCompat, invalid
 * extension) produces a precise diagnostic under the declared failure
 * mode, and the kernel keeps booting regardless.
 *
 * Three failure-mode scenarios + a green-path scenario + a discovery
 * scenario cover the full loader contract.
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, match } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadSchemaValidators } from '../kernel/adapters/schema-validators.js';
import { PluginLoader, installedSpecVersion } from '../kernel/adapters/plugin-loader.js';

let tempRoot: string;

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'skill-map-plugins-'));
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function makePluginsDir(name: string): string {
  const dir = join(tempRoot, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writePlugin(
  rootDir: string,
  id: string,
  manifest: unknown,
  extensions: Record<string, string> = {},
): string {
  const pluginDir = join(rootDir, id);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(manifest));
  for (const [relPath, contents] of Object.entries(extensions)) {
    const target = join(pluginDir, relPath);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, contents);
  }
  return pluginDir;
}

function loaderFor(rootDir: string): PluginLoader {
  return new PluginLoader({
    searchPaths: [rootDir],
    validators: loadSchemaValidators(),
    specVersion: installedSpecVersion(),
  });
}

describe('PluginLoader', () => {
  it('discovers empty search paths without error', async () => {
    const empty = makePluginsDir('empty');
    const loader = loaderFor(empty);
    const plugins = await loader.discoverAndLoadAll();
    strictEqual(plugins.length, 0);
  });

  it('loads a green-path plugin with one detector extension', async () => {
    const root = makePluginsDir('green');
    const detectorSource = `
      export default {
        id: 'url-counter',
        kind: 'detector',
        version: '1.0.0',
        description: 'Counts external URLs',
        emitsLinkKinds: ['references'],
        defaultConfidence: 'high',
      };
    `;
    writePlugin(
      root,
      'ok-plugin',
      {
        id: 'ok-plugin',
        version: '0.1.0',
        specCompat: '>=0.0.0',
        extensions: ['detector.mjs'],
      },
      { 'detector.mjs': detectorSource },
    );

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result.length, 1);
    const only = result[0]!;
    strictEqual(only.status, 'loaded');
    strictEqual(only.id, 'ok-plugin');
    strictEqual(only.extensions?.length, 1);
    strictEqual(only.extensions?.[0]?.kind, 'detector');
    strictEqual(only.extensions?.[0]?.id, 'url-counter');
  });

  it('invalid-manifest: missing required fields', async () => {
    const root = makePluginsDir('invalid-manifest-missing');
    writePlugin(root, 'bad-shape', { id: 'bad-shape' });

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result.length, 1);
    strictEqual(result[0]?.status, 'invalid-manifest');
    ok(result[0]?.reason, 'reason populated');
    match(result[0]!.reason!, /version|specCompat|extensions/);
  });

  it('invalid-manifest: malformed JSON', async () => {
    const root = makePluginsDir('invalid-manifest-json');
    const pluginDir = join(root, 'bad-json');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), '{ this is not json }');

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result[0]?.status, 'invalid-manifest');
  });

  it('incompatible-spec: semver does not satisfy installed spec version', async () => {
    const root = makePluginsDir('incompatible');
    writePlugin(root, 'too-new', {
      id: 'too-new',
      version: '1.0.0',
      specCompat: '>=999.0.0',
      extensions: ['x.mjs'],
    });

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result[0]?.status, 'incompatible-spec');
    ok(result[0]?.manifest, 'manifest preserved for diagnostic');
    match(result[0]!.reason!, /@skill-map\/spec/);
  });

  it('load-error: extension file missing', async () => {
    const root = makePluginsDir('load-missing');
    writePlugin(root, 'mia', {
      id: 'mia',
      version: '1.0.0',
      specCompat: '>=0.0.0',
      extensions: ['nope.mjs'],
    });

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result[0]?.status, 'load-error');
    match(result[0]!.reason!, /not found/);
  });

  it('load-error: extension default export fails kind schema', async () => {
    const root = makePluginsDir('load-schema');
    const badDetector = `
      export default {
        id: 'bad',
        kind: 'detector',
        version: '1.0.0',
        // Missing required emitsLinkKinds and defaultConfidence.
      };
    `;
    writePlugin(
      root,
      'bad-detector',
      {
        id: 'bad-detector',
        version: '1.0.0',
        specCompat: '>=0.0.0',
        extensions: ['bad.mjs'],
      },
      { 'bad.mjs': badDetector },
    );

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result[0]?.status, 'load-error');
    match(result[0]!.reason!, /emitsLinkKinds|defaultConfidence|required/);
  });

  it('continues booting when a later plugin is bad', async () => {
    const root = makePluginsDir('mixed');
    writePlugin(
      root,
      'good',
      {
        id: 'good',
        version: '0.1.0',
        specCompat: '>=0.0.0',
        extensions: ['d.mjs'],
      },
      {
        'd.mjs': `export default { id: 'd', kind: 'detector', version: '1.0.0', emitsLinkKinds: ['references'], defaultConfidence: 'high' };`,
      },
    );
    writePlugin(root, 'broken', { id: 'broken' });

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result.length, 2);
    const statuses = result.map((p) => p.status).sort();
    // 'invalid-manifest' sorts before 'loaded' alphabetically.
    strictEqual(statuses[0], 'invalid-manifest');
    strictEqual(statuses[1], 'loaded');
  });
});
