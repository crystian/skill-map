/**
 * Step 6.6 — `sm plugins enable / disable` end-to-end through the real
 * binary. Each test isolates HOME and cwd so the host's `~/.skill-map/`
 * is never touched. A helper drops a mock plugin under the project
 * scope's plugin directory so the toggle verbs have something to act on.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import { getPluginEnabled } from '../kernel/adapters/sqlite/plugins.js';
import { installedSpecVersion } from '../kernel/adapters/plugin-loader.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', 'bin', 'sm.mjs');

let root: string;
let counter = 0;

interface IScope {
  cwd: string;
  home: string;
}

function freshScope(label: string): IScope {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  const cwd = join(dir, 'cwd');
  const home = join(dir, 'home');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { cwd, home };
}

function dropMockPlugin(scope: IScope, id: string): void {
  const pluginDir = join(scope.cwd, '.skill-map', 'plugins', id);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({
      id,
      version: '0.1.0',
      specCompat: `^${installedSpecVersion()}`,
      extensions: ['extractor.js'],
    }),
  );
  writeFileSync(
    join(pluginDir, 'extractor.js'),
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
}

interface IMockProviderOptions {
  /** Override the explorationDir on the manifest. Defaults to `'~/.mock'`. */
  explorationDir?: string;
  /** When true, the manifest omits explorationDir entirely (invalid-manifest). */
  omitExplorationDir?: boolean;
}

/**
 * Drop a Provider plugin under the project scope. Used by the explorationDir
 * validation tests; the runtime contract is just enough for the loader to
 * accept it (or reject it deterministically when fields are missing).
 */
function dropMockProvider(
  scope: IScope,
  id: string,
  opts: IMockProviderOptions = {},
): void {
  const pluginDir = join(scope.cwd, '.skill-map', 'plugins', id);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({
      id,
      version: '0.1.0',
      specCompat: `^${installedSpecVersion()}`,
      extensions: ['provider.js'],
    }),
  );
  // Phase 3 (spec 0.8.0): the Provider runtime shape collapses
  // `emits` + flat `defaultRefreshAction` into the `kinds` map. The
  // mock declares a single `note` kind whose schemaJson is a tiny
  // pass-everything schema so AJV can compile it during boot without
  // needing a real per-kind file on disk.
  const manifestParts = [
    `kind: 'provider'`,
    `id: '${id}-provider'`,
    `version: '0.1.0'`,
    `description: 'mock provider'`,
    `stability: 'experimental'`,
    `kinds: { note: { schema: './schemas/note.schema.json', schemaJson: { $id: 'urn:test:${id}/note', type: 'object', additionalProperties: true }, defaultRefreshAction: '${id}/summarize-note' } }`,
  ];
  if (!opts.omitExplorationDir) {
    manifestParts.push(`explorationDir: '${opts.explorationDir ?? '~/.mock'}'`);
  }
  manifestParts.push(`async *walk() {}`);
  manifestParts.push(`classify() { return 'note'; }`);
  writeFileSync(
    join(pluginDir, 'provider.js'),
    `export default {\n  ${manifestParts.join(',\n  ')},\n};\n`,
  );
}

function sm(args: string[], scope: IScope) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: scope.cwd,
    env: { ...process.env, HOME: scope.home, USERPROFILE: scope.home },
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-plugins-cli-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sm plugins enable / disable', () => {
  it('disables a plugin: writes config_plugins row, list shows status=disabled', async () => {
    const scope = freshScope('disable-one');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-a');

    const r = sm(['plugins', 'disable', 'mock-a'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /disabled: mock-a/);

    // DB row reflects disabled
    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await getPluginEnabled(adapter.db, 'mock-a'), false);
    } finally {
      await adapter.close();
    }

    // sm plugins list reflects the toggle
    const list = sm(['plugins', 'list'], scope);
    assert.equal(list.status, 0);
    assert.match(list.stdout, /off\s+mock-a/);
  });

  it('enable flips a previously disabled plugin back on', async () => {
    const scope = freshScope('enable-flip');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-b');
    sm(['plugins', 'disable', 'mock-b'], scope);

    const r = sm(['plugins', 'enable', 'mock-b'], scope);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /enabled: mock-b/);

    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await getPluginEnabled(adapter.db, 'mock-b'), true);
    } finally {
      await adapter.close();
    }

    const list = sm(['plugins', 'list'], scope);
    assert.match(list.stdout, /ok\s+mock-b/);
  });

  it('--all disables every bundle-granularity plugin (built-in claude + user plugins)', async () => {
    const scope = freshScope('disable-all');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-c');
    dropMockPlugin(scope, 'mock-d');

    const r = sm(['plugins', 'disable', '--all'], scope);
    assert.equal(r.status, 0);
    // Spec § A.7 — `--all` operates on bundle-granularity ids only.
    // Built-in `claude` (granularity=bundle) is included; built-in
    // `core` (granularity=extension) is NOT — its individual extensions
    // are the toggle-able units, and `--all` deliberately does not
    // expand to qualified ids.
    assert.match(r.stdout, /disabled: 3 plugin\(s\)/);
    assert.match(r.stdout, /- claude/);
    assert.match(r.stdout, /- mock-c/);
    assert.match(r.stdout, /- mock-d/);
    // `core` must NOT be in the targets — extension granularity rejects
    // bare bundle ids.
    assert.equal(r.stdout.includes('- core\n'), false, 'core must not be toggled by --all');

    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await getPluginEnabled(adapter.db, 'mock-c'), false);
      assert.equal(await getPluginEnabled(adapter.db, 'mock-d'), false);
      assert.equal(await getPluginEnabled(adapter.db, 'claude'), false);
    } finally {
      await adapter.close();
    }
  });

  it('exit 5 on unknown plugin id', () => {
    const scope = freshScope('disable-unknown');
    sm(['init', '--no-scan'], scope);
    const r = sm(['plugins', 'disable', 'no-such-plugin'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Plugin not found/);
  });

  it('exit 2 when neither <id> nor --all is supplied', () => {
    const scope = freshScope('disable-no-arg');
    sm(['init', '--no-scan'], scope);
    const r = sm(['plugins', 'disable'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /<id> or --all/);
  });

  it('exit 2 when both <id> and --all are passed', () => {
    const scope = freshScope('disable-both');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-e');
    const r = sm(['plugins', 'disable', 'mock-e', '--all'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not both/);
  });

  it('settings.json baseline is overridden by DB user override', async () => {
    const scope = freshScope('precedence');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-f');
    // settings.json says enabled: false; DB will say enabled: true.
    sm(['config', 'set', 'plugins.mock-f.enabled', 'false'], scope);
    sm(['plugins', 'enable', 'mock-f'], scope);

    const list = sm(['plugins', 'list'], scope);
    assert.equal(list.status, 0);
    // DB says enabled → status enabled
    assert.match(list.stdout, /ok\s+mock-f/);
  });

  it('settings.json baseline applies when DB has no override (enabled by default → disabled by settings)', () => {
    const scope = freshScope('settings-only');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-g');
    sm(['config', 'set', 'plugins.mock-g.enabled', 'false'], scope);

    const list = sm(['plugins', 'list'], scope);
    assert.equal(list.status, 0);
    assert.match(list.stdout, /off\s+mock-g/);
  });
});

// Spec § A.7 — granularity. The CLI rejects mismatched ids up front so
// the user learns the model from the error message instead of silently
// writing a config_plugins row that the runtime would later ignore.
describe('sm plugins enable / disable — granularity', () => {
  it('(e) disable claude (bundle granularity) → OK, persists row under "claude"', async () => {
    const scope = freshScope('granularity-claude-disable');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'claude'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /disabled: claude/);

    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await getPluginEnabled(adapter.db, 'claude'), false);
    } finally {
      await adapter.close();
    }
  });

  it('(f) disable claude/slash (qualified id under bundle granularity) → ERROR', () => {
    const scope = freshScope('granularity-claude-qualified');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'claude/slash'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /'claude' has granularity=bundle/);
    assert.match(r.stderr, /sm plugins disable claude/);
  });

  it('(g) disable core (bare bundle id under extension granularity) → ERROR', () => {
    const scope = freshScope('granularity-core-bare');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'core'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /'core' has granularity=extension/);
    assert.match(r.stderr, /sm plugins disable core\/<ext-id>/);
  });

  it('(h) disable core/superseded (qualified id under extension granularity) → OK', async () => {
    const scope = freshScope('granularity-core-qualified');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'core/superseded'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /disabled: core\/superseded/);

    const dbPath = join(scope.cwd, '.skill-map', 'skill-map.db');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      assert.equal(await getPluginEnabled(adapter.db, 'core/superseded'), false);
      // Other core extensions and the claude bundle untouched.
      assert.equal(await getPluginEnabled(adapter.db, 'claude'), undefined);
      assert.equal(await getPluginEnabled(adapter.db, 'core/broken-ref'), undefined);
    } finally {
      await adapter.close();
    }
  });

  it('(i) sm plugins list shows mixed granularities correctly', () => {
    const scope = freshScope('granularity-list');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-list');

    const r = sm(['plugins', 'list'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // Claude bundle line carries granularity=bundle and an inline list
    // of qualified extension ids.
    assert.match(r.stdout, /claude@built-in \(granularity=bundle\)/);
    assert.match(r.stdout, /provider:claude\/claude/);
    // Core bundle line carries granularity=extension and one indented
    // line per extension with its own status.
    assert.match(r.stdout, /core@built-in \(granularity=extension\)/);
    assert.match(r.stdout, /\bok\b\s+rule:core\/superseded/);
    // User plugin still has its own row with granularity=bundle (default).
    assert.match(r.stdout, /mock-list@0\.1\.0 \(granularity=bundle\)/);
  });

  it('rejects qualified id under unknown bundle with directed message', () => {
    const scope = freshScope('granularity-unknown-bundle');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'no-such/anything'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Qualified extension id references unknown bundle/);
  });

  it('rejects qualified id with unknown extension under known bundle', () => {
    const scope = freshScope('granularity-unknown-ext');
    sm(['init', '--no-scan'], scope);

    const r = sm(['plugins', 'disable', 'core/no-such-rule'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Qualified extension id not found/);
    assert.match(r.stderr, /'core' does not declare an extension with id 'no-such-rule'/);
  });
});

describe('sm plugins doctor — disabled is not a failure', () => {
  it('exit 0 when the only non-loaded plugin is disabled', () => {
    const scope = freshScope('doctor-disabled');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-h');
    sm(['plugins', 'disable', 'mock-h'], scope);

    const r = sm(['plugins', 'doctor'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /disabled\s+1/);
  });
});

// Spec § A.6 — qualified extension ids surface through `sm plugins
// show`. The plugin id (the namespace) stays unqualified — `show`
// resolves on it — but the listed extensions are rendered with their
// qualified form `<pluginId>/<id>` so the user pastes the same string
// used by registry lookups and `defaultRefreshAction`.
describe('sm plugins show — qualified extension ids', () => {
  it('renders extensions as <pluginId>/<id>; show resolves on the plugin id', () => {
    const scope = freshScope('show-qualified');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-q');

    const r = sm(['plugins', 'show', 'mock-q'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /^id:\s+mock-q$/m);
    // Extensions row uses the qualified form `mock-q/mock-q-extractor`.
    assert.match(r.stdout, /extractor:mock-q\/mock-q-extractor@/);
  });

  it('list output renders extensions with qualified ids', () => {
    const scope = freshScope('list-qualified');
    sm(['init', '--no-scan'], scope);
    dropMockPlugin(scope, 'mock-l');

    const r = sm(['plugins', 'list'], scope);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /extractor:mock-l\/mock-l-extractor/);
  });
});

// Provider §explorationDir — the manifest field is required (loader rejects
// missing) and `sm plugins doctor` warns when the resolved directory does
// not exist on disk. The warning is non-blocking — the user may install
// the matching platform later. Three sub-cases cover the contract:
describe('sm plugins doctor — Provider explorationDir validation', () => {
  it('Provider with valid explorationDir loads OK (status=enabled)', () => {
    const scope = freshScope('provider-explorationdir-ok');
    sm(['init', '--no-scan'], scope);
    // Use the home dir itself as explorationDir — guaranteed to exist.
    dropMockProvider(scope, 'mock-prov-ok', { explorationDir: scope.home });
    const r = sm(['plugins', 'list'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /\bok\b\s+mock-prov-ok@/);
  });

  it('Provider with missing explorationDir → doctor emits non-blocking warning', () => {
    const scope = freshScope('provider-explorationdir-missing');
    sm(['init', '--no-scan'], scope);
    // Pin to an absolute path under the scope home that we deliberately
    // do NOT create — guarantees the existsSync probe returns false.
    const ghostPath = join(scope.home, 'definitely-not-here');
    dropMockProvider(scope, 'mock-prov-ghost', { explorationDir: ghostPath });
    const r = sm(['plugins', 'doctor'], scope);
    // Exit 0 — explorationDir warnings do NOT promote the exit code.
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /Warnings:/);
    assert.match(
      r.stdout,
      /mock-prov-ghost\/mock-prov-ghost-provider.*explorationDir/,
    );
  });

  it('Provider without explorationDir → load-error citing the schema', () => {
    const scope = freshScope('provider-explorationdir-omitted');
    sm(['init', '--no-scan'], scope);
    dropMockProvider(scope, 'mock-prov-bad', { omitExplorationDir: true });
    const r = sm(['plugins', 'list'], scope);
    // List itself does not error; the plugin row carries the rejection.
    // The loader treats per-extension manifest schema failures as
    // `load-error` (load!) rather than `invalid-manifest` (mani!) because
    // the plugin manifest itself parsed — only one of its extensions is
    // shape-broken — and routes the failure through the schema-cited
    // diagnostic path.
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /load!\s+mock-prov-bad@/);
    assert.match(r.stdout, /must have required property 'explorationDir'/);
  });
});
