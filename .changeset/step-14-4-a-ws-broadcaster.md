---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Step 14.4.a — BFF WS broadcaster + chokidar wiring + scan event emission

First half of Step 14.4 lands. The BFF's `/ws` endpoint flips from
"upgrade-only stub" to a real broadcaster fed by a chokidar
filesystem watcher: every debounced batch runs the same
`runScanWithRenames` + persistence pipeline `sm watch` uses, and the
kernel's `ProgressEmitterPort` is bridged directly to the broadcaster
so `scan.*` / `extractor.completed` / `rule.completed` / `extension.error`
events reach every connected client verbatim — no envelope
construction in the BFF for the routine cases. Tests 832 → 854 (+22).

The UI-side consumer (`WsEventStreamService`) ships separately as
14.4.b.

**Files added (server)**

- `src/server/broadcaster.ts` — `WsBroadcaster` class. Owns the
  connected-clients Set, fans `JSON.stringify(envelope)` once across
  every open socket, evicts on backpressure (`bufferedAmount > 4 MiB`
  → close 1009 + unregister), drains every client with code 1001 +
  reason `'server shutdown'` on `shutdown()`. `IBroadcasterClient`
  interface is structural so unit tests inject fakes without a real
  `WebSocket`.
- `src/server/watcher.ts` — `createWatcherService(deps)` factory.
  Wraps `createChokidarWatcher` with `scan.watch.debounceMs` from
  config (override via `--watcher-debounce-ms`), runs the kernel scan
  pipeline per debounced batch, persists via `withSqlite(...).scans.persist(...)`.
  The per-batch `ProgressEmitterPort` bridges every event the kernel
  orchestrator emits during the scan to `broadcaster.broadcast(envelope)`.
  Per-batch failures log + continue (transient FS errors must not
  kill the broadcaster); chokidar instance errors broadcast a
  `watcher.error` advisory.
- `src/server/events.ts` — envelope helpers (`IWsEventEnvelope` shape,
  `buildWatcherStartedEvent`, `buildWatcherErrorEvent`). The
  `watcher.*` events are BFF-internal advisories — non-normative,
  prefixed with `watcher.` to flag their non-spec status. Spec-mandated
  shapes (`scan.*`, `extractor.completed`, `rule.completed`) are
  forwarded verbatim from the kernel emitter, so this file does not
  build them.

**Files added (tests)**

- `src/test/server-ws-broadcaster.test.ts` (15 tests) — broadcaster
  unit tests against fake `IBroadcasterClient` instances. Coverage:
  register/unregister/clientCount accounting, broadcast fan-out + JSON
  stringify, readyState filter (skip closing/closed), per-client
  `send()` failure isolation, backpressure eviction at the documented
  threshold (`WS_BACKPRESSURE_BYTES = 4 MiB`), shutdown idempotency
  + close-code/reason assertions, post-shutdown register immediate
  close, post-shutdown broadcast no-op, circular-envelope serialization
  failure handling.
- `src/test/server-ws-integration.test.ts` (7 tests) — end-to-end
  against a real server. Boots `createServer({...})` with
  `noWatcher: false`, watches a `mkdtempSync` cwd via the
  `runtimeContext` override (production callers' cwd would point at the
  test runner's repo root). Exercises: initial-batch `scan.completed`
  observed by a connected client; multi-client fan-out (one batch fires
  to two open clients); `clientCount` decrement on disconnect;
  `handle.close()` shuts the watcher cleanly under 2s;
  `validateServerOptions` rejects `--no-built-ins + watcher on`;
  `--no-watcher` confirms no `scan.*` events fire.

**Files edited (server)**

- `src/server/ws.ts` — `noopWebSocketRoute(app)` deleted, replaced
  with `attachBroadcasterRoute(app, broadcaster)`. Pulls the underlying
  `ws` library `WebSocket` off `WSContext.raw` and registers it on
  `onOpen`; unregisters on `onClose` / `onError`. Server-push only —
  `onMessage` intentionally not registered at v14.4.a.
- `src/server/index.ts` — `createServer` composition root grows the
  broadcaster + watcher lifecycle: instantiate `WsBroadcaster` →
  build app (broadcaster threaded into `IAppDeps`) → bind listener →
  start watcher (unless `--no-watcher`); `handle.close()` shuts in
  order: `watcherService.stop()` → `broadcaster.shutdown()` → http
  close → `wss.close()`. `ServerHandle` exposes the `broadcaster`
  field for tests asserting `clientCount`.
- `src/server/app.ts` — `IAppDeps.attachWs: TWsRegistrar` removed;
  replaced with `IAppDeps.broadcaster: WsBroadcaster`. The BFF wires
  `attachBroadcasterRoute` directly inside `createApp` now (route
  registrar pattern was the v14.1 scaffolding to allow swap-in at
  v14.4 — that work is done, no need for the indirection).
- `src/server/options.ts` — adds `noWatcher: boolean` (default `false`
  per Decision #121: a server with stale DB is a footgun) and
  `watcherDebounceMs?: number` (override the config value).
  Validator gains `watcher-requires-pipeline` (rejects
  `--no-built-ins + watcher on` — would persist empty scans on every
  batch) and `watcher-debounce-invalid` (non-integer / negative).
- `src/server/i18n/server.texts.ts` — eight new keys for watcher /
  broadcaster lifecycle log lines.

**Files edited (CLI)**

- `src/cli/commands/serve.ts` — plumbs `--no-watcher` (documented) +
  hidden `--watcher-debounce-ms` flag through to `IServerOptionsInput`.
- `src/cli/i18n/serve.texts.ts` — two new keys
  (`watcherRequiresPipeline`, `watcherDebounceInvalid`).

**Files edited (tests)**

- `src/test/server-boot.test.ts` — the no-broadcaster-yet
  close-1000-on-`onOpen` assertion is replaced with a "connection
  stays open + registers" assertion. Default options grow
  `noWatcher: true` (the watcher is exercised in the dedicated
  integration file).
- `src/test/server-{db-missing,endpoints,errors,pagination}.test.ts`
  — default options grow `noWatcher: true` so chokidar doesn't
  subscribe to the test runner's cwd. No behavior change for these
  tests; they exercise the REST surface, not the watcher.

**Spec**

- `spec/cli-contract.md` `### Server` — new **WebSocket protocol**
  subsection. Documents the wire envelope (delegated to
  `job-events.md` §Common envelope), the v14.4.a event catalog
  (`scan.started` / `scan.progress` / `scan.completed` plus the
  side-effect events `extractor.completed` / `rule.completed` /
  `extension.error`, plus the BFF-internal advisories
  `watcher.started` / `watcher.error`), the connection lifecycle
  (no state push on connect; client polls `/api/scan` to seed; close
  codes 1000 / 1001 / 1009), the backpressure rule, and the
  loopback-only assumption (no per-connection auth through v0.6.0
  per Decision #119). The endpoint table flips `GET /ws` from
  `upgrade-only` to `implemented (v14.4.a)`. The `sm serve` flag
  table grows `--no-watcher`. The verb-catalog row for `sm serve`
  mirrors the new flag.
- `spec/CHANGELOG.md` `[Unreleased]` `### Minor` entry.
- `spec/index.json` — regenerated (41 files hashed; no schema added).

**ROADMAP.md** — bumped `Last updated`, marked Step 14.4.a landed
(14.4 carries an explicit (a/b) split now), 14.4.b still owes the
UI-side consumer. Earlier 14.3 prose pushed to "Earlier prose".

**Decisions taken inline (flag for orchestrator)**

- `issue.added` / `issue.resolved` (per `spec/job-events.md` §Issue
  events line 446) **deferred to a follow-up**. The diff requires
  comparing the new `ScanResult.issues` set against the prior
  persisted snapshot; the watcher already loads the prior for the
  rename heuristic, so the data is at hand, but the diff plumbing
  (key derivation, set comparison, two emit calls per delta) is
  enough material that it deserves its own brief. The 14.4.a surface
  fans out exactly what the kernel emitter already produces.
- `scan.failed` **deferred to a follow-up**. The shape is not yet
  locked in `spec/job-events.md` and would need a normative
  addition. For 14.4.a, per-batch failures log via the kernel logger
  and the watcher loop continues — same behavior as `sm watch`'s
  `WATCH_TEXTS.batchFailed`.
- `scan.progress` **emitted, not throttled**. The kernel
  orchestrator emits one event per node walked; on a small workspace
  this is a handful of events per batch, on a large workspace it's
  hundreds. The brief flagged throttling as optional at 14.4.a; the
  bridge forwards verbatim today. The integration test observed 13
  `scan.progress` events for a 4-file fixture, which is fine. A
  throttle (250ms aggregation) is the obvious 14.6 polish if the
  bundle / perf pass shows the fan-out swamping the channel.
- `watcher.started` / `watcher.error` BFF-internal advisories
  **emitted** rather than silent. They give the SPA event-log a
  clear "armed" signal and a surface for chokidar errors that don't
  fit the spec's `scan.*` shape. Prefix marks them as non-normative;
  consumers that follow the spec's "ignore unknown event types"
  rule will not break.
- `IHealthResponse.watcher: 'on' | 'off'` **NOT added**. Keeping
  the v14.2 health response shape stable was preferable to adding
  one field for what tests / `--no-watcher` already cover. The
  broadcaster's `clientCount` is exposed on `ServerHandle.broadcaster`
  for test introspection without polluting the public health surface.
- The validator rejects `--no-built-ins + watcher on` because the
  watcher would persist empty scans on every batch, silently wiping
  the DB. `--no-plugins + watcher on` is OK (the built-in pipeline
  is still complete on its own).
- `attachBroadcasterRoute` does NOT register `onMessage`. v14.4.a
  is server-push only. A future client-initiated heartbeat / filter
  request lands at 14.4.b or later.
- `WsBroadcaster` is a class (not a factory) per AGENTS.md
  §Adapter wiring rule 5: factories scope to "adapters consumed via
  ports", and the broadcaster is a plain BFF helper with no kernel
  port to satisfy. The class is grandfathered no-`I*`-prefix per
  §Type naming convention category 4.

**Smoke (live BFF, one-shot per AGENTS.md)**

The integration tests cover the live boot + WS upgrade + chokidar
batch + broadcast end-to-end against a `mkdtempSync` scope. The
diagnostic line `ws events received: scan.started, scan.progress
× 13, extractor.completed × 4, rule.completed × 5, scan.completed`
confirms the full event sequence reaches a connected client during
a real scan against a 4-file fixture.
