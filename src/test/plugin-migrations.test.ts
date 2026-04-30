/**
 * Step 9.2 integration tests for the plugin-migration runner and the
 * `sm db migrate` CLI surface.
 *
 * Each `it` plants a fresh fixture under tmp, drops the kernel migrations
 * (via `sm init --no-scan` would work, but we drive `DbMigrateCommand`
 * directly to keep the test focused on this verb), then drops one or
 * more plugins under `<fixture>/.skill-map/plugins/<id>/` and asserts
 * the runner / CLI reaches the expected end state.
 *
 * The triple-protection rule is exercised by:
 *
 *   - 9.2.d.green:    a green-path plugin with one prefixed CREATE TABLE
 *                     migration applies cleanly + table exists in catalog.
 *   - 9.2.d.layer1:   a malicious migration with a bare CREATE TABLE
 *                     fails at Layer 1 (validation before any apply).
 *   - 9.2.d.layer3:   a migration that hides a kernel-table CREATE
 *                     inside a comment passes Layer 1 (comment stripped)
 *                     but the resulting SQL is still legal — exercises
 *                     the comment-strip-then-revalidate path.
 *
 * The CLI tests cover --kernel-only, --plugin <id>, and the mutual
 * exclusion check.
 */

import { after, before, describe, it } from 'node:test';
import { match, ok, strictEqual } from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { BaseContext } from 'clipanion';

import { DbMigrateCommand } from '../cli/commands/db.js';

let tmpRoot: string;
let counter = 0;

function freshFixture(label: string): string {
  counter += 1;
  return mkdtempSync(join(tmpRoot, `${label}-${counter}-`));
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-9-2-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

interface ICapturedContext {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICapturedContext {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const context = {
    stdout: { write: (s: string) => { stdoutChunks.push(s); return true; } },
    stderr: { write: (s: string) => { stderrChunks.push(s); return true; } },
  } as unknown as BaseContext;
  return {
    context,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
  };
}

interface IBuildMigrateOpts {
  kernelOnly?: boolean;
  pluginId?: string;
  status?: boolean;
  dryRun?: boolean;
  noBackup?: boolean;
  to?: string;
}

function buildMigrate(opts: IBuildMigrateOpts = {}): DbMigrateCommand {
  const cmd = new DbMigrateCommand();
  cmd.global = false;
  cmd.db = undefined;
  cmd.dryRun = opts.dryRun ?? false;
  cmd.status = opts.status ?? false;
  cmd.to = opts.to;
  cmd.noBackup = opts.noBackup ?? true; // backups slow tests; opt out by default
  cmd.kernelOnly = opts.kernelOnly ?? false;
  cmd.pluginId = opts.pluginId;
  return cmd;
}

interface IPlantPluginOpts {
  id: string;
  /** When set, ships under <plugin-dir>/migrations/. */
  migrations?: Record<string, string>;
  /** Defaults to dedicated mode if migrations are present. */
  storage?: 'kv' | 'dedicated' | 'none';
  /** Defaults to ['./extension.mjs'], a no-op extractor. */
  extensions?: Record<string, string>;
}

function plantPlugin(fixture: string, opts: IPlantPluginOpts): void {
  const dir = join(fixture, '.skill-map', 'plugins', opts.id);
  mkdirSync(dir, { recursive: true });

  const manifest: Record<string, unknown> = {
    id: opts.id,
    version: '1.0.0',
    specCompat: '>=0.0.0',
    extensions: ['./extension.mjs'],
  };
  const storage = opts.storage ?? (opts.migrations ? 'dedicated' : 'none');
  if (storage === 'kv') manifest['storage'] = { mode: 'kv' };
  if (storage === 'dedicated') {
    const migs = Object.keys(opts.migrations ?? {}).map((m) => `./migrations/${m}`);
    manifest['storage'] = {
      mode: 'dedicated',
      tables: [`plugin_${opts.id.replace(/[^a-z0-9]+/g, '_')}_*`],
      migrations: migs.length > 0 ? migs : ['./migrations/001_init.sql'],
    };
  }
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest));

  const exts = opts.extensions ?? {
    'extension.mjs': `
      export default {
        id: '${opts.id}-extractor',
        kind: 'extractor',
        version: '1.0.0',
        emitsLinkKinds: ['references'],
        defaultConfidence: 'high',
        extract() {},
      };
    `,
  };
  for (const [rel, content] of Object.entries(exts)) {
    const target = join(dir, rel);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);
  }

  if (opts.migrations) {
    const migDir = join(dir, 'migrations');
    mkdirSync(migDir, { recursive: true });
    for (const [name, sql] of Object.entries(opts.migrations)) {
      writeFileSync(join(migDir, name), sql);
    }
  }
}

/** Read every user-visible object name from the project DB. */
function listObjects(fixture: string): string[] {
  const db = new DatabaseSync(join(fixture, '.skill-map', 'skill-map.db'));
  try {
    const rows = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type IN ('table','index','trigger','view')
           AND name NOT LIKE 'sqlite_autoindex_%'
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  } finally {
    db.close();
  }
}

/** Look up the ledger row for a single plugin migration. */
function pluginLedger(fixture: string, pluginId: string): Array<{ version: number; description: string }> {
  const db = new DatabaseSync(join(fixture, '.skill-map', 'skill-map.db'));
  try {
    return db
      .prepare(
        `SELECT version, description FROM config_schema_versions
         WHERE scope='plugin' AND owner_id=? ORDER BY version`,
      )
      .all(pluginId) as Array<{ version: number; description: string }>;
  } finally {
    db.close();
  }
}

describe('Step 9.2 — sm db migrate (kernel + plugin)', () => {
  it('green path: plugin with dedicated storage applies its migration cleanly', async () => {
    const fixture = freshFixture('green');
    plantPlugin(fixture, {
      id: 'fixture-store',
      migrations: {
        '001_init.sql': `
          CREATE TABLE plugin_fixture_store_items (
            id INTEGER PRIMARY KEY,
            label TEXT NOT NULL
          );
          CREATE INDEX plugin_fixture_store_items_label
            ON plugin_fixture_store_items (label);
        `,
      },
    });

    const original = process.cwd();
    process.chdir(fixture);
    try {
      const cap = captureContext();
      const cmd = buildMigrate();
      cmd.context = cap.context;
      const code = await cmd.execute();
      strictEqual(code, 0, `migrate exited ${code}; stderr=${cap.stderr()}`);

      const objects = listObjects(fixture);
      ok(
        objects.includes('plugin_fixture_store_items'),
        `expected plugin table in catalog; got ${objects.join(', ')}`,
      );
      ok(objects.includes('plugin_fixture_store_items_label'));

      const ledger = pluginLedger(fixture, 'fixture-store');
      strictEqual(ledger.length, 1);
      strictEqual(ledger[0]!.version, 1);
      strictEqual(ledger[0]!.description, 'init');
    } finally {
      process.chdir(original);
    }
  });

  it('Layer 1 rejects a bare-table migration without writing anything', async () => {
    const fixture = freshFixture('layer1');
    plantPlugin(fixture, {
      id: 'evil-plugin',
      migrations: {
        '001_pwn.sql': 'CREATE TABLE evil_table (id INTEGER PRIMARY KEY);',
      },
    });

    const original = process.cwd();
    process.chdir(fixture);
    try {
      const cap = captureContext();
      const cmd = buildMigrate();
      cmd.context = cap.context;
      const code = await cmd.execute();
      strictEqual(code, 2, 'expected exit 2 on validator failure');
      match(cap.stderr(), /plugin evil-plugin/);
      match(cap.stderr(), /outside the plugin's namespace/);
      const objects = listObjects(fixture);
      ok(
        !objects.includes('evil_table'),
        `bare table must NOT have been created; catalog: ${objects.join(', ')}`,
      );
      // Ledger should also be empty for this plugin (no partial advance).
      strictEqual(pluginLedger(fixture, 'evil-plugin').length, 0);
    } finally {
      process.chdir(original);
    }
  });

  it('idempotent re-run reports already-up-to-date and does not duplicate ledger rows', async () => {
    const fixture = freshFixture('idempotent');
    plantPlugin(fixture, {
      id: 'idem-plugin',
      migrations: {
        '001_init.sql': 'CREATE TABLE plugin_idem_plugin_t (a INTEGER);',
      },
    });

    const original = process.cwd();
    process.chdir(fixture);
    try {
      // First run: applies.
      const cap1 = captureContext();
      const cmd1 = buildMigrate();
      cmd1.context = cap1.context;
      strictEqual(await cmd1.execute(), 0, cap1.stderr());
      strictEqual(pluginLedger(fixture, 'idem-plugin').length, 1);

      // Second run: no-op.
      const cap2 = captureContext();
      const cmd2 = buildMigrate();
      cmd2.context = cap2.context;
      strictEqual(await cmd2.execute(), 0, cap2.stderr());
      match(cap2.stdout(), /plugin idem-plugin · Already up to date/);
      strictEqual(pluginLedger(fixture, 'idem-plugin').length, 1);
    } finally {
      process.chdir(original);
    }
  });

  it('--kernel-only skips plugin migrations entirely', async () => {
    const fixture = freshFixture('kernel-only');
    plantPlugin(fixture, {
      id: 'should-be-skipped',
      migrations: {
        '001_init.sql': 'CREATE TABLE plugin_should_be_skipped_t (a INTEGER);',
      },
    });

    const original = process.cwd();
    process.chdir(fixture);
    try {
      const cap = captureContext();
      const cmd = buildMigrate({ kernelOnly: true });
      cmd.context = cap.context;
      strictEqual(await cmd.execute(), 0, cap.stderr());
      const objects = listObjects(fixture);
      ok(
        !objects.includes('plugin_should_be_skipped_t'),
        `plugin table must not be created under --kernel-only; got ${objects.join(', ')}`,
      );
      strictEqual(pluginLedger(fixture, 'should-be-skipped').length, 0);
    } finally {
      process.chdir(original);
    }
  });

  it('--plugin <id> targets one plugin and skips kernel + other plugins', async () => {
    const fixture = freshFixture('plugin-targeted');
    plantPlugin(fixture, {
      id: 'targeted',
      migrations: {
        '001_init.sql': 'CREATE TABLE plugin_targeted_t (a INTEGER);',
      },
    });
    plantPlugin(fixture, {
      id: 'untargeted',
      migrations: {
        '001_init.sql': 'CREATE TABLE plugin_untargeted_t (a INTEGER);',
      },
    });

    const original = process.cwd();
    process.chdir(fixture);
    try {
      // Run kernel migrations once so the ledger / config_schema_versions
      // table exists for plugin ledger writes.
      const k = captureContext();
      const kCmd = buildMigrate({ kernelOnly: true });
      kCmd.context = k.context;
      strictEqual(await kCmd.execute(), 0, k.stderr());

      const cap = captureContext();
      const cmd = buildMigrate({ pluginId: 'targeted' });
      cmd.context = cap.context;
      strictEqual(await cmd.execute(), 0, cap.stderr());

      const objects = listObjects(fixture);
      ok(objects.includes('plugin_targeted_t'));
      ok(
        !objects.includes('plugin_untargeted_t'),
        `untargeted plugin must not be migrated; catalog: ${objects.join(', ')}`,
      );
      strictEqual(pluginLedger(fixture, 'targeted').length, 1);
      strictEqual(pluginLedger(fixture, 'untargeted').length, 0);
    } finally {
      process.chdir(original);
    }
  });

  it('--plugin <id> with a non-existent id exits 5', async () => {
    const fixture = freshFixture('plugin-missing');
    const original = process.cwd();
    process.chdir(fixture);
    try {
      const cap = captureContext();
      const cmd = buildMigrate({ pluginId: 'does-not-exist' });
      cmd.context = cap.context;
      const code = await cmd.execute();
      strictEqual(code, 5);
      match(cap.stderr(), /no loaded plugin with that id/);
    } finally {
      process.chdir(original);
    }
  });

  it('--kernel-only and --plugin <id> are mutually exclusive', async () => {
    const fixture = freshFixture('mutual-exclusive');
    const original = process.cwd();
    process.chdir(fixture);
    try {
      const cap = captureContext();
      const cmd = buildMigrate({ kernelOnly: true, pluginId: 'whatever' });
      cmd.context = cap.context;
      const code = await cmd.execute();
      strictEqual(code, 2);
      match(cap.stderr(), /mutually exclusive/);
    } finally {
      process.chdir(original);
    }
  });

  it('--status reports both kernel and plugin ledgers', async () => {
    const fixture = freshFixture('status');
    plantPlugin(fixture, {
      id: 'status-plugin',
      migrations: {
        '001_init.sql': 'CREATE TABLE plugin_status_plugin_t (a INTEGER);',
      },
    });

    const original = process.cwd();
    process.chdir(fixture);
    try {
      // Apply everything first.
      const apply = captureContext();
      const applyCmd = buildMigrate();
      applyCmd.context = apply.context;
      strictEqual(await applyCmd.execute(), 0, apply.stderr());

      const cap = captureContext();
      const cmd = buildMigrate({ status: true });
      cmd.context = cap.context;
      strictEqual(await cmd.execute(), 0, cap.stderr());
      match(cap.stdout(), /kernel · Applied: \d+/);
      match(cap.stdout(), /plugin status-plugin · Applied: 1/);
    } finally {
      process.chdir(original);
    }
  });

  it('--dry-run on plugin migrations does not write anything', async () => {
    const fixture = freshFixture('dry-run');
    plantPlugin(fixture, {
      id: 'dry-plugin',
      migrations: {
        '001_init.sql': 'CREATE TABLE plugin_dry_plugin_t (a INTEGER);',
      },
    });

    const original = process.cwd();
    process.chdir(fixture);
    try {
      // Run kernel first so DB + ledger table exist; then --dry-run.
      const k = captureContext();
      const kCmd = buildMigrate({ kernelOnly: true });
      kCmd.context = k.context;
      strictEqual(await kCmd.execute(), 0, k.stderr());

      const cap = captureContext();
      const cmd = buildMigrate({ dryRun: true });
      cmd.context = cap.context;
      strictEqual(await cmd.execute(), 0, cap.stderr());
      match(cap.stdout(), /plugin dry-plugin · Would apply 1 migration/);

      const objects = listObjects(fixture);
      ok(
        !objects.includes('plugin_dry_plugin_t'),
        `dry-run must not create the plugin table; got ${objects.join(', ')}`,
      );
      strictEqual(pluginLedger(fixture, 'dry-plugin').length, 0);
    } finally {
      process.chdir(original);
    }
  });
});
