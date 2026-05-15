/**
 * WebSocket route registrar for `/ws` — Hono BFF integration surface.
 *
 * The actual WebSocket upgrade is handled by `Bun.serve()` in
 * `index.ts` (the composition root), one layer above Hono. By the time
 * an `/ws` request reaches the Hono pipeline, the upgrade has already
 * been routed away — this handler only sees requests that bypassed the
 * upgrade path (e.g. a non-upgrade GET hitting `/ws`).
 *
 * Behavior:
 *
 *   - Returns `426 Upgrade Required` so callers know `/ws` exists but
 *     needs the WebSocket handshake to enter.
 *
 * The function still takes the broadcaster as a parameter so the wiring
 * in `app.ts` stays unchanged — historically the route held the
 * broadcaster registration logic. Today the registration happens in
 * `index.ts:listenAsync`'s `websocket.open` callback, where Bun
 * surfaces the upgraded socket directly.
 */

import type { Hono } from 'hono';

import type { WsBroadcaster } from './broadcaster.js';

const WS_PATH = '/ws';

export function attachBroadcasterRoute(app: Hono, _broadcaster: WsBroadcaster): void {
  app.get(WS_PATH, (c) => {
    return c.text('upgrade required', 426, { Upgrade: 'websocket' });
  });
}
