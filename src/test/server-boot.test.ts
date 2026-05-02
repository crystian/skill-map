/**
 * Boot / health / shutdown smoke tests for the Hono BFF (Step 14.1).
 *
 * Every test pairs a `createServer(...)` call with `await handle.close()`
 * inside a `try / finally` so a failing assertion never leaks a listening
 * socket into the next test.
 *
 * `--port 0` is used everywhere — the OS picks a free port; tests read
 * the actual port off `handle.address.port`. Hard-coded ports cause CI
 * flake on busy runners.
 *
 * The UI bundle is intentionally absent (`uiDist: null`) — `/api/health`
 * + the structured 404 surface don't depend on it. Boot resilience is
 * the contract being asserted.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createServer, type IServerOptions, type ServerHandle } from '../server/index.js';

interface ITestRoot { tmp: string; dbPath: string; }

let root: ITestRoot;

before(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-server-boot-'));
  root = { tmp, dbPath: join(tmp, '.skill-map', 'skill-map.db') };
});

after(() => {
  rmSync(root.tmp, { recursive: true, force: true });
});

function defaultOptions(overrides: Partial<IServerOptions> = {}): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    scope: 'project',
    dbPath: root.dbPath,
    uiDist: null,
    noBuiltIns: false,
    noPlugins: false,
    open: false,
    devCors: false,
    ...overrides,
  };
}

async function bootAndUse<T>(
  options: IServerOptions,
  fn: (handle: ServerHandle) => Promise<T>,
): Promise<T> {
  const handle = await createServer(options);
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

describe('server boot — single-port wiring', () => {
  it('boots, listens on an OS-assigned port, and serves /api/health JSON', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      assert.equal(handle.address.host, '127.0.0.1');
      assert.ok(handle.address.port > 0, 'expected an OS-assigned port > 0');

      const res = await fetch(`http://127.0.0.1:${handle.address.port}/api/health`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body['ok'], true);
      assert.equal(body['scope'], 'project');
      assert.equal(typeof body['implVersion'], 'string');
      assert.equal(typeof body['specVersion'], 'string');
      assert.equal(body['schemaVersion'], '1');
    });
  });

  it('boots on a custom --port (high random) and reflects it in handle.address', async () => {
    // Pick a high random port and trust the OS to release it between
    // tests. If it's busy we fall back to 0 in a retry.
    const port = 30000 + Math.floor(Math.random() * 5000);
    let chosen: number;
    try {
      await bootAndUse(defaultOptions({ port }), async (handle) => {
        chosen = handle.address.port;
        assert.equal(chosen, port, 'expected handle.address.port to match the requested port');
      });
    } catch (err) {
      // If the OS rejected the port (rare on CI), retry on port 0 so
      // the test still asserts the binding round-trip.
      const message = err instanceof Error ? err.message : String(err);
      if (!/EADDRINUSE|EACCES/.test(message)) throw err;
      await bootAndUse(defaultOptions({ port: 0 }), async (handle) => {
        assert.ok(handle.address.port > 0);
      });
    }
  });

  it('reports db: present when the DB exists, missing otherwise', async () => {
    // Variant 1 — DB absent (default state of the temp dir).
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.address.port}/api/health`);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body['db'], 'missing');
    });

    // Variant 2 — DB present (touch the file).
    const tmp2 = mkdtempSync(join(tmpdir(), 'skill-map-server-db-'));
    const presentDb = join(tmp2, 'skill-map.db');
    writeFileSync(presentDb, ''); // empty placeholder is enough — buildHealth only existsSync()s.
    try {
      await bootAndUse(defaultOptions({ dbPath: presentDb }), async (handle) => {
        const res = await fetch(`http://127.0.0.1:${handle.address.port}/api/health`);
        const body = (await res.json()) as Record<string, unknown>;
        assert.equal(body['db'], 'present');
      });
    } finally {
      rmSync(tmp2, { recursive: true, force: true });
    }
  });

  it('returns the structured error envelope for /api/<unknown>', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.address.port}/api/nonexistent`);
      assert.equal(res.status, 404);
      const body = (await res.json()) as { ok: boolean; error: { code: string; message: string; details: unknown } };
      assert.equal(body.ok, false);
      assert.equal(body.error.code, 'not-found');
      assert.equal(typeof body.error.message, 'string');
      assert.ok('details' in body.error, 'envelope must carry details key');
    });
  });

  it('accepts a /ws upgrade and closes with code 1000 + reason "no broadcaster yet"', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      // Use the `ws` package's WebSocket client (the same library that
      // backs the server). The 14.1 no-op handler closes the connection
      // immediately on `onOpen` with code 1000 + reason 'no broadcaster
      // yet' — both surfaces are observable on the client `close` event.
      const { WebSocket } = await import('ws');
      const url = `ws://127.0.0.1:${handle.address.port}/ws`;
      const result = await new Promise<{ code: number; reason: string }>((resolveConn, rejectConn) => {
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
          ws.terminate();
          rejectConn(new Error('WS handshake / close timed out'));
        }, 2000);
        ws.on('close', (code, reasonBuf) => {
          clearTimeout(timeout);
          resolveConn({ code, reason: reasonBuf.toString('utf-8') });
        });
        ws.on('error', (err) => {
          clearTimeout(timeout);
          rejectConn(err);
        });
      });
      assert.equal(result.code, 1000, `expected close code 1000, got ${result.code}`);
      assert.equal(
        result.reason,
        'no broadcaster yet',
        `expected close reason "no broadcaster yet", got ${JSON.stringify(result.reason)}`,
      );
    });
  });

  it('shuts down within 1s without leaking connections', async () => {
    const handle = await createServer(defaultOptions());
    // Open + drop a connection so close() has to wait on it (or kick it).
    const probeRes = await fetch(`http://127.0.0.1:${handle.address.port}/api/health`);
    assert.equal(probeRes.status, 200);
    await probeRes.text();

    const startedAt = Date.now();
    await handle.close();
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < 1000, `expected close < 1000ms, got ${elapsed}ms`);

    // A second close() must be idempotent.
    await handle.close();
  });

  it('serves the inline placeholder at "/" when uiDist is null', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.address.port}/`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.match(text, /skill-map server is running/);
      assert.match(text, /<meta name="skill-map-mode" content="live"/);
    });
  });
});
