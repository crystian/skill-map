/**
 * Step 6.6 — `config_plugins` storage + resolver + PluginLoader
 * `disabled` status. Three layers:
 *
 *   1. Direct storage helper round-trips (set/get/list/delete).
 *   2. resolvePluginEnabled precedence (DB > settings.json > default).
 *   3. PluginLoader honours the resolver: returns status='disabled'
 *      with the manifest still attached, no extensions imported.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { PluginLoader, installedSpecVersion } from '../kernel/adapters/plugin-loader.js';
import { loadSchemaValidators } from '../kernel/adapters/schema-validators.js';
import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import {
  deletePluginOverride,
  getPluginEnabled,
  loadPluginOverrideMap,
  setPluginEnabled,
} from '../kernel/adapters/sqlite/plugins.js';
import {
  makeEnabledResolver,
  resolvePluginEnabled,
} from '../kernel/config/plugin-resolver.js';
import type { IEffectiveConfig } from '../kernel/config/loader.js';

let root: string;
let counter = 0;

function freshDb(label: string): string {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  return join(dir, 'skill-map.db');
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-plugin-overrides-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

// -----------------------------------------------------------------------------
// Storage helpers
// -----------------------------------------------------------------------------

describe('config_plugins storage helpers', () => {
  it('setPluginEnabled + getPluginEnabled round-trip', async () => {
    const dbPath = freshDb('round-trip');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await getPluginEnabled(adapter.db, 'foo'), undefined);
      await setPluginEnabled(adapter.db, 'foo', false);
      assert.equal(await getPluginEnabled(adapter.db, 'foo'), false);
      await setPluginEnabled(adapter.db, 'foo', true);
      assert.equal(await getPluginEnabled(adapter.db, 'foo'), true);
    } finally {
      await adapter.close();
    }
  });

  it('loadPluginOverrideMap returns every row', async () => {
    const dbPath = freshDb('list');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      await setPluginEnabled(adapter.db, 'a', true);
      await setPluginEnabled(adapter.db, 'b', false);
      await setPluginEnabled(adapter.db, 'c', false);
      const map = await loadPluginOverrideMap(adapter.db);
      assert.equal(map.size, 3);
      assert.equal(map.get('a'), true);
      assert.equal(map.get('b'), false);
      assert.equal(map.get('c'), false);
    } finally {
      await adapter.close();
    }
  });

  it('deletePluginOverride drops the row; idempotent on missing id', async () => {
    const dbPath = freshDb('delete');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      await setPluginEnabled(adapter.db, 'foo', false);
      assert.equal(await getPluginEnabled(adapter.db, 'foo'), false);
      await deletePluginOverride(adapter.db, 'foo');
      assert.equal(await getPluginEnabled(adapter.db, 'foo'), undefined);
      // Idempotent
      await deletePluginOverride(adapter.db, 'foo');
      await deletePluginOverride(adapter.db, 'never-existed');
    } finally {
      await adapter.close();
    }
  });
});

// -----------------------------------------------------------------------------
// Resolver precedence
// -----------------------------------------------------------------------------

function cfg(plugins: IEffectiveConfig['plugins']): Pick<IEffectiveConfig, 'plugins'> {
  return { plugins };
}

describe('resolvePluginEnabled — precedence', () => {
  it('default = true when neither layer mentions the id', () => {
    assert.equal(resolvePluginEnabled('foo', cfg({}), new Map()), true);
  });

  it('settings.json overrides the default', () => {
    assert.equal(
      resolvePluginEnabled('foo', cfg({ foo: { enabled: false } }), new Map()),
      false,
    );
  });

  it('DB override overrides settings.json', () => {
    const dbOverrides = new Map<string, boolean>([['foo', true]]);
    assert.equal(
      resolvePluginEnabled('foo', cfg({ foo: { enabled: false } }), dbOverrides),
      true,
    );
    const dbOff = new Map<string, boolean>([['foo', false]]);
    assert.equal(
      resolvePluginEnabled('foo', cfg({ foo: { enabled: true } }), dbOff),
      false,
    );
  });

  it('makeEnabledResolver curries cfg + dbOverrides into a (id) => boolean', () => {
    const resolver = makeEnabledResolver(
      cfg({ foo: { enabled: false } }),
      new Map<string, boolean>([['bar', true]]),
    );
    assert.equal(resolver('foo'), false);   // settings.json wins
    assert.equal(resolver('bar'), true);    // DB wins
    assert.equal(resolver('baz'), true);    // default
  });
});

// -----------------------------------------------------------------------------
// PluginLoader respects resolveEnabled
// -----------------------------------------------------------------------------

function writeMockPlugin(rootDir: string, id: string): string {
  const dir = join(rootDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({
      id,
      version: '0.1.0',
      specCompat: `^${installedSpecVersion()}`,
      extensions: ['extractor.js'],
    }),
  );
  // Extractor manifests are pure data (no runtime methods on the
  // exported object), so they pass AJV `unevaluatedProperties: false`
  // without needing the runtime extractor contract — perfect for
  // testing enable/disable flow.
  writeFileSync(
    join(dir, 'extractor.js'),
    `export default {
       kind: 'extractor',
       id: '${id}-extractor',
       version: '0.1.0',
       description: 'mock',
       stability: 'experimental',
       emitsLinkKinds: ['references'],
       defaultConfidence: 'high',
     };`,
  );
  return dir;
}

describe('PluginLoader — disabled status', () => {
  it('returns status=disabled when resolveEnabled returns false; manifest preserved, extensions empty', async () => {
    const dir = mkdtempSync(join(root, 'loader-disabled-'));
    writeMockPlugin(dir, 'opt-out');
    const loader = new PluginLoader({
      searchPaths: [dir],
      validators: loadSchemaValidators(),
      specVersion: installedSpecVersion(),
      resolveEnabled: (id) => id !== 'opt-out',
    });
    const plugins = await loader.discoverAndLoadAll();
    assert.equal(plugins.length, 1);
    const p = plugins[0]!;
    assert.equal(p.id, 'opt-out');
    assert.equal(p.status, 'disabled');
    assert.ok(p.manifest, 'manifest preserved');
    assert.equal(p.manifest?.id, 'opt-out');
    assert.equal(p.extensions, undefined);
    assert.match(p.reason ?? '', /disabled/);
  });

  it('omitting resolveEnabled treats every plugin as enabled (back-compat)', async () => {
    const dir = mkdtempSync(join(root, 'loader-default-'));
    writeMockPlugin(dir, 'default-on');
    const loader = new PluginLoader({
      searchPaths: [dir],
      validators: loadSchemaValidators(),
      specVersion: installedSpecVersion(),
    });
    const plugins = await loader.discoverAndLoadAll();
    assert.equal(plugins.length, 1);
    assert.equal(plugins[0]!.status, 'enabled');
  });
});
