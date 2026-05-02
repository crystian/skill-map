/**
 * Spec § Dry-run invariant gate. The contract:
 *
 *   "No observable side effects. The command MUST NOT mutate the
 *    database, the filesystem, the config, the network, or spawn
 *    external processes."
 *
 * Each verb that exposes `--dry-run` already covers its own preview
 * shape in its dedicated `*-cli.test.ts`; this file is the
 * cross-cutting gate that snapshots the scope's filesystem byte-for-
 * byte before / after a `--dry-run` invocation and asserts equality.
 * Catches the regression where a verb's dry-run path silently grows
 * a side effect (e.g. logging into the DB, writing a temp file
 * outside the live-mode set, auto-creating a directory the live mode
 * also wouldn't have created).
 *
 * SQLite WAL / SHM sidecars are excluded from the snapshot — opening
 * a DB read-only still rewrites them at open / close time, which is
 * not a "side effect" in the spec's sense (no row is added,
 * removed, or rewritten). The main `.db` file is hashed.
 */

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { BaseContext } from 'clipanion';

import { DbMigrateCommand, DbResetCommand, DbRestoreCommand } from '../cli/commands/db.js';
import { InitCommand } from '../cli/commands/init.js';
import { ScanCommand } from '../cli/commands/scan.js';
import type { SmCommand } from '../cli/util/sm-command.js';
import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';

interface ICapturedContext {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICapturedContext {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const context = {
    stdin: process.stdin,
    stdout: { write: (s: string) => { stdoutChunks.push(s); return true; } },
    stderr: { write: (s: string) => { stderrChunks.push(s); return true; } },
  } as unknown as BaseContext;
  return {
    context,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
  };
}

function applySmDefaults(cmd: SmCommand, dbPath?: string): void {
  cmd.global = false;
  cmd.json = false;
  cmd.quiet = false;
  cmd.noColor = false;
  cmd.verbose = 0;
  cmd.db = dbPath;
}

/**
 * Walk `root` and return `{ relativePath: sha256(content) }` for every
 * file. SQLite WAL / SHM sidecars are excluded — opening any DB
 * touches them even on a pure read, and the spec's "no observable
 * side effects" rule cares about row content, not engine bookkeeping.
 */
function snapshotDir(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!e.isFile()) continue;
      if (e.name.endsWith('-wal') || e.name.endsWith('-shm')) continue;
      const rel = relative(root, abs);
      out[rel] = createHash('sha256').update(readFileSync(abs)).digest('hex');
    }
  }
  walk(root);
  return out;
}

function assertByteEqual(
  before: Record<string, string>,
  after: Record<string, string>,
  label: string,
): void {
  const beforeKeys = Object.keys(before).sort();
  const afterKeys = Object.keys(after).sort();
  assert.deepStrictEqual(afterKeys, beforeKeys, `${label}: file set changed`);
  for (const k of beforeKeys) {
    assert.strictEqual(after[k], before[k], `${label}: file content changed: ${k}`);
  }
}

let tmpRoot: string;
let counter = 0;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-dryrun-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

interface IFixture {
  cwd: string;
  scopeRoot: string;
  dbPath: string;
}

/**
 * Plant a populated scope: `<cwd>/.skill-map/skill-map.db` with the
 * latest schema applied. Returns paths the per-verb tests need.
 */
async function freshFixture(label: string): Promise<IFixture> {
  counter += 1;
  const cwd = join(tmpRoot, `${label}-${counter}`);
  const scopeRoot = join(cwd, '.skill-map');
  mkdirSync(scopeRoot, { recursive: true });
  const dbPath = join(scopeRoot, 'skill-map.db');
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  await adapter.close();
  return { cwd, scopeRoot, dbPath };
}

describe('spec § Dry-run — every verb that exposes `--dry-run` is byte-equal before / after', () => {
  it('sm db reset --dry-run', async () => {
    const fx = await freshFixture('db-reset');
    const before = snapshotDir(fx.cwd);

    const cap = captureContext();
    const cmd = new DbResetCommand();
    applySmDefaults(cmd, fx.dbPath);
    cmd.state = false;
    cmd.hard = false;
    cmd.yes = false;
    cmd.dryRun = true;
    cmd.context = cap.context;
    const exit = await cmd.execute();

    assert.strictEqual(exit, 0, `unexpected exit ${exit}; stderr=${cap.stderr()}`);
    assertByteEqual(before, snapshotDir(fx.cwd), 'db reset --dry-run');
  });

  it('sm db reset --hard --dry-run', async () => {
    const fx = await freshFixture('db-reset-hard');
    const before = snapshotDir(fx.cwd);

    const cap = captureContext();
    const cmd = new DbResetCommand();
    applySmDefaults(cmd, fx.dbPath);
    cmd.state = false;
    cmd.hard = true;
    cmd.yes = false;
    cmd.dryRun = true;
    cmd.context = cap.context;
    const exit = await cmd.execute();

    assert.strictEqual(exit, 0, `unexpected exit ${exit}; stderr=${cap.stderr()}`);
    assertByteEqual(before, snapshotDir(fx.cwd), 'db reset --hard --dry-run');
  });

  it('sm db restore <source> --dry-run', async () => {
    const fx = await freshFixture('db-restore');
    // Plant a sibling source DB that --dry-run would otherwise copy
    // over the live one.
    const sourcePath = join(tmpRoot, `db-restore-source-${counter}.db`);
    const sourceAdapter = new SqliteStorageAdapter({ databasePath: sourcePath, autoBackup: false });
    await sourceAdapter.init();
    await sourceAdapter.close();
    const before = snapshotDir(fx.cwd);

    const cap = captureContext();
    const cmd = new DbRestoreCommand();
    applySmDefaults(cmd, fx.dbPath);
    cmd.source = sourcePath;
    cmd.yes = false;
    cmd.dryRun = true;
    cmd.context = cap.context;
    const exit = await cmd.execute();

    assert.strictEqual(exit, 0, `unexpected exit ${exit}; stderr=${cap.stderr()}`);
    assertByteEqual(before, snapshotDir(fx.cwd), 'db restore --dry-run');
  });

  it('sm db migrate --dry-run', async () => {
    const fx = await freshFixture('db-migrate');
    const before = snapshotDir(fx.cwd);

    const cap = captureContext();
    const cmd = new DbMigrateCommand();
    applySmDefaults(cmd, fx.dbPath);
    cmd.dryRun = true;
    cmd.status = false;
    cmd.to = undefined;
    cmd.noBackup = true;
    cmd.kernelOnly = true;
    cmd.pluginId = undefined;
    cmd.context = cap.context;
    const exit = await cmd.execute();

    assert.strictEqual(exit, 0, `unexpected exit ${exit}; stderr=${cap.stderr()}`);
    assertByteEqual(before, snapshotDir(fx.cwd), 'db migrate --dry-run');
  });

  it('sm scan --dry-run (no scope on disk)', async () => {
    // `sm scan` honours `--dry-run` by skipping every DB write AND
    // refusing to provision a `.skill-map/` scope. We chdir into a
    // fresh tmp dir with no `.skill-map/` so the test exercises the
    // "no auto-provisioning" half of the contract.
    counter += 1;
    const cwd = join(tmpRoot, `scan-dryrun-${counter}`);
    mkdirSync(cwd, { recursive: true });
    // Plant one minimal MD file so the scan has something to walk;
    // otherwise the empty-roots guard short-circuits with a different
    // exit code that doesn't exercise the dry-run path we care about.
    writeFileSync(join(cwd, 'note.md'), '---\nname: smoke\n---\nbody\n');

    const cwdBefore = process.cwd();
    process.chdir(cwd);
    try {
      const before = snapshotDir(cwd);

      const cap = captureContext();
      const cmd = new ScanCommand();
      applySmDefaults(cmd);
      cmd.roots = [];
      cmd.noBuiltIns = false;
      cmd.noPlugins = true;
      cmd.noTokens = true;
      cmd.dryRun = true;
      cmd.changed = false;
      cmd.allowEmpty = false;
      cmd.strict = false;
      cmd.watch = false;
      cmd.context = cap.context;
      await cmd.execute();

      assertByteEqual(before, snapshotDir(cwd), 'sm scan --dry-run');
    } finally {
      process.chdir(cwdBefore);
    }
  });

  it('sm init --dry-run (preview without provisioning)', async () => {
    counter += 1;
    const cwd = join(tmpRoot, `init-dryrun-${counter}`);
    mkdirSync(cwd, { recursive: true });

    const cwdBefore = process.cwd();
    process.chdir(cwd);
    try {
      const before = snapshotDir(cwd);

      const cap = captureContext();
      const cmd = new InitCommand();
      applySmDefaults(cmd);
      cmd.noScan = true;
      cmd.force = false;
      cmd.strict = false;
      cmd.dryRun = true;
      cmd.context = cap.context;
      const exit = await cmd.execute();

      assert.strictEqual(exit, 0, `unexpected exit ${exit}; stderr=${cap.stderr()}`);
      assertByteEqual(before, snapshotDir(cwd), 'sm init --dry-run');
    } finally {
      process.chdir(cwdBefore);
    }
  });

  it('non-dry-run mutates (smoke check — proves the snapshot machinery has teeth)', async () => {
    // Sanity: if our snapshot helper missed real mutation we'd never
    // catch a regression. Run `sm db reset` for real and assert the
    // file set / hashes DO change.
    const fx = await freshFixture('non-dryrun-control');
    // Seed a placeholder plain file so reset has visible work.
    copyFileSync(fx.dbPath, join(fx.scopeRoot, 'skill-map.db.bak'));
    const before = snapshotDir(fx.cwd);

    const cap = captureContext();
    const cmd = new DbResetCommand();
    applySmDefaults(cmd, fx.dbPath);
    cmd.state = false;
    cmd.hard = true;
    cmd.yes = true;
    cmd.dryRun = false;
    cmd.context = cap.context;
    const exit = await cmd.execute();

    assert.strictEqual(exit, 0, `unexpected exit ${exit}; stderr=${cap.stderr()}`);
    const after = snapshotDir(fx.cwd);
    // `db reset --hard` deletes the DB file; the file set MUST change.
    assert.notDeepStrictEqual(
      Object.keys(after).sort(),
      Object.keys(before).sort(),
      'control test: live `db reset --hard` should change the file set',
    );
  });
});
