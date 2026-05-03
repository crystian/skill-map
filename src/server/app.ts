/**
 * Hono app construction — the BFF's request pipeline assembled in the
 * exact order the single-port mandate requires.
 *
 * Route registration order (matters — Hono matches in declaration order):
 *
 *   1. `GET  /api/health`            → real handler (`routes/health.ts`).
 *   2. `GET  /api/scan[?fresh=1]`    → persisted ScanResult (or fresh in-memory).
 *   3. `GET  /api/nodes/:pathB64`    → single-node detail bundle.
 *   4. `GET  /api/nodes`             → paginated, filtered node list.
 *   5. `GET  /api/links`             → filtered link list.
 *   6. `GET  /api/issues`            → filtered issue list.
 *   7. `GET  /api/graph?format=...`  → formatter-rendered graph.
 *   8. `GET  /api/config`            → merged effective config.
 *   9. `GET  /api/plugins`           → installed plugins + load status.
 *  10. `ALL  /api/*` (catch-all)     → 404 with structured error envelope.
 *  11. `GET  /ws`                    → WebSocket upgrade (registered via
 *                                       `deps.attachWs(app)` — at 14.1 the
 *                                       no-op closer; at 14.4 the
 *                                       chokidar broadcaster).
 *  12. `GET  *` (static)             → `serveStatic` rooted at `uiDist`.
 *  13. `GET  *` (SPA fallback)       → `index.html` for any other GET.
 *
 * `/ws` is a real Hono route — `@hono/node-server@2.x` natively
 * supports WebSocket upgrades through its built-in `upgradeWebSocket`
 * helper. The Node http `'upgrade'` listener is wired by node-server
 * itself when `serve({ websocket: { server: wss } })` is called from
 * the composition root.
 *
 * Error envelope (mirrors `cli-contract.md` §Machine-readable output rules):
 *
 *   ```json
 *   {
 *     "ok": false,
 *     "error": { "code": "<short>", "message": "<human>", "details": { ... } | null }
 *   }
 *   ```
 *
 * `app.onError` funnels every uncaught throw through this shape:
 *
 *   - `HTTPException(404)`    → `code: 'not-found'`.
 *   - `HTTPException(400)`    → `code: 'bad-query'`.
 *   - `ExportQueryError`      → `code: 'bad-query'`, `status: 400`.
 *   - any other status / `Error` → `code: 'internal'`, `status: 500`.
 *
 * `formatErrorMessage` from the CLI's error reporter ensures the
 * server-side log line matches the CLI's `*.texts.ts` framing — same
 * vocabulary across both surfaces.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode, StatusCode } from 'hono/utils/http-status';

import { formatErrorMessage } from '../cli/util/error-reporter.js';
import type { IRuntimeContext } from '../cli/util/runtime-context.js';
import { ExportQueryError } from '../kernel/index.js';
import type { WsBroadcaster } from './broadcaster.js';
import type { IKindRegistry } from './envelope.js';
import type { IServerOptions } from './options.js';
import { registerConfigRoute } from './routes/config.js';
import type { IRouteDeps } from './routes/deps.js';
import { registerGraphRoute } from './routes/graph.js';
import { registerHealthRoute } from './routes/health.js';
import { registerIssuesRoute } from './routes/issues.js';
import { registerLinksRoute } from './routes/links.js';
import { registerNodesRoutes } from './routes/nodes.js';
import { registerPluginsRoute } from './routes/plugins.js';
import { registerScanRoute } from './routes/scan.js';
import { createSpaFallback, createStaticHandler } from './static.js';
import { attachBroadcasterRoute } from './ws.js';

export type TErrorCode = 'not-found' | 'bad-query' | 'db-missing' | 'internal';

export interface IErrorEnvelope {
  ok: false;
  error: {
    code: TErrorCode;
    message: string;
    details: unknown | null;
  };
}

export interface IAppDeps {
  options: IServerOptions;
  /** Pre-resolved spec version threaded through to `/api/health`. */
  specVersion: string;
  /**
   * The `/ws` broadcaster. Step 14.4.a wires `attachBroadcasterRoute`
   * inside `createApp` against this instance; the composition root
   * (`createServer`) owns its lifecycle (instantiate → register → close
   * via `broadcaster.shutdown()`).
   */
  broadcaster: WsBroadcaster;
  /**
   * Runtime context (`cwd`, `homedir`) consumed by the read-side routes.
   * `loadConfig` for `/api/config` and the fresh-scan branch of
   * `/api/scan` both need it; the kernel never reads `process.*`
   * itself. Threaded in by the composition root via `defaultRuntimeContext()`.
   */
  runtimeContext: IRuntimeContext;
  /**
   * Registry of kinds active in the current scope (Step 14.5.d).
   * Composition root builds it once at boot from every enabled
   * Provider via `buildKindRegistry`; every payload-bearing envelope
   * embeds it so the UI never has to hardcode kind visuals. Sentinel
   * envelopes (`health`, `scan`, `graph`) stay exempt.
   */
  kindRegistry: IKindRegistry;
}

/**
 * Build the Hono app. Pure factory — every dependency comes through
 * `deps`. The composition root (`createServer`) is the only place
 * that reads env / globals.
 */
export function createApp(deps: IAppDeps): Hono {
  const app = new Hono();

  // Permissive CORS for the dev workflow — `--dev-cors` only ever
  // applies to a loopback host (validated in `options.ts`), so this
  // never widens the attack surface beyond the local machine.
  if (deps.options.devCors) {
    app.use('*', async (c, next) => {
      await next();
      c.res.headers.set('access-control-allow-origin', '*');
      c.res.headers.set('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
      c.res.headers.set('access-control-allow-headers', 'content-type, authorization');
    });
    app.options('*', (c) => c.body(null, 204));
  }

  // 1. /api/health — liveness / version probe.
  registerHealthRoute(app, { options: deps.options, specVersion: deps.specVersion });

  // 2-9. /api/* — Step 14.2 read-side endpoints. Order matters for
  //      the `/api/nodes/:pathB64` vs `/api/nodes` pair (see
  //      `routes/nodes.ts` — single first, list second).
  const routeDeps: IRouteDeps = {
    options: deps.options,
    runtimeContext: deps.runtimeContext,
    kindRegistry: deps.kindRegistry,
  };
  registerScanRoute(app, routeDeps);
  registerNodesRoutes(app, routeDeps);
  registerLinksRoute(app, routeDeps);
  registerIssuesRoute(app, routeDeps);
  registerGraphRoute(app, routeDeps);
  registerConfigRoute(app, routeDeps);
  registerPluginsRoute(app, routeDeps);

  // 10. /api/* (catch-all) — every other API path returns the structured
  //     404 envelope. Keeps the contract honest as new endpoints land in
  //     post-14.2 sub-steps.
  app.all('/api/*', (c) => {
    throw new HTTPException(404, { message: `Unknown API endpoint: ${c.req.path}` });
  });

  // 3. /ws — WebSocket upgrade route. Must be declared BEFORE the
  //    static handler so a literal `/ws` path on disk in `uiDist`
  //    cannot accidentally shadow the upgrade route.
  attachBroadcasterRoute(app, deps.broadcaster);

  // 4. Static + 5. SPA fallback. Order matters: the static handler
  //    short-circuits on a real file match; everything else falls
  //    through to the SPA fallback (which serves index.html).
  app.use('*', createStaticHandler(deps.options.uiDist));
  app.get('*', createSpaFallback(deps.options.uiDist));

  app.notFound((c) => {
    throw new HTTPException(404, { message: `Not found: ${c.req.path}` });
  });

  app.onError((err, c) => {
    return formatError(err, c);
  });

  return app;
}

function codeForStatus(status: number): TErrorCode {
  if (status === 404) return 'not-found';
  if (status === 400) return 'bad-query';
  return 'internal';
}

function formatError(err: unknown, c: Context): Response {
  if (err instanceof HTTPException) {
    const status = err.status as StatusCode;
    const envelope: IErrorEnvelope = {
      ok: false,
      error: {
        code: codeForStatus(status),
        message: err.message,
        details: null,
      },
    };
    return c.json(envelope, status as ContentfulStatusCode);
  }

  // `ExportQueryError` is the kernel's contract for malformed query
  // input — `parseExportQuery` throws it from inside
  // `urlParamsToExportQuery`. Map to 400 `bad-query` so the user sees
  // the same envelope shape as a `HTTPException(400)` thrown by a
  // route handler.
  if (err instanceof ExportQueryError) {
    const envelope: IErrorEnvelope = {
      ok: false,
      error: {
        code: 'bad-query',
        message: err.message,
        details: null,
      },
    };
    return c.json(envelope, 400);
  }

  const envelope: IErrorEnvelope = {
    ok: false,
    error: {
      code: 'internal',
      message: formatErrorMessage(err),
      details: null,
    },
  };
  return c.json(envelope, 500);
}
