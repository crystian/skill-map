/**
 * `createServer(opts)` — composition root for the Hono BFF.
 *
 * Returns a `ServerHandle` exposing the actual bound address (port 0 →
 * OS-assigned, so the caller reads the real port from
 * `handle.address.port`) and an idempotent `close()` for graceful
 * shutdown.
 *
 * Wiring:
 *
 *   1. Resolve the spec version once (async — `import('@skill-map/spec')`).
 *   2. Build the Hono app via `createApp(deps)` — that's the only place
 *      that knows about routes / middleware / error handlers. The
 *      composition root passes the `/ws` registrar in via `deps.attachWs`
 *      so 14.4's broadcaster can drop in without touching `app.ts`.
 *   3. Instantiate a `WebSocketServer({ noServer: true })` (the
 *      `noServer: true` flag is mandatory — node-server `serve()`
 *      throws if it isn't set; node-server owns the http `'upgrade'`
 *      listener and routes upgrades through Hono).
 *   4. Hand `app.fetch` + `{ websocket: { server: wss } }` to
 *      `@hono/node-server`'s `serve()` to get a Node `http.Server`
 *      bound on `host:port`. node-server attaches its own
 *      `server.on('close', () => wss.close())` automatically — closing
 *      the http server alone tears down the WS server too.
 *
 * The server NEVER reads `process.env` / `process.cwd()` / `homedir()` —
 * the CLI verb (`cli/commands/serve.ts`) is the only place that does
 * that. This keeps the BFF reusable from a future test harness that
 * boots it directly with a synthetic `IServerOptions`.
 */

import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';

import { defaultRuntimeContext, type IRuntimeContext } from '../cli/util/runtime-context.js';
import { createApp } from './app.js';
import { resolveSpecVersion } from './health.js';
import type { IServerOptions } from './options.js';
import { noopWebSocketRoute } from './ws.js';

export type { IServerOptions, IServerOptionsInput, TServerScope } from './options.js';
export { validateServerOptions, isLoopbackHost } from './options.js';
export { resolveDefaultUiDist, resolveExplicitUiDist, isUiBundleDir } from './paths.js';
export type { IHealthResponse, THealthDbState } from './health.js';
export type { IErrorEnvelope, TErrorCode } from './app.js';

export interface IServerAddress {
  host: string;
  port: number;
  family: string;
}

export interface ServerHandle {
  /** Address the listener actually bound to. `port` is the resolved value when `options.port === 0`. */
  address: IServerAddress;
  /** Graceful shutdown. Idempotent — calling twice resolves immediately on the second call. */
  close(): Promise<void>;
}

export interface ICreateServerOpts {
  /**
   * Optional runtime context override. Tests inject a tempdir cwd so
   * `loadConfig` / fresh-scan can be exercised against a controlled
   * scope. Production callers (the `sm serve` verb) leave it
   * undefined; the composition root falls back to
   * `defaultRuntimeContext()`.
   */
  runtimeContext?: IRuntimeContext;
}

export async function createServer(
  options: IServerOptions,
  extra: ICreateServerOpts = {},
): Promise<ServerHandle> {
  const specVersion = await resolveSpecVersion();
  const runtimeContext = extra.runtimeContext ?? defaultRuntimeContext();
  const app = createApp({
    options,
    specVersion,
    attachWs: noopWebSocketRoute,
    runtimeContext,
  });

  // `noServer: true` is mandatory — node-server's `setupWebSocket` throws
  // ("WebSocket server must be created with { noServer: true } option")
  // otherwise. node-server owns the http `'upgrade'` listener and runs
  // upgrades through the Hono fetch pipeline; the WSS only handles the
  // post-handshake socket lifecycle.
  const wss = new WebSocketServer({ noServer: true });
  const server = await listenAsync(app.fetch, wss, options.host, options.port);

  const addr = server.address();
  const address = normalizeAddress(addr, options.host, options.port);

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    // node-server registers `server.on('close', () => wss.close())`
    // inside `setupWebSocket`, so closing the http server also tears
    // down the WSS. We still call `wss.close()` defensively so a
    // future refactor that drops node-server's auto-cleanup hook
    // can't leak the WSS into the next test.
    await closeServer(server);
    wss.close();
  };

  return { address, close };
}

/**
 * Wrap `@hono/node-server`'s `serve(...)` in a promise that resolves
 * once the listener is actually bound. The base helper invokes the
 * `listeningListener` callback, but it doesn't surface bind errors —
 * we wire `'error'` ourselves so a port-in-use rejects cleanly instead
 * of leaking an unhandled error event.
 */
function listenAsync(
  fetchCallback: (req: Request) => Response | Promise<Response>,
  wss: WebSocketServer,
  host: string,
  port: number,
): Promise<Server> {
  return new Promise<Server>((resolveListen, rejectListen) => {
    let settled = false;
    const server = serve(
      {
        fetch: fetchCallback,
        hostname: host,
        port,
        websocket: { server: wss },
      },
      () => {
        if (settled) return;
        settled = true;
        // Detach the bind-time error listener — operational errors
        // after bind reach the request pipeline through `app.onError`,
        // not here.
        server.removeListener('error', onBindError);
        resolveListen(server);
      },
    ) as Server;

    const onBindError = (err: Error): void => {
      if (settled) return;
      settled = true;
      rejectListen(err);
    };
    server.once('error', onBindError);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolveClose, rejectClose) => {
    // `server.close()` waits for in-flight connections to settle. The
    // `closeAllConnections` call after it forces idle keep-alives to
    // drop so tests don't hang on the SPA's keep-alive pool.
    server.close((err) => {
      if (err) {
        rejectClose(err);
      } else {
        resolveClose();
      }
    });
    server.closeAllConnections?.();
  });
}

function normalizeAddress(addr: AddressInfo | string | null, fallbackHost: string, fallbackPort: number): IServerAddress {
  if (addr === null || typeof addr === 'string') {
    return { host: fallbackHost, port: fallbackPort, family: 'IPv4' };
  }
  return { host: addr.address, port: addr.port, family: addr.family };
}
