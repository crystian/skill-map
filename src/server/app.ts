/**
 * Hono app construction — the BFF's request pipeline assembled in the
 * exact order the single-port mandate requires.
 *
 * Route registration order (matters — Hono matches in declaration order):
 *
 *   1. `GET  /api/health`            → real handler.
 *   2. `ALL  /api/*`                 → 404 with structured error envelope.
 *   3. `GET  /ws`                    → WebSocket upgrade (registered via
 *                                       `deps.attachWs(app)` — at 14.1 the
 *                                       no-op closer; at 14.4 the
 *                                       chokidar broadcaster).
 *   4. `GET  *` (static)             → `serveStatic` rooted at `uiDist`.
 *   5. `GET  *` (SPA fallback)       → `index.html` for any other GET.
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
import { buildHealth } from './health.js';
import type { IServerOptions } from './options.js';
import { createSpaFallback, createStaticHandler } from './static.js';

/**
 * Registrar called after the `/api/*` routes and before the static /
 * SPA fallback layers. The composition root passes the no-op closer at
 * 14.1; 14.4 swaps in the broadcaster registrar without touching this
 * file.
 */
export type TWsRegistrar = (app: Hono) => void;

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
  /** Registers the `/ws` route. 14.1: no-op closer. 14.4: broadcaster. */
  attachWs: TWsRegistrar;
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

  // 1. /api/health — the only real endpoint at 14.1.
  app.get('/api/health', (c) => {
    const payload = buildHealth({
      dbPath: deps.options.dbPath,
      scope: deps.options.scope,
      specVersion: deps.specVersion,
    });
    return c.json(payload);
  });

  // 2. /api/* — every other API path returns 404 in the structured
  //    envelope. Endpoints land at 14.2; the catch-all keeps the
  //    contract honest until then.
  app.all('/api/*', (c) => {
    throw new HTTPException(404, { message: `Unknown API endpoint: ${c.req.path}` });
  });

  // 3. /ws — WebSocket upgrade route, registered via the injected
  //    registrar so 14.4 can swap the no-op closer for the chokidar
  //    broadcaster without touching this file. Must be declared
  //    BEFORE the static handler so a literal `/ws` path on disk
  //    in `uiDist` cannot accidentally shadow the upgrade route.
  deps.attachWs(app);

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
