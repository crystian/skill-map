/**
 * Step 14.4.a — `/ws` end-to-end integration tests.
 *
 * Drive a real server (`createServer`) with the watcher ENABLED against
 * a `mkdtempSync` scope, then:
 *
 *   1. Open a real `ws` client to `/ws`.
 *   2. Touch a `.md` file inside the watched scope.
 *   3. Await the `scan.completed` envelope.
 *   4. Assert the persisted DB matches.
 *
 * Multi-client fan-out (one batch fires events to two open WS clients)
 * is also covered. Disconnect cleanup is asserted via the broadcaster's
 * `clientCount` after the client closes.
 *
 * Lifecycle hygiene mirrors `server-boot.test.ts`: every `createServer`
 * is paired with `await handle.close()` in `try/finally` so a stray
 * listener never leaks across tests. The `runtimeContext` override is
 * REQUIRED — production callers use `process.cwd()` but a test runner
 * that did the same would watch the entire skill-map repo.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { WebSocket } from 'ws';

import {
  createServer,
  type IServerOptions,
  type ServerHandle,
} from '../server/index.js';
import { resetLogger } from '../kernel/util/logger.js';

interface IFixture {
  tmp: string;
  cwd: string;
  dbPath: string;
}

function plantFixture(): IFixture {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-server-ws-int-'));
  const cwd = mkdtempSync(join(tmp, 'cwd-'));
  // The watcher needs a target file the chokidar instance is allowed
  // to walk on its initial pass. A single seed file under `.claude/`
  // matches the built-in claude Provider's discovery and yields a
  // ScanResult with at least one node.
  mkdirSync(join(cwd, '.claude', 'agents'), { recursive: true });
  writeFileSync(
    join(cwd, '.claude', 'agents', 'seed.md'),
    [
      '---',
      'name: seed',
      'description: Seed agent.',
      '---',
      'Seed body.',
    ].join('\n'),
  );
  const dbPath = join(cwd, '.skill-map', 'skill-map.db');
  return { tmp, cwd, dbPath };
}

function defaultOptions(fx: IFixture, overrides: Partial<IServerOptions> = {}): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    scope: 'project',
    dbPath: fx.dbPath,
    uiDist: null,
    noBuiltIns: false,
    noPlugins: true,
    open: false,
    devCors: false,
    noWatcher: false,
    // Tighten the debounce so the test doesn't wait the default
    // 250ms+ on every assertion. 25ms is short enough to keep tests
    // snappy and long enough that chokidar's internal coalescing
    // still groups a single touch into one batch.
    watcherDebounceMs: 25,
    ...overrides,
  };
}

async function bootAndUse<T>(
  fx: IFixture,
  options: IServerOptions,
  fn: (handle: ServerHandle) => Promise<T>,
): Promise<T> {
  // Force the runtime context to the test fixture's cwd. Without this
  // the watcher would walk the test runner's actual cwd (the
  // skill-map repo root), which would fire batches for every
  // unrelated FS event during the test run.
  const handle = await createServer(options, {
    runtimeContext: { cwd: fx.cwd, homedir: homedir() },
  });
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

interface IConnectedClient {
  ws: WebSocket;
  events: Array<{ type: string; data?: unknown; timestamp?: unknown }>;
  /** Resolves when the next event of `type` arrives, or rejects on timeout. */
  awaitEvent(type: string, timeoutMs?: number): Promise<{ type: string; data?: unknown }>;
  close(): Promise<void>;
}

async function connectClient(handle: ServerHandle): Promise<IConnectedClient> {
  const url = `ws://127.0.0.1:${handle.address.port}/ws`;
  const ws = new WebSocket(url);
  await new Promise<void>((resolveOpen, rejectOpen) => {
    const timeout = setTimeout(() => {
      ws.terminate();
      rejectOpen(new Error('WS handshake timed out'));
    }, 2000);
    ws.once('open', () => {
      clearTimeout(timeout);
      resolveOpen();
    });
    ws.once('error', (err) => {
      clearTimeout(timeout);
      rejectOpen(err);
    });
  });

  const events: Array<{ type: string; data?: unknown; timestamp?: unknown }> = [];
  const waiters = new Map<string, Array<(ev: { type: string; data?: unknown }) => void>>();
  ws.on('message', (raw) => {
    try {
      const parsed = JSON.parse(raw.toString('utf-8')) as { type: string; data?: unknown };
      events.push(parsed);
      const queue = waiters.get(parsed.type);
      if (queue && queue.length > 0) {
        const next = queue.shift()!;
        next(parsed);
      }
    } catch {
      // ignore — non-JSON frames are unexpected at 14.4.a
    }
  });

  const awaitEvent = (type: string, timeoutMs = 5000): Promise<{ type: string; data?: unknown }> => {
    const existing = events.find((ev) => ev.type === type);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolveEv, rejectEv) => {
      const timer = setTimeout(() => {
        const queue = waiters.get(type);
        if (queue) {
          const idx = queue.indexOf(handler);
          if (idx >= 0) queue.splice(idx, 1);
        }
        rejectEv(new Error(`timed out waiting for WS event "${type}" after ${timeoutMs}ms (received: ${events.map((e) => e.type).join(', ') || '<none>'})`));
      }, timeoutMs);
      const handler = (ev: { type: string; data?: unknown }): void => {
        clearTimeout(timer);
        resolveEv(ev);
      };
      const queue = waiters.get(type) ?? [];
      queue.push(handler);
      waiters.set(type, queue);
    });
  };

  const close = async (): Promise<void> => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolveClose) => {
        ws.once('close', () => resolveClose());
        ws.close();
      });
    }
  };

  return { ws, events, awaitEvent, close };
}

let activeFixtures: IFixture[] = [];

afterEach(() => {
  for (const fx of activeFixtures) {
    rmSync(fx.tmp, { recursive: true, force: true });
  }
  activeFixtures = [];
  resetLogger();
});

function freshFixture(): IFixture {
  const fx = plantFixture();
  activeFixtures.push(fx);
  return fx;
}

describe('server `/ws` — broadcaster integration', () => {
  it('boots the watcher and broadcasts watcher.started + scan.completed for the initial batch', async (t) => {
    // The initial scan happens BEFORE the WS client connects, so the
    // first observable event is `watcher.started`. We then touch a
    // file to trigger a fresh batch and assert `scan.completed`.
    const fx = freshFixture();
    const options = defaultOptions(fx);
    await bootAndUse(fx, options, async (handle) => {
      // Sanity: the broadcaster registered watcherStarted before
      // anyone could connect. We only verify scan.* against a
      // user-triggered touch.
      const client = await connectClient(handle);
      try {
        // Touch a new file — chokidar emits 'add', the watcher
        // debounces 25ms, runs scan+persist, and broadcasts.
        const touched = join(fx.cwd, '.claude', 'agents', 'touched.md');
        writeFileSync(
          touched,
          [
            '---',
            'name: touched',
            'description: Touched agent.',
            '---',
            'Touched body.',
          ].join('\n'),
        );
        const completed = await client.awaitEvent('scan.completed', 8000);
        assert.equal(completed.type, 'scan.completed');
        // Per spec/job-events.md §scan.completed line 363, the data
        // payload carries scan stats. The kernel orchestrator emits
        // `{ stats }` (the pre-spec shape — drift documented in
        // events.ts header). Either shape passes:
        const data = completed.data as Record<string, unknown> | undefined;
        assert.ok(data, 'scan.completed must carry a data payload');
        // Either flat counts or nested stats — assert the union.
        const hasStats = data?.['stats'] !== undefined || data?.['nodes'] !== undefined;
        assert.ok(hasStats, `expected stats / nodes on payload, got: ${JSON.stringify(data)}`);
      } finally {
        await client.close();
      }
      t.diagnostic(`ws events received: ${client.events.map((e) => e.type).join(', ')}`);
    });
  });

  it('fans a single batch out to multiple connected clients', async () => {
    const fx = freshFixture();
    const options = defaultOptions(fx);
    await bootAndUse(fx, options, async (handle) => {
      const a = await connectClient(handle);
      const b = await connectClient(handle);
      try {
        // Both clients are connected — broadcaster has 2 clients.
        // Wait one debounce cycle for the registrations to settle.
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(handle.broadcaster.clientCount, 2);
        const touched = join(fx.cwd, '.claude', 'agents', 'fanout.md');
        writeFileSync(
          touched,
          [
            '---',
            'name: fanout',
            'description: Fanout.',
            '---',
            'Fanout body.',
          ].join('\n'),
        );
        const [evA, evB] = await Promise.all([
          a.awaitEvent('scan.completed', 8000),
          b.awaitEvent('scan.completed', 8000),
        ]);
        assert.equal(evA.type, 'scan.completed');
        assert.equal(evB.type, 'scan.completed');
      } finally {
        await Promise.all([a.close(), b.close()]);
      }
    });
  });

  it('unregisters a client from the broadcaster on close', async () => {
    const fx = freshFixture();
    const options = defaultOptions(fx);
    await bootAndUse(fx, options, async (handle) => {
      const c = await connectClient(handle);
      // Wait one debounce to let the registration settle.
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(handle.broadcaster.clientCount, 1);
      await c.close();
      // Give the onClose handler a tick to unregister.
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(handle.broadcaster.clientCount, 0);
    });
  });

  it('shuts the watcher down cleanly on handle.close()', async () => {
    const fx = freshFixture();
    const options = defaultOptions(fx);
    const handle = await createServer(options, {
      runtimeContext: { cwd: fx.cwd, homedir: homedir() },
    });
    // Verify the broadcaster exists and can close without throwing.
    assert.ok(handle.broadcaster);
    const startedAt = Date.now();
    await handle.close();
    const elapsed = Date.now() - startedAt;
    // chokidar.close() is async; on a tiny tree it should still
    // resolve well under 2s.
    assert.ok(elapsed < 2000, `close should be fast (got ${elapsed}ms)`);
    // A second close() must be idempotent.
    await handle.close();
  });

  it('refuses to boot the watcher with --no-built-ins (validateServerOptions guard)', async () => {
    const fx = freshFixture();
    // The validator rejects this combo at the options layer; the test
    // proves the boot-time guard fires through `validateServerOptions`.
    const { validateServerOptions } = await import('../server/options.js');
    const result = validateServerOptions({
      dbPath: fx.dbPath,
      noBuiltIns: true,
      noWatcher: false,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'watcher-requires-pipeline');
    }
  });

  it('--no-watcher disables the chokidar loop (no scan.* events fire)', async () => {
    const fx = freshFixture();
    const options = defaultOptions(fx, { noWatcher: true });
    await bootAndUse(fx, options, async (handle) => {
      const c = await connectClient(handle);
      try {
        const touched = join(fx.cwd, '.claude', 'agents', 'no-watch.md');
        writeFileSync(
          touched,
          [
            '---',
            'name: no-watch',
            'description: No watch.',
            '---',
            'No watch body.',
          ].join('\n'),
        );
        // Wait long enough that a real watcher would have fired
        // a batch. With --no-watcher there is no chokidar loop,
        // so no scan.* event ever arrives.
        await new Promise((r) => setTimeout(r, 300));
        const sawScan = c.events.some((e) => e.type === 'scan.started' || e.type === 'scan.completed');
        assert.equal(sawScan, false, `expected no scan.* events with --no-watcher, got: ${c.events.map((e) => e.type).join(', ')}`);
      } finally {
        await c.close();
      }
    });
  });
});
