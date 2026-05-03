/**
 * `WsBroadcaster` — owns the set of connected `/ws` clients and fans
 * one event payload out to all of them.
 *
 * Step 14.4.a wiring:
 *
 *   1. `attachBroadcasterRoute(app, broadcaster)` (in `ws.ts`) registers
 *      the upgrade handler. On every `onOpen`, the handler hands the raw
 *      `WebSocket` to `broadcaster.register(ws)`. On `onClose` / `onError`,
 *      the handler calls `broadcaster.unregister(ws)`.
 *   2. `WatcherService` (in `watcher.ts`) subscribes a `ProgressEmitterPort`
 *      bridge that calls `broadcaster.broadcast(envelope)` for every
 *      `scan.*` event the kernel orchestrator emits during a debounced
 *      batch's scan.
 *   3. `createServer` (`index.ts`) instantiates one broadcaster per server
 *      and threads it into `IAppDeps`. `handle.close()` calls
 *      `broadcaster.shutdown()` which drains all connected sockets with
 *      close code 1001 + reason `'server shutdown'`.
 *
 * The class is a TS-only public surface — name has no `I*` prefix per
 * AGENTS.md §Type naming convention category 4 grandfathering.
 *
 * Backpressure: each `broadcast` call inspects every client's
 * `bufferedAmount`. A client whose buffer exceeds `MAX_BUFFERED_BYTES`
 * is closed with code 1009 (`'message too big'`) and unregistered. The
 * threshold (`4 MiB`) is high enough to absorb a normal browser refresh
 * mid-batch and low enough to evict a frozen client before memory grows
 * unbounded.
 *
 * Why a class (not a factory) for this surface: the broadcaster carries
 * mutable per-instance state (the connected-clients Set) AND a clear
 * lifecycle (`register` / `broadcast` / `unregister` / `shutdown`).
 * Factories are the convention for adapters that implement a port; this
 * is a plain BFF helper that does not implement any kernel port. AGENTS.md
 * §Adapter wiring rule 5 explicitly scopes factories to "adapters
 * consumed via ports", which this isn't.
 */

import type { WebSocket } from 'ws';

import { sanitizeForTerminal } from '../kernel/util/safe-text.js';
import { log } from '../kernel/util/logger.js';
import { tx } from '../kernel/util/tx.js';
import { SERVER_TEXTS } from './i18n/server.texts.js';

/**
 * Backpressure threshold. A client whose `WebSocket.bufferedAmount`
 * exceeds this value when `broadcast()` runs is treated as frozen — the
 * broadcaster closes it with RFC 6455 code `1009` ('message too big')
 * and unregisters it so the next batch doesn't re-trip the check.
 *
 * 4 MiB chosen after walking through the worst-case event sequence for a
 * normal browser refresh (single `scan.completed` carrying the
 * `ScanResult.stats` block — well under 1 KB; `scan.started` carrying
 * roots — same scale). A frozen client at 4 MiB has missed thousands of
 * batches; saving its session is no longer the right call.
 */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

/** RFC 6455 — going away (server shutdown). */
const CLOSE_CODE_GOING_AWAY = 1001;
/** RFC 6455 — message too big (used for the backpressure eviction). */
const CLOSE_CODE_MESSAGE_TOO_BIG = 1009;

/**
 * Minimal WebSocket subset the broadcaster relies on. Lets the
 * broadcaster unit tests inject a fake without dragging the full `ws`
 * client surface into every fixture.
 */
export interface IBroadcasterClient {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  /** Per `ws@8.x`. Bytes queued by the OS but not yet flushed. */
  bufferedAmount: number;
  /** Per `ws@8.x`. `0` connecting, `1` open, `2` closing, `3` closed. */
  readyState: number;
}

/** `WebSocket.OPEN` numeric value per the standard / `ws` exports. */
const READY_STATE_OPEN = 1;

export class WsBroadcaster {
  readonly #clients = new Set<IBroadcasterClient>();
  #shutDown = false;

  /** Number of currently-registered clients. Read-only — for tests / `/api/health`. */
  get clientCount(): number {
    return this.#clients.size;
  }

  /**
   * Register a client. Called from the `/ws` `onOpen` handler with the
   * raw `WebSocket` instance. After shutdown the broadcaster refuses
   * new registrations and immediately closes the offered socket so a
   * late upgrade doesn't leak.
   */
  register(ws: IBroadcasterClient): void {
    if (this.#shutDown) {
      try {
        ws.close(CLOSE_CODE_GOING_AWAY, 'server shutdown');
      } catch {
        // ignore — the socket may already be closed
      }
      return;
    }
    this.#clients.add(ws);
  }

  /**
   * Unregister a client. Called from the `/ws` `onClose` / `onError`
   * handlers and from the backpressure path. Idempotent — calling on a
   * client that was never registered (or was already removed) is a no-op.
   */
  unregister(ws: IBroadcasterClient): void {
    this.#clients.delete(ws);
  }

  /**
   * Serialize the envelope once and fan out to every open client.
   * Closed / closing clients are silently skipped (the `onClose` handler
   * has already removed them, but we double-check `readyState` because a
   * close in the middle of the loop is observable as a transient
   * `OPEN → CLOSING` flip).
   *
   * Per-client `send()` failures are caught: one rogue socket cannot
   * stop the rest from receiving the event. A failing socket is closed
   * + unregistered so the next broadcast doesn't waste cycles on it.
   *
   * Backpressure check (per AGENTS.md §Watcher integration): if a
   * client's `bufferedAmount` exceeds `MAX_BUFFERED_BYTES`, it's evicted
   * with close code 1009. The check runs BEFORE `send` so the threshold
   * acts as an admission gate, not a post-mortem.
   */
  broadcast(envelope: unknown): void {
    if (this.#shutDown) return;
    let payload: string;
    try {
      payload = JSON.stringify(envelope);
    } catch (err) {
      // Serialization failure — emit a single advisory log line and
      // drop the event. Per spec/job-events.md §Error handling, a
      // synthetic `emitter.error` event is the right shape; v14.4.a
      // does not yet route emitter errors through the broadcaster
      // itself (that would re-enter the same `JSON.stringify` path),
      // so we degrade to a logged warning.
      const message = err instanceof Error ? err.message : String(err);
      log.warn(
        tx(SERVER_TEXTS.wsBroadcastSerializeFailed, {
          message: sanitizeForTerminal(message),
        }),
      );
      return;
    }

    // Snapshot the iterator so a `delete` during iteration (from the
    // backpressure / send-failure paths below) doesn't perturb the
    // walk. `Set` iteration is safe under deletion in modern Node, but
    // an explicit copy makes the intent obvious.
    const snapshot = Array.from(this.#clients);
    for (const client of snapshot) {
      this.#deliver(client, payload);
    }
  }

  /**
   * Drain every connected socket with code 1001 ('going away') + reason
   * `'server shutdown'`. Idempotent — a second call after the first
   * `shutdown()` is a no-op. After shutdown, `register()` immediately
   * closes any new client offered.
   */
  shutdown(): void {
    if (this.#shutDown) return;
    this.#shutDown = true;
    const snapshot = Array.from(this.#clients);
    this.#clients.clear();
    for (const client of snapshot) {
      try {
        client.close(CLOSE_CODE_GOING_AWAY, 'server shutdown');
      } catch {
        // ignore — already closing / closed
      }
    }
  }

  /**
   * Per-client delivery: backpressure check, then `send()`. Eviction +
   * unregistration on either failure mode.
   */
  #deliver(client: IBroadcasterClient, payload: string): void {
    if (client.readyState !== READY_STATE_OPEN) {
      this.#clients.delete(client);
      return;
    }
    if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.#clients.delete(client);
      try {
        client.close(CLOSE_CODE_MESSAGE_TOO_BIG, 'backpressure exceeded');
      } catch {
        // ignore
      }
      log.warn(
        tx(SERVER_TEXTS.wsBackpressureEvicted, {
          buffered: String(client.bufferedAmount),
          threshold: String(MAX_BUFFERED_BYTES),
        }),
      );
      return;
    }
    try {
      client.send(payload);
    } catch (err) {
      this.#clients.delete(client);
      try {
        client.close();
      } catch {
        // ignore
      }
      const message = err instanceof Error ? err.message : String(err);
      log.warn(
        tx(SERVER_TEXTS.wsClientSendFailed, {
          message: sanitizeForTerminal(message),
        }),
      );
    }
  }
}

/** Re-export for tests that want the eviction threshold without importing the constant. */
export const WS_BACKPRESSURE_BYTES = MAX_BUFFERED_BYTES;
