---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Step 14.1 — `sm serve` + Hono BFF skeleton

Adds `src/server/` Hono workspace with single-port wiring (`/api/health` real,
`/api/*` 404 stubs, `/ws` no-op upgrade, `serveStatic` + SPA fallback). Real
`ServeCommand` extracted from stub at `cli/commands/stubs.ts` to dedicated
`cli/commands/serve.ts` extending `SmCommand`. Loopback-only through v0.6.0
(Decision #119). Boot resilient to missing DB — `/api/health` reports
`db: 'missing'`. Spec `cli-contract.md` `sm serve` row updated to full flag
set; new `### Server` subsection (skeleton — endpoints fill at 14.2).

**Files added (server)**

- `src/server/index.ts` — `createServer(opts)` factory returning `ServerHandle` (`{ address, close }`); resolves spec version, builds the Hono app, instantiates a `WebSocketServer({ noServer: true })`, hands both to `@hono/node-server`'s `serve({ websocket: { server: wss } })`. Closing the http server tears down the WSS automatically (node-server registers the `'close'` hook internally); `close()` calls `wss.close()` defensively for forward-compatibility.
- `src/server/app.ts` — Hono app construction. Routes registered in single-port order: `GET /api/health` → real, `ALL /api/*` → structured 404, `GET /ws` via the injected `attachWs` registrar, static handler + SPA fallback. Global `app.onError` formats every uncaught throw into the error envelope.
- `src/server/options.ts` — `IServerOptions` + `validateServerOptions(input)`. Loopback-only check for `--dev-cors`; port range check `[0, 65535]`; scope validation.
- `src/server/paths.ts` — `resolveDefaultUiDist(ctx)` walks upwards from cwd looking for `ui/dist/browser/index.html`; `resolveExplicitUiDist(ctx, raw)` honours absolute paths for `--ui-dist`.
- `src/server/static.ts` — wraps `@hono/node-server`'s `serveStatic` middleware with the SPA-fallback layer (`serveStatic` does not do SPA fallback — it `next()`s on miss, which is exactly the seam we hook into). Absolute `root` paths work on POSIX in node-server@2.0.1 (verified runtime probe — implementation is `path.join(root, filename)`); the `.d.ts` "Absolute paths are not supported" string is stale (upstream issue honojs/node-server#187 still open). When the bundle is missing (`uiDist === null`), a tiny placeholder middleware serves the boot-without-bundle hint at `/`.
- `src/server/ws.ts` — `noopWebSocketRoute(app)` registers `GET /ws` via the official `upgradeWebSocket` re-exported from `@hono/node-server@2.x`. The 14.1 handler closes the connection in `onOpen` with code 1000 + reason `'no broadcaster yet'`. 14.4 swaps this registrar for the chokidar-fed broadcaster — one-line change in `index.ts`, `app.ts` untouched.
- `src/server/health.ts` — `buildHealth(deps)` synchronous; `resolveSpecVersion()` async, called once at boot.
- `src/server/i18n/server.texts.ts` — `SERVER_TEXTS` catalog.

**Files added (CLI)**

- `src/cli/commands/serve.ts` — `ServeCommand extends SmCommand`. Parses flags, validates, calls `createServer`, registers SIGINT/SIGTERM handlers, awaits shutdown. `protected emitElapsed = false` (long-running daemon).
- `src/cli/i18n/serve.texts.ts` — `SERVE_TEXTS` catalog.

**Tests added (15)**

- `src/test/server-boot.test.ts` (7) — boot/listen/health JSON, custom port, db state present/missing, structured 404, /ws upgrade closes with code 1000 + reason 'no broadcaster yet' (uses real `WebSocket` client from `ws`), shutdown < 1s + idempotent close, inline placeholder when uiDist null.
- `src/test/server-flags.test.ts` (6) — host non-loopback + dev-cors rejection, port out-of-range, port non-numeric, scope invalid, ui-dist missing, ui-dist with valid bundle.
- `src/test/server-db-missing.test.ts` (2) — `--db <missing>` exits 5, default boots cleanly with db:missing.

**Files edited**

- `src/cli/commands/stubs.ts` — `ServeCommand` removed; replaced with a comment pointer.
- `src/cli/entry.ts` — registers the new `ServeCommand`.
- `src/package.json` — adds `hono@4.12.16`, `@hono/node-server@2.0.1`, `ws@8.20.0` (deps); `@types/ws@8.18.1` (dev). All exact-pinned per AGENTS.md.
- `spec/cli-contract.md` — `sm serve` row replaced with the full 14.1 flag set; new `#### Server` subsection (stability: experimental).
- `spec/CHANGELOG.md` — `[Unreleased]` `### Minor` entry for the spec change.
- `spec/index.json` — regenerated (40 files hashed; previous head was 215 lines).

**Decisions during implementation (flag for orchestrator)**

- WebSocket support uses `@hono/node-server@2.x`'s built-in `upgradeWebSocket` plus the canonical `ws@8.20.0` Node WebSocket library, per the official README pattern. The previously-published `@hono/node-ws` adapter was deprecated when node-server@2.0 absorbed WebSocket support natively (PR honojs/node-server#328). The 14.4 broadcaster will replace `noopWebSocketRoute` with its own one-line registrar — no API churn between 14.1 and 14.4.
- The `/api/*` catch-all is wired with `app.all('/api/*', ...)` BEFORE the `/ws` registrar and the static handler so neither a `serveStatic` filesystem hit nor the SPA fallback can shadow API endpoints. `/ws` is registered BEFORE the static handler so a literal `/ws` path on disk inside `uiDist` cannot accidentally shadow the upgrade route.
- `serveStatic` from `@hono/node-server/serve-static` accepts absolute root paths at runtime on POSIX (its implementation is `path.join(root, filename)`); the `.d.ts` string saying otherwise is documentation drift, not a runtime contract. Verified with a runtime probe and cross-referenced against the open upstream issue (honojs/node-server#187). Documented in `src/server/static.ts` so future contributors don't re-investigate.
