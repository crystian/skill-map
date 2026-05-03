# BFF (Hono server) source layout

Annex of [`AGENTS.md`](../AGENTS.md). Read this file before editing anything under `src/server/`. For shared `src/` rules (kernel boundaries, type naming, i18n, sanitization) see [`kernel.md`](./kernel.md).

`src/server/` houses the Hono BFF — peer of `src/cli/`, not under it. Hono is a driver, not a kernel port impl, so the same kernel-boundary rules apply: no `console.*`, no direct `process.cwd()` / `process.env` / `os.homedir()` (the verb threads `defaultRuntimeContext()` in), all i18n via `tx()` against `src/server/i18n/server.texts.ts`.

Files:

- `src/server/index.ts` — composition root: `createServer(opts: IServerOptions): Promise<ServerHandle>`. Resolves the spec version, assembles the kindRegistry (`assembleKindRegistry`), builds the Hono app via `createApp`, instantiates a `WebSocketServer({ noServer: true })` from `ws@8` plus the `WsBroadcaster`, and hands both to `@hono/node-server`'s `serve({ websocket: { server: wss } })` so REST + WS share one listener. Starts the chokidar watcher unless `--no-watcher`. Returns `{ address, close, broadcaster }`; `close()` shuts watcher → broadcaster → http → wss in order.
- `src/server/app.ts` — Hono app construction. Routes registered in single-port order: REST endpoints under `/api/*`, `GET /ws` via `attachBroadcasterRoute(app, broadcaster)`, static handler + SPA fallback. Global `app.onError` formats every uncaught throw into the structured error envelope (`{ ok: false, error: { code, message, details } }`).
- `src/server/routes/` — REST handlers per resource (`config`, `health`, `issues`, `links`, `nodes`, `plugins`, `scan`, `graph`). Each consumes the shared `IRouteDeps` (kernel, scope, scope root, kindRegistry, body reader, etc.) wired at the composition root.
- `src/server/envelope.ts` — REST envelope helpers (`buildListEnvelope`, `buildSingleEnvelope`, `buildValueEnvelope`, sentinel envelopes for `health` / `scan` / `graph`). Embeds `kindRegistry` on every payload-bearing variant.
- `src/server/kind-registry.ts` — `buildKindRegistry(opts)` walks every enabled Provider's `kinds[*].ui` and assembles the `{ [kindName]: { providerId, label, color, colorDark?, emoji?, icon? } }` map shipped on every applicable response.
- `src/server/broadcaster.ts` — `WsBroadcaster`: owns the connected-clients Set, fans `JSON.stringify(envelope)` once across all open sockets, evicts on backpressure (`bufferedAmount > 4 MiB` → close 1009), drains every client with code 1001 + reason `'server shutdown'` on `shutdown()`.
- `src/server/watcher.ts` — `createWatcherService(deps)` wraps `createChokidarWatcher` with `scan.watch.debounceMs` from config, runs `runScanWithRenames` + `withSqlite(...).scans.persist(...)` per debounced batch, bridges the kernel's `ProgressEmitterPort` to the broadcaster so every `scan.*` / `extractor.completed` / `rule.completed` / `extension.error` event reaches every connected client verbatim.
- `src/server/events.ts` — envelope helpers + the BFF-internal `watcher.started` / `watcher.error` advisories (non-normative; prefixed with `watcher.` to flag their non-spec status).
- `src/server/ws.ts` — `attachBroadcasterRoute(app, broadcaster)` registers `GET /ws` via the official `upgradeWebSocket` re-exported from `@hono/node-server@2.x` (paired with `ws@8` — the canonical Node WebSocket library); pulls the underlying `ws` `WebSocket` off `WSContext.raw` and registers it on `onOpen`, unregisters on `onClose` / `onError`.
- `src/server/options.ts` — `IServerOptions` + `validateServerOptions`. Loopback-only check for `--dev-cors`; port range `[0, 65535]`; scope validation (`'project' | 'global'`); rejects `--no-built-ins + watcher on` (would persist empty scans on every batch).
- `src/server/paths.ts` — `resolveDefaultUiDist(ctx)` tries the package-bundled `<package>/dist/ui/` first (installed mode), then walks upwards from cwd looking for `ui/dist/ui/browser/` (dev / monorepo mode); `resolveExplicitUiDist(ctx, raw)` honours absolute paths for `--ui-dist`. The package-bundled branch reads from the directory tsup populates via the `copyUiBundle` post-build step in `src/tsup.config.ts`.
- `src/server/path-codec.ts` — base64url codec (RFC 4648 §5, no padding) for `node.path` round-tripping. Mirrored at `ui/src/services/data-source/path-codec.ts` so node ids round-trip identically across the two transports.
- `src/server/node-body.ts` — on-demand body reader for `/api/nodes/:pathB64?include=body`. Refuses absolute paths and any relative path that resolves outside the scope root.
- `src/server/query-adapter.ts` — lifts URL query params into the kernel's `IExportQuery` shape (shared filter grammar with `sm export`).
- `src/server/static.ts` — wraps `@hono/node-server`'s `serveStatic` middleware with the SPA-fallback layer (`serveStatic` `next()`s on miss). When the UI bundle is missing (`uiDist === null`), a tiny placeholder middleware serves the boot-without-bundle hint at `/`.
- `src/server/health.ts` — `buildHealth(deps)` synchronous; `resolveSpecVersion()` async, called once at boot.
- `src/server/i18n/server.texts.ts` — `SERVER_TEXTS` catalog.

The CLI surface is `src/cli/commands/serve.ts` — extends `SmCommand` with `protected emitElapsed = false` (long-running daemon, mirrors `sm watch`). The verb is the only place that reads `process.argv` / `process.env` / `process.cwd()`; everything below is driven by the assembled `IServerOptions` bag.

Tests live under `src/test/server-*.test.ts` (boot, flags, db-missing, endpoints, errors, pagination, query-adapter, path-codec, node-body, ws-broadcaster, ws-integration). Style: `node --test` + `tsx`, every `createServer` paired with `await handle.close()` in a `try/finally`. Use `--port 0` so the OS picks a free port.
