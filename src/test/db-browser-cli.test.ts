/**
 * `sm db browser` — opens the project DB in DB Browser for SQLite
 * (sqlitebrowser GUI). The verb sniffs the binary on PATH and spawns it
 * detached. Tests use a temp-dir PATH shim so:
 *   - `which sqlitebrowser` returns whatever the test wants
 *   - `sqlitebrowser` is a fake script that records its argv to a file
 *     and exits 0 (no GUI window ever opens)
 *
 * Coverage:
 *   - happy path: db exists + sqlitebrowser found → exit 0, stdout
 *     reports "(read-only)", child invoked with `-R <path>`.
 *   - `--rw` toggles spawn args: no `-R`, just the path; stdout
 *     reports "(read-write)".
 *   - db missing → exit 5 (NotFound) + "run sm scan first" hint.
 *   - sqlitebrowser missing → exit 2 (Error) + install hint.
 *   - positional path overrides the project default.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
  shimDir: string;
  argvLog: string;
}

/**
 * Build a per-test scope with:
 *   - clean cwd + HOME
 *   - a `shimDir` containing fake `sqlitebrowser` and `which` scripts
 *     (presence of each toggled by the booleans)
 *   - an `argvLog` path the fake `sqlitebrowser` writes its argv to,
 *     one arg per line, so the test can assert exact spawn args.
 *
 * The shim dir is prepended to PATH on every `sm` invocation. We
 * intentionally also shim `which` because the verb uses `which
 * sqlitebrowser` to sniff presence — bypassing the system `which` keeps
 * the test deterministic across environments where `sqlitebrowser` may
 * actually be installed.
 */
function freshScope(
  label: string,
  opts: { withSqlitebrowser: boolean; withWhich: boolean },
): IScope {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  const cwd = join(dir, 'cwd');
  const home = join(dir, 'home');
  const shimDir = join(dir, 'shim');
  const argvLog = join(dir, 'sqlitebrowser-argv.log');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(shimDir, { recursive: true });

  // `which`: when the test wants `sqlitebrowser` to be "found", our
  // shim returns 0; when "missing", returns 1. The verb does not look
  // at stdout — only the exit status.
  if (opts.withWhich) {
    const target = opts.withSqlitebrowser
      ? `#!/usr/bin/env sh\necho "${shimDir}/sqlitebrowser"\nexit 0\n`
      : `#!/usr/bin/env sh\nexit 1\n`;
    const whichPath = join(shimDir, 'which');
    writeFileSync(whichPath, target);
    chmodSync(whichPath, 0o755);
  }

  if (opts.withSqlitebrowser) {
    // Fake `sqlitebrowser`: write each argv to the log (one per line)
    // and exit 0. Detached + unref on the parent side means we don't
    // actually wait for it to exit, but the log gets flushed
    // synchronously in the shim.
    const sb = `#!/usr/bin/env sh\nfor arg in "$@"; do echo "$arg" >> "${argvLog}"; done\nexit 0\n`;
    const sbPath = join(shimDir, 'sqlitebrowser');
    writeFileSync(sbPath, sb);
    chmodSync(sbPath, 0o755);
  }

  return { cwd, home, shimDir, argvLog };
}

function sm(
  args: string[],
  scope: IScope,
): { status: number; stdout: string; stderr: string } {
  // Prepend shimDir to PATH so the fake `which` and `sqlitebrowser`
  // win over any system install.
  const path = `${scope.shimDir}:${process.env['PATH'] ?? ''}`;
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: scope.cwd,
    env: {
      ...process.env,
      HOME: scope.home,
      USERPROFILE: scope.home,
      PATH: path,
    },
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function dbPath(scope: IScope): string {
  return join(scope.cwd, '.skill-map', 'skill-map.db');
}

/**
 * Wait briefly for the detached child's argv log to land on disk.
 * `child.unref()` lets the parent exit immediately, but the shim's
 * `echo >> "$argvLog"` is synchronous from the shell's perspective. On
 * a busy CI box the file may still not be visible when the parent's
 * `process.exit` runs, so we poll for up to ~1s. Pure determinism win
 * for the assertion that follows.
 */
function waitForLog(path: string, timeoutMs = 1000): string[] | null {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf8');
      const lines = raw.split('\n').filter((l) => l.length > 0);
      if (lines.length > 0) return lines;
    }
    // Tiny synchronous sleep — `Atomics.wait` on a SharedArrayBuffer
    // would be cleaner but the test stays single-threaded and the
    // 10ms granularity is plenty.
    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 10)']);
  }
  return null;
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-db-browser-cli-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sm db browser', () => {
  it('happy path: db exists + sqlitebrowser found → exit 0, read-only by default', () => {
    const scope = freshScope('happy', { withSqlitebrowser: true, withWhich: true });
    const init = sm(['init', '--no-scan'], scope);
    assert.equal(init.status, 0, `init failed: ${init.stderr}`);

    const r = sm(['db', 'browser'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /Opening .*\.skill-map\/skill-map\.db \(read-only\)/);

    // The shim recorded its argv: should be `-R <path>`.
    const argv = waitForLog(scope.argvLog);
    assert.ok(argv, 'sqlitebrowser shim did not record argv');
    assert.deepEqual(argv, ['-R', dbPath(scope)]);
  });

  it('--rw drops the -R flag and reports (read-write)', () => {
    const scope = freshScope('rw', { withSqlitebrowser: true, withWhich: true });
    sm(['init', '--no-scan'], scope);

    const r = sm(['db', 'browser', '--rw'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /\(read-write\)/);

    const argv = waitForLog(scope.argvLog);
    assert.ok(argv, 'sqlitebrowser shim did not record argv');
    assert.deepEqual(argv, [dbPath(scope)]);
  });

  it('exits 5 (NotFound) when the DB does not exist', () => {
    // Don't init — DB absent. sqlitebrowser presence does not matter
    // because the verb checks the file before sniffing the binary.
    const scope = freshScope('no-db', { withSqlitebrowser: true, withWhich: true });

    const r = sm(['db', 'browser'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Run `sm scan` first/);
    // Shim was NOT invoked.
    assert.equal(existsSync(scope.argvLog), false);
  });

  it('exits 2 (Error) when sqlitebrowser is not on PATH', () => {
    // sqlitebrowser missing, but `which` is shimmed so it returns 1
    // deterministically (instead of relying on the host's `which`).
    const scope = freshScope('no-sb', { withSqlitebrowser: false, withWhich: true });
    sm(['init', '--no-scan'], scope);

    const r = sm(['db', 'browser'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /sqlitebrowser not found on PATH/);
    assert.match(r.stderr, /sudo apt install -y sqlitebrowser/);
  });

  it('positional path overrides the project default', () => {
    const scope = freshScope('positional', { withSqlitebrowser: true, withWhich: true });
    // Don't init — we're pointing at a hand-crafted file instead.
    const custom = join(scope.cwd, 'custom.db');
    writeFileSync(custom, ''); // existsSync passes; sqlitebrowser shim never opens it

    const r = sm(['db', 'browser', custom], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, new RegExp(`Opening ${custom.replace(/\//g, '\\/')} \\(read-only\\)`));

    const argv = waitForLog(scope.argvLog);
    assert.ok(argv, 'sqlitebrowser shim did not record argv');
    assert.deepEqual(argv, ['-R', custom]);
  });
});
