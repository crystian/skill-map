#!/usr/bin/env node
/**
 * dev:serve — wrapper around `node --import tsx --watch sm serve` that
 * frees the target port before booting the watcher.
 *
 * Why this exists: a previous watcher tree can leak (the npm wrapper
 * dies but the actual node child gets reparented to init), leaving the
 * dev port held. Manually finding + killing the orphan is friction the
 * Architect should not have to repeat.
 *
 * Safety: this script ONLY kills processes whose command line matches
 * an `sm serve` / `tsx` / `cli/entry` signature. Anything else on the
 * port (Postgres, Docker, an unrelated dev server) aborts the script
 * with a clear message — better than nuking the Architect's Postgres
 * because it happened to bind 4242.
 *
 * Usage (from repo root):
 *   npm run dev:serve                                 # default port 4242, cwd=src/
 *   npm run dev:serve -- --port 4243                  # override port
 *   npm run dev:serve -- --cwd ui/fixtures/foo        # serve a fixture scope
 *   npm run dev:serve -- --strict                     # any extra flags pass through
 *
 * `--cwd <path>` is the modal switch: without it, the watcher serves
 * `src/.skill-map/` (handy for kernel iteration); with it, the watcher
 * serves the named directory's project (handy for the `dev:local` flow
 * where the SPA dev server proxies into a local fixture). The path is
 * resolved relative to the repo root.
 *
 * Defaults to `--no-open` (no browser-tab spam on every restart). To
 * exercise the auto-open feature, run the entry directly:
 *   node --import tsx src/cli/entry.ts serve
 *
 * POSIX-only (uses lsof / ps). The repo engines field requires Node 24+;
 * Windows support is out of scope for the dev wrapper.
 */

import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(REPO_ROOT, 'src');
const ENTRY = resolve(SRC, 'cli', 'entry.ts');

const PORT_FLAG = '--port';
const CWD_FLAG = '--cwd';
const DEFAULT_PORT = '4242';

const args = process.argv.slice(2);
const port = parsePort(args);
const cwdOverride = parseCwd(args);
const passthroughArgs = stripFlag(stripFlag(args, CWD_FLAG), PORT_FLAG);
const targetCwd = cwdOverride ?? SRC;

await freePort(port);

const child = spawn(
  'node',
  [
    // Suppress the `node:sqlite` ExperimentalWarning the same way
    // `src/bin/sm.js` does via its shebang. Without this, every dev
    // restart prints two extra lines that drown the actual server logs.
    '--disable-warning=ExperimentalWarning',
    '--import', 'tsx',
    '--watch',
    ENTRY,
    'serve',
    '--no-open',
    PORT_FLAG, port,
    ...passthroughArgs,
  ],
  { stdio: 'inherit', cwd: targetCwd },
);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

function parsePort(argv) {
  const idx = argv.indexOf(PORT_FLAG);
  if (idx < 0 || idx + 1 >= argv.length) return DEFAULT_PORT;
  const raw = argv[idx + 1];
  if (!/^\d+$/.test(raw)) return DEFAULT_PORT;
  return raw;
}

/**
 * Resolve `--cwd <path>` from argv (relative to repo root). Returns
 * `null` when the flag is absent — callers default to `SRC`.
 */
function parseCwd(argv) {
  const idx = argv.indexOf(CWD_FLAG);
  if (idx < 0 || idx + 1 >= argv.length) return null;
  const raw = argv[idx + 1];
  if (!raw || raw.startsWith('--')) return null;
  return resolve(REPO_ROOT, raw);
}

/**
 * Drop a `--flag <value>` pair from an argv array. Used to keep flags
 * that this wrapper consumes itself (`--port`, `--cwd`) from leaking
 * into the spawned `sm serve` child where they would either duplicate
 * the wrapper's own forwarded value or fail with "unknown flag".
 */
function stripFlag(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx < 0) return argv.slice();
  const out = argv.slice();
  out.splice(idx, idx + 1 < argv.length ? 2 : 1);
  return out;
}

async function freePort(port) {
  const pid = listenerPid(port);
  if (pid === null) return;

  const cmd = cmdline(pid);
  if (!isOurProcess(cmd)) {
    process.stderr.write(
      `[dev:serve] port ${port} held by unrelated PID ${pid}: ${cmd}\n` +
      `[dev:serve] refusing to kill — free the port manually then retry.\n`,
    );
    process.exit(1);
  }

  process.stderr.write(`[dev:serve] reaping orphan on port ${port} (PID ${pid}) — SIGTERM\n`);
  trySignal(pid, 'SIGTERM');

  for (let i = 0; i < 10; i++) {
    await sleep(100);
    if (listenerPid(port) === null) return;
  }

  process.stderr.write(`[dev:serve] still held — SIGKILL\n`);
  trySignal(pid, 'SIGKILL');
  await sleep(100);
}

function listenerPid(port) {
  try {
    const out = execFileSync('lsof', ['-ti', `:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!out) return null;
    const pid = Number(out.split('\n')[0]);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    // lsof exits non-zero when nothing is listening — that's the happy path
    return null;
  }
}

function cmdline(pid) {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function isOurProcess(cmd) {
  return /tsx|cli\/entry|sm serve/.test(cmd);
}

function trySignal(pid, signal) {
  try { process.kill(pid, signal); }
  catch { /* already gone */ }
}
