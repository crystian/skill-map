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
 *   2. Instantiate the `WsBroadcaster` — a fresh one per server.
 *   3. Build the Hono app via `createApp(deps)` — the only place that
 *      knows about routes / middleware / error handlers. The broadcaster
 *      flows through `IAppDeps`.
 *   4. Hand `app.fetch` to `Bun.serve` along with a `websocket` config.
 *      The fetch handler upgrades `/ws` requests with `server.upgrade()`
 *      before delegating everything else to the Hono pipeline.
 *   5. Unless `--no-watcher` is set, instantiate a `WatcherService`
 *      (chokidar-fed scan loop) and `start()` it. The watcher
 *      broadcasts `scan.*` events through the same broadcaster.
 *
 * `close()` shutdown order is intentional:
 *   1. `watcherService.stop()` — drains the in-flight scan batch
 *      cleanly so chokidar is not torn down mid-`runScan`.
 *   2. `broadcaster.shutdown()` — closes every connected WS client
 *      with code 1001 ('going away').
 *   3. `server.stop(true)` — closes the listener and forces any
 *      remaining active connections to drop.
 *
 * The server NEVER reads `process.env` / `process.cwd()` / `homedir()` —
 * the CLI verb (`cli/commands/serve.ts`) is the only place that does
 * that. This keeps the BFF reusable from a future test harness that
 * boots it directly with a synthetic `IServerOptions`.
 */

import type { Server as BunServer, ServerWebSocket } from 'bun';

import {
  composeScanExtensions,
  emptyPluginRuntime,
  loadPluginRuntime,
  type IPluginRuntimeBundle,
} from '../core/runtime/plugin-runtime.js';
import { defaultRuntimeContext, type IRuntimeContext } from '../core/runtime/runtime-context.js';
import { createKernel, type Kernel } from '../kernel/index.js';
import { formatErrorMessage } from '../kernel/util/format-error.js';
import { log } from '../kernel/util/logger.js';
import { sanitizeForTerminal } from '../kernel/util/safe-text.js';
import { tx } from '../kernel/util/tx.js';
import { createApp } from './app.js';
import { WsBroadcaster, type IBroadcasterClient } from './broadcaster.js';
import { resolveSpecVersion } from './health.js';
import { SERVER_TEXTS } from './i18n/server.texts.js';
import { buildKindRegistry } from './kind-registry.js';
import type { IServerOptions } from './options.js';
import { createWatcherService, type IWatcherServiceHandle } from './watcher.js';

export type { IServerOptions, IServerOptionsInput, TServerScope } from './options.js';
export { validateServerOptions, isLoopbackHost } from './options.js';
export { resolveDefaultUiDist, resolveExplicitUiDist, isUiBundleDir } from './paths.js';
export type { IHealthResponse, THealthDbState } from './health.js';
export type { IErrorEnvelope, TErrorCode } from './app.js';
export { WsBroadcaster, WS_BACKPRESSURE_BYTES, type IBroadcasterClient } from './broadcaster.js';
export { createWatcherService, type IWatcherServiceHandle } from './watcher.js';

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
  /**
   * The active broadcaster — exposed for tests that want to assert
   * `clientCount` / inject a synthetic event without touching internal
   * state. Production callers should not need this.
   */
  broadcaster: WsBroadcaster;
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

// Composition root: assemble broadcaster, app, server, watcher, and
// the close() handle. Each subsystem is its own conditional / try
// branch; collapsing them into fewer functions hides the boot order
// the file header documents. Budget intentionally lifted.
// eslint-disable-next-line complexity
export async function createServer(
  options: IServerOptions,
  extra: ICreateServerOpts = {},
): Promise<ServerHandle> {
  const specVersion = await resolveSpecVersion();
  const runtimeContext = extra.runtimeContext ?? defaultRuntimeContext();
  const broadcaster = new WsBroadcaster();
  const { pluginRuntime, kindRegistry, kernel } = await assembleBootBundle(
    options,
    runtimeContext,
  );

  const app = createApp({
    options,
    specVersion,
    broadcaster,
    runtimeContext,
    kindRegistry,
    pluginRuntime,
    kernel,
  });

  const server = await listenAsync(app.fetch, broadcaster, options.host, options.port);
  // Bun's `Server.hostname` / `port` are typed as possibly-undefined to
  // cover unix-socket servers; we always bind a TCP host:port, so fall
  // back to the requested values if Bun's typings stay conservative.
  const boundHost = server.hostname ?? options.host;
  const boundPort = server.port ?? options.port;
  const address: IServerAddress = {
    host: boundHost,
    port: boundPort,
    family: boundHost.includes(':') ? 'IPv6' : 'IPv4',
  };

  // Watcher boot — defaults on (Decision #121). On boot failure, log +
  // continue serving (the REST surface stays alive; the operator sees
  // the warning and can disable the watcher with --no-watcher to
  // continue work on the broken setup).
  let watcherService: IWatcherServiceHandle | null = null;
  if (!options.noWatcher) {
    const debounce = options.watcherDebounceMs;
    const svcOpts: Parameters<typeof createWatcherService>[0] = {
      options,
      runtimeContext,
      broadcaster,
    };
    if (debounce !== undefined) svcOpts.debounceMsOverride = debounce;
    const candidate = createWatcherService(svcOpts);
    try {
      await candidate.start();
      watcherService = candidate;
    } catch (err) {
      const message = formatErrorMessage(err);
      log.warn(
        tx(SERVER_TEXTS.watcherBootFailed, {
          message: sanitizeForTerminal(message),
        }),
      );
      // Best-effort cleanup of the partially-started watcher (chokidar
      // may have subscribed to roots even if the post-ready broadcast
      // threw).
      try {
        await candidate.stop();
      } catch {
        // ignore
      }
    }
  }

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    // Order matters — see file header §close().
    if (watcherService) {
      try {
        await watcherService.stop();
      } catch {
        // already logged inside stop()
      }
    }
    broadcaster.shutdown();
    server.stop(true);
  };

  return { address, close, broadcaster };
}

/**
 * Wrap `@hono/node-server`'s `serve(...)` in a promise that resolves
 * once the listener is actually bound. The base helper invokes the
 * `listeningListener` callback, but it doesn't surface bind errors —
 * we wire `'error'` ourselves so a port-in-use rejects cleanly instead
 * of leaking an unhandled error event.
 */
/**
 * Step 14.5.d / audit M3: load the plugin runtime ONCE at boot and
 * derive both (a) the cached bundle that every read-side route reuses
 * and (b) the kindRegistry assembled from every enabled Provider.
 *
 * Pre-M3 each of `/api/graph`, `/api/plugins`, `/api/scan?fresh=1` ran
 * the same FS walk + DB read + AJV compile per request. Cached here
 * once: an operator that installs a new plugin restarts `sm serve` —
 * matching the watcher's documented "loaded ONCE at watcher boot"
 * contract (`server/watcher.ts: createWatcherService` docstring) so
 * the BFF's plugin view never diverges from the watcher's.
 *
 * Plugin warnings are logged here once; the routes don't re-log them
 * (they used to, on every request — same warning twice, three times,
 * N times under load).
 */
async function assembleBootBundle(
  options: IServerOptions,
  runtimeContext: IRuntimeContext,
): Promise<{
  pluginRuntime: IPluginRuntimeBundle;
  kindRegistry: ReturnType<typeof buildKindRegistry>;
  kernel: Kernel;
}> {
  // R14 — thread the boot-time runtime context through to
  // `loadPluginRuntime` so plugin discovery walks the same `cwd` /
  // `homedir` the rest of the BFF resolves against. Without this the
  // loader silently falls back to `defaultRuntimeContext()` (which
  // reads `process.cwd()`) and the override on `IAppDeps.runtimeContext`
  // is ignored for plugin discovery + plugin-config layering.
  const pluginRuntime = options.noPlugins
    ? emptyPluginRuntime()
    : await loadPluginRuntime({ scope: options.scope, runtimeContext });
  for (const warn of pluginRuntime.warnings) {
    log.warn(sanitizeForTerminal(warn));
  }
  const composed = composeScanExtensions({
    noBuiltIns: options.noBuiltIns,
    pluginRuntime,
  });
  const kindRegistry = buildKindRegistry(composed?.providers ?? []);
  // Step 9.6.6 — instantiate a kernel at boot and stamp the runtime
  // annotation catalog onto it. The BFF's read-side routes are pure
  // projections of plugin-time discovery, so a single kernel populated
  // here matches the "loaded ONCE at boot" watcher contract: an
  // operator that installs a new plugin restarts `sm serve`. Routes
  // that need the catalog (`GET /api/annotations/registered`) read it
  // off this kernel via closure.
  const kernel = createKernel();
  kernel.setRegisteredAnnotationKeys(pluginRuntime.annotationContributions);
  return { pluginRuntime, kindRegistry, kernel };
}

/**
 * Each upgraded WebSocket carries its own broadcaster-client adapter on
 * `ws.data`, so `open` / `close` can register / unregister it without
 * needing a separate lookup table. The adapter implements
 * `IBroadcasterClient` (the structural surface the broadcaster
 * consumes) over Bun's `ServerWebSocket` API. `bufferedAmount` lives on
 * the Bun socket as `getBufferedAmount()`; we expose it as a getter so
 * the broadcaster's `client.bufferedAmount > MAX_BUFFERED_BYTES` check
 * keeps working unchanged.
 */
interface IWsData {
  client: IBroadcasterClient | null;
}

function adaptBunWs(ws: ServerWebSocket<IWsData>): IBroadcasterClient {
  return {
    send(data) {
      ws.send(data);
    },
    close(code, reason) {
      ws.close(code, reason);
    },
    get bufferedAmount() {
      return ws.getBufferedAmount();
    },
    get readyState() {
      return ws.readyState;
    },
  };
}

function listenAsync(
  fetchCallback: (req: Request) => Response | Promise<Response>,
  broadcaster: WsBroadcaster,
  host: string,
  port: number,
): Promise<BunServer<IWsData>> {
  return new Promise<BunServer<IWsData>>((resolveListen, rejectListen) => {
    try {
      const server = Bun.serve<IWsData, never>({
        hostname: host,
        port,
        fetch(req, srv) {
          const url = new URL(req.url);
          if (url.pathname === '/ws') {
            const ok = srv.upgrade(req, { data: { client: null } satisfies IWsData });
            if (ok) {
              // Bun handles the 101 response internally.
              return undefined;
            }
            return new Response('upgrade required', { status: 426 });
          }
          return fetchCallback(req);
        },
        websocket: {
          open(ws) {
            const client = adaptBunWs(ws);
            ws.data.client = client;
            broadcaster.register(client);
          },
          close(ws) {
            if (ws.data.client) {
              broadcaster.unregister(ws.data.client);
              ws.data.client = null;
            }
          },
          message() {
            // Server-push only; inbound frames are ignored at this stage.
          },
        },
      });
      resolveListen(server);
    } catch (err) {
      rejectListen(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
