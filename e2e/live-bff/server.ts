/**
 * Live-BFF process lifecycle — spawn `sm serve` against the fixture
 * tempdir and tear it down cleanly. Closes the spawn half of R10.
 *
 * Spawn pattern (per AGENTS.md §"Smoke-testing live servers from an
 * agent — NO `--watch`, free ports with `fuser`"):
 *
 *   - One-shot `bun src/cli/entry.ts serve --no-open --port <free>
 *     --no-watcher=false`. NO `--watch` wrapper — that spawns
 *     descendants that get reparented to init when the wrapper dies,
 *     breaking the polling/cleanup story Playwright relies on.
 *   - `cwd` is the materialised fixture tempdir, so `defaultRuntimeContext()`
 *     in the kernel resolves the right project DB / scan root.
 *   - The watcher IS armed (default — we WANT the initial batch to
 *     populate the DB so the bump flow has a node to operate on).
 *
 * Free-port discovery uses `net.createServer().listen(0)`; no extra
 * dep, just `node:net`. Health-poll loop is a vanilla `fetch` against
 * `/api/health` until 200 or the timeout window elapses.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

export interface ILiveBffServer {
  /** Absolute base URL the SPA + REST + WS attach to. Trailing slash. */
  readonly baseUrl: string;
  /** Port the server bound on (ipv4 loopback). */
  readonly port: number;
  /** Best-effort kill (SIGTERM → SIGKILL escalation). Idempotent. */
  shutdown(): Promise<void>;
}

export interface ILiveBffSpawnOpts {
  /** Repo root (workspace ancestor). The CLI entry path is resolved against this. */
  readonly repoRoot: string;
  /** Fixture root — passed as the spawn `cwd`. */
  readonly fixtureCwd: string;
  /** Total ms the helper will wait for `/api/health` to return 200. Default 30 000. */
  readonly readyTimeoutMs?: number;
}

/** Reserve and immediately release an ephemeral TCP port. */
export async function pickFreePort(): Promise<number> {
  return new Promise<number>((resolveFn, rejectFn) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rejectFn);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (typeof addr === 'object' && addr !== null) {
        const { port } = addr;
        srv.close(() => resolveFn(port));
      } else {
        srv.close();
        rejectFn(new Error('failed to bind ephemeral port'));
      }
    });
  });
}

/** Polls `GET <baseUrl>api/health` until 200 or timeout. Returns true on success. */
async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const url = `${baseUrl}api/health`;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // ECONNREFUSED while the listener spins up — retry.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * Boot `sm serve` against the fixture and resolve once `/api/health`
 * responds 200. Rejects with the captured stderr tail when the server
 * fails to come up in time — that's the actionable signal in CI logs.
 */
export async function spawnLiveBff(opts: ILiveBffSpawnOpts): Promise<ILiveBffServer> {
  const port = await pickFreePort();
  const baseUrl = `http://127.0.0.1:${port}/`;
  const entry = `${opts.repoRoot}/src/cli/entry.ts`;
  const child: ChildProcess = spawn(
    'bun',
    [
      entry,
      'serve',
      '--no-open',
      '--port', String(port),
    ],
    {
      cwd: opts.fixtureCwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Force-disable color so the captured stderr is greppable in CI
        // logs. The banner still renders; just without ANSI escapes.
        NO_COLOR: '1',
      },
    },
  );

  const stderrChunks: Buffer[] = [];
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
    // Cap retained bytes to a sane value so a chatty server doesn't
    // balloon memory; we only need the tail for diagnostics.
    if (stderrChunks.length > 200) stderrChunks.splice(0, stderrChunks.length - 200);
  });
  child.stdout?.on('data', () => {
    // Discard stdout — the banner is on stderr; stdout is reserved for
    // structured output verbs (which `sm serve` doesn't emit).
  });

  let exitedEarly = false;
  child.on('exit', () => {
    exitedEarly = true;
  });

  const ready = await waitForHealth(baseUrl, opts.readyTimeoutMs ?? 30_000);
  if (!ready) {
    const tail = Buffer.concat(stderrChunks).toString('utf8');
    await killChild(child);
    const reason = exitedEarly ? 'exited before /api/health came up' : 'health probe timed out';
    throw new Error(`live-bff: ${reason}\n--- captured stderr ---\n${tail}`);
  }

  return {
    baseUrl,
    port,
    shutdown: () => killChild(child),
  };
}

/**
 * SIGTERM → wait → SIGKILL escalation. Resolves either when the child
 * exits or after the kill window elapses (so Playwright's
 * globalTeardown never hangs CI on a stuck process).
 */
async function killChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  return new Promise<void>((resolveFn) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolveFn();
    };
    child.once('exit', finish);
    try { child.kill('SIGTERM'); } catch { /* already dead */ }
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
      }
      // Belt-and-suspenders: cap the wait window even if 'exit' never
      // fires (extremely rare — but better to leak a zombie than hang
      // the test run).
      setTimeout(finish, 1_000);
    }, 3_000);
  });
}
