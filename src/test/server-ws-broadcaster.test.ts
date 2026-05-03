/**
 * Step 14.4.a — `WsBroadcaster` unit tests.
 *
 * These exercise the broadcaster against fake `IBroadcasterClient`
 * implementations — no real `WebSocket`, no `createServer()`. The
 * end-to-end path (real WS upgrade against a booted server, watcher
 * batch → broadcast → received frame) lives in
 * `server-ws-integration.test.ts`.
 *
 * Coverage targets:
 *
 *   - register / unregister / clientCount accounting.
 *   - `broadcast` fans out to every open client, JSON-stringifying once.
 *   - `broadcast` skips clients whose `readyState` is not OPEN.
 *   - Per-client `send()` failure does not stop the rest of the fan-out.
 *   - Backpressure eviction at the documented threshold.
 *   - `shutdown()` closes every client with code 1001 + reason
 *     `'server shutdown'` and is idempotent.
 *   - Post-shutdown `register()` immediately closes the offered socket.
 *   - Serialization failure (a circular envelope) drops the event
 *     without throwing.
 */

import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import {
  WsBroadcaster,
  WS_BACKPRESSURE_BYTES,
  type IBroadcasterClient,
} from '../server/broadcaster.js';
import { resetLogger } from '../kernel/util/logger.js';

interface ICloseCall {
  code: number | undefined;
  reason: string | undefined;
}

interface IFakeClient extends IBroadcasterClient {
  sent: string[];
  closeCalls: ICloseCall[];
  failNextSend?: boolean;
}

function makeFakeClient(
  overrides: Partial<Pick<IFakeClient, 'bufferedAmount' | 'readyState'>> = {},
): IFakeClient {
  const sent: string[] = [];
  const closeCalls: ICloseCall[] = [];
  const client: IFakeClient = {
    sent,
    closeCalls,
    bufferedAmount: overrides.bufferedAmount ?? 0,
    readyState: overrides.readyState ?? 1,
    send(data: string): void {
      if (this.failNextSend) {
        this.failNextSend = false;
        throw new Error('synthetic send failure');
      }
      sent.push(data);
    },
    close(code, reason): void {
      closeCalls.push({ code, reason });
    },
  };
  return client;
}

afterEach(() => {
  // The broadcaster routes warnings through the kernel logger
  // singleton; reset to SilentLogger between tests so a stray
  // configureLogger from another test file doesn't bleed in.
  resetLogger();
});

describe('WsBroadcaster — register / unregister / clientCount', () => {
  it('starts with zero clients', () => {
    const b = new WsBroadcaster();
    assert.equal(b.clientCount, 0);
  });

  it('register increments clientCount', () => {
    const b = new WsBroadcaster();
    b.register(makeFakeClient());
    b.register(makeFakeClient());
    assert.equal(b.clientCount, 2);
  });

  it('register is idempotent for the same client instance (Set semantics)', () => {
    const b = new WsBroadcaster();
    const c = makeFakeClient();
    b.register(c);
    b.register(c);
    assert.equal(b.clientCount, 1);
  });

  it('unregister decrements clientCount; double-unregister is a no-op', () => {
    const b = new WsBroadcaster();
    const c = makeFakeClient();
    b.register(c);
    b.unregister(c);
    b.unregister(c);
    assert.equal(b.clientCount, 0);
  });
});

describe('WsBroadcaster — broadcast fan-out', () => {
  it('serializes the envelope once and delivers to every open client', () => {
    const b = new WsBroadcaster();
    const a = makeFakeClient();
    const b1 = makeFakeClient();
    const c = makeFakeClient();
    b.register(a);
    b.register(b1);
    b.register(c);
    const env = { type: 'scan.started', data: { roots: ['.'] } };
    b.broadcast(env);
    const expected = JSON.stringify(env);
    assert.deepEqual(a.sent, [expected]);
    assert.deepEqual(b1.sent, [expected]);
    assert.deepEqual(c.sent, [expected]);
  });

  it('skips clients whose readyState is not OPEN', () => {
    const b = new WsBroadcaster();
    const open = makeFakeClient({ readyState: 1 });
    const closing = makeFakeClient({ readyState: 2 });
    const closed = makeFakeClient({ readyState: 3 });
    b.register(open);
    b.register(closing);
    b.register(closed);
    b.broadcast({ type: 'x' });
    assert.equal(open.sent.length, 1);
    assert.equal(closing.sent.length, 0);
    assert.equal(closed.sent.length, 0);
    // Non-OPEN clients are evicted as a side effect.
    assert.equal(b.clientCount, 1);
  });

  it('continues fan-out when one client throws on send', () => {
    const b = new WsBroadcaster();
    const a = makeFakeClient();
    const failing = makeFakeClient();
    failing.failNextSend = true;
    const c = makeFakeClient();
    b.register(a);
    b.register(failing);
    b.register(c);
    b.broadcast({ type: 'x' });
    assert.equal(a.sent.length, 1, 'first client should receive');
    assert.equal(failing.sent.length, 0, 'failing client should not have stored');
    assert.equal(c.sent.length, 1, 'third client should still receive');
    // Failing client is evicted + closed.
    assert.equal(b.clientCount, 2);
    assert.equal(failing.closeCalls.length, 1);
  });

  it('does not throw when broadcast is called with zero clients', () => {
    const b = new WsBroadcaster();
    assert.doesNotThrow(() => b.broadcast({ type: 'noop' }));
  });

  it('deserialized broadcast frame matches the envelope shape', () => {
    const b = new WsBroadcaster();
    const c = makeFakeClient();
    b.register(c);
    const env = {
      type: 'scan.completed',
      timestamp: '2026-05-02T10:00:00.000Z',
      data: { stats: { nodes: 3, links: 2, issues: 0, durationMs: 12 } },
    };
    b.broadcast(env);
    assert.equal(c.sent.length, 1);
    assert.deepEqual(JSON.parse(c.sent[0]!), env);
  });
});

describe('WsBroadcaster — backpressure eviction', () => {
  it('evicts a client whose bufferedAmount exceeds the threshold', () => {
    const b = new WsBroadcaster();
    const wedged = makeFakeClient({ bufferedAmount: WS_BACKPRESSURE_BYTES + 1 });
    const healthy = makeFakeClient();
    b.register(wedged);
    b.register(healthy);
    b.broadcast({ type: 'x' });
    assert.equal(wedged.sent.length, 0, 'wedged client should not receive');
    assert.equal(healthy.sent.length, 1);
    assert.equal(b.clientCount, 1, 'wedged client should be evicted');
    assert.equal(wedged.closeCalls.length, 1);
    assert.equal(wedged.closeCalls[0]!.code, 1009, 'eviction uses RFC 6455 code 1009');
  });

  it('does NOT evict a client at exactly the threshold (strict greater-than)', () => {
    const b = new WsBroadcaster();
    const c = makeFakeClient({ bufferedAmount: WS_BACKPRESSURE_BYTES });
    b.register(c);
    b.broadcast({ type: 'x' });
    assert.equal(c.sent.length, 1);
    assert.equal(b.clientCount, 1);
  });
});

describe('WsBroadcaster — shutdown', () => {
  it('closes every connected client with code 1001 + reason "server shutdown"', () => {
    const b = new WsBroadcaster();
    const a = makeFakeClient();
    const c = makeFakeClient();
    b.register(a);
    b.register(c);
    b.shutdown();
    assert.equal(b.clientCount, 0);
    assert.equal(a.closeCalls.length, 1);
    assert.equal(a.closeCalls[0]!.code, 1001);
    assert.equal(a.closeCalls[0]!.reason, 'server shutdown');
    assert.equal(c.closeCalls.length, 1);
    assert.equal(c.closeCalls[0]!.code, 1001);
  });

  it('is idempotent', () => {
    const b = new WsBroadcaster();
    const c = makeFakeClient();
    b.register(c);
    b.shutdown();
    b.shutdown();
    assert.equal(c.closeCalls.length, 1, 'second shutdown should not re-close');
  });

  it('post-shutdown register immediately closes the offered client', () => {
    const b = new WsBroadcaster();
    b.shutdown();
    const c = makeFakeClient();
    b.register(c);
    assert.equal(b.clientCount, 0, 'client should not be registered post-shutdown');
    assert.equal(c.closeCalls.length, 1);
    assert.equal(c.closeCalls[0]!.code, 1001);
  });

  it('post-shutdown broadcast is a no-op', () => {
    const b = new WsBroadcaster();
    const c = makeFakeClient();
    b.register(c);
    b.shutdown();
    // c is now closed (and unregistered), but broadcast should still
    // be safe to call.
    assert.doesNotThrow(() => b.broadcast({ type: 'late' }));
    assert.equal(c.sent.length, 0);
  });
});

describe('WsBroadcaster — serialization failure handling', () => {
  it('drops a circular envelope without throwing', () => {
    const b = new WsBroadcaster();
    const c = makeFakeClient();
    b.register(c);
    interface IRecursive { self?: IRecursive }
    const circular: IRecursive = {};
    circular.self = circular;
    assert.doesNotThrow(() => b.broadcast(circular));
    assert.equal(c.sent.length, 0, 'no frame should be delivered');
    assert.equal(b.clientCount, 1, 'client should remain registered');
  });
});
