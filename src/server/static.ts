/**
 * Static-asset middleware for the BFF.
 *
 * Two responsibilities:
 *
 *   1. Serve files out of the resolved UI bundle (`ui/dist/browser/`)
 *      using `@hono/node-server`'s `serveStatic` middleware.
 *   2. **SPA fallback**: when the request matches no static asset and
 *      isn't `/api/*` / `/ws`, serve `index.html` so Angular's client
 *      router takes over. Without this, deep links like
 *      `/inspector/foo.md` would 404 on a hard refresh. `serveStatic`
 *      itself does NOT do SPA fallback — it returns 404 and `next()`s,
 *      which is exactly the seam we hook into.
 *
 * **Absolute paths for `root`** — the `serveStatic` `.d.ts` comment
 * states *"Absolute paths are not supported"*, but the runtime
 * implementation in `@hono/node-server@2.0.1`'s
 * `dist/serve-static.mjs` simply calls `path.join(root, filename)`.
 * On POSIX `path.join('/abs/ui', '/foo.js')` returns `'/abs/ui/foo.js'`
 * (the leading slash on the second argument is stripped), so absolute
 * roots work end-to-end. Verified with a runtime probe against
 * `@hono/node-server@2.0.1` during the 14.1 follow-up. The upstream
 * issue + PR adding officially-supported absolute roots
 * (honojs/node-server#78 / #187) is still open; if a future
 * node-server bump tightens validation, swap the `root` value for a
 * `path.relative(process.cwd(), uiDist)` precompute (NOT
 * `process.chdir()` — long-running processes that mutate `cwd` poison
 * every other module that reads it later).
 *
 * When the UI bundle is missing (`uiDist === null`), the middleware
 * serves a tiny inline placeholder at `/` instead. The SPA can't boot
 * without `index.html`, but the rest of the API surface (notably
 * `/api/health`) stays alive — useful for development workflows where
 * the user runs `sm serve` before `npm run build --workspace=ui`.
 *
 * Path safety: `serveStatic` itself rejects requests containing `..`
 * segments via its built-in
 * `/(?:^|[\/\\])\.{1,2}(?:$|[\/\\])|[\/\\]{2,}/` regex (see
 * `dist/serve-static.mjs` line ~70). The SPA-fallback branch does
 * NOT need additional traversal protection because it always serves
 * the same composed `index.html` path — no user-supplied segment
 * touches the filesystem path.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import type { Context, MiddlewareHandler } from 'hono';
// eslint-disable-next-line import-x/extensions
import { serveStatic } from '@hono/node-server/serve-static';

const INDEX_HTML = 'index.html';

const PLACEHOLDER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="skill-map-mode" content="live" />
    <title>skill-map server</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 36rem; line-height: 1.5; }
      code { background: #f4f4f4; padding: 0.1rem 0.3rem; border-radius: 3px; }
      h1 { font-size: 1.4rem; }
    </style>
  </head>
  <body>
    <h1>skill-map server is running</h1>
    <p>The UI bundle was not found. If you installed <code>@skill-map/cli</code> from npm, this is a packaging bug — please report it. If you're developing in the monorepo, run <code>npm run build --workspace=ui</code> from the repo root and restart <code>sm serve</code> (or pass <code>--ui-dist &lt;path&gt;</code> to point at a custom build).</p>
    <p>The REST API is available at <code>/api/health</code>.</p>
  </body>
</html>
`;

/**
 * Build the static-serve middleware. When `uiDist === null`, only `/`
 * (and HEAD `/`) responds with the inline placeholder; every other
 * request falls through (the SPA fallback turns most of those into
 * the same placeholder).
 *
 * Method handling: `serveStatic` only serves `GET` / `HEAD` / `OPTIONS`.
 * Other methods fall through to the catch-all (and ultimately the
 * global error handler).
 */
export function createStaticHandler(uiDist: string | null): MiddlewareHandler {
  if (uiDist === null) return placeholderRootMiddleware();
  return serveStatic({ root: uiDist });
}

/**
 * SPA fallback — serves `index.html` for any request that hit no other
 * route. `/api/*` and `/ws` are registered before this in `app.ts` so
 * they short-circuit; only true SPA deep-links land here. Returns the
 * inline placeholder when the bundle is missing OR `index.html` is
 * absent inside an otherwise-present bundle dir.
 */
export function createSpaFallback(uiDist: string | null): MiddlewareHandler {
  return async (c, _next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return c.notFound();
    if (uiDist === null) return htmlResponse(c, PLACEHOLDER_HTML);
    const indexPath = join(uiDist, INDEX_HTML);
    if (!existsSync(indexPath)) return htmlResponse(c, PLACEHOLDER_HTML);
    return fileResponse(c, indexPath);
  };
}

/**
 * Tiny middleware that serves the inline placeholder at `/` when the
 * UI bundle is missing. Used in lieu of `serveStatic` so we don't
 * spam stderr with `serveStatic: root path '<null>' is not found`
 * during `sm serve` runs that intentionally boot without a bundle.
 */
function placeholderRootMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();
    if (c.req.path === '/' || c.req.path === '/index.html') {
      return htmlResponse(c, PLACEHOLDER_HTML);
    }
    return next();
  };
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.mjs': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=UTF-8',
  '.map': 'application/json; charset=UTF-8',
};

function mimeFor(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

function htmlResponse(c: Context, html: string): Response {
  return c.body(html, 200, { 'content-type': 'text/html; charset=UTF-8' });
}

async function fileResponse(c: Context, absPath: string): Promise<Response> {
  const buf = await readFile(absPath);
  return c.body(buf, 200, { 'content-type': mimeFor(absPath) });
}
