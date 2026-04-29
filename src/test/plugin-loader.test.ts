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

  // Step 9.4 — polished diagnostics: every reason string carries an
  // actionable hint pointing the user at the file, the schema, or a
  // remediation. The full text is fragile and we don't pin it; we
  // assert each hint shape is *present*.
  describe('Step 9.4 diagnostics polish', () => {
    it('invalid-manifest reason names the manifest path', async () => {
      const root = makePluginsDir('diag-path');
      const pluginDir = join(root, 'p');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, 'plugin.json'), '{ not json');
      const r = await loaderFor(root).discoverAndLoadAll();
      ok(r[0]!.reason!.includes('plugin.json'), `expected manifest path; got: ${r[0]!.reason}`);
      match(r[0]!.reason!, /Validate the JSON/);
    });

    it('invalid-manifest (AJV) hints at the spec schema', async () => {
      const root = makePluginsDir('diag-schema');
      writePlugin(root, 'bad', { id: 'bad' });
      const r = await loaderFor(root).discoverAndLoadAll();
      match(r[0]!.reason!, /plugins-registry\.schema\.json/);
    });

    it('incompatible-spec suggests a remediation', async () => {
      const root = makePluginsDir('diag-spec');
      writePlugin(root, 'old', {
        id: 'old',
        version: '1.0.0',
        specCompat: '>=999.0.0',
        extensions: ['x.mjs'],
      });
      const r = await loaderFor(root).discoverAndLoadAll();
      match(r[0]!.reason!, /update the plugin's specCompat|pin sm to a compatible/);
    });

    it('extension file not found resolves the absolute path', async () => {
      const root = makePluginsDir('diag-missing');
      writePlugin(root, 'mia', {
        id: 'mia',
        version: '1.0.0',
        specCompat: '>=0.0.0',
        extensions: ['./does/not/exist.mjs'],
      });
      const r = await loaderFor(root).discoverAndLoadAll();
      match(r[0]!.reason!, /resolved to .*does\/not\/exist\.mjs/);
    });

    it('unknown kind lists the valid options', async () => {
      const root = makePluginsDir('diag-kind');
      writePlugin(
        root,
        'wrong-kind',
        {
          id: 'wrong-kind',
          version: '1.0.0',
          specCompat: '>=0.0.0',
          extensions: ['x.mjs'],
        },
        { 'x.mjs': `export default { id: 'x', kind: 'wat', version: '1.0.0' };` },
      );
      const r = await loaderFor(root).discoverAndLoadAll();
      match(r[0]!.reason!, /Expected one of: adapter \/ detector \/ rule \/ action \/ audit \/ renderer/);
    });

    it('extension manifest invalid points at its kind schema', async () => {
      const root = makePluginsDir('diag-extension-schema');
      writePlugin(
        root,
        'broken-renderer',
        {
          id: 'broken-renderer',
          version: '1.0.0',
          specCompat: '>=0.0.0',
          extensions: ['r.mjs'],
        },
        { 'r.mjs': `export default { id: 'r', kind: 'renderer', version: '1.0.0' };` },
      );
      const r = await loaderFor(root).discoverAndLoadAll();
      match(r[0]!.reason!, /spec\/schemas\/extensions\/renderer\.schema\.json/);
    });
  });

  // H2 — Plugin loader timeout. A plugin whose top-level work hangs
  // (a never-resolving `await`, an infinite loop, a hanging network
  // call) used to block every host CLI command indefinitely. The
  // loader now races every dynamic import against a configurable
  // timer and surfaces the timeout as a `load-error` row.
  describe('Step H2 — load timeout', () => {
    it('load-error: extension import that never resolves trips the timeout', async () => {
      const root = makePluginsDir('timeout-hang');
      // Top-level `await` on a never-resolving promise. The dynamic
      // import will sit forever waiting for module evaluation; the
      // race with the loader's timer should win.
      const hangSource = `
        await new Promise(() => {});
        export default { id: 'never', kind: 'detector', version: '1.0.0', emitsLinkKinds: ['references'], defaultConfidence: 'high' };
      `;
      writePlugin(
        root,
        'hangs',
        {
          id: 'hangs',
          version: '1.0.0',
          specCompat: '>=0.0.0',
          extensions: ['hang.mjs'],
        },
        { 'hang.mjs': hangSource },
      );

      const loader = new PluginLoader({
        searchPaths: [root],
        validators: loadSchemaValidators(),
        specVersion: installedSpecVersion(),
        loadTimeoutMs: 75,
      });
      const start = Date.now();
      const r = await loader.discoverAndLoadAll();
      const elapsed = Date.now() - start;

      strictEqual(r.length, 1);
      strictEqual(r[0]?.status, 'load-error');
      match(r[0]!.reason!, /exceeded\s+75ms/);
      match(r[0]!.reason!, /top-level side effect/);
      ok(elapsed < 1000, `loader returned in ${elapsed}ms; should be ≪ default 5000ms`);
    });

    it('non-hanging plugin still loads fine with a tight timeout', async () => {
      const root = makePluginsDir('timeout-fast');
      const detector = `
        export default { id: 'fast', kind: 'detector', version: '1.0.0', emitsLinkKinds: ['references'], defaultConfidence: 'high' };
      `;
      writePlugin(
        root,
        'quick',
        {
          id: 'quick',
          version: '1.0.0',
          specCompat: '>=0.0.0',
          extensions: ['fast.mjs'],
        },
        { 'fast.mjs': detector },
      );

      const loader = new PluginLoader({
        searchPaths: [root],
        validators: loadSchemaValidators(),
        specVersion: installedSpecVersion(),
        loadTimeoutMs: 100,
      });
      const r = await loader.discoverAndLoadAll();
      strictEqual(r[0]?.status, 'loaded');
    });
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
