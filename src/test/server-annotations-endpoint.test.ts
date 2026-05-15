/**
 * Step 9.6.6 (BFF half) — `GET /api/annotations/registered` integration tests.
 *
 * Exercises the route against the real composition root. Per Step 9.6
 * review-queue R14, `loadPluginRuntime` now honours the BFF's
 * `runtimeContext` override, so a tempdir cwd carrying synthetic
 * plugins under `<tempdir>/.skill-map/plugins/<id>/` is enough to
 * drive the populated catalog through `createServer()` end-to-end —
 * no `createApp()` bypass needed.
 *
 * Surfaces:
 *
 *   1. Empty catalog — boot with `noPlugins: true`. Confirms the
 *      composition root threads a fresh kernel through `IAppDeps.kernel`
 *      and the route returns the canonical envelope shape with
 *      `items: []`.
 *
 *   2. Populated catalog — boot with `noPlugins: false` against a
 *      tempdir cwd whose `.skill-map/plugins/` carries two synthetic
 *      plugins (one `namespaced` contribution, one `root + exclusive`).
 *      `runtimeContext: { cwd: <tempdir>, ... }` steers plugin
 *      discovery into the fixture; the planted contributions surface
 *      in the catalog with their full shape.
 *
 *   3. Mutation guard — handler returns a fresh items array each call,
 *      so a downstream mutation cannot pollute subsequent requests.
 *      Exercised against the populated boot.
 *
 *   4. Envelope schema validation — empty + populated responses
 *      validate against `spec/schemas/api/rest-envelope.schema.json`'s
 *      `'annotations.registered'` variant (R7 closed at 9.6.7).
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {afterAll as after,beforeAll as before, describe, it } from 'bun:test';

import { Ajv2020 } from 'ajv/dist/2020.js';

import {
  createServer,
  type IServerOptions,
  type ServerHandle,
} from '../server/index.js';

interface IRegisteredAnnotationKeyWire {
  pluginId: string;
  key: string;
  location: 'namespaced' | 'root';
  ownership: 'exclusive' | 'shared';
  schema: Record<string, unknown>;
}

interface IAnnotationsEnvelope {
  schemaVersion: string;
  kind: string;
  items: IRegisteredAnnotationKeyWire[];
  counts: { total: number };
}

let tmp: string;
let dbPath: string;
/**
 * Tempdir whose `.skill-map/plugins/` carries the two synthetic
 * contribution-bearing plugins. Used as `runtimeContext.cwd` for
 * every populated-catalog boot. Kept separate from `tmp` so the
 * empty-catalog boot can point at a clean tempdir without the
 * planted fixtures.
 */
let populatedRoot: string;
/**
 * Empty homedir used alongside `populatedRoot`. The loader walks BOTH
 * `<cwd>/.skill-map/plugins/` AND `<homedir>/.skill-map/plugins/` when
 * scope is `'project'`; pointing `homedir` at a clean tempdir (instead
 * of reusing `populatedRoot`) avoids the user-scope branch
 * re-discovering the same plugin ids and emitting `id-collision`
 * warnings.
 */
let populatedHome: string;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'skill-map-annot-endpoint-'));
  dbPath = join(tmp, 'primed.db');

  // Plant two plugins under the populated tempdir. Each plugin's
  // single extractor advertises an `annotationContributions` map; the
  // loader (post-R14) walks `<populatedRoot>/.skill-map/plugins/`
  // because `runtimeContext.cwd` overrides the default `process.cwd()`
  // resolution.
  populatedRoot = mkdtempSync(join(tmpdir(), 'skill-map-annot-populated-'));
  populatedHome = mkdtempSync(join(tmpdir(), 'skill-map-annot-populated-home-'));
  const pluginsDir = join(populatedRoot, '.skill-map', 'plugins');
  mkdirSync(pluginsDir, { recursive: true });
  plantContributionPlugin(pluginsDir, 'reviewer', {
    lastReviewedAt: { schema: { type: 'string' } },
  });
  plantContributionPlugin(pluginsDir, 'governance', {
    governance: {
      schema: { type: 'object' },
      location: 'root',
      ownership: 'exclusive',
    },
  });
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(populatedRoot, { recursive: true, force: true });
  rmSync(populatedHome, { recursive: true, force: true });
});

interface IContributionShape {
  schema: Record<string, unknown>;
  ownership?: 'exclusive' | 'shared';
  location?: 'namespaced' | 'root';
}

/**
 * Drop a single-extractor plugin into `<pluginsDir>/<id>/` whose only
 * contract beyond loading is its `annotationContributions` map. The
 * extractor itself is a no-op — it never has to extract anything for
 * this test, only register contributions during the loader's
 * per-extension validation pass.
 */
function plantContributionPlugin(
  pluginsDir: string,
  id: string,
  contributions: Record<string, IContributionShape>,
): void {
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
      annotationContributions: ${JSON.stringify(contributions)},
      extract() {},
    };`,
  );
}

function defaultOptions(overrides: Partial<IServerOptions> = {}): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    scope: 'project',
    dbPath,
    uiDist: null,
    noUi: false,
    noBuiltIns: false,
    noPlugins: true,
    open: false,
    devCors: false,
    noWatcher: true,
    ...overrides,
  };
}

async function bootEmpty<T>(
  fn: (handle: ServerHandle) => Promise<T>,
): Promise<T> {
  const handle = await createServer(defaultOptions(), {
    runtimeContext: { cwd: tmp, homedir: tmpdir() },
  });
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

async function bootPopulated<T>(
  fn: (handle: ServerHandle) => Promise<T>,
): Promise<T> {
  const handle = await createServer(
    defaultOptions({ noPlugins: false }),
    // R14 — `runtimeContext.cwd` is now honoured by `loadPluginRuntime`.
    // The loader walks `<populatedRoot>/.skill-map/plugins/` and
    // surfaces the two planted contributions through the catalog.
    // `homedir` points at a SEPARATE empty tempdir so the user-scope
    // branch (`<homedir>/.skill-map/plugins/`) stays empty — pointing
    // both at the same tempdir would re-discover the planted plugins
    // and emit `id-collision` warnings.
    { runtimeContext: { cwd: populatedRoot, homedir: populatedHome } },
  );
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

function url(handle: ServerHandle, path: string): string {
  return `http://127.0.0.1:${handle.address.port}${path}`;
}

describe('GET /api/annotations/registered', () => {
  it('200: empty catalog → items: [], counts.total: 0 (real createServer boot)', async () => {
    await bootEmpty(async (handle) => {
      const res = await fetch(url(handle, '/api/annotations/registered'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IAnnotationsEnvelope;
      assert.equal(env.schemaVersion, '1');
      assert.equal(env.kind, 'annotations.registered');
      assert.deepEqual(env.items, []);
      assert.equal(env.counts.total, 0);
    });
  });

  it('200: populated catalog → both contributions surface with full shape', async () => {
    await bootPopulated(async (handle) => {
      const res = await fetch(url(handle, '/api/annotations/registered'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IAnnotationsEnvelope;
      assert.equal(env.schemaVersion, '1');
      assert.equal(env.kind, 'annotations.registered');
      assert.equal(env.items.length, 2);
      assert.equal(env.counts.total, 2);

      // Every entry carries the full IRegisteredAnnotationKey shape.
      for (const item of env.items) {
        assert.equal(typeof item.pluginId, 'string');
        assert.notEqual(item.pluginId, '');
        assert.equal(typeof item.key, 'string');
        assert.notEqual(item.key, '');
        assert.ok(['namespaced', 'root'].includes(item.location));
        assert.ok(['exclusive', 'shared'].includes(item.ownership));
        assert.equal(typeof item.schema, 'object');
        assert.notEqual(item.schema, null);
      }

      // Spot-check the two specific contributions we planted.
      const byKey = new Map(env.items.map((i) => [i.key, i]));
      const reviewer = byKey.get('lastReviewedAt');
      assert.ok(reviewer, 'reviewer namespaced contribution present');
      assert.equal(reviewer.pluginId, 'reviewer');
      assert.equal(reviewer.location, 'namespaced');
      assert.equal(reviewer.ownership, 'shared');
      assert.deepEqual(reviewer.schema, { type: 'string' });

      const governance = byKey.get('governance');
      assert.ok(governance, 'governance root contribution present');
      assert.equal(governance.pluginId, 'governance');
      assert.equal(governance.location, 'root');
      assert.equal(governance.ownership, 'exclusive');
      assert.deepEqual(governance.schema, { type: 'object' });
    });
  });

  it('200 envelope validates against rest-envelope.schema.json (R7 closed) — empty + populated', async () => {
    // Cross-cutting check: both the empty and populated catalog responses
    // satisfy the canonical envelope schema's `'annotations.registered'`
    // variant (R7 closed at 9.6.7). Any drift in the route's wire shape
    // or in the schema's variant fails here.
    const validate = compileEnvelopeValidator();

    // Empty catalog via the real composition root.
    await bootEmpty(async (handle) => {
      const res = await fetch(url(handle, '/api/annotations/registered'));
      assert.equal(res.status, 200);
      const env = await res.json();
      const ok = validate(env);
      assert.equal(
        ok,
        true,
        `empty envelope must validate: ${JSON.stringify(validate.errors)}`,
      );
    });

    // Populated catalog also through the real boot (R14).
    await bootPopulated(async (handle) => {
      const res = await fetch(url(handle, '/api/annotations/registered'));
      assert.equal(res.status, 200);
      const env = await res.json();
      const ok = validate(env);
      assert.equal(
        ok,
        true,
        `populated envelope must validate: ${JSON.stringify(validate.errors)}`,
      );
    });
  });

  it('handler returns a fresh items array each call (no shared mutation)', async () => {
    await bootPopulated(async (handle) => {
      const first = (await (
        await fetch(url(handle, '/api/annotations/registered'))
      ).json()) as IAnnotationsEnvelope;
      assert.equal(first.items.length, 2);
      // Mutate the parsed response — the kernel's frozen view MUST be
      // immune to a downstream consumer pushing extra entries.
      first.items.push({
        pluginId: 'evil',
        key: 'injected',
        location: 'namespaced',
        ownership: 'shared',
        schema: {},
      });

      const second = (await (
        await fetch(url(handle, '/api/annotations/registered'))
      ).json()) as IAnnotationsEnvelope;
      assert.equal(second.items.length, 2, 'second call still sees the original 2 entries');
      assert.equal(second.counts.total, 2);
      const keys = second.items.map((i) => i.key).sort();
      assert.deepEqual(keys, ['governance', 'lastReviewedAt']);
    });
  });
});

/**
 * Resolve and AJV-compile `spec/schemas/api/rest-envelope.schema.json`.
 * Mirrors the require.resolve dance used by the unknown-field rule
 * (`built-in-plugins/rules/unknown-field/index.ts:getKnownAnnotationKeys`).
 */
function compileEnvelopeValidator(): ReturnType<Ajv2020['compile']> {
  const require = createRequire(import.meta.url);
  const indexPath = require.resolve('@skill-map/spec/index.json');
  const specRoot = dirname(indexPath);
  const schemaPath = resolve(specRoot, 'schemas/api/rest-envelope.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  return ajv.compile(schema);
}
