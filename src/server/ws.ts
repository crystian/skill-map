/**
 * WebSocket route registrar for `/ws` — Hono BFF integration surface.
 *
 * **14.4.a surface**: registers each accepted upgrade with the
 * `WsBroadcaster`. The broadcaster fans `scan.*` events from the
 * chokidar-backed `WatcherService` (see `watcher.ts`) out to every
 * connected client. The client never sends frames TO the server at
 * 14.4.a — the channel is server-push only.
 *
 * **14.1 surface (replaced)**: a no-op handler that closed every
 * connection on `onOpen` with code 1000 + reason `'no broadcaster yet'`.
 *
 * Implementation: uses the `upgradeWebSocket` helper exported by
 * `@hono/node-server@2.x`. The composition root (`index.ts`) creates a
 * `WebSocketServer({ noServer: true })` and passes it to
 * `serve({ websocket: { server: wss } })` — node-server wires the http
 * `'upgrade'` listener internally and routes the upgrade through the
 * Hono fetch pipeline. Our handler receives a `WSContext` whose `raw`
 * field carries the underlying `ws` library `WebSocket` instance —
 * that's the object the broadcaster fans `send()` calls out to.
 *
 * **Connection lifecycle**:
 *
 *   1. Client connects to `/ws`. node-server completes the WS handshake.
 *   2. Hono fires `onOpen(_event, ws)`. We grab `ws.raw` (the underlying
 *      `WebSocket` from the `ws` package) and register it on the
 *      broadcaster.
 *   3. Server pushes events via the broadcaster. The client never sends
 *      frames at 14.4.a — `onMessage` is intentionally not registered.
 *      A future client-initiated heartbeat / subscribe / filter request
 *      lands at 14.4.b or later.
 *   4. On `onClose` / `onError` we unregister the client. The broadcaster
 *      tolerates double-unregister (it's a `Set.delete` — idempotent).
 *   5. On server shutdown, `WsBroadcaster.shutdown()` closes every client
 *      with code 1001 ('going away') + reason `'server shutdown'`.
 *
 * **Loopback-only assumption per Decision #119**: no per-connection
 * auth at v0.6.0. Multi-host `sm serve` re-opens post-v0.6.0 alongside
 * the auth model. The route accepts any upgrade reaching it; the
 * upstream `--host` enforcement (defaults to 127.0.0.1) is the security
 * boundary.
 */

import { upgradeWebSocket } from '@hono/node-server';
import type { Hono } from 'hono';
import type { WebSocket } from 'ws';

import { log } from '../kernel/util/logger.js';
import { sanitizeForTerminal } from '../kernel/util/safe-text.js';
import { tx } from '../kernel/util/tx.js';
import type { WsBroadcaster } from './broadcaster.js';
import { SERVER_TEXTS } from './i18n/server.texts.js';

const WS_PATH = '/ws';

/**
 * Register the `/ws` upgrade route on the Hono app and bridge every
 * accepted connection to the supplied broadcaster.
 *
 * **14.4.a behavior**: the handler accepts the upgrade, registers the
 * underlying `WebSocket` (via `WSContext.raw`) with the broadcaster on
 * `onOpen`, and unregisters it on `onClose` / `onError`. It does NOT
 * read inbound frames — the channel is server-push only at this stage.
 */
export function attachBroadcasterRoute(app: Hono, broadcaster: WsBroadcaster): void {
  app.get(
    WS_PATH,
    upgradeWebSocket(() => ({
      onOpen(_event, ws): void {
        // `ws.raw` is the underlying `ws` library WebSocket instance.
        // node-server@2.x exposes it on every WSContext (see
        // `node_modules/@hono/node-server/dist/index.d.mts` line 56:
        // `UpgradeWebSocket<WebSocket, ...>` parameterizes WSContext's
        // `raw` slot to the `ws` package `WebSocket` type).
        const raw = ws.raw as WebSocket | undefined;
        if (!raw) {
          // Defensive: in test rigs that mock the upgrade, `raw` may
          // be absent. The broadcaster's `IBroadcasterClient` interface
          // is structural, so we fall through to register the WSContext
          // shim itself; the test surface is satisfied because
          // WSContext exposes `send` / `close` / `readyState` directly.
          // bufferedAmount is missing on the shim, so back-pressure
          // checks degrade to "always under threshold" — acceptable
          // for the no-real-socket path.
          broadcaster.register({
            send: (data) => ws.send(data),
            close: (code, reason) => ws.close(code, reason),
            bufferedAmount: 0,
            readyState: ws.readyState,
          });
          return;
        }
        broadcaster.register(raw);
      },
      onClose(_event, ws): void {
        const raw = ws.raw as WebSocket | undefined;
        if (raw) broadcaster.unregister(raw);
      },
      onError(event, ws): void {
        const raw = ws.raw as WebSocket | undefined;
        if (raw) broadcaster.unregister(raw);
        const message = (event as unknown as { message?: string })?.message ?? 'unknown';
        log.warn(
          tx(SERVER_TEXTS.wsClientSendFailed, {
            message: sanitizeForTerminal(message),
          }),
        );
      },
    })),
  );
}
