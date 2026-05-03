/**
 * H3 — `sm db reset` and `sm db restore` `--dry-run` previews per
 * `cli-contract.md` §Dry-run. Each test isolates HOME and cwd so the
 * host machine is never touched.
 *
 * Coverage:
 *   - `sm db reset --dry-run` previews row counts per `scan_*` table
 *     and DOES NOT clear the data.
 *   - `sm db reset --state --dry-run` includes `state_*` tables in
 *     the preview.
 *   - `sm db reset --hard --dry-run` previews path + size and does
 *     NOT unlink the file.
 *   - `sm db reset --hard --dry-run` on a missing file says so without
 *     an error.
 *   - `sm db restore <src> --dry-run` previews the swap and DOES NOT
 *     copy.
 *   - `sm db restore` of a missing source still exits 5 under dry-run
 *     (spec §Dry-run: input-validation errors keep their normal exit
 *     code).
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', 'bin', 'sm.js');

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

function sm(
  args: string[],
  scope: IScope,
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: scope.cwd,
    env: { ...process.env, HOME: scope.home, USERPROFILE: scope.home },
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function dbPath(scope: IScope): string {
  return join(scope.cwd, '.skill-map', 'skill-map.db');
}

function fileSize(path: string): number {
  return statSync(path).size;
}

function fileChecksum(path: string): string {
  // Simple: compare sizes + first 1 KB. Adequate for "did the file
  // change" assertions inside dry-run tests.
  const raw = readFileSync(path);
  return `${raw.length}-${raw.subarray(0, 1024).toString('hex')}`;
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-db-cli-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sm db reset --dry-run', () => {
  it('previews row counts per scan_* table and does NOT clear the DB', () => {
    const scope = freshScope('reset-default');
    const init = sm(['init', '--no-scan'], scope);
    assert.equal(init.status, 0, `init failed: ${init.stderr}`);
    const target = dbPath(scope);
    const before = fileChecksum(target);

    const r = sm(['db', 'reset', '--dry-run'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /\(dry-run/);
    assert.match(r.stdout, /would clear\s+\d+ table\(s\)/);
    // Names of the three core scan tables MUST appear in the preview.
    assert.match(r.stdout, /scan_nodes/);
    assert.match(r.stdout, /scan_links/);
    assert.match(r.stdout, /scan_issues/);

    // Spec §Dry-run: no DB writes. File on disk identical.
    assert.equal(fileChecksum(target), before, 'DB file must be untouched');
  });

  it('--state --dry-run includes state_* tables in the preview', () => {
    const scope = freshScope('reset-state');
    sm(['init', '--no-scan'], scope);

    const r = sm(['db', 'reset', '--state', '--dry-run'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // At least state_jobs / state_executions / state_summaries must
    // appear; we don't pin the full set so the test is robust to new
    // tables added in future migrations.
    assert.match(r.stdout, /state_jobs/);
    assert.match(r.stdout, /state_executions/);
  });

  it('--hard --dry-run previews path + size and does NOT unlink the DB', () => {
    const scope = freshScope('reset-hard');
    sm(['init', '--no-scan'], scope);
    const target = dbPath(scope);
    const expectedSize = fileSize(target);

    const r = sm(['db', 'reset', '--hard', '--dry-run'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /\(dry-run/);
    assert.match(r.stdout, new RegExp(`would delete\\s+.*skill-map\\.db.*\\(${expectedSize} bytes\\)`));

    // File still on disk untouched.
    assert.ok(existsSync(target));
    assert.equal(fileSize(target), expectedSize);
  });

  it('--hard --dry-run on a missing DB reports no-op without erroring', () => {
    const scope = freshScope('reset-hard-missing');
    // Don't init — leave the DB absent.
    const r = sm(['db', 'reset', '--hard', '--dry-run'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /would delete.+\(file does not exist — no-op\)/);
  });

  it('--state --dry-run bypasses the confirmation prompt entirely', () => {
    const scope = freshScope('reset-state-no-prompt');
    sm(['init', '--no-scan'], scope);

    // Pipe an empty stdin: if the prompt fired, the call would block
    // waiting for input. spawnSync with a missing stdin keyword would
    // also fail. The fact that the call returns at all is the assert.
    const r = sm(['db', 'reset', '--state', '--dry-run'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // No "Aborted." (which would mean the prompt was answered "no").
    assert.doesNotMatch(r.stderr, /Aborted/);
  });
});

describe('sm db restore --dry-run', () => {
  it('previews the swap (source size + target overwrite hint) and does NOT copy', () => {
    const scope = freshScope('restore-overwrite');
    sm(['init', '--no-scan'], scope);
    const target = dbPath(scope);
    const targetBefore = fileChecksum(target);

    // Make a backup file (a copy of the existing DB is a valid input
    // shape — same schema, same size).
    const backup = join(scope.cwd, 'backup.db');
    copyFileSync(target, backup);
    const backupSize = fileSize(backup);

    const r = sm(['db', 'restore', backup, '--dry-run'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /\(dry-run/);
    assert.match(r.stdout, new RegExp(`would copy\\s+.*backup\\.db.*\\(${backupSize} bytes\\)`));
    assert.match(r.stdout, /\(exists, would be overwritten\)/);
    assert.match(r.stdout, /would delete\s+.+-wal and .+-shm sidecars/);

    // Target byte-identical after the dry-run.
    assert.equal(fileChecksum(target), targetBefore, 'live DB must be untouched');
  });

  it('--dry-run reports "would be created" when the target does NOT exist', () => {
    const scope = freshScope('restore-fresh');
    // Don't init — target DB absent.
    const backup = join(scope.cwd, 'seed.db');
    writeFileSync(backup, 'fake-sqlite-bytes-irrelevant-for-dry-run');

    const r = sm(['db', 'restore', backup, '--dry-run'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /\(does not exist, would be created\)/);

    // Target still absent.
    assert.equal(existsSync(dbPath(scope)), false);
  });

  it('--dry-run with a missing source still exits 5 (NotFound)', () => {
    const scope = freshScope('restore-no-source');
    sm(['init', '--no-scan'], scope);

    const r = sm(['db', 'restore', join(scope.cwd, 'nope.db'), '--dry-run'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Backup not found/);
  });

  it('--dry-run bypasses the confirmation prompt entirely', () => {
    const scope = freshScope('restore-no-prompt');
    sm(['init', '--no-scan'], scope);
    const backup = join(scope.cwd, 'b.db');
    copyFileSync(dbPath(scope), backup);

    const r = sm(['db', 'restore', backup, '--dry-run'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /Aborted/);
  });
});

describe('sm db dump — pure node:sqlite (no external sqlite3 binary)', () => {
  it('emits the .dump envelope (PRAGMA + BEGIN/COMMIT + schema) on a fresh init', () => {
    const scope = freshScope('dump-envelope');
    sm(['init', '--no-scan'], scope);

    const r = sm(['db', 'dump'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /^PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n/);
    assert.match(r.stdout, /\nCOMMIT;\n$/);
    // At least one CREATE TABLE for a kernel scan_* table must appear.
    assert.match(r.stdout, /CREATE TABLE scan_nodes/);
  });

  it('respects --tables filter: emits only the named table', () => {
    const scope = freshScope('dump-filter');
    sm(['init', '--no-scan'], scope);

    const r = sm(['db', 'dump', '--tables', 'scan_nodes'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // scan_nodes IS in the dump.
    assert.match(r.stdout, /CREATE TABLE scan_nodes/);
    // scan_links is NOT (filtered out).
    assert.doesNotMatch(r.stdout, /CREATE TABLE scan_links/);
  });

  it('exits 5 (not-found) when the DB does not exist', () => {
    const scope = freshScope('dump-missing');
    // No `sm init` — the DB file is not created.
    const r = sm(['db', 'dump'], scope);
    assert.equal(r.status, 5);
  });

  it('roundtrips: dump output is valid SQL that loads into a fresh sqlite DB', async () => {
    const scope = freshScope('dump-roundtrip');
    sm(['init', '--no-scan'], scope);

    const r = sm(['db', 'dump'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);

    // Reload into a fresh DB via node:sqlite (no external binary).
    const { DatabaseSync } = await import('node:sqlite');
    const reloadedPath = join(scope.cwd, 'reloaded.db');
    const reloaded = new DatabaseSync(reloadedPath);
    try {
      reloaded.exec(r.stdout);
      // The reloaded DB must contain at least the same kernel tables
      // the dump promised.
      const tables = (reloaded
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as Array<{ name: string }>)
        .map((row) => row.name);
      assert.ok(tables.includes('scan_nodes'), `reloaded DB missing scan_nodes: ${tables.join(',')}`);
    } finally {
      reloaded.close();
    }
  });
});

describe('sm db dump --tables — identifier whitelist (audit L1)', () => {
  it('rejects a table name with a semicolon', () => {
    const scope = freshScope('dump-semi');
    sm(['init', '--no-scan'], scope);

    const r = sm(['db', 'dump', '--tables', 'scan_nodes; .shell'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /refusing non-identifier name/i);
  });

  it('rejects a table name with a dash', () => {
    const scope = freshScope('dump-dash');
    sm(['init', '--no-scan'], scope);

    const r = sm(['db', 'dump', '--tables', 'scan-nodes'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /refusing non-identifier name/i);
  });

  it('rejects an empty token', () => {
    const scope = freshScope('dump-empty');
    sm(['init', '--no-scan'], scope);

    const r = sm(['db', 'dump', '--tables', ''], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /refusing non-identifier name/i);
  });
});
