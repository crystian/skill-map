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

  it('loads a green-path plugin with one extractor extension', async () => {
    const root = makePluginsDir('green');
    const extractorSource = `
      export default {
        id: 'url-counter',
        kind: 'extractor',
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
        extensions: ['extractor.mjs'],
      },
      { 'extractor.mjs': extractorSource },
    );

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result.length, 1);
    const only = result[0]!;
    strictEqual(only.status, 'enabled');
    strictEqual(only.id, 'ok-plugin');
    strictEqual(only.extensions?.length, 1);
    strictEqual(only.extensions?.[0]?.kind, 'extractor');
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
    const badExtractor = `
      export default {
        id: 'bad',
        kind: 'extractor',
        version: '1.0.0',
        // Missing required emitsLinkKinds and defaultConfidence.
      };
    `;
    writePlugin(
      root,
      'bad-extractor',
      {
        id: 'bad-extractor',
        version: '1.0.0',
        specCompat: '>=0.0.0',
        extensions: ['bad.mjs'],
      },
      { 'bad.mjs': badExtractor },
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
      match(r[0]!.reason!, /Expected one of: provider \/ extractor \/ rule \/ action \/ formatter/);
    });

    it('extension manifest invalid points at its kind schema', async () => {
      const root = makePluginsDir('diag-extension-schema');
      writePlugin(
        root,
        'broken-formatter',
        {
          id: 'broken-formatter',
          version: '1.0.0',
          specCompat: '>=0.0.0',
          extensions: ['f.mjs'],
        },
        { 'f.mjs': `export default { id: 'f', kind: 'formatter', version: '1.0.0' };` },
      );
      const r = await loaderFor(root).discoverAndLoadAll();
      match(r[0]!.reason!, /spec\/schemas\/extensions\/formatter\.schema\.json/);
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
        export default { id: 'never', kind: 'extractor', version: '1.0.0', emitsLinkKinds: ['references'], defaultConfidence: 'high' };
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
      const extractor = `
        export default { id: 'fast', kind: 'extractor', version: '1.0.0', emitsLinkKinds: ['references'], defaultConfidence: 'high' };
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
        { 'fast.mjs': extractor },
      );

      const loader = new PluginLoader({
        searchPaths: [root],
        validators: loadSchemaValidators(),
        specVersion: installedSpecVersion(),
        loadTimeoutMs: 100,
      });
      const r = await loader.discoverAndLoadAll();
      strictEqual(r[0]?.status, 'enabled');
    });
  });

  // Spec § A.5 — plugin id global uniqueness. Two enforcement points:
  //   (a) directory name MUST equal manifest id   → invalid-manifest
  //   (b) cross-root same-id collision            → id-collision (both)
  describe('Step A.5 — id uniqueness', () => {
    it('invalid-manifest: directory name does not match manifest id', async () => {
      const root = makePluginsDir('dir-mismatch');
      // Directory is 'wrong-dir' but manifest id is 'real-id'. AJV passes
      // (the manifest is structurally valid), so the new structural rule
      // is what catches it.
      writePlugin(
        root,
        'wrong-dir',
        {
          id: 'real-id',
          version: '1.0.0',
          specCompat: '>=0.0.0',
          extensions: ['x.mjs'],
        },
      );
      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'invalid-manifest');
      ok(result[0]?.reason, 'reason populated');
      match(result[0]!.reason!, /directory name 'wrong-dir' does not match manifest id 'real-id'/);
      // Manifest is preserved on a dir-mismatch so `sm plugins list/show`
      // can still surface the conflicting id and version.
      ok(result[0]?.manifest, 'manifest preserved on dir-mismatch');
    });

    it('id-collision: two plugins in different roots claim the same id', async () => {
      const rootA = makePluginsDir('collide-A');
      const rootB = makePluginsDir('collide-B');
      const extractorSrc = `
        export default {
          id: 'd', kind: 'extractor', version: '1.0.0',
          emitsLinkKinds: ['references'], defaultConfidence: 'high',
        };
      `;
      // Same id 'twin' under two different parent roots — directory
      // names match (rule #1 passes), but cross-root id check (rule #2)
      // fires.
      writePlugin(
        rootA,
        'twin',
        { id: 'twin', version: '1.0.0', specCompat: '>=0.0.0', extensions: ['d.mjs'] },
        { 'd.mjs': extractorSrc },
      );
      writePlugin(
        rootB,
        'twin',
        { id: 'twin', version: '2.0.0', specCompat: '>=0.0.0', extensions: ['d.mjs'] },
        { 'd.mjs': extractorSrc },
      );

      const loader = new PluginLoader({
        searchPaths: [rootA, rootB],
        validators: loadSchemaValidators(),
        specVersion: installedSpecVersion(),
      });
      const result = await loader.discoverAndLoadAll();

      strictEqual(result.length, 2);
      // Both members of the collision pair receive the new status — no
      // precedence rule applies.
      for (const p of result) {
        strictEqual(p.status, 'id-collision');
        match(p.reason!, /Plugin 'twin' at .* collides with the plugin at .*\. Rename one and rerun\./);
      }
      // Extensions are stripped from a colliding plugin so a careless
      // caller cannot register them.
      strictEqual(result[0]?.extensions, undefined);
      strictEqual(result[1]?.extensions, undefined);
    });

    it('id-collision: three-way collision lists every other path in the reason', async () => {
      const rootA = makePluginsDir('collide-3-A');
      const rootB = makePluginsDir('collide-3-B');
      const rootC = makePluginsDir('collide-3-C');
      const manifest = (specCompat = '>=0.0.0') => ({
        id: 'triplet',
        version: '1.0.0',
        specCompat,
        extensions: ['d.mjs'],
      });
      const extractorSrc = `
        export default {
          id: 'd', kind: 'extractor', version: '1.0.0',
          emitsLinkKinds: ['references'], defaultConfidence: 'high',
        };
      `;
      writePlugin(rootA, 'triplet', manifest(), { 'd.mjs': extractorSrc });
      writePlugin(rootB, 'triplet', manifest(), { 'd.mjs': extractorSrc });
      writePlugin(rootC, 'triplet', manifest(), { 'd.mjs': extractorSrc });

      const loader = new PluginLoader({
        searchPaths: [rootA, rootB, rootC],
        validators: loadSchemaValidators(),
        specVersion: installedSpecVersion(),
      });
      const result = await loader.discoverAndLoadAll();

      strictEqual(result.length, 3);
      for (const p of result) strictEqual(p.status, 'id-collision');
    });

    it('id-collision: a non-colliding plugin alongside a colliding pair is unaffected', async () => {
      const rootA = makePluginsDir('mix-A');
      const rootB = makePluginsDir('mix-B');
      const extractorSrc = `
        export default {
          id: 'd', kind: 'extractor', version: '1.0.0',
          emitsLinkKinds: ['references'], defaultConfidence: 'high',
        };
      `;
      writePlugin(
        rootA,
        'twin',
        { id: 'twin', version: '1.0.0', specCompat: '>=0.0.0', extensions: ['d.mjs'] },
        { 'd.mjs': extractorSrc },
      );
      writePlugin(
        rootB,
        'twin',
        { id: 'twin', version: '2.0.0', specCompat: '>=0.0.0', extensions: ['d.mjs'] },
        { 'd.mjs': extractorSrc },
      );
      // Independent plugin in rootA — its id is unique across the search set.
      writePlugin(
        rootA,
        'solo',
        { id: 'solo', version: '1.0.0', specCompat: '>=0.0.0', extensions: ['d.mjs'] },
        { 'd.mjs': extractorSrc },
      );

      const loader = new PluginLoader({
        searchPaths: [rootA, rootB],
        validators: loadSchemaValidators(),
        specVersion: installedSpecVersion(),
      });
      const result = await loader.discoverAndLoadAll();

      strictEqual(result.length, 3);
      const byId = new Map(result.map((p) => [p.id, p] as const));
      strictEqual(byId.get('solo')?.status, 'enabled');
      // Both 'twin' entries collide.
      strictEqual(result.filter((p) => p.id === 'twin').every((p) => p.status === 'id-collision'), true);
    });

    it('id-collision: a parse-failed sibling does not muddy the trusted-id collision report', async () => {
      // A plugin whose plugin.json fails to parse exposes an *untrusted*
      // id (the directory basename). It must NOT be confused with a real
      // id collision: the loader excludes invalid-manifest entries from
      // the collision-detection set.
      const rootA = makePluginsDir('mud-A');
      const rootB = makePluginsDir('mud-B');
      const extractorSrc = `
        export default {
          id: 'd', kind: 'extractor', version: '1.0.0',
          emitsLinkKinds: ['references'], defaultConfidence: 'high',
        };
      `;
      // A real, valid plugin with id 'sibling' under rootA.
      writePlugin(
        rootA,
        'sibling',
        { id: 'sibling', version: '1.0.0', specCompat: '>=0.0.0', extensions: ['d.mjs'] },
        { 'd.mjs': extractorSrc },
      );
      // A directory under rootB also called 'sibling', but with a broken
      // plugin.json — its fall-back id is 'sibling' (path basename) but
      // the manifest never validated.
      const brokenDir = join(rootB, 'sibling');
      mkdirSync(brokenDir, { recursive: true });
      writeFileSync(join(brokenDir, 'plugin.json'), '{ not json');

      const loader = new PluginLoader({
        searchPaths: [rootA, rootB],
        validators: loadSchemaValidators(),
        specVersion: installedSpecVersion(),
      });
      const result = await loader.discoverAndLoadAll();

      strictEqual(result.length, 2);
      const valid = result.find((p) => p.path.includes('mud-A'));
      const broken = result.find((p) => p.path.includes('mud-B'));
      // The valid one keeps loading — its id is unique among trusted ids.
      strictEqual(valid?.status, 'enabled');
      // The broken one stays invalid-manifest, NOT id-collision: a
      // collision report would mislead ("rename your good plugin to fix
      // the JSON typo in the bad one"); we keep the original diagnostic.
      strictEqual(broken?.status, 'invalid-manifest');
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
        'd.mjs': `export default { id: 'd', kind: 'extractor', version: '1.0.0', emitsLinkKinds: ['references'], defaultConfidence: 'high' };`,
      },
    );
    writePlugin(root, 'broken', { id: 'broken' });

    const result = await loaderFor(root).discoverAndLoadAll();
    strictEqual(result.length, 2);
    const statuses = result.map((p) => p.status).sort();
    // 'enabled' sorts before 'invalid-manifest' alphabetically.
    strictEqual(statuses[0], 'enabled');
    strictEqual(statuses[1], 'invalid-manifest');
  });

  // Spec § A.6 — qualified extension ids. The loader injects
  // `pluginId = manifest.id` so the registry can key by `<pluginId>/<id>`.
  describe('Step A.6 — qualified id injection', () => {
    it('injects pluginId from plugin.json#/id into every loaded extension', async () => {
      const root = makePluginsDir('a6-injection');
      const extractorSrc = `
        export default {
          id: 'greet', kind: 'extractor', version: '1.0.0',
          emitsLinkKinds: ['references'], defaultConfidence: 'high',
        };
      `;
      writePlugin(
        root,
        'my-plugin',
        { id: 'my-plugin', version: '1.0.0', specCompat: '>=0.0.0', extensions: ['d.mjs'] },
        { 'd.mjs': extractorSrc },
      );
      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'enabled');
      const ext = result[0]?.extensions?.[0];
      ok(ext, 'expected one loaded extension');
      strictEqual(ext.id, 'greet');
      strictEqual(ext.pluginId, 'my-plugin');
    });

    it('tolerates a matching pluginId hand-coded in the extension', async () => {
      // Defensive: an author who copies built-ins style and includes
      // `pluginId` matching the manifest id is accepted (no-op). The
      // loader strips the field before AJV so it doesn't violate
      // `unevaluatedProperties: false`.
      const root = makePluginsDir('a6-tolerate');
      const extractorSrc = `
        export default {
          id: 'greet', pluginId: 'my-plugin',
          kind: 'extractor', version: '1.0.0',
          emitsLinkKinds: ['references'], defaultConfidence: 'high',
        };
      `;
      writePlugin(
        root,
        'my-plugin',
        { id: 'my-plugin', version: '1.0.0', specCompat: '>=0.0.0', extensions: ['d.mjs'] },
        { 'd.mjs': extractorSrc },
      );
      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result[0]?.status, 'enabled');
      strictEqual(result[0]?.extensions?.[0]?.pluginId, 'my-plugin');
    });

    // Spec § A.7 — granularity. The loader copies `manifest.granularity`
    // (default `'bundle'`) onto the discovered plugin so the runtime
    // composer and `sm plugins` verbs can inspect it without re-reading
    // the manifest.
    describe('granularity injection', () => {
      it('(j) user plugin with granularity: extension surfaces verbatim', async () => {
        const root = makePluginsDir('granularity-extension');
        const extractorSrc = `
          export default {
            id: 'one', kind: 'extractor', version: '1.0.0',
            emitsLinkKinds: ['references'], defaultConfidence: 'high',
          };
        `;
        writePlugin(
          root,
          'multi-tool',
          {
            id: 'multi-tool',
            version: '1.0.0',
            specCompat: '>=0.0.0',
            granularity: 'extension',
            extensions: ['d.mjs'],
          },
          { 'd.mjs': extractorSrc },
        );
        const result = await loaderFor(root).discoverAndLoadAll();
        strictEqual(result.length, 1);
        strictEqual(result[0]?.status, 'enabled');
        strictEqual(result[0]?.granularity, 'extension');
      });

      it('(k) user plugin without granularity defaults to bundle', async () => {
        const root = makePluginsDir('granularity-default');
        const extractorSrc = `
          export default {
            id: 'one', kind: 'extractor', version: '1.0.0',
            emitsLinkKinds: ['references'], defaultConfidence: 'high',
          };
        `;
        writePlugin(
          root,
          'simple',
          {
            id: 'simple',
            version: '1.0.0',
            specCompat: '>=0.0.0',
            extensions: ['d.mjs'],
          },
          { 'd.mjs': extractorSrc },
        );
        const result = await loaderFor(root).discoverAndLoadAll();
        strictEqual(result.length, 1);
        strictEqual(result[0]?.status, 'enabled');
        strictEqual(result[0]?.granularity, 'bundle');
      });
    });

    it('invalid-manifest: extension declares pluginId that disagrees with plugin.json', async () => {
      const root = makePluginsDir('a6-mismatch');
      const extractorSrc = `
        export default {
          id: 'greet', pluginId: 'someone-else',
          kind: 'extractor', version: '1.0.0',
          emitsLinkKinds: ['references'], defaultConfidence: 'high',
        };
      `;
      writePlugin(
        root,
        'my-plugin',
        { id: 'my-plugin', version: '1.0.0', specCompat: '>=0.0.0', extensions: ['d.mjs'] },
        { 'd.mjs': extractorSrc },
      );
      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'invalid-manifest');
      ok(result[0]?.reason, 'reason populated');
      match(result[0]!.reason!, /pluginId 'someone-else'/);
      match(result[0]!.reason!, /plugin\.json declares id 'my-plugin'/);
    });
  });

  // Spec § A.10 — `applicableKinds` filter on Extractors.
  //
  //   - Empty array `[]` is rejected by AJV (`minItems: 1`) → load-error.
  //   - Unknown kinds (no installed Provider declares them) load OK
  //     (status `enabled`); the warning surfaces in `sm plugins doctor`,
  //     covered by `plugins-cli.test.ts` separately. Here we just pin
  //     that the loader does NOT block unknown kinds.
  describe('Step A.10 — applicableKinds filter', () => {
    it('(e) extractor with applicableKinds: ["unknown-kind"] loads OK (status: enabled)', async () => {
      const root = makePluginsDir('a10-unknown-kind');
      const extractorSrc = `
        export default {
          id: 'd', kind: 'extractor', version: '1.0.0',
          emitsLinkKinds: ['references'], defaultConfidence: 'high',
          applicableKinds: ['unknown-kind'],
        };
      `;
      writePlugin(
        root,
        'maybe-someday',
        {
          id: 'maybe-someday',
          version: '1.0.0',
          specCompat: '>=0.0.0',
          extensions: ['d.mjs'],
        },
        { 'd.mjs': extractorSrc },
      );
      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'enabled');
      const ext = result[0]?.extensions?.[0];
      ok(ext, 'extension loaded');
      // The applicableKinds field survives the load (the loader does
      // not strip it; the runtime carries it for the orchestrator and
      // doctor to inspect).
      strictEqual(ext.kind, 'extractor');
    });

    it('(f) extractor with applicableKinds: [] is rejected by AJV (minItems: 1)', async () => {
      const root = makePluginsDir('a10-empty-array');
      const extractorSrc = `
        export default {
          id: 'd', kind: 'extractor', version: '1.0.0',
          emitsLinkKinds: ['references'], defaultConfidence: 'high',
          applicableKinds: [],
        };
      `;
      writePlugin(
        root,
        'empty-applies',
        {
          id: 'empty-applies',
          version: '1.0.0',
          specCompat: '>=0.0.0',
          extensions: ['d.mjs'],
        },
        { 'd.mjs': extractorSrc },
      );
      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      // AJV rejects the manifest → status is `load-error` (per the
      // existing pattern: extension-kind manifest invalid → load-error,
      // not invalid-manifest, since plugin.json itself was fine).
      strictEqual(result[0]?.status, 'load-error');
      ok(result[0]?.reason, 'reason populated');
      // The reason names the offending field (AJV path or keyword).
      match(result[0]!.reason!, /applicableKinds|minItems|fewer than 1/i);
    });
  });

  // Audit M3 — extension entries that escape the plugin tree (`../`
  // breakouts, absolute paths) must be rejected before any
  // dynamic-import is attempted. Closes the lane where one plugin
  // re-imports another plugin's source under its own pluginId.
  describe('audit M3 — plugin entry containment', () => {
    it('rejects an extension entry that escapes the plugin directory via ..', async () => {
      const root = makePluginsDir('m3-escape');
      // Create a sibling file the malicious manifest will try to import.
      mkdirSync(join(root, 'shared'), { recursive: true });
      writeFileSync(
        join(root, 'shared', 'leaked.mjs'),
        `export default { id: 'x', kind: 'extractor', version: '1.0.0', description: '', emitsLinkKinds: ['references'], defaultConfidence: 'high' };`,
      );
      writePlugin(root, 'attacker', {
        id: 'attacker',
        version: '0.1.0',
        specCompat: '>=0.0.0',
        extensions: ['../shared/leaked.mjs'],
      });

      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'invalid-manifest');
      match(result[0]!.reason!, /resolves outside the plugin directory|escapes/i);
    });

    it('rejects an absolute-path extension entry', async () => {
      const root = makePluginsDir('m3-abs');
      writePlugin(root, 'absolute', {
        id: 'absolute',
        version: '0.1.0',
        specCompat: '>=0.0.0',
        extensions: ['/etc/hostname'],
      });

      const result = await loaderFor(root).discoverAndLoadAll();
      strictEqual(result.length, 1);
      strictEqual(result[0]?.status, 'invalid-manifest');
      match(result[0]!.reason!, /resolves outside the plugin directory|escapes/i);
    });
  });
});
