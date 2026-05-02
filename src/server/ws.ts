/**
 * WebSocket route registrar for `/ws` — Hono BFF integration surface.
 *
 * **14.1 surface — no-op:** the endpoint accepts the upgrade and
 * immediately closes the socket with code 1000 (normal closure) and
 * reason `'no broadcaster yet'`. The real broadcaster (chokidar batches
 * → fan-out) lands at Step 14.4.
 *
 * Why this file exists as a thin registrar over a single Hono route:
 *
 *   - The single-port mandate (`/api/*` + `/ws` + SPA bundle under one
 *     listener) is the architectural invariant; wiring a real `/ws`
 *     route at 14.1 means 14.2 / 14.3 tests can connect to `/ws` without
 *     any additional plumbing.
 *   - The Angular SPA at 14.3 will already attempt to open the socket
 *     during bootstrap; a 404 on `/ws` would force a code-path branch
 *     that 14.4 has to undo.
 *   - Keeping the route in a dedicated file documents the handler
 *     boundary for future readers — at 14.4 the `noopWebSocketRoute`
 *     call in the composition root flips to a one-line replacement
 *     (e.g. `attachWatchBroadcasterRoute(app, broadcaster)`) without
 *     touching `app.ts`.
 *
 * Implementation: uses the official `upgradeWebSocket` re-exported from
 * `@hono/node-server` (v2.x absorbed WebSocket support natively; the
 * separate `@hono/node-ws` package is deprecated as of node-server@2.0).
 * The composition root (`index.ts`) creates a `WebSocketServer({ noServer: true })`
 * and passes it via `serve({ websocket: { server: wss } })` — node-server
 * wires the http `'upgrade'` listener internally and routes the upgrade
 * through the Hono fetch pipeline. Our handler receives a `ws` context
 * with `close(code, reason)` plus the lifecycle hooks (`onOpen`, `onMessage`,
 * `onClose`, `onError`) used by 14.4 for the broadcaster.
 *
 * Loopback-only assumption per Decision #119: no per-connection auth.
 * Multi-host `sm serve` re-opens post-v0.6.0 alongside the auth model.
 */

import { upgradeWebSocket } from '@hono/node-server';
import type { Hono } from 'hono';

const WS_PATH = '/ws';
const NOOP_CLOSE_CODE = 1000; // RFC 6455 — normal closure
const NOOP_CLOSE_REASON = 'no broadcaster yet';

/**
 * Register the `/ws` no-op upgrade route on the given Hono app.
 *
 * Behaviour: accept the WebSocket upgrade, close immediately on `onOpen`
 * with code 1000 + reason `'no broadcaster yet'`. The connection is
 * gracefully terminated; the client sees `event.code === 1000` and
 * `event.reason === 'no broadcaster yet'`. 14.4 replaces this call with
 * the chokidar-fed broadcaster registrar.
 */
export function noopWebSocketRoute(app: Hono): void {
  app.get(
    WS_PATH,
    upgradeWebSocket(() => ({
      onOpen(_event, ws): void {
        ws.close(NOOP_CLOSE_CODE, NOOP_CLOSE_REASON);
      },
    })),
  );
}
