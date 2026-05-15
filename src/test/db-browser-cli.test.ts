/**
 * `sm db browser` — opens the project DB in DB Browser for SQLite
 * (sqlitebrowser GUI). The verb probes the binary by running
 * `sqlitebrowser --version` (portable to Windows, where `which` is not
 * on PATH) and then spawns it detached. Tests use a temp-dir PATH shim
 * so `sqlitebrowser` is a fake script that:
 *   - returns 0 silently on the `--version` probe (no log line).
 *   - records its launch argv to a file (one arg per line).
 *
 * When the test wants the binary to be "missing", we simply don't
 * create the shim; Node's `spawnSync` returns `error.code === 'ENOENT'`.
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
import {afterAll as after,beforeAll as before, describe, it } from 'bun:test';

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
 *   - a `shimDir` containing a fake `sqlitebrowser` script. Always
 *     present so PATH-prepending wins over any system install (running
 *     this suite on a box that has the real sqlitebrowser would
 *     otherwise launch a real GUI). Behaviour toggled by the option:
 *       - `withSqlitebrowser: true`  → `--version` probe exits 0; launch
 *         records argv to `argvLog` and exits 0.
 *       - `withSqlitebrowser: false` → script always exits 1 (simulates
 *         a non-usable / missing install — the verb's probe rejects it
 *         and reports the install hint).
 *   - an `argvLog` path the fake `sqlitebrowser` writes its launch argv
 *     to, one arg per line, so the test can assert exact spawn args.
 */
function freshScope(
  label: string,
  opts: { withSqlitebrowser: boolean },
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

  // The shim handles two cases:
  //   1. `--version` probe (single arg) exits 0 silently — does not
  //      touch the log so the recorded argv is the launch invocation
  //      only.
  //   2. Any other invocation writes each argv to the log (one per
  //      line) and exits 0. Detached + unref on the parent side means
  //      we don't wait for it; the shim's `echo >>` is synchronous
  //      from the shell's perspective.
  // When `withSqlitebrowser: false`, the shim short-circuits and exits
  // 1 unconditionally so the verb's probe treats the binary as
  // unusable.
  const sb = opts.withSqlitebrowser
    ? `#!/usr/bin/env sh
if [ "$#" = "1" ] && [ "$1" = "--version" ]; then
  exit 0
fi
for arg in "$@"; do echo "$arg" >> "${argvLog}"; done
exit 0
`
    : `#!/usr/bin/env sh\nexit 1\n`;
  const sbPath = join(shimDir, 'sqlitebrowser');
  writeFileSync(sbPath, sb);
  chmodSync(sbPath, 0o755);

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
    const scope = freshScope('happy', { withSqlitebrowser: true });
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
    const scope = freshScope('rw', { withSqlitebrowser: true });
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
    // because the verb checks the file before probing the binary.
    const scope = freshScope('no-db', { withSqlitebrowser: true });

    const r = sm(['db', 'browser'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Run `sm scan` first/);
    // Shim was NOT invoked.
    assert.equal(existsSync(scope.argvLog), false);
  });

  it('exits 2 (Error) when sqlitebrowser is not on PATH', () => {
    // The shim is present but exits 1 unconditionally (PATH-prepended,
    // so it wins over any system install). The verb's `--version`
    // probe sees a non-zero status and reports the binary as missing.
    const scope = freshScope('no-sb', { withSqlitebrowser: false });
    sm(['init', '--no-scan'], scope);

    const r = sm(['db', 'browser'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /sqlitebrowser is not installed/);
    assert.match(r.stderr, /sudo apt install -y sqlitebrowser/);
  });

  it('positional path overrides the project default', () => {
    const scope = freshScope('positional', { withSqlitebrowser: true });
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
