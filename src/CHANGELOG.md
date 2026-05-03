# skill-map

## 0.11.1

### Patch Changes

- 103fc1a: Doc revision pass — greenfield framing across READMEs, spec prose, ROADMAP, AGENTS, web, and workspace landing pages.

  Pure documentation changes; no normative schema or code changes.

  `@skill-map/spec`:

  - `architecture.md` — terse rewrite of §Provider · `kinds` catalog (now lists three required fields: `schema`, `defaultRefreshAction`, `ui`); new §Provider · `ui` presentation section documenting the label / color / colorDark / emoji / icon contract; §Stability section updated for the six extension kinds + Hook trigger set.
  - `plugin-author-guide.md` — Provider section gains the `ui` block documentation alongside `schema` and `defaultRefreshAction`; example manifest carries both icon variants (`pi` + `svg`); migration notes stripped under greenfield framing.
  - `cli-contract.md` — §Server documents the `kindRegistry` envelope field on every payload-bearing variant (sentinel envelopes — health/scan/graph — exempt).
  - `conformance/coverage.md` — row 18 (`extensions/provider.schema.json`) flipped 🔴 → 🟡, points at the new `plugin-missing-ui-rejected` case; new §Stability section.
  - `conformance/README.md` — drop "(Phase 5 / A.13 of spec 0.8.0)" historical phase markers.
  - `db-schema.md`, `plugin-author-guide.md` — fix `pisar` typo (Spanish leaked into English) → "are simply overwritten".
  - `CHANGELOG.md` — aggressive sweep: 2114 → 77 lines (96% reduction). Every release gets a 1–3 line greenfield summary. Drops the `Files touched`, `Migration for consumers`, `Out of scope`, `Why`, and per-step decision sub-sections. Drops commit-hash prefixes and `Pre-1.0 minor per versioning.md` boilerplate from every entry. The `[Unreleased]` section preserves the three in-flight Step 14 entries.
  - `conformance/fixtures/plugin-missing-ui/.skill-map/plugins/bad-provider/{plugin.json,provider.js}` — recovered (lost in the merge from `main` due to `.gitignore` masking gitignored-but-tracked files; `git add -f` brings them back into the index).

  `@skill-map/cli`:

  - `src/README.md` — Status section greenfield (terse: pre-1.0, what's next, what's after); usage examples expanded with `sm serve` + monorepo dev scripts.
  - `src/built-in-plugins/README.md` — drop the contradictory "empty on purpose" framing; document the actual built-in inventory (Claude Provider + Extractors + Rules + Formatter + `validate-all`).

  `@skill-map/testkit`:

  - `testkit/README.md` — rewrite end-to-end against the actual exported helper names (`runExtractorOnFixture` instead of the long-renamed `runDetectorOnFixture`); align example with the `extract(ctx) → void` Extractor shape and the `enabled` plugin status enum.

  Plus `ui/` README rewrite, root README + ES mirror Status / badge bumps + `sm serve` mention + Star History embed, AGENTS.md greenfield BFF section, CONTRIBUTING.md refresh, ROADMAP.md greenfield sweep (`Earlier prose` blocks stripped, decision log reframed without rename history, 14.6+ content preserved), web copy revision (How-it-works section), examples/hello-world rewritten to the Extractor model with passing tests, and the spec/index.json regeneration that goes with it.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

- Updated dependencies [103fc1a]
  - @skill-map/spec@0.13.1

## 0.11.0

### Minor Changes

- e0fb57e: Step 14.2 — REST read-side endpoints + DataSource contract

  Fills the `### Server` subsection's endpoint catalogue from the v14.1 stub
  (`/api/health` real, `/api/*` 404) to the eight read-side endpoints the
  Angular SPA at 14.3 will consume. New `spec/schemas/api/rest-envelope.schema.json`
  formalises the list-envelope shape. Test totals 764 → 832 (+68).

  **Files added (server)**

  - `src/server/path-codec.ts` — `encodeNodePath` / `decodeNodePath`. Base64url (RFC 4648 §5, no padding). Mirrored at `ui/src/services/data-source/path-codec.ts` in 14.3.
  - `src/server/envelope.ts` — list / single / value envelope builders. `REST_ENVELOPE_SCHEMA_VERSION = '1'`. Hardcoded to track `spec/schemas/api/rest-envelope.schema.json#/properties/schemaVersion/const`.
  - `src/server/query-adapter.ts` — `urlParamsToExportQuery(params)` lifts URL search params into the kernel's `IExportQuery` via `parseExportQuery` (one grammar, two transports). `filterNodesWithoutIssues` post-filter handles `hasIssues=false` (the one filter the kernel grammar can't express).
  - `src/server/routes/deps.ts` — shared `IRouteDeps` bag (`options`, `runtimeContext`).
  - `src/server/routes/health.ts` — extracted from `app.ts` for symmetry with the other routes (no behavior change).
  - `src/server/routes/scan.ts` — `/api/scan` + `/api/scan?fresh=1`. DB absent → returns the empty `ScanResult` shape (matches the `loadScanResult` synthetic fallback). `?fresh=1` rejects when the server was started with `--no-built-ins` or `--no-plugins`.
  - `src/server/routes/nodes.ts` — `/api/nodes/:pathB64` (single) registered BEFORE `/api/nodes` (list) so the param doesn't shadow the literal prefix. Pagination defaults `offset=0`, `limit=100`; max `limit=1000`.
  - `src/server/routes/links.ts` — `/api/links?kind=&from=&to=`.
  - `src/server/routes/issues.ts` — `/api/issues?severity=&ruleId=&node=`. `ruleId` filter mirrors `sm check`'s qualified-or-suffix match.
  - `src/server/routes/graph.ts` — `/api/graph?format=ascii|json|md`. Per-format content-type. Unknown format → `bad-query` 400.
  - `src/server/routes/config.ts` — `/api/config`. Wraps `loadConfig` from the kernel. Layered-loader warnings forwarded to `process.stderr`.
  - `src/server/routes/plugins.ts` — `/api/plugins`. Built-ins (gated by `noBuiltIns`) + drop-ins (gated by `noPlugins`). `source: 'built-in' | 'project' | 'global'` derived from the plugin's filesystem path against `defaultProjectPluginsDir`.

  **Files edited (server)**

  - `src/server/app.ts` — `IAppDeps` gains `runtimeContext` (mandatory). Routes registered via the new `routes/*` registrars BEFORE the `/api/*` 404 catch-all. `app.onError` extended to map `ExportQueryError` → 400 `bad-query` (alongside the existing HTTPException + uncaught-Error branches).
  - `src/server/index.ts` — `createServer(options, extra?)` accepts an optional `extra.runtimeContext` so tests can drive against a tempdir scope; production callers (the `sm serve` verb) leave it undefined and the composition root falls back to `defaultRuntimeContext()`.
  - `src/server/i18n/server.texts.ts` — adds error message templates: `dbMissingHint`, `freshScanRequiresPipeline`, `graphUnknownFormat`, `paginationLimitTooLarge`, `paginationInvalidInteger`, `nodeNotFound`, `pathB64Malformed`.

  **Tests added (68)**

  - `src/test/server-endpoints.test.ts` (24) — happy + error path per endpoint. Uses real `runScan` + `persistScanResult` against a `mkdtempSync` fixture (no `:memory:` per `feedback_sqlite_in_memory_workaround.md`).
  - `src/test/server-pagination.test.ts` (10) — default page caps at 100, `?limit=1000` accepted, `?limit=1001` rejected, offset/limit boundaries, `?offset=-1` and `?offset=foo` rejected, offset past total returns empty + preserves total.
  - `src/test/server-errors.test.ts` (8) — every `code` value maps to the documented HTTP status; canonical envelope shape on every error response.
  - `src/test/server-query-adapter.test.ts` (16) — URL-param → IExportQuery matrix; `filterNodesWithoutIssues` post-filter behaviour.
  - `src/test/server-path-codec.test.ts` (10) — round-trip on POSIX / unicode / spaces / very long paths; rejection of empty, non-alphabet, single-char inputs; uniqueness for distinct inputs.

  **Spec**

  - `spec/schemas/api/rest-envelope.schema.json` — new schema. `$id: https://skill-map.dev/spec/v0/api/rest-envelope.schema.json`. `oneOf` enforces that an envelope carries exactly one of `items` / `item` / `value` per kind (with sentinel kinds `health` / `scan` / `graph` reserved for routes that don't use the envelope).
  - `spec/cli-contract.md` `### Server` — endpoint table expanded from 4 rows (v14.1 surface) to 12 rows (v14.2 surface) with full filters / status / shape per row. Error code source enumeration added (`not-found` / `bad-query` / `internal` / reserved `db-missing`). Stability stays `experimental — locks at v0.6.0`.
  - `spec/CHANGELOG.md` `[Unreleased]` `### Minor` — entry for BFF endpoints + envelope schema.
  - `spec/conformance/coverage.md` — row 25 added for `api/rest-envelope.schema.json` (status: 🔴 missing — implementation-side coverage exists in `src/test/server-endpoints.test.ts`; a kernel-agnostic conformance case is still required before v1.0.0 ships).
  - `spec/index.json` — regenerated (40 → 41 files hashed).

  **Decisions during implementation (flag for orchestrator)**

  - The `db-missing` error code is kept in the documented enum but no v14.2 route currently emits it — `/api/scan` returns the empty `ScanResult` when the DB is absent, list routes return zero items, and `/api/health` already advertises `db: 'missing'`. Documented in the spec as "reserved for future endpoints (post-v0.6.0 mutations) where degradation is not safe". Removing the code would be a breaking change to the envelope contract; keeping it costs nothing.
  - `ExportQueryError` from `parseExportQuery` is funneled to `bad-query` 400 via a new branch in `app.onError`. The brief listed it as a route-level concern; centralising in the global handler means future routes that go through the kernel grammar (e.g. a future `/api/export?q=...`) inherit the same envelope mapping for free.
  - `urlParamsToExportQuery` builds a canonical raw query string and re-parses it through `parseExportQuery` instead of constructing `IExportQuery` directly. The extra parse is microseconds and guarantees the BFF and `sm export` can never drift on what counts as a valid filter token. When the grammar grows (e.g. `has=findings` post-Step 11), only `parseExportQuery` changes.
  - `/api/scan?fresh=1` rejection on `--no-built-ins` / `--no-plugins` matches Decision §14.1's intent: the BFF surface should not silently produce empty results that look indistinguishable from "your project has no nodes". The `bad-query` envelope tells the operator they're holding a knife by the blade.
  - Tests use `noPlugins: true` by default to keep them deterministic against `process.cwd()` — `loadPluginRuntime` walks the live cwd's plugins dir, which would surface ambient plugins from the test runner's host (none in CI today, but a developer running tests locally with their own plugins installed would see flake).
  - The route registration order in `app.ts` is documented in the file's header comment. `/api/nodes/:pathB64` MUST register before `/api/nodes` (Hono matches in declaration order; the literal prefix wins otherwise).

- d5488bf: Step 14.4.a — BFF WS broadcaster + chokidar wiring + scan event emission

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
    - close-code/reason assertions, post-shutdown register immediate
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

- 4ff3f38: Step 14.5.d — Provider-driven kind presentation + envelope kindRegistry

  Pre-1.0 minor breaking per `versioning.md` § Pre-1.0.

  The Provider extension surface gains the required `kinds[*].ui` field
  so each kind a Provider declares carries the presentation metadata the
  UI needs to render it (label, base color, optional dark-theme color,
  optional emoji, optional icon). The icon is a discriminated union —
  `{ kind: 'pi'; id: 'pi-…' }` for PrimeIcons or `{ kind: 'svg'; path:
'…' }` for raw SVG path data. The UI derives `bg` / `fg` tints from
  `color` per theme via a deterministic helper, so the Provider declares
  one base color per theme rather than four hex values.

  The REST envelope shape (`spec/schemas/api/rest-envelope.schema.json`)
  gains a new required `kindRegistry` field on every payload-bearing
  variant (`nodes` / `links` / `issues` / `plugins` / `node` / `config`);
  sentinel envelopes (`health` / `scan` / `graph`) stay exempt. The
  registry is keyed by kind name and carries `{ providerId, label,
color, colorDark?, emoji?, icon? }` — the BFF assembles it once at
  boot from every enabled Provider and attaches it to every applicable
  response so the UI can render Provider-declared kinds (built-in and
  user-plugin alike) without hardcoding a closed kind enum. The change
  keeps `schemaVersion` at `'1'` (greenfield — no released consumers
  depend on the prior shape).

  **Files edited (spec)**

  - `spec/schemas/extensions/provider.schema.json` — adds `ui` to the
    required field set on each `kinds[*]` entry, with discriminated
    `oneOf` for `icon`.
  - `spec/schemas/api/rest-envelope.schema.json` — new `kindRegistry`
    definition; required on every payload-bearing variant; sentinel
    variants explicitly forbid the field via `not.anyOf`. Version stays
    at `'1'` (greenfield).
  - `spec/CHANGELOG.md` — `[Unreleased]` `### Minor` entry.

  **Files edited (kernel + built-in)**

  - `src/kernel/extensions/provider.ts` — adds `IProviderKindUi` and
    `IProviderKindIcon`; `ui` becomes required on `IProviderKind`.
  - `src/built-in-plugins/providers/claude/index.ts` — every kind
    (skill / agent / command / hook / note) declares its `ui` block
    reusing the colors / labels / icons previously hardcoded in
    `ui/src/styles.css`, `ui/src/i18n/kinds.texts.ts`, and
    `ui/src/app/components/kind-icon/kind-icon.html`.
  - `src/built-in-plugins/providers/claude/claude.test.ts` — new test
    asserts every kind declares a well-formed `ui` block.
  - `src/test/external-provider-kind.test.ts` — three mock providers
    updated to declare `ui` on their `cursorRule` kinds.
  - `src/test/plugins-cli.test.ts` — `dropMockProvider` helper template
    declares `ui` on the inline mock `note` kind.

  **Files added (conformance)**

  - `spec/conformance/fixtures/plugin-missing-ui/` — drop-in Provider
    fixture whose `kinds[*]` omits `ui` (plus a trivial `notes/example.md`
    for the built-in Claude scan to grab).
  - `spec/conformance/cases/plugin-missing-ui-rejected.json` — locks the
    loader contract: `sm scan --json` exits 0, stderr matches
    `plugin bad-provider:.*invalid.*must have required property 'ui'`,
    the envelope still contains the built-in Claude provider, and the
    one fixture node still gets scanned (one bad plugin does not take
    down the scan).

  **Decisions taken inline (flag for orchestrator)**

  - `ui` is required, not optional — making it optional reintroduces the
    pre-14.5.d trap of silently collapsing unknown kinds to `'note'`.
    The cost (one object per kind in the manifest) is small.
  - Icon is a discriminated union (`oneOf` with `kind` discriminator)
    rather than two optional fields. Keeps the UI dispatch exhaustive
    and AJV validates each variant cleanly.
  - `schemaVersion` stays at `'1'` despite the required-field add.
    Greenfield — no released consumers; a versioned migration buys
    nothing today. Bumps the day a third-party consumer ships against
    the wire.
  - Severity (PrimeNG `<p-tag>` `severity` enum) is NOT declared by the
    Provider. The UI tints kind tags with the registry's `color`
    directly, avoiding a Provider-side dependency on a UI-framework
    enum.
  - BFF + UI sub-steps land in follow-up commits (14.5.d.iii / .iv /
    .v) — the spec + kernel + built-in surface ship first so the
    contract is visible before consumers wire up.

- de20bc2: Step 14.5 (a + b) — Inspector polish: markdown body opt-in + linked-nodes panel + dead-link verify hybrid

  Two sub-steps land together as a single feature unit. The Inspector
  view (UI workspace) gains a real markdown body card, a dedicated
  linked-nodes panel fed by the BFF's `/api/links` endpoint, and a
  hybrid dead-link checker that combines the in-memory heuristic with
  on-demand BFF verification. The spec + server side ships the minimal
  contract the new UI surface depends on: an opt-in `?include=body`
  parameter on `GET /api/nodes/:pathB64`, plus a corrected single-node
  response shape. Tests 854 → 868 (+14 server) and UI 113 → 138 (+25
  inspector / linked-nodes specs).

  **Why on-demand body reads instead of persisting bodies in the DB**:
  the kernel persists `body_hash` only (per `db-schema.md` §scan_nodes)
  — the body itself is human content, not machine state, and
  duplicating it in SQLite would inflate the DB without serving any
  read-side query the kernel cares about. Inspector cards that DO want
  to render the body (markdown preview at Step 14.5) opt into the
  filesystem re-read; the list / graph / kind-palette views never need
  it.

  **Files added (server)**

  - `src/server/node-body.ts` — on-demand body reader. Exports
    `readNodeBody(cwd, relPath)` (returns `string | null`; `null` on
    ENOENT / EACCES / EISDIR / ENOTDIR) and `stripFrontmatter(body)`
    (drops the leading `---\n…\n---\n` block when present, leaves
    fences in mid-document untouched). Path-traversal hardened: refuses
    absolute paths and any relative path that resolves outside `cwd`.
  - `src/test/server-node-body.test.ts` (11 unit cases) — covers
    `stripFrontmatter` edge cases (empty, no frontmatter, missing
    closing fence, fence in mid-document) and `readNodeBody` traversal
    rejection + the four `null`-returning errno branches.

  **Files edited (server)**

  - `src/server/routes/nodes.ts` — `GET /api/nodes/:pathB64` extends
    with `?include=body` opt-in (CSV-tolerant via the new
    `parseIncludes` helper, so `?include=body,future-extension` reads
    cleanly the day a second include lands). Same handler also FIXES a
    long-standing shape bug: was emitting `{ item: { node, linksOut,
linksIn, issues } }` (raw `INodeBundle` pass-through), now emits
    the documented `{ item: Node, links: { incoming, outgoing },
issues }` that the UI's `INodeDetailApi` and `StaticDataSource`
    already expected. No prod consumer ran against the legacy shape
    (the UI was internally branching on the legacy shape before the
    REST adapter landed at 14.3.a), so the corrected shape ships as a
    minor.
  - `src/test/server-endpoints.test.ts` — assertions corrected to the
    documented shape; 2 new cases for `?include=body` (returns body
    on present file, returns `null` when the file is missing).

  **Files added (UI)**

  - `ui/src/app/components/linked-nodes-panel/{ts,html,css,spec.ts}`
    — standalone Angular component. Inputs: `path`. Outputs:
    `openPath`. Internally fires `dataSource.listLinks({from})` +
    `listLinks({to})` in parallel; state machine
    `idle/loading/ready/error`. Subscribes to `events()` filtered on
    `scan.completed` for reactive refresh, plus a manual refresh
    button in the card header. Token guard handles rapid path
    changes. Renders rows with kind tag + clickable path +
    confidence chip + sources. 10 spec cases.
  - `ui/src/i18n/linked-nodes-panel.texts.ts` — i18n catalog.
  - `ui/src/app/views/inspector-view/inspector-view.spec.ts` (15
    cases) — first inspector-view spec. Covers empty / loading /
    body-card states, stale-fetch token guard, kind-card smoke,
    dead-link verify icon flow (heuristic-dead renders icon,
    click → 404 confirms, click → 200 flips to live).

  **Files edited (UI)**

  - `ui/src/models/api.ts` — `INodeApi.body?: string | null` added.
  - `ui/src/services/data-source/data-source.port.ts` —
    `IDataSourcePort.getNode(path, opts?: {includeBody?: boolean})`.
  - `ui/src/services/data-source/rest-data-source.ts` — propagates
    `includeBody` to `?include=body`.
  - `ui/src/services/data-source/static-data-source.ts` — ignores
    the flag (demo bundle ships bodies inline; see
    `scripts/build-demo-dataset.js` below).
  - `ui/src/services/collection-loader.ts` — minor signature touch
    for the `getNode` opts pass-through.
  - `ui/src/models/node.ts` — `INodeView` loses three fields:
    `body`, `raw`, `mockSummary`. The "Summary" mock card is
    retired (description already lives in `inspector__desc`).
  - `ui/src/app/views/inspector-view/inspector-view.ts` — body card
    switches from `<pre>{{ n.body }}</pre>` to a `@switch` over a
    `bodyState` signal (idle / loading / empty / unavailable /
    error / ready) with token-guarded fetch via `effect()` keyed on
    `path()`; markdown rendered via `MarkdownRenderer` and
    `[innerHTML]`. Mounts `<sm-linked-nodes-panel>` as a separate
    card between Relations and Body. Dead-link verify hybrid: the
    Relations card chips (`supersededBy` / `supersedes` / `requires`
    / `related`) keep the in-memory heuristic but now carry a verify
    icon (`pi-question-circle`) that fires `getNode(path)` against
    the BFF; three visual states `live` / `dead-confirmed` (404 → red
    dashed border + `pi-times-circle`) / `dead-heuristic` (not in
    scope, not yet verified). Per-node signals
    `verifiedAlive` / `verifiedDead` / `verifyInFlight` reset on
    `path()` change. Template refactor consolidates 4 inline
    duplicated chip blocks into a single `<ng-template #pathChip>`
    shared via `*ngTemplateOutlet`.
  - `ui/src/app/views/inspector-view/inspector-view.{html,css}` —
    templates + styles for the new body / verify states.
  - `ui/src/i18n/inspector-view.texts.ts` — drops `summary*`, adds
    `body.*` (loading / empty / unavailable / renderError),
    `relations.verifyHint`, `relations.deadConfirmed`. `body: 'Body'`
    (was `'Body (raw markdown)'`).

  **Files edited (build pipeline)**

  - `scripts/build-demo-dataset.js` — new `embedBodies(scan,
fixtureDir)` post-processor reads each fixture's body from disk,
    strips frontmatter, attaches to the demo `data.json` so the
    demo experience matches the live BFF (~40 KB extra for 21
    fixtures; bodies-on-bundle is the explicit demo-mode tradeoff).

  **Spec**

  - `spec/cli-contract.md` `### Server` — `/api/nodes/:pathB64` row
    flips its shape column from the legacy bundle to the documented
    `{ item, links: { incoming, outgoing }, issues }` and gains the
    `?include=body` filter column.
  - `spec/CHANGELOG.md` `[Unreleased]` `### Minor` — entry covering
    the `?include=body` opt-in, the corrected response shape, and
    the path-traversal defense.
  - `spec/index.json` — regenerated (41 files hashed; no schema
    added).

  **ROADMAP** — `Last updated` bumped, "YOU ARE HERE" updated,
  completeness marker now lists 14.5.a + 14.5.b as complete; "Next"
  points at 14.5.c.

  **Decisions taken inline (flag for orchestrator)**

  - The corrected single-node shape ships as a minor (additive on
    the contract surface) rather than a major. Rationale: no public
    consumer ran against the legacy shape; the UI was decoding the
    legacy shape internally before the REST adapter at 14.3.a
    introduced the documented shape; and the spec table already
    documented the new shape (the bug was in the implementation,
    not the spec). Keeping the bump minor avoids burning a major
    on a never-shipped wire format.
  - `parseIncludes` is CSV-tolerant from day one (`?include=body`
    and `?include=body,foo` both parse) so the second include can
    land without a parser refactor. Unknown include values are
    silently ignored — the BFF surface mirrors the spec's
    "ignore unknown event types" rule for forward compatibility.
  - Bodies are fetched per-node on inspector open, not pre-fetched
    in the list endpoint. Keeps the list `/api/nodes` response
    small (the list view never renders bodies) and matches the
    read-side hot path: most nodes are listed but few are inspected.
  - The dead-link verify is opt-in per chip click, not auto-fired
    on inspector open. Heuristic-dead nodes are common in scoped
    scans (a workspace that scans `docs/` but references `src/`);
    auto-firing would burn one BFF round-trip per such reference.
  - Per-node verification signals reset on `path()` change to avoid
    stale state bleeding between inspector navigations. The signals
    are scoped to the component instance; no global cache (the
    cost is one BFF call per re-verify on revisit, which the user
    triggers intentionally by clicking the icon).

### Patch Changes

- Updated dependencies [e0fb57e]
- Updated dependencies [d5488bf]
- Updated dependencies [4ff3f38]
- Updated dependencies [de20bc2]
  - @skill-map/spec@0.13.0

## 0.10.0

### Minor Changes

- 9b55981: cli-architect review follow-up — `SmCommand` base class wires every spec § Global flag (`-q/--quiet`, `-v/--verbose`, `--no-color`, env vars), every read-side verb now emits `done in <…>` per spec § Elapsed time, watch grows a circuit breaker, scan extracts the runner, and two invariant tests gate future regressions.

  **HIGH — spec § Global flags / Elapsed time gaps**

  Audit found the CLI honoured only a subset of the spec's global flags and emitted `done in <…>` from a handful of verbs ad-hoc. Closed structurally:

  - New `cli/util/sm-command.ts` — abstract `SmCommand extends Command`. Declares `-g/--global`, `--json`, `-q/--quiet`, `--no-color`, `-v/--verbose`, `--db` once. Subclasses implement `protected run()` instead of `execute()`; the base wraps it with `applyEnvOverrides()` (promotes `SKILL_MAP_SCOPE=global`, `SKILL_MAP_JSON=1`, `NO_COLOR`, `SKILL_MAP_DB=<path>` to flags when the CLI flag is at default — spec precedence: CLI > env > config) + `startElapsed()` + a `finally` that emits `done in <…>` (suppressed by `--quiet`). Verbs opt out via `protected emitElapsed = false` (today: `sm version`, `sm watch`, `sm db shell`, `sm config list/get/show`).
  - `-v` / `-vv` / `-vvv` reconfigures the kernel logger to `info` / `debug` / `trace` respectively; `--log-level` from `entry.ts` stays as the legacy escape hatch.
  - 24 verb classes migrated: `init`, `scan`, `check`, `list`, `show`, `export`, `refresh`, `history`, `history stats`, `db backup/restore/reset/shell/dump/migrate`, `plugins list/show/doctor/enable/disable`, `orphans/orphans reconcile/orphans undo-rename`, `graph`, `scan-compare`, `version`, `conformance run`, `config list/get/show/set/reset`, `jobs prune`, `watch`. Each drops its locally-declared globals (`global`, `db`, `json`, `quiet`) and renames `execute()` → `run()`.

  **MEDIUM — watch circuit breaker**

  `runWatchLoop` previously caught every per-batch error, logged one line, and continued forever. A permanent failure (write-protected DB, schema corruption discovered post-init) repeated indefinitely with no exit signal. New `--max-consecutive-failures=N` flag (default 5; 0 disables) shuts the watcher down with exit 2 after N back-to-back failures. A successful batch resets the counter so transient errors never trip the breaker. Also removes the inner try/catch in `runOnePass` that was duplicating the per-batch error path — failures now propagate to `onBatch` so the breaker can count them.

  **MEDIUM — `cli/util/scan-runner.ts` extraction**

  `ScanCommand.execute` was 340 LOC inside one allowed `eslint-disable complexity`. The wiring chain (plugin runtime, config + ignore filter, prior-snapshot load, single-`withSqlite` open for persist, dry-run / non-persist branch) moved to `runScanForCommand(opts: IScanRunOpts): IScanRunResult` — a kernel-thin runner the verb consumes via `parse flags → runScanForCommand → render → exit code`. Mirrors `runWatchLoop`'s shape for `sm watch`.

  **MEDIUM — quick wins**

  - `cli/util/fs.ts` — lifts the `pathExists` / `statOrNull` helpers that were duplicated in `cli/commands/db.ts` and `cli/commands/init.ts`. ENOENT remains the only swallowed errno; every other code propagates so the caller sees the real reason.
  - `cli/util/db-path.ts` — adds `defaultDbPath(scopeRoot)`, `defaultSettingsPath`, `defaultLocalSettingsPath`, `defaultIgnoreFilePath`, and a frozen `GITIGNORE_ENTRIES` constant. `cli/commands/init.ts` consumes them; the spirit of "no hardcoded `.skill-map/...` literals" now applies to settings / ignore paths the same way it already applied to the DB path.
  - `kernel/util/ajv-interop.ts` — single `applyAjvFormats(ajv)` helper. The `ajv-formats as unknown as ...` ESM/CJS workaround that used to live in both `plugin-loader.ts` and `schema-validators.ts` is now in one place.
  - `cli/commands/plugins.ts` — every `tx(PLUGINS_TEXTS.*, { ... })` interpolation that splices a user-supplied `id` / `bundleId` / `extId` (CLI flag input, untrusted) wraps the value in `sanitizeForTerminal()`. Closes the audit's note that `plugins.ts:304` and the surrounding `resolveToggleTarget` call sites were the one remaining gap in CLI output sanitization.
  - `cli/commands/db.ts` — `db migrate` declares `-n,--dry-run` (was `--dry-run` only); aligns with `db reset` and the rest of the verb family.
  - `cli/commands/show.ts` — drops the speculative `findings: never[]` / `summary: null` reserved slots. The spec § `sm show --json` shape is `{ node, linksOut, linksIn, issues }` until Step 10 (findings) and Step 11 (summary) ship; the placeholders narrow consumer types in a way the eventual `unknown[]` / `unknown | null` widen could not be additive over. Test updated to assert the fields are absent.

  **Invariant tests (catch future regressions)**

  - `test/elapsed-invariant.test.ts` (10 tests) — for every read-side verb in spec § Elapsed time scope (`check`, `list`, `show`, `export`, `history`, `history stats`, `db migrate --status`, `plugins list`, `plugins doctor`), captures stderr and asserts `/^done in (\d+ms|\d+\.\d+s|\d+m \d+s)\n?$/m`. Plus one negative test that `--quiet` suppresses the line.
  - `test/render-sanitize-invariant.test.ts` (5 tests) — plants `\x1b[2J` (ANSI clear-screen) and `\x07` (BEL) inside `Node.title` and `Issue.message`, persists them, then runs `check`, `show`, `list`, `export --format md/json` and asserts no C0 / C1 control byte (other than `\n` / `\t`) reaches stdout. Catches any future render path that forgets to wrap a plugin / DB / FS string in `sanitizeForTerminal`.

  **Out of scope (deferred)**

  - `sm export --format mermaid` exit code — currently `2` (operational error). Audit suggested a dedicated "deferred / unsupported" code; that requires a `spec/cli-contract.md` § Exit codes amendment (codes 6–15 are reserved per spec). Not landing in this PR.

  **Audit follow-up tail (low-priority items held back from the main commit — `patch`-level)**

  Tests + comments only; no behavioural or surface change. Folded into this changeset because it ships in the same release window and the reader benefits from one continuous narrative.

  - `cli/commands/scan.ts` + `cli/util/scan-runner.ts` — 6-line comments document the `sm scan --global` gap. Spec § Global flags lists `-g/--global` as universal but the per-verb § Scan table omits it, and "scan global" semantics (which dirs? which ignore filter?) are undefined. `ScanCommand` accepts `-g` (inherited from `SmCommand`) but the runner hardcodes `scope: 'project'`. Comments mark both sites so the wiring lands in one motion once spec defines the contract.
  - `test/conformance.test.ts` — 2 new integration tests (audit finding 6.4) plant a hostile case JSON with `fixture: '../../../../../../etc/passwd'` and another with `fixture: '/etc/passwd'`, invoke `runConformanceCase(...)` directly, and assert the runner refuses both before any I/O against the planted path. Reinforces the unit-level guard at `conformance/index.ts:assertContained` end-to-end.
  - `test/dry-run-invariant.test.ts` (new file, 7 tests — refactor 8.3) — cross-cutting gate for spec § Dry-run's "no observable side effects" contract. Snapshots the scope dir's file content via `sha256` (excluding SQLite WAL/SHM sidecars — those rewrite even on read-only opens) before / after a `--dry-run` invocation and asserts byte-equality. Covers `db reset`, `db reset --hard`, `db restore <source>`, `db migrate`, `sm scan` (over a fresh cwd with no `.skill-map/`), and `sm init`. Plus a negative control test that runs `db reset --hard` for real and asserts the file set DOES change — proves the snapshot machinery has teeth.

  **Tests**

  749/749 pass (+24 vs prior 725; +9 vs the main follow-up commit's 740). Lint clean, build clean. No spec change; `spec/index.json` not regenerated.

- 68c5e28: Step 14.1 — `sm serve` + Hono BFF skeleton

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

### Patch Changes

- Updated dependencies [68c5e28]
  - @skill-map/spec@0.12.0

## 0.9.0

### Minor Changes

- 67fb4ae: refactor: cli-architect audit sweep — boundary hygiene, i18n discipline, enum hardening, IAction stub

  Closes the findings from the `minions:cli-architect` review of `src/`. No spec changes, no behaviour change in command output bytes (every promoted renderer was rerun against its existing tests). One internal port-shape change (`StoragePort.jobs.listOrphanFiles → listReferencedFilePaths`) — `@skill-map/cli` is still `private: true`, but pre-1.0 minor anyway because the change is structural and the new `IAction` contract is part of the public extension surface.

  **Boundary hygiene (C1, C2, H1)**

  - Lifted every storage-port type from the SQLite adapter modules into `kernel/types/storage.ts`: `IPruneResult`, `IListExecutionsFilter`, `IHistoryStatsRange`, `THistoryStatsPeriod`, `IMigrateNodeFksReport`, `IPluginConfigRow`, `IApplyOptions/Result`, `IMigrationFile/Plan/Record`, `IPluginApplyOptions/Result`, `IPluginMigrationFile/Plan/Record`. The port and the SQLite adapter modules now both import from one source; a second adapter (Postgres, in-memory test harness) inherits no SQLite-specific types.
  - `StoragePort` re-exports the lifted types so the CLI consumes the abstract contract end-to-end. `cli/commands/orphans.ts` and `cli/commands/history.ts` no longer reach into `kernel/adapters/sqlite/*` for type imports.
  - `kernel/adapters/sqlite/jobs.ts` no longer touches the FS — the docstring was already promising "we do NOT touch the FS from the storage layer", but `listOrphanJobFiles` was importing `node:fs`. New helper `kernel/jobs/orphan-files.ts:findOrphanJobFiles(jobsDir, referenced)` performs the directory walk; the storage helper renames to `selectReferencedJobFilePaths(db)` and the port surface flips from `jobs.listOrphanFiles(jobsDir): IOrphanFilesResult` to `jobs.listReferencedFilePaths(): Promise<Set<string>>`. `sm job prune --orphan-files` orchestrates the two pieces in the CLI command.

  **IAction extension contract + exhaustive switches (C3, H4)**

  - New `kernel/extensions/action.ts:IAction` + `IActionPrecondition`, mirroring `spec/schemas/extensions/action.schema.json`. Manifest-only — runtime invocation (deterministic in-process call vs probabilistic runner dispatch) lands with the job subsystem (Decision #114); the contract carries the manifest fields so the AJV validator and `sm actions show` already have a typed shape to anchor against.
  - `IBuiltIns` gains an `actions: IAction[]` bucket. `bucketBuiltIn` (`built-in-plugins/built-ins.ts`) and `bucketLoaded` (`cli/util/plugin-runtime.ts`) both grow exhaustive `default: never` arms — silent fall-through on a future kind addition turns into a compile error. `accumulateBuiltInScanExtensions` similarly explicit.
  - `extensions/index.ts` docstring no longer claims "six kinds" while shipping five.

  **Runtime enum hardening at the row→domain boundary (H5)**

  - New `kernel/util/enum-parsers.ts` with type guards (`isStability`, `isLinkKind`, `isConfidence`, `isSeverity`, …) and parsers (`parseStability(s, ctx)`, `parseLinkKind(s, ctx)`, …). Parsers throw with a clear diagnostic naming the offending value, the allowed set, and the caller's row context.
  - `kernel/adapters/sqlite/scan-load.ts:rowToNode/rowToLink/rowToIssue` now use the parsers instead of raw `as Stability/LinkKind/Confidence/Severity` casts. `Node.kind` stays open string per spec — the parsers cover only the closed-enum fields.

  **i18n discipline sweep (H2, H3)**

  CLI catalog additions (`cli/i18n/*.texts.ts`):

  - `CHECK_TEXTS.issueRow` — `[severity] ruleId: message — nodeIds`.
  - `SHOW_TEXTS.groupedLinkHead/Dup/Sources` — split the in/out link bullet so the `(×N)` and ` sources: …` segments stay greppable.
  - `ORPHANS_TEXTS.activeIssuesHeader/activeIssueRow/noNodePlaceholder` — `renderOrphans` no longer composes English inline.
  - `EXPORT_TEXTS.md*` — every line of `renderMarkdown` (title, query echo, counts, per-kind sections, link bullets, issue bullets) routes through `tx`.
  - `HISTORY_TEXTS.statusWithReason` — `<status> (<failureReason>)` cell composition.

  Kernel catalog (`kernel/i18n/storage.texts.ts`, new):

  - `STORAGE_TEXTS.scanPersistInvalidScannedAt` — `kernel/adapters/sqlite/scan-persistence.ts`.
  - `STORAGE_TEXTS.findNodesInvalidSortBy/Limit` — `kernel/adapters/sqlite/storage-adapter.ts`.
  - `QUERY_TEXTS.exportQuery*` — `kernel/scan/query.ts` (every `ExportQueryError` thrown by `parseExportQuery`).

  **Cleanup (H6, H7, M2, M3, L4, L5)**

  - Dropped dead `FRONTMATTER_BY_KIND` map + `void` suppress in `built-in-plugins/rules/validate-all/index.ts` (unused per-kind frontmatter routing scaffolding).
  - Dropped unused `NodeKind` import in `kernel/extensions/provider.ts` (referenced only in JSDoc text).
  - Deduplicated `HOOK_TRIGGERS`: `kernel/adapters/plugin-loader.ts` now imports the single source of truth from `kernel/extensions/hook.ts` instead of redeclaring the eight-trigger list.
  - Collapsed `TExtensionKind` and `ExtensionKind` to the canonical declaration in `kernel/registry.ts`. `kernel/adapters/schema-validators.ts` and `kernel/types/plugin.ts` re-import from there.
  - Pruned `kernel/adapters/sqlite/index.ts` re-exports from ~22 schema-internal types to just `IDatabase` (the single type `src/test/storage.test.ts` consumes); CLI consumers go through the port.
  - `cli/commands/scan.ts` consolidates `process.cwd()` calls behind a single `defaultRuntimeContext()` invocation per execution.

- 2ef6b15: refactor: cli-architect follow-up — finish kernel i18n migration, dedupe DB-path helpers, normalize conformance type names, switch `sm db` / `sm init` to async fs

  Bundles a series of cli-architect audit findings (H1, H2, M1–M7, L1, L3). The `minor` bump is required by **M1** — the public type names exported from `src/conformance/index.ts` get an `I*` prefix to align with the kernel's category-4 naming convention; per AGENTS.md pre-1.0 rule, breaking changes ship as a minor while the workspace stays in `0.Y.Z`.

  **H1 — kernel i18n leak in config loader + migrations**

  Two new catalogs land under `src/kernel/i18n/`:

  - `config-loader.texts.ts` — every warning the layered config loader pushes into `ILoadedConfig.warnings` (or throws under `--strict`) now flows through `tx(CONFIG_LOADER_TEXTS.<key>, vars)`.
  - `migrations.texts.ts` — every `Error.message` thrown by `kernel/adapters/sqlite/migrations.ts` (duplicate version, invalid version range, per-file apply failure) goes through `tx(MIGRATIONS_TEXTS.<key>, vars)`.

  These messages surface to the user via `cli/commands/config.ts` (warnings dumped to stderr) and `cli/commands/db.ts` (migration failures rendered with the `{{reason}}` template). They were the last hardcoded-English strings in the kernel surface.

  **H2 — hardcoded `.skill-map/skill-map.db` (and friends) duplicated across six call sites**

  `cli/util/db-path.ts` now exports a single `DEFAULT_DB_REL = '.skill-map/skill-map.db'` plus four typed companion helpers:

  - `defaultProjectDbPath(ctx)` → `<cwd>/.skill-map/skill-map.db`
  - `defaultProjectJobsDir(ctx)` → `<cwd>/.skill-map/jobs`
  - `defaultProjectPluginsDir(ctx)` → `<cwd>/.skill-map/plugins`
  - `defaultUserPluginsDir(ctx)` → `<homedir>/.skill-map/plugins`

  Migrated call sites: `cli/commands/scan.ts`, `cli/commands/refresh.ts`, `cli/commands/watch.ts`, `cli/commands/jobs.ts`, `cli/commands/plugins.ts`, `cli/util/plugin-runtime.ts`. The convention now lives in exactly one file.

  **M1 — conformance public types adopt the `I*` prefix (BREAKING)**

  `src/conformance/index.ts` exports get the kernel-style `I*` prefix:

  - `AssertionResult` → `IAssertionResult`
  - `RunCaseResult` → `IRunCaseResult`
  - `RunCaseOptions` → `IRunCaseOptions`
  - `Assertion` (private) → `IAssertion` (now exported)
  - `AssertionContext` (private) → `IAssertionContext`
  - `ConformanceCase` (private) → `IConformanceCase`

  Consumers inside the repo (`cli/commands/conformance.ts`, `test/conformance*.test.ts`) reference `runConformanceCase` only — none of them import the type names — so the rename is type-only inside the workspace; the breaking impact is for downstream tooling that imports the conformance module directly.

  **M2 — conformance reason strings**

  New `src/conformance/i18n/runner.texts.ts` catalog. Every `reason` string the runner returns (assertion failures, JSONPath dispatch errors, containment violations, the `assertSpecRoot` throw) now flows through `tx(CONFORMANCE_RUNNER_TEXTS.<key>, vars)`.

  **M3 — registry errors**

  New `src/kernel/i18n/registry.texts.ts` catalog. The `DuplicateExtensionError` constructor, the unknown-kind throw, and the missing-`pluginId` throw all use the catalog now.

  **M4 — `sm help --format json` flag description**

  The `--help` global flag's English description in `cli/commands/help.ts` was hardcoded. Moved to `HELP_TEXTS.globalFlagHelpDescription`.

  **M5 — `resolveDbPath` is the canonical entrypoint everywhere**

  Subsumed by H2: the previously-direct `resolve(ctx.cwd, DEFAULT_PROJECT_DB)` constructions in `scan.ts`, `refresh.ts`, `watch.ts` now call `defaultProjectDbPath(ctx)` (a thin wrapper over `resolveDbPath`). `init.ts` keeps its inline path because it owns `--global` semantics that resolve through `SKILL_MAP_DIR` directly.

  **M6 — async fs in `sm db` and `sm init`**

  `cli/commands/db.ts` and `cli/commands/init.ts` switched from `fs`'s sync API (`copyFileSync`, `mkdirSync`, `existsSync`, `rmSync`, `statSync`, `readFileSync`, `writeFileSync`) to `fs/promises`. `existsSync` checks became a small `pathExists()` helper that wraps `stat()` and only swallows `ENOENT`. `DatabaseSync` and `spawnSync('sqlite3')` stay as they were (sync-only by design).

  **M7 — `sm scan compare-with` now forwards layered-loader warnings**

  Mirrors what `cli/commands/config.ts` already did for `sm config show / get / set`: the `ILoadedConfig.warnings` array is iterated to stderr instead of being silently dropped. Without `--strict`, a malformed `settings.json` now produces the same diagnostic line under compare-with that it produces under every other read-side verb.

  **L1 — collapsed duplicate DB-path constants**

  `DEFAULT_PROJECT_DB` and `DEFAULT_GLOBAL_DB` resolved to the same string. Replaced by the single `DEFAULT_DB_REL`.

  **L3 — dropped the unused `LOGGER_FLAG_NAME` export**

  `cli/util/logger.ts` exported both `LOGGER_ENV_VAR` (used by `entry.ts`) and `LOGGER_FLAG_NAME` (no consumers anywhere). Dropped the latter; the internal `FLAG_NAME` constant stays because `extractLogLevelFlag` still uses it.

  **Validation**

  `npm run validate` clean (lint across workspaces). `npm test -w src` 693/693 pass.

- 723c022: cli-architect audit follow-up — output sanitization hardening, `StoragePort.migrations.writeBackup` signature change, atomic config write, and shared helper extraction.

  **BREAKING (pre-1.0, ships as minor per `versioning.md` § Pre-1.0)**

  `StoragePort.migrations.writeBackup(targetVersion: number)` is now `writeBackup(destPath: string)`. The port stays a generic "WAL-checkpoint + atomic file copy" primitive; the per-target naming (`skill-map-pre-migrate-v<N>.db` for the migrations runner; `<timestamp>.db` for `sm db backup`) is the caller's concern. `sm db backup` now routes through the port via `withSqlite` instead of opening `node:sqlite` directly. The on-disk paths and the user-facing CLI surface (`sm db backup [--out <path>]`) are unchanged — verified deliberately. No spec impact.

  **HIGH — output sanitization gaps (defence in depth)**

  Plugin-authored strings persisted in the DB (`Issue.message`, `scan_issues.data_json`, conformance assertion `reason` strings spliced from subprocess stderr, plugin-loader `reason` payloads) reach the user's terminal through several CLI render paths that previously did not pass them through `sanitizeForTerminal`. A hostile or buggy plugin could plant ANSI escape sequences or C0 control bytes in those fields and repaint the user's screen on `sm history`, `sm orphans undo-rename`, `sm conformance run`, or any verb that prints a plugin-warning row.

  - **H1** — `formatWarning` in `cli/util/plugin-runtime.ts` sanitizes + length-caps `id` (200) and `reason` (1000) before interpolation. Closes M8 in the same change. Function exported (with docstring noting test-only consumers) so the new audit unit tests can target it directly.
  - **H2** — `renderStats` in `cli/commands/history.ts` sanitizes `actionId`, `actionVersion`, `nodePath`, and the `failureReason` enum key before interpolating into the top-actions / top-nodes / failures-by-reason rows. Enum value sanitized for symmetry with `renderTable`.
  - **H3** — `cli/commands/orphans.ts` sanitizes `dataFrom` in `undoMediumFromMismatch` (sourced from `scan_issues.data_json` written by the rename heuristic) and `safeFrom` in the confirm-prompt + summary template paths.

  **MEDIUM**

  - **M1** — `cli/commands/conformance.ts` extracts `formatAssertionFailureDetail(type, reason)` that sanitizes + caps `reason` to 1000 chars. The conformance runner splices subprocess stderr verbatim into `runtime-error` reasons; a runaway impl-under-test could emit kilobytes that drown the user's terminal. Helper exported for the audit unit tests.
  - **M2** — see BREAKING above.
  - **M3** — `cli/commands/jobs.ts` swaps `unlinkSync` for `await unlink` from `node:fs/promises` in the prune loop. Aligns with the rest of the verb (already async) and avoids blocking the event loop on slow filesystems.
  - **M4** — extracts shared `bucketByKind` helper at `kernel/util/bucket-by-kind.ts`. `built-in-plugins/built-ins.ts:bucketBuiltIn` and `cli/util/plugin-runtime.ts:bucketLoaded` both consume it; the open-coded six-way `switch (ext.kind)` blocks (each with its own exhaustive-`never` guard) collapse to one centralized dispatch table. The helper still owns the exhaustive switch so adding a new `ExtensionKind` flags every caller through the `never` guard at compile time. The `eslint-disable-next-line complexity` justification (AGENTS.md category 6 — discriminated-union dispatcher) moves to the helper.
  - **M5** — `cli/commands/config.ts` `writeJsonAtomic` replaces `writeFileSync` with stage-to-`<path>.tmp.<pid>` + `renameSync`. POSIX guarantees rename atomicity on the same filesystem, so a crash mid-write leaves `settings.json` either at its prior content or at the new content, never half-written. Best-effort temp-file cleanup on error so we don't leak siblings if the rename target is read-only.

  **LOW**

  - **L4** — extracts shared `parsePositiveIntegerOption(raw, label, stderr)` at `cli/util/option-validators.ts` with new i18n catalog `option-validators.texts.ts`. Three near-duplicate inline checks consolidated: `sm list --limit`, `sm history --limit`, `sm history stats --top`. Each used to ship its own `LIST_TEXTS.invalidLimit` / `HISTORY_TEXTS.limitNotPositiveInt` / `HISTORY_TEXTS.topNotPositiveInt` wording; the three keys are removed and replaced by a single `OPTION_VALIDATORS_TEXTS.notPositiveInt` template scoped by the `{{label}}` placeholder. Acceptance rules stay locked across sites (a permissive `Number.parseInt('12abc', 10)` would otherwise accept `12` — every call site repeats the same trim + signed + non-integer guard).
  - **L8** — `built-in-plugins/formatters/ascii/index.ts` sanitizes `issue.ruleId` for symmetry with the sibling `issue.message` sanitization. The registry validator already constrains `ruleId` to `[a-z0-9-]+`, but defence in depth keeps the gate uniform if the validator ever loosens.

  **Tests**

  725/725 pass (+31 vs prior 694). New: `test/bucket-by-kind.test.ts` (M4 dispatch table coverage), `test/option-validators.test.ts` (L4 boundary cases). Modified: `test/plugin-runtime.test.ts` (H1), `test/history-cli.test.ts` (H2 + L4), `test/orphans-cli.test.ts` (H3), `test/conformance-cli.test.ts` (M1), `test/config-cli.test.ts` (M5), `test/storage.test.ts` (M2 port shape), `built-in-plugins/formatters/ascii/ascii.test.ts` (L8).

  No spec changes — `spec/index.json` not regenerated. `npm run lint` clean, `npm run -w src build` clean.

- 147adb8: feat(cli): compact `sm --help` and per-verb help

  Replace Clipanion's default top-level and per-verb help output with a project-styled, compact renderer that fits the rest of the CLI's visual language. The normative `--format json` and `--format md` paths (locked by `spec/cli-contract.md` § Help) are untouched — only the human format changed.

  **Top-level overview (`sm`, `sm --help`, `sm -h`, `sm help` no-verb)**

  New `RootHelpCommand` replaces `Builtins.HelpCommand`. Layout: header tagline → USAGE block → EXAMPLES block → per-category sections (uppercased, alphabetical) → footer pointing at `sm <command> --help`. Per-category column width is computed independently so a single long verb doesn't widen every other section. Stub verbs (those whose description starts with `(planned)`) get a leading `[stub] ` tag in the description column (and in the single-verb header), and the `(planned)` parenthetical is stripped to keep the column flush. Long rows are truncated with a `…` ellipsis at 120 chars.

  **Per-verb help (`sm <verb> --help`, `sm help <verb>`)**

  New `routeHelpArgs(args, cli)` in `cli/entry.ts` (called before `cli.run`) intercepts `sm <verb...> --help|-h` and rewrites it to `sm help <verb...>`, picking the longest registered verb-path prefix. Pure function, lives next to the renderer in `cli/commands/help.ts`. `HelpCommand.verb` switched from `Option.String` to `Option.Rest` so multi-token verbs (`db migrate`, `scan compare-with`, `config get`) work via `sm help <verb>` too. `renderSingle` rewritten with HEAD / USAGE / DESCRIPTION / FLAGS sections matching the overview. The USAGE line now shows real positionals (`<orphanPath>`, `<dump> ...`, etc.) extracted from Clipanion's detailed-usage string — required adding `usage` to `ICliDefinition` because `def.path` is just the verb path; positionals only live in the detailed `def.usage`. FLAGS rows show the first sentence of each flag's description, padded into a column, truncated at 120 chars.

  **Category consolidation** (eliminate one-verb categories)

  `version` moves from `Setup & state` → `Introspection`. The two `actions` stubs move from `Actions` → `Jobs`. `serve` moves from `Server` → `Setup`. Cascades cleanly into `context/cli-reference.md` (regenerated; `npm run cli:check` clean).

  **i18n**

  Every new user-facing string lives in `cli/i18n/help.texts.ts` per the project's `tx(*_TEXTS.*)` discipline — no inline strings in command code.

  **Lint**

  Three new functions tripped the `complexity=8` cap. `extractPositionals` is a legit char-by-char tokenizer (AGENTS.md exception #2 — `eslint-disable-next-line complexity` with the documented justification). `renderSingle` and `routeHelpArgs` were split into helpers cleanly, no disables.

  **Spec stance**

  The human help format is not spec-normative — only `--format json` and `--format md` are locked by `spec/cli-contract.md` § Help, and those paths are untouched. The contract requirement that `sm`, `sm --help`, `sm -h` all print top-level help and exit 0 is still satisfied. No spec change, no `spec/CHANGELOG` entry.

  Classified `minor` (not `major`) per AGENTS.md "Pre-1.0: never bump to a major" — pre-1.0 breaking changes ship as minor bumps.

  **Validation**

  `npm run validate` (lint) clean, `npm test -w src` 693/693 pass, `npm run cli:reference` regenerated, `npm run cli:check` confirms in sync. Manual smoke across `sm`, `sm --help`, `sm -h`, `sm help`, `sm scan --help`, `sm db migrate --help`, `sm orphans reconcile --help`, `sm scan compare-with --help`, `sm config get --help`, `sm help <verb>` for the same set, plus `sm help <verb> --format json|md` (normative formats — unchanged behaviour).

- 256fb70: security: harden CLI/kernel against prototype pollution, ANSI injection, and path-escape attacks (audit findings H1–H3, M1–M6, L1)

  - **H1** — `kernel/config/loader.ts` `deepMerge` now skips `__proto__` / `constructor` / `prototype` keys, closing the lane where a hostile config layer (settings.json, overrides) could mutate the merged config's prototype chain via the `additionalProperties: true` opening inside `plugins[*].config`.
  - **H2** — `cli/commands/config.ts` `getAtPath` / `setAtPath` / `deleteAtPath` reject pollution-class path segments before walking; `sm config set __proto__.x true` exits 2 with a clear message instead of polluting the running process's prototype chain.
  - **H3** — `kernel/orchestrator.ts` `mergeNodeWithEnrichments` filters pollution keys from every source before copying; a malicious extractor can no longer reshape the merged frontmatter's prototype via persisted `enrichments.value`.
  - **L2** (defense-in-depth) — claude provider strips pollution keys from parsed YAML frontmatter at parse time so downstream `Object.assign`-style merges remain safe even without per-callsite filters.
  - **M1** — new `kernel/util/safe-text.ts` (`stripAnsi`, `sanitizeForTerminal`) wired through ASCII formatter, `sm show`, `sm export`, `sm scan-compare`, `sm conformance`. Disk-sourced strings (titles, paths, issue messages, plugin output) are stripped of ANSI/CSI/OSC escapes and dangerous C0 controls before reaching stdout/stderr.
  - **M2 / L1** — `sm db reset` now whitelists + double-quotes table names taken from `sqlite_master`; `sm db dump --tables` rejects non-identifier names with a clean error.
  - **M3** — `kernel/adapters/plugin-loader.ts` rejects `extensions[*]` entries and `storage.schema(s)` paths whose resolved form escapes the plugin directory (closes the cross-plugin reference lane).
  - **M4** — `conformance/index.ts` validates that case-supplied `fixture` and assertion `path` values stay inside `fixturesRoot` / `scope` before any filesystem read or copy.
  - **M5** — `kernel/adapters/sqlite/plugin-migrations-validator.ts` rejects plugin migrations whose string literals contain `--` or `/*`, closing the validator/exec divergence noted in the audit.
  - **M6** — `kernel/adapters/sqlite/migrations.ts` asserts `Number.isInteger` on the migration version before interpolating it into `PRAGMA user_version`.

  No changes to public APIs; behaviour change is limited to rejecting previously-undefined-but-dangerous inputs.

### Patch Changes

- 3c07b8f: refactor: cli-architect audit follow-up — i18n discipline in built-in plugins, scan-compare delta, plugin-runtime warnings, and `IDbLocationOptions` runtime-context unification

  Internal hygiene only. No spec changes, no public CLI surface change, no behavioural change to output bytes — every promoted renderer keeps producing the same text it produced before, only the mechanism (`tx(*_TEXTS.*)`) changed. `cli/util/db-path.ts` is CLI-internal (not exported via `src/index.ts` or `src/kernel/index.ts`), so the helper signature change is a no-op for downstream consumers.

  **F1 — `scan-compare` delta render lifted to the catalog**

  `cli/commands/scan-compare.ts` (lines 217-263) was rendering the human delta with hardcoded English strings (`'Delta vs ...'`, `'## nodes'`, `'## links'`, `'## issues'`, `+`/`-`/`~` row prefixes). The previous i18n sweep had missed it. 11 new keys land in `cli/i18n/scan.texts.ts` (`compareDeltaSummary`, `compareDeltaNoDifferences`, plus header / row catalog entries for nodes / links / issues) and the renderer routes through `tx()` end-to-end.

  **F2 — `built-in-plugins/` joins the `tx()` discipline**

  Every `Issue.message` produced by a built-in rule and every line emitted by the ASCII formatter were inline English templates. `Issue.message` strings persist in `scan_issues.message` and surface through `sm check` / `sm show` / `sm export` — they are user-facing exactly like CLI stdout, so the same i18n rule applies. New directory `src/built-in-plugins/i18n/` ships six catalogs (`broken-ref.texts.ts`, `superseded.texts.ts`, `trigger-collision.texts.ts`, `validate-all.texts.ts`, `link-conflict.texts.ts`, `ascii.texts.ts`) and each built-in migrates to `tx(*_TEXTS.*)`. AGENTS.md gains a bullet under "i18n strategy" extending the rule to `built-in-plugins/`.

  **F3 — `IDbLocationOptions` extends `IRuntimeContext` (closes TODO M3)**

  The TODO left in the previous audit pass (`cli/util/db-path.ts`) is now closed. `IDbLocationOptions` extends `IRuntimeContext`, so `cwd` and `homedir` are mandatory; the helper no longer reads `process.cwd()` / `homedir()` directly. The local duplicate `resolveDbPath` in `cli/commands/plugins.ts` is dropped and that file imports the canonical helper. 21 call sites across 11 commands (`export`, `list`, `show`, `history`, `orphans`, `check`, `graph`, `db`, `version`, `plugins`, plus the related util) thread `{ ...defaultRuntimeContext() }` at the call edge.

  **F4 — `plugin-runtime.formatWarning` catalogued**

  `cli/util/plugin-runtime.ts:formatWarning` was composing `'plugin <id>: <status> — <reason>'` inline. New catalog `cli/i18n/plugin-runtime.texts.ts` ships `PLUGIN_RUNTIME_TEXTS.warningRow` + `warningReasonMissing`; `formatWarning` now routes through `tx()`.

  **F5 — `export.ts` deferred-format reason catalogued**

  The raw English `reason` string `'lands at Step 12 with the mermaid formatter'` interpolated by `cli/commands/export.ts` moves to `EXPORT_TEXTS.formatDeferredReasonMermaid`.

  **F6 — orphan JSDoc cleanup in `init.ts`**

  A JSDoc block documenting `ensureGitignoreEntries` had drifted on top of `previewGitignoreEntries` after a previous refactor. Moved back to its rightful function.

  **F7 — `confirm.ts` yes-pattern catalogued**

  `cli/util/confirm.ts` hardcoded `/^y(es)?$/i`. The regex source moves to `UTIL_TEXTS.confirmYesPatternSource` and the helper compiles it with the `i` flag. Trivial today but pre-wires the day a non-English locale lands (`^(y(es)?|s(í|i)?)$`).

  **F10 — `storage-adapter.ts` header docstring rewording**

  The header of `kernel/adapters/sqlite/storage-adapter.ts` claimed `enrichments` was a top-level property of the adapter class. It is not — `enrichments` lives on `ITransactionalStorage` (handed out via `port.transaction(...)`). Reworded to match.

  **Validation**

  `npm run -w src build` clean, `npm run lint` clean, `npm test -w src` 693/693 pass, `tsc --noEmit` clean.

- 62d3124: refactor: cli-architect audit follow-up — i18n discipline, runtime-context sweep, ExitCode literal cleanup

  Internal hygiene only. No spec changes, no public CLI surface change, no behavioural change to output bytes — every promoted renderer was audited against its existing tests and the regenerated `context/cli-reference.md` is byte-identical to the pre-sweep version under matching CLI / spec versions (the diff in this commit is the legitimate version drift, not an i18n regression).

  **M1 — i18n discipline in `cli/commands/help.ts`**

  Promoted every hardcoded English string in `renderMarkdown` / `renderVerbBlock` / `renderVerbFlags` / `renderVerbExamples` / `renderSingle` to `cli/i18n/help.texts.ts`. 14 new keys: `mdReferenceTitle`, `mdGeneratedNotice`, `mdCliVersionLine`, `mdSpecVersionLine`, `mdHeaderGlobalFlags`, `mdGlobalFlagBullet`, `mdCategoryHeading`, `mdVerbHeading`, `mdLabelFlags`, `mdLabelExamples`, `mdFlagBullet` (+ `mdFlagBulletRequiredFragment` / `mdFlagBulletDescriptionFragment` for the optional trailing slots), `mdExampleBullet`, `humanVerbHeader`, `humanLabelFlags`, `humanFlagRow` (+ `humanFlagRowRequiredFragment`). Markdown structural pieces (code-fence backticks, table pipes) stay inline — they are syntax, not user-facing prose.

  **M2 — `refresh.ts` "read failed for &lt;path&gt;: &lt;err&gt;" sub-detail catalogued**

  `#runDetExtractorsAcrossNodes` was composing the inner error string via TS template inside the `tx(REFRESH_TEXTS.refreshFailed, …)` call. Lifted the inner copy to `REFRESH_TEXTS.readFailedDetail` (`'read failed for {{path}}: {{message}}'`) and the call site now nests a `tx(…)` for the detail inside the outer `refreshFailed`. Same output bytes, but every translatable substring is now in the catalog.

  **M3 — `defaultRuntimeContext()` sweep across `cli/commands/`**

  Replaced direct `process.cwd()` / `homedir()` reads with `defaultRuntimeContext()` in: `init.ts` (and the `runFirstScan` helper now takes `homedir` as a parameter), `jobs.ts`, `refresh.ts`, `scan-compare.ts`, `config.ts` (`ConfigSetCommand` / `ConfigResetCommand`), `plugins.ts` (`resolveSearchPaths`, `resolveDbPath`, `buildResolver`, `loadAll`, `expandHome`, `collectExplorationDirWarnings`, `TogglePluginsBase`), and `cli/util/plugin-runtime.ts` (`resolveSearchPaths`, `dbPathForScope`). The `cli/**` layer is allowed to call Node globals, but funnelling them through one helper keeps the future "drive the CLI from a non-process host" path clean and matches the pattern already established in earlier audit sweeps.

  **M3 deferred — `cli/util/db-path.ts` carries a TODO**

  `resolveDbPath` (and its `IDbLocationOptions` shape) still reads `homedir()` and `process.cwd()` directly. Promoted to a `TODO(cli-architect M3)` block in the file's docstring rather than rewritten inline because flipping the signature touches 18 call sites across 11 commands for a helper that lives in `cli/util/` (not in `kernel/**`, where the no-Node-globals invariant actually bites). The comment names the exact follow-up: extend `IDbLocationOptions` from `IRuntimeContext`, drop the imports, thread `...defaultRuntimeContext()` at every call site.

  **L1 / L2 — `ExitCode.Error` literal cleanup**

  Replaced three remaining `2` integer literals with `ExitCode.Error`: `db.ts:623,655` (plugin-migration failure paths) and `config.ts:202` (config-load failure path). Aligns with the H1 sweep from the prior audit pass that migrated 123 sites.

  **Validation**

  `npm run lint` clean, `npm run typecheck -w src` clean, `npm test -w src` 693/693 pass, `npm run validate` clean, `npm run cli:check` clean (the `context/cli-reference.md` regen in this commit reflects normal CLI / spec version drift since the file was last regenerated; the i18n sweep verified byte-identical render at HEAD's pre-sweep version values).

- 7d14da9: refactor: cli-architect re-audit follow-up — dedupe `dbPathForScope`, share `SKILL_MAP_DIR` const, fold trigger-collision joiner into the i18n template

  Internal hygiene only. No spec changes, no public CLI surface change, no behavioural change to output bytes — every emitted string keeps its previous value (the test suite covers the affected paths and stays green); only the indirection moved.

  **N1 — `dbPathForScope` helper dropped from `cli/util/plugin-runtime.ts`**

  `buildEnabledResolver` was reimplementing the project=cwd vs global=homedir DB-path resolution that already lives in `resolveDbPath` (`cli/util/db-path.ts`). The local helper plus its private `DB_FILENAME` constant are removed; the resolver now calls `resolveDbPath({ global: scope === 'global', db: undefined, ...ctx })` directly. Single source of truth for the canonical `--db > --global > project` precedence.

  **N2 — `SKILL_MAP_DIR` constant shared between `db-path.ts` and `init.ts`**

  `cli/commands/init.ts` was constructing `join(scopeRoot, '.skill-map')` with the literal duplicated from the convention encoded in `cli/util/db-path.ts`. New exported const `SKILL_MAP_DIR = '.skill-map'` lands in `db-path.ts` with a docstring explaining the per-scope layout. `init.ts` imports and uses it; the internal `DEFAULT_PROJECT_DB` / `DEFAULT_GLOBAL_DB` constants now derive from `${SKILL_MAP_DIR}/${DB_FILENAME}` instead of re-typing the literal. Future changes to the directory convention happen in one place.

  **N3 — Trigger-collision joiner moved inside the `tx()` template**

  `built-in-plugins/i18n/trigger-collision.texts.ts` was exposing `partsJoiner: '; and '` as a separate key that the rule code stitched into the message via `parts.join(...)`. The joiner sat outside the template, which means a future `es` locale would need to patch rule code, not just the catalog. Replaced the `(message, partsJoiner)` pair with two templates: `messageOnePart` (`'Trigger "{{normalized}}" has {{part}}.'`) and `messageTwoParts` (`'Trigger "{{normalized}}" has {{first}}; and {{second}}.'`). `analyzeTriggerBucket` picks the template based on `parts.length` and a comment documents that `parts.length ∈ {1, 2}` by construction (advertiser-ambiguous and cross-kind-ambiguous are mutually exclusive — the latter requires `advertiserPaths.length === 1` — so the two-part path is exactly advertiser-ambiguous + invocation-ambiguous). The `'; and '` joiner now lives entirely inside the catalog; a future `'; y '` swap is a single-key edit.

  **Validation**

  `npm run -w src build` clean, `npm run lint` clean, `npm test -w src` 693/693 pass.

- 4080efd: refactor: i18n discipline sweep across CLI renderers + storage-port-promotion follow-up

  Internal tightening only. No spec changes, no public CLI surface change, no behavioural change to output bytes — every promoted renderer was audited against its existing tests (notably the `sm job prune` colon alignment and `renderStats` join semantics).

  **Storage port follow-up (Phase F leftovers)**

  - `StoragePort.migrations` gains `currentSchemaVersion(): number | null`, implemented in `SqliteStorageAdapter` via `withRawDb` + `PRAGMA user_version`. `cli/commands/version.ts` now resolves the DB schema version through the port + `tryWithSqlite` instead of importing `node:sqlite` directly. The `existsSync` short-circuit (no provisioning for an informational read) is preserved by `tryWithSqlite`.
  - Cleaned up Phase D/F residue: dropped `void sql;` + the unused `sql` import in `kernel/adapters/sqlite/plugins.ts`; dropped the empty residual import from `cli/commands/plugins.ts`; dropped the unused `existsSync` import in `cli/commands/scan.ts`; dropped `void join;` + the unused `join` import in `cli/commands/jobs.ts`. Refreshed the `db` getter docstring on `SqliteStorageAdapter` (was tagged "Pre-Phase F" — Phase F is DONE; rewrote it as the documented test-only escape hatch).

  **i18n discipline sweep**

  Promoted hardcoded English strings inside CLI command renderers to their `*_TEXTS` catalogs, per the AGENTS.md i18n strategy ("every CLI command sources its strings from a sibling `cli/i18n/<verb>.texts.ts` via `tx(*_TEXTS.<key>)`"):

  - `sm db migrate` apply / dry-run output (`Nothing to apply`, `Would apply N`, `Already up to date`, `Applied N`, `Applied N · backup: …`) → `DB_TEXTS`.
  - `sm history` validation errors (`--limit` / `--period` / `--top`), the internal schema-validation error, render-table headers, and the entire `renderStats` block (window, totals, error rate, top actions/nodes, failures by reason) → `HISTORY_TEXTS`.
  - `sm job prune` pretty output (tag, retention rows, orphan-files row, verbs, `formatPolicy('never')`) → `JOBS_TEXTS`. Colon alignment for `failed:    policy …` preserved verbatim.
  - `sm list` render-table column headers → `LIST_TEXTS`.
  - `sm orphans undo-rename` no longer concatenates English directly into `scan_issues.message`; routed through `tx(ORPHANS_TEXTS.undoRenameOrphanMessage, …)` (with a docstring noting the ideal layering would be kernel-side).
  - `sm plugins` list / show renderers (`renderBuiltInBundleRow`, `renderPluginRow`, `renderBuiltInDetail`, `renderPluginDetail`, `renderExtensionsList`) → `PLUGINS_TEXTS`.
  - `sm show` human renderer (`renderHuman`, `renderNodeHeader`, `renderIssuesSection`, `renderLinksSection` — section headers, `(none)` placeholder, optional-field rows, weight/tokens/external refs lines, issue rows) → `SHOW_TEXTS`.
  - New `cli/i18n/util.texts.ts` (`UTIL_TEXTS`) for cross-cutting strings: `db-path` `dbNotFound`, `elapsed` `done in <…>`, `confirm` `[y/N]` suffix.

- 33383c9: Security audit fixes (cli-hacker sweep):

  - Sanitize ANSI escape sequences and C0 control bytes in `sm check`, `sm history`, `sm list`, `sm orphans`, `sm plugins` output (defense in depth — values originate from plugin-authored strings persisted in the DB).
  - Upgrade `stripAnsi()` regex in `kernel/util/safe-text.ts` to the strip-ansi v7 pattern so OSC 8 hyperlinks (with `:/?#&=` chars in the URL) strip cleanly instead of leaving the URL fragment behind.
  - Reject `node.path` values that are absolute or escape the repo root in `sm refresh` (defense in depth against tampered DB files); shared helper at `cli/util/path-guard.ts`.
  - Skip symlinks explicitly in the built-in claude `walkMarkdown` (audit M7); document that `scan.followSymlinks` is reserved for a future cycle-aware implementation.
  - Pin `js-yaml` schema to `JSON_SCHEMA` in the claude provider's frontmatter parser.
  - Preserve `0o600` permissions on `sm db restore`.
  - Sanitize `--log-level` raw input before printing the invalid-level warning.
  - Sanitize conformance case id before using it as the `mkdtemp` prefix.
  - Move `truncate(...)` into a shared `cli/util/text.ts` and make it UTF-8 safe (split on code-point boundaries via `Array.from`).
  - Document untrusted-repository plugin auto-loading risk in the CLI README.

  No behavioral changes for trusted inputs; only hardens output rendering and edge-case validation.

- Updated dependencies [f8fca25]
  - @skill-map/spec@0.11.0

## 0.8.0

### Minor Changes

- bb7ff01: Audit cleanup pass — close four mechanical items from the
  `cli-architect` audit in a single sweep. **Pre-1.0 minor bump** per
  `spec/versioning.md` § Pre-1.0; the API changes below are technically
  breaking but ship as a minor while the package stays `0.Y.Z`.

  ## V5 — kernel stops reading Node globals

  `ILoadConfigOptions.cwd` / `.homedir` and `ICreateFsWatcherOptions.cwd`
  are now **mandatory**. Previously they fell back to `process.cwd()` /
  `os.homedir()` inside the kernel — which broke the kernel-isolation
  invariant the linter enforces elsewhere. New helper
  `src/cli/util/runtime-context.ts#defaultRuntimeContext()` wraps
  `{ cwd: process.cwd(), homedir: homedir() }`; the CLI threads it
  through every `loadConfig` / `createChokidarWatcher` call. Eight CLI
  sites migrated (`scan`, `watch`, `jobs`, `scan-compare`, `plugins`,
  `config` × 3, `init`, `plugin-runtime` resolver) plus seven test sites
  in `watcher.test.ts`.

  **Breaking** for any external consumer of `loadConfig` /
  `createChokidarWatcher` that relied on the implicit fallback — they
  now must pass `cwd` (and `homedir` for `loadConfig`) explicitly.

  ## V8 — no more `pluginId` mutation in plugin-runtime

  `ILoadedExtension` gains an `instance: unknown` field alongside
  `module: unknown`. The loader now shallow-clones the runtime instance
  (default export, or the module namespace when none) and injects
  `pluginId` per spec § A.6, exposing the result as `instance`. The CLI
  runtime composer (`bucketLoaded`) consumes `ext.instance` directly —
  the previous post-hoc mutation of `instance['pluginId']` is gone, and
  the obsolete `extractDefault` helper with it.

  The bug this closes: two plugins importing the same file via the ESM
  module cache shared a single mutable object, so the second `pluginId`
  assignment stomped the first. Centralising the clone in the loader
  makes the issue structurally impossible.

  **Additive** at the type level (`instance` is a new field consumers
  read; only the loader produces it).

  ## V9 — `confirm()` accepts streams from the Clipanion context

  `src/cli/util/confirm.ts` now takes
  `confirm(question, { stdin, stderr })` instead of reaching for
  `process.stdin` / `process.stderr`. Every command site
  (`db restore`, `db reset --hard`, `db reset --state`,
  `orphans undo-rename`) passes `this.context.stdin` /
  `this.context.stderr`, so commands become testable with captured
  streams instead of monkey-patching the globals.

  **Breaking** for any external caller of the helper (none expected —
  it lives under `src/cli/util/`).

  ## D7 — extracted `isBundleEntryEnabled` helper

  The toggle-resolution logic
  (`if (granularity === 'bundle') resolveEnabled(bundle.id) else
resolveEnabled(qualifiedExtensionId(...))`) was duplicated between
  `isBuiltInExtensionEnabled` (typed `TBuiltInExtension`) and the inline
  filter inside `filterBuiltInManifests` (raw `IPluginManifest.id`). A
  new private helper `isBundleEntryEnabled(bundle, extId, resolveEnabled)`
  operates on the plain extension id; both call sites delegate to it.
  Pure refactor, no behaviour change.

  ## Out of scope

  The audit's SD4 item (88 references to "Step N / Phase N" in kernel
  docstrings) is deferred to a dedicated docs pass — too large for a
  mechanical sweep.

- d058bf8: Close H1 / M1 / M3 from the cli-architect review.

  - **kernel — `IExtractorContext.store` wiring (spec § A.12)**: `RunScanOptions.pluginStores?: ReadonlyMap<string, IPluginStore>` is threaded through `walkAndExtract → runExtractorsForNode → buildExtractorContext` and surfaced on `ctx.store`. Legacy contract preserved (no entry for a plugin id → `ctx.store` stays `undefined`). The orchestrator never touches the wrapper's persist callback; driving adapters supply it. New public exports on `kernel/index.ts`: `IPluginStore`, `IKvStoreWrapper`, `IDedicatedStoreWrapper`, `IKvStorePersist`, `IDedicatedStorePersist`, `makePluginStore`, `makeKvStoreWrapper`, `makeDedicatedStoreWrapper`, `KV_SCHEMA_KEY`.
  - **cli — `sm version --json`**: emits `{ sm, kernel, spec, dbSchema }` exactly per `spec/cli-contract.md` § `sm version`. The orphan `json = false` field is gone; the option is wired through Clipanion. `runtime` stays in human-only output (spec lists four JSON fields).
  - **cli — `sm orphans reconcile --dry-run` / `sm orphans undo-rename --dry-run`**: previews the FK migration without mutating. Rollback is forced via a sentinel symbol thrown inside the Kysely transaction so the dry-run path runs the same `migrateNodeFks` code as live mode (no count-only divergence). Per spec § Dry-run, `--dry-run` skips the `--force` confirm prompt entirely.
  - **cli — refresh stream discipline (M1)**: mid-action banners (`refreshingStale`, `refreshingNode`) move from stdout to stderr so a future `--json` mode (or any pipe consumer) sees only the payload.
  - **cli — printer abstraction**: new `cli/util/printer.ts` exposing `IPrinter { data, info, warn, error }` with a `quietInfo` flag for `--json` gating. Optional helper for verbs that opt in.
  - **cli — orphans i18n migration**: ten new entries in `cli/i18n/orphans.texts.ts` replacing inline string templates in `reconcile` and `undo-rename`.

  Tests:

  - `test/orchestrator-ctx-store.test.ts` (new, 5 cases): pluginStores absent → `undefined`; pluginStores entry matches `pluginId` → wrapper inyected, persist captures writes; multi-plugin without leakage; plugin without entry stays `undefined`; `runExtractorsForNode` honours the same wiring.
  - `test/orphans-cli.test.ts` (+ 2 cases): `reconcile --dry-run` + `undo-rename --dry-run` both leave `state_executions` and `scan_issues` UNCHANGED.
  - `test/cli.test.ts` (+ 1 case): `sm version --json` emits the four-field shape per spec.
  - `test/node-enrichments.test.ts`: updated to expect `Refreshing enrichments for` on stderr after the M1 banner move.

  What is NOT in this PR (deferred):

  - The CLI side of H1 (Mode A persister against `state_plugin_kvs`, Mode B dedicated-table persister) is out of scope until the first plugin declares `storage`. The kernel seam ships now so any future driver can plug in without an orchestrator change.

- b5a1a1e: Correct misclassified exit codes in `sm export` and `sm graph`.

  Per `spec/cli-contract.md` § Exit codes, exit `5` is reserved for
  "DB missing"; user/argument errors return `2`. The two verbs were
  returning `5` for cases that have nothing to do with a missing DB —
  unsupported `--format`, invalid `--query`, deferred formatters, no
  formatter registered.

  **Sites corrected:**

  - `sm export --format mermaid` (deferred to Step 12) → `2` (was `5`).
  - `sm export --format <unsupported>` → `2` (was `5`).
  - `sm export --query '<invalid>'` → `2` (was `5`).
  - `sm graph --format <no-formatter-registered>` → `2` (was `5`).

  Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0: this changes a
  user-observable contract (exit code) so it ships as a minor while the
  package is `0.Y.Z`. Header comments on both verbs and three
  test-suite assertions updated.

- 698dd5d: Introduce `LoggerPort` on the kernel and a concrete CLI `Logger`
  adapter, replacing the last direct `console.error` write inside the
  kernel.

  **Why.** The kernel must not write to stdout/stderr directly — that's
  an adapter concern. Until now the orchestrator's probabilistic-hook
  deferral notice was a `console.error` call, which made kernel output
  untestable, unconfigurable, and impossible to silence from an embedded
  host.

  **What.**

  - New `LoggerPort` (`trace` / `debug` / `info` / `warn` / `error`)
    with `LogLevel` (incl. `silent` sentinel), `LogRecord`, and helpers
    (`parseLogLevel`, `logLevelRank`, `isLogLevel`, `LOG_LEVELS`).
  - New `SilentLogger` no-op default — equivalent in spirit to
    `InMemoryProgressEmitter`.
  - New module-level singleton (`log` proxy + `configureLogger` /
    `resetLogger` / `getActiveLogger`). Imports made before bootstrap
    see the new impl on every call — no captured-stale-logger bugs.
  - New CLI `Logger` (level + stream + format), default formatter
    `HH:MM:SS | LEVEL | message [| ctx]` (local time, stderr).
  - `entry.ts` pre-parses `--log-level` (flag wins over
    `SKILL_MAP_LOG_LEVEL` env var, fallback `warn`) before Clipanion
    sees argv, then calls `configureLogger(...)`.
  - Orchestrator's `console.error` → `log.warn(...)` with structured
    `{ hookId, mode }` context; the `logger` knob on `runScan` /
    `makeHookDispatcher` is gone (singleton replaces it).

  Tests that previously monkey-patched `console.error` now install an
  in-test `LoggerPort` via `configureLogger(...)` and restore via
  `resetLogger()` in `finally`.

- 124ccda: Open `Node.kind` and `IProvider.classify` to `string` end-to-end on the TS side (Phases B + C).

  Phase A (spec) shipped the contract; this lands the TypeScript runtime to match. Three layers move:

  - **`Node.kind: string`** (was `NodeKind`). The orchestrator, persistence layer, and every renderer accept whatever an enabled Provider classifies into — built-in Claude catalog kinds (`skill` / `agent` / `command` / `hook` / `note`) plus anything an external Provider declares.
  - **`IProvider.classify(...) → string`** (was `→ NodeKind`). Cursor / Obsidian / Roo Providers can return their own kinds without the `as NodeKind` cast that previously lied to the type system.
  - **`TNodeKind = string`** in `kernel/adapters/sqlite/schema.ts` (was the closed five-value union). The `as NodeKind` cast in `rowToNode` (`scan-load.ts`) is gone.

  `NodeKind` survives as an exported type alias for the **built-in Claude Provider catalog only**, with a docstring clarifying it is no longer the kernel-wide kind type. Code that intentionally narrows on the five claude kinds (the `validate-all` rule's per-kind frontmatter schema map, the `KIND_ORDER` rendering arrays, claude-aware UI cards) keeps using it. Code that handles arbitrary kinds widens to `string`.

  Side effects:

  - **`sm export`'s query parser drops the closed-enum check** for `kind=...` clauses. `kind=widget` is now structurally valid (open-by-design); it matches zero nodes if no Provider classifies into `widget`. Empty values (`kind=`) still error. Matches `node.schema.json#/properties/kind`.
  - **`ascii` formatter and `sm export`'s markdown renderer**: nodes are bucketed by an open string. Built-in Claude catalog renders first in canonical order; external-Provider kinds append after, alphabetically sorted, so output stays deterministic across runs.
  - **`built-in-plugins/rules/trigger-collision`**: `ADVERTISING_KINDS` is now `ReadonlySet<string>` (still containing the same three claude kinds); the rule applies if `node.kind` is in the set, and external Providers can extend the set in a future release without touching the rule.

  Tests: `extractor-applicable-kinds.test`, `self-scan.test`, and `export-cli.test` updated where they pinned `NodeKind`-typed accumulators. The "rejects unknown kind value" parser test became "accepts arbitrary kind tokens" (the parser no longer enforces a closed enum); the "invalid query → exit 2" verb test was rewritten to use `confidence=high` (an actually-unknown key) instead of `kind=widget`.

  What's still pending:

  - **Phase D** — the SQL `CHECK in (<5 values>)` constraints on `scan_nodes.kind` and `state_summaries.kind` are still live in `001_initial.sql`. They run on every existing DB. Pre-1.0 the right move is a fold of the change directly into `001_initial.sql` (no separate migration), mirroring how `002_scan_meta` was folded back; that lands in a follow-up commit.
  - **Phase E** — smoke test with a fake external Provider end-to-end, conformance suite re-run.

  Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0 (technically breaking for code that imported `NodeKind` and assumed it was the kernel-wide kind type, but pre-1.0 these go as minor).

- 558cf43: Replace the placeholder `PluginLoaderPort` shape with the real
  contract the concrete loader has been exposing since Step 0b, and
  pin the adapter to the port via `implements PluginLoaderPort`.

  **Why.** The port was authored as Step-0b stubs (`discover` / `load` /
  `validateManifest`, plus `PluginManifest` / `PluginStorage` /
  `LoadedExtension` types) and never updated when the real loader
  landed. Two latent risks: callers who imported from the ports barrel
  got a different shape than the actual class; and the concrete adapter
  was free to drift from the port silently. Both eliminated.

  **What.**

  - `PluginLoaderPort` now declares `discoverPaths()`,
    `discoverAndLoadAll()`, `loadOne(path)` — verbatim mirror of
    `kernel/adapters/plugin-loader.ts`.
  - The placeholder DTOs are gone; the port re-exports the real domain
    types (`IPluginManifest`, `ILoadedExtension`, `IDiscoveredPlugin`,
    `IPluginStorageSchema`, `TGranularity`, `TPluginLoadStatus`,
    `TPluginStorage`) from `kernel/types/plugin.ts`.
  - `class PluginLoader implements PluginLoaderPort` — drift is now a
    compile error.
  - New factory `createPluginLoader(opts): PluginLoaderPort`. The CLI
    call sites (`commands/plugins.ts`, `util/plugin-runtime.ts`) use it
    so production callers are pinned to the abstract shape; tests keep
    `new PluginLoader(...)` for legitimate access to internals.
  - Re-exports through `kernel/index.ts` and `kernel/ports/index.ts`
    swapped to the real domain types (already shipped in the previous
    Logger commit alongside the new `LoggerPort` exports).

- 91fea6a: Split the orchestrator's `walkAndExtract` into three named helpers and
  close audit item V4 by reusing the kernel's extractor loop from
  `sm refresh`. **Pre-1.0 minor bump** per `spec/versioning.md` § Pre-1.0;
  the API addition below would warrant a minor on its own, and the
  internal split is non-breaking (no public signature changes).

  ## Why

  `walkAndExtract` was the audit's most-flagged complexity offender
  (cyclomatic 47 — by a wide margin the worst offender in the kernel).
  Three logically distinct concerns lived in the same function:
  extractor-execution wiring, per-(node, extractor) cache decision, and
  the reused-node bundle for full cache hits. Splitting them buys
  readability, isolates the `IExtractorContext` plumbing in one place
  that `refresh.ts` can reuse, and unblocks the next round of audit
  follow-ups.

  Independently, `cli/commands/refresh.ts#runExtractorForEnrichment` was
  hand-duplicating the extract-and-fold dance: it built its own
  `IExtractorContext`, did the scope-aware `body` / `frontmatter`
  gating, folded partials into a single record, and hardcoded
  `isProbabilistic: false`. That was audit item V4, and the hardcode was
  a latent correctness bug — a probabilistic extractor passed to refresh
  persisted with `isProbabilistic: false` while the in-scan path
  correctly read `extractor.mode === 'probabilistic'`.

  ## What

  ### `src/kernel/orchestrator.ts` — three new helpers

  - **`runExtractorsForNode(opts)`** — `export`ed. Runs N extractors
    against a single node and returns
    `{ internalLinks, externalLinks, enrichments }`. Encapsulates the
    `IExtractorContext` build + `emitLink` / `enrichNode` callback
    wiring + per-`(node, extractor)` enrichment folding. Reuses the
    existing private helpers (`buildExtractorContext`, `validateLink`,
    `isExternalUrlLink`).
  - **`computeCacheDecision(opts)`** — internal. Returns
    `{ applicableExtractors, applicableQualifiedIds, cachedQualifiedIds,
missingExtractors, fullCacheHit }` for one node. Handles both the
    fine-grained `priorExtractorRuns` case and the legacy fallback
    (when the caller did not load breadcrumbs — preserves the pre-A.9
    contract).
  - **`reusePriorNode(opts)`** — internal. Builds the reused-node
    bundle for a full cache hit: shallow-clones the prior node, reshapes
    its outbound links per A.9 sources rules
    (`reuseCachedLink(...)`), re-emits prior frontmatter issues with the
    current `strict` severity, and persists `scan_extractor_runs` rows
    for every still-applicable, still-cached pair so the cache survives
    the next `replace-all` persist.

  `walkAndExtract` complexity dropped **47 -> 35** (-12 points). The
  two new private helpers sit at 9 and 10 — just above the lint
  threshold of 8 — so visible debt remains, but the net architectural
  improvement is the worth-having change. Promoting `complexity` to
  `error` is deferred until the next round of splits brings the
  remaining offenders down.

  ### `src/kernel/index.ts` — export `runExtractorsForNode`

  Added to the orchestrator export block. New public kernel API; the
  shape mirrors `walkAndExtract`'s internal call exactly so embedders
  can reproduce a single-node extract pass without going through a full
  scan.

  ### `src/cli/commands/refresh.ts` — close audit V4

  `runExtractorForEnrichment` now delegates to `runExtractorsForNode`
  with a single-element extractor array. Refresh keeps the returned
  `enrichments` and discards the link arrays — link rebuilding is
  `sm scan`'s job and refresh stays scoped to the enrichment layer.
  ~30 lines of duplication eliminated; the `isProbabilistic` field now
  correctly reflects `extractor.mode === 'probabilistic'`. Imports
  trimmed accordingly (`qualifiedExtensionId`, `IExtractorContext`,
  `Link` are no longer needed); `InMemoryProgressEmitter` is added
  as a throwaway emitter to satisfy the new API surface — refresh does
  not expose progress events.

  ### `package.json` (root) — `validate` script also runs tests

  `npm run validate` was lint-only; it now runs `npm run test &&
npm run lint --workspaces --if-present`. Intentional — local
  `validate` becomes a proper pre-push gate. CI's `build-test` workflow
  already runs tests separately, so the "Validate" step now overlaps
  with it; that overlap is acknowledged and left for a follow-up
  decision.

  ## Out of scope

  The remaining `walkAndExtract` complexity (35) is still above the
  threshold; further splits (provider walk, per-node frontmatter
  validation) will follow in the next pass. Bonus correctness fix on
  `isProbabilistic` is documented above but no behaviour test is added
  in this commit — the in-scan path already exercises the field
  correctly, and refresh's caller surface does not currently propagate
  the flag.

- e8cbd19: Storage-port promotion — Phase A (`scans` / `issues` / `enrichments` / `transaction` namespaces).

  Pre-refactor, `StoragePort` modeled only `init` / `close`. All real persistence lived as free functions in `kernel/adapters/sqlite/*.ts` that took `Kysely<IDatabase>` directly, and 8+ CLI commands consumed those free functions plus inline `selectFrom(...)` queries — hexagonal architecture in name only.

  Phase A lands the core scan pipeline:

  - **`kernel/types/storage.ts`** (new) — option bags + result shapes (`INodeFilter`, `INodeBundle`, `INodeCounts`, `IPersistOptions`, `IIssueRow`).
  - **`kernel/ports/storage.ts`** — full namespaced shape declared (full surface, not Phase-A-only). `scans` / `issues` namespaces have method bodies; `transaction(fn)` exposes `ITransactionalStorage` with `scans.persist` / `issues.deleteById,insert` / `enrichments.upsertMany`.
  - **`kernel/adapters/sqlite/storage-adapter.ts`** — implements the namespaces. `scans.persist` delegates to `persistScanResult`, `scans.load` to `loadScanResult`, `findNodes` reproduces `sm list`'s filter logic with a defensive `sortBy` whitelist, `findNode` returns the bundled node + outgoing/incoming links + filtered issues. `transaction(fn)` wraps `Kysely.transaction().execute(...)` and hands the callback a `buildTxSubset(trx)` projection.
  - **9 CLI commands migrated**: `scan`, `list`, `show`, `check`, `orphans`, `refresh`, `export`, `graph`, `watch`. Every `selectFrom('scan_nodes' \| 'scan_issues' \| 'scan_links')`, every `loadScanResult` / `loadExtractorRuns` / `loadNodeEnrichments` / `persistScanResult` direct call, and every `rowToNode` / `rowToLink` / `rowToIssue` import is gone from these files. The two transactional blocks in `orphans.ts` (reconcile + undo-rename) still use `adapter.db.transaction()` directly because they call `migrateNodeFks` (Phase B port surface) — they migrate when Phase B lands.

  Side effect: the CLI no longer needs to know `scan_*` table names or the json_each subquery shape. The free functions in `kernel/adapters/sqlite/scan-load.ts` and `scan-persistence.ts` stay exported for tests and the cross-phase migration; Phase F drops them from `kernel/index.ts`'s public surface.

  Tests: 617/617 pass. `findNodes` carries a defensive sortBy whitelist that mirrors the CLI's own (`list.ts` validates upstream too — defense in depth).

  Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0. Breaking for any caller that imported the kernel-side free functions, but no published consumer exists.

  What's still pending:

  - Phase B — `history` namespace (history.ts + orphans.ts migrateNodeFks).
  - Phase C — `jobs` namespace.
  - Phase D — `pluginConfig` namespace.
  - Phase E — `migrations` + `pluginMigrations` (the `sm db` verb).
  - Phase F — cleanup (drop unused free functions from `kernel/index.ts`, remove residual `import type { Kysely, IDatabase }` in CLI).

- 19fbc08: Storage-port promotion — Phase B (`history` namespace).

  - **Port surface**: `port.history.list(filter)`, `port.history.aggregateStats(range, period, top)` for the read paths; `tx.history.migrateNodeFks(from, to)` (transactional) for the FK-repointing primitive.
  - **Adapter**: `SqliteStorageAdapter.history` delegates to the existing `listExecutions` / `aggregateHistoryStats` / `migrateNodeFks` free functions in `kernel/adapters/sqlite/history.ts`. Bodies stay; the namespace is a thin façade.
  - **CLI migrated**: `cli/commands/history.ts` — `aggregateHistoryStats(adapter.db, ...)` → `adapter.history.aggregateStats(...)`; `listExecutions(adapter.db, ...)` → `adapter.history.list(...)`. `cli/commands/orphans.ts` — both transactional blocks (reconcile + undo-rename) move to `adapter.transaction(tx => tx.history.migrateNodeFks(...))` plus `tx.issues.deleteById` / `tx.issues.insert`. The `runWithOptionalRollback` helper now takes the adapter and a port-subset callback (instead of `Kysely<IDatabase>`); the `--dry-run` rollback-via-sentinel pattern is identical.

  Side effect: the last `adapter.db.transaction()` direct call in CLI is gone. `orphans.ts` no longer imports `migrateNodeFks` directly, no longer touches `Kysely` / `IDatabase`. The free function `migrateNodeFks` stays exported (used by `scan-persistence.ts`); Phase F drops it from `kernel/index.ts`'s public surface if no caller reaches over.

  617/617 tests pass; npm run validate exit 0. Pre-1.0 minor bump.

- 19fbc08: Storage-port promotion — Phase C (`jobs` namespace).

  - **Port**: `port.jobs.pruneTerminal(status, cutoffMs)`, `port.jobs.listTerminalCandidates(status, cutoffMs)` (the dry-run preview surface), `port.jobs.listOrphanFiles(jobsDir)`.
  - **Adapter**: `SqliteStorageAdapter.jobs` delegates to `pruneTerminalJobs` / `listOrphanJobFiles`. The dry-run candidate enumeration moves into the adapter as `listTerminalCandidates(...)` (mirrors the SELECT side of `pruneTerminalJobs` without the DELETE), so the CLI no longer hand-rolls the same query.
  - **CLI migrated**: `cli/commands/jobs.ts` — `pruneTerminalJobs(adapter.db, ...)` → `adapter.jobs.pruneTerminal(...)`; `listOrphanJobFiles(adapter.db, jobsDir)` → `adapter.jobs.listOrphanFiles(jobsDir)`; the inline `selectFrom('state_jobs')` dry-run preview collapses into `adapter.jobs.listTerminalCandidates(...)`. `pruneOrPreview` is now a one-line ternary.

  617/617 tests pass; npm run validate exit 0. Pre-1.0 minor bump.

- 19fbc08: Storage-port promotion — Phase D (`pluginConfig` namespace).

  - **Port**: `port.pluginConfig.set / get / list / delete / loadOverrideMap`. The `set` upserts a per-plugin enabled override into `config_plugins`; `loadOverrideMap` returns the full map for layering over `settings.json` defaults at scan boot.
  - **Adapter**: `SqliteStorageAdapter.pluginConfig` delegates to the existing free functions in `kernel/adapters/sqlite/plugins.ts`.
  - **CLI migrated**: `cli/commands/plugins.ts` (the `enable / disable` toggle and the override-map loader for `sm plugins doctor`); `cli/util/plugin-runtime.ts` (the same loader used by `loadPluginRuntime` to layer DB overrides at boot). Both files no longer import directly from `kernel/adapters/sqlite/plugins.js`. `deletePluginOverride` was used as a `void`-suppressed import to keep it available for a future `sm config reset`; that comment now points at `port.pluginConfig.delete` instead.

  617/617 tests pass; npm run validate exit 0. Pre-1.0 minor bump.

- 19fbc08: Storage-port promotion — Phase E (`migrations` / `pluginMigrations` namespaces) + Phase F (cleanup).

  **Phase E** ports the kernel + per-plugin migration runners through the port:

  - **Port**: `port.migrations.{discover, plan, apply, writeBackup}` and `port.pluginMigrations.{resolveDir, discover, plan, apply}`. The free functions in `kernel/adapters/sqlite/{migrations,plugin-migrations}.ts` stay as-is (synchronous, raw `DatabaseSync`-based, identical body); the namespace methods wrap them.
  - **Adapter**: a small `withRawDb(path, fn)` helper opens / closes a short-lived `DatabaseSync` per port-method call. The verb's per-method invocations are infrequent (one `discover` + zero-to-three `plan` + zero-to-one `apply` + zero-to-N `pluginMigrations.{plan,apply}`), so the open/close overhead is negligible. The adapter's Kysely connection is unused by the migrations namespace; the migrations runner has its own raw lifecycle by design.
  - **CLI migrated**: `cli/commands/db.ts:DbMigrateCommand.execute` no longer opens its own `new DatabaseSync(path)` — it builds a `SqliteStorageAdapter({ databasePath: path, autoMigrate: false })` and calls `adapter.migrations.discover() / plan() / apply()` plus `adapter.pluginMigrations.plan() / apply()`. `runPluginMigrations` takes the adapter instead of a raw db handle. The CLI no longer imports any free function from the migrations modules.

  **Phase F** finishes the cleanup:

  - The CLI surface no longer contains a single `selectFrom` / `insertInto` / `deleteFrom` / `updateTable` call against any `scan_*` / `state_*` / `config_*` table inside command files (verified via grep). The only remaining non-port `DatabaseSync` opens in CLI are the two administrative SQL paths in `db.ts` — `sm db backup` (PRAGMA wal_checkpoint + copy file) and `sm db reset` (drop tables for a clean slate). Both are intentionally raw — they do schema-management on the file rather than queries against application state.
  - `cli/commands/init.ts` migrated the residual `persistScanResult(adapter.db, ...)` to `adapter.scans.persist(result, { renameOps, extractorRuns, enrichments })`.
  - `kernel/index.ts` re-exports `ITransactionalStorage` plus the new domain types from `kernel/types/storage.ts` (`IIssueRow`, `INodeBundle`, `INodeCounts`, `INodeFilter`, `IPersistOptions`) so external consumers reach them through the canonical entry point.
  - The free functions in `kernel/adapters/sqlite/*.ts` stay exported. Tests still construct `SqliteStorageAdapter` and (post-init) call `persistScanResult(adapter.db, ...)` directly in some places; that survives the refactor — they're testing the adapter implementation, not the port. The plan's "drop the adapter free functions from `kernel/index.ts` public surface" is moot here because they were already not re-exported through `kernel/index.ts`.

  End-state: every CLI command that touches persistence does it through `port.<namespace>.<method>` or `port.transaction(tx => tx.<namespace>.<method>)`. Adding a second adapter (HTTP server, in-memory test harness) is now a matter of implementing the same `StoragePort` interface — no command surgery needed.

  617/617 tests pass; npm run validate exit 0. Pre-1.0 minor bump for E (port surface expansion); F is bundled because the cleanup is the natural conclusion of the same refactor.

### Patch Changes

- bf30b67: Update `AGENTS.md` to reflect the post-sweep lint state: every quality rule is now `'error'` (no more `'warn'` tier), and codify the six categories where `eslint-disable-next-line` is the right answer (CLI orchestrators, parsers, multi-accumulator folds, migration runners, pure column mappers, discriminated-union dispatchers). Anything outside those categories should be split, not disabled — pointers to the canonical split commits included.
- 3cc603b: Close audit items D3 (i18n discipline) and D4 (rename `extensions/`) in
  a single sweep. **Patch bump**: pure refactor + docs; zero public API
  changes, no spec change, no behaviour change. The directory rename and
  the i18n migration are both internal to the workspace.

  ## D4 — rename `src/extensions/` → `src/built-in-plugins/`

  The directory was confusingly close in name to `src/kernel/extensions/`,
  which holds the **contracts** (`IProvider`, `IExtractor`, `IRule`,
  `IFormatter`, `IHook`, …) — not implementations. Renaming the bundled
  implementations to `built-in-plugins/` makes the distinction obvious at
  import sites: "kernel/extensions = what shape; built-in-plugins = what
  code."

  - `mv src/extensions src/built-in-plugins`. Internal layout preserved
    (`built-ins.ts` + `providers/` + `extractors/` + `rules/` +
    `formatters/`).
  - Bulk update of relative imports across 31 files (`from
'../extensions/...'` → `from '../built-in-plugins/...'`, across four
    depth levels). One overshoot caught by hand:
    `kernel/adapters/schema-validators.ts` legitimately imports
    `../extensions/index.js` (the contracts, inside the kernel) — that
    site was restored.
  - `src/tsconfig.json` — `include` updated.
  - `src/package.json` — four test scripts repointed
    (`'extensions/**/*.test.ts'` → `'built-in-plugins/**/*.test.ts'`).
  - `src/cli/util/conformance-scopes.ts` — runtime path resolver and the
    user-facing error message updated to `built-in-plugins/providers/`.
  - `src/test/conformance.test.ts` and
    `src/test/conformance-disable-flags.test.ts` — hardcoded fixture
    paths updated.

  ## D3 — migrate hardcoded CLI strings to the `tx(*_TEXTS.*)` discipline

  Every `cli/commands/*.ts` file that previously emitted user-facing text
  through `this.context.std{out,err}.write('literal string')` now sources
  its strings from a sibling `cli/i18n/<verb>.texts.ts` file. Pattern:
  `tx(<VERB>_TEXTS.<key>, { vars })`.

  - New texts files (8): `show.texts.ts`, `history.texts.ts`,
    `orphans.texts.ts`, `help.texts.ts`, `stubs.texts.ts`,
    `export.texts.ts`, `jobs.texts.ts`, `config.texts.ts`.
  - Extended (2): `check.texts.ts` (+`noIssues`), `db.texts.ts` (+8 keys
    for backup, migrate, status).
  - Migrated sites: `show.ts`, `check.ts`, `history.ts`, `orphans.ts`,
    `help.ts`, `stubs.ts`, `export.ts`, `jobs.ts`, `db.ts`,
    `config.ts`. ~25 hardcoded strings replaced.
  - Pure-passthrough writes (e.g. `this.context.stderr.write(\`${warn}\n\`)`
    relaying an already-formatted plugin warning) were intentionally
    left alone — those carry no locally-authored copy.

  ## AGENTS.md — record both decisions as durable conventions

  Two new sections so future agents do not re-derive these:

  - **"Source layout: built-ins vs extension contracts"** — explains the
    `kernel/extensions/` (contracts) vs `built-in-plugins/`
    (implementations) split with the mnemonic and pointers to where to
    import what.
  - **"i18n strategy: where strings live"** — codifies the rule that CLI
    strings live in `cli/i18n/<verb>.texts.ts` and pass through `tx`.
    Documents the rationale (one greppable catalog, future-locale-ready,
    enforces "no copy-changes hidden in command logic") and the
    passthrough exemption.

  ## Net effect

  - Tests: **602/602 still green**.
  - Build: clean.
  - Lint: still silent (0 errors, 0 warnings).
  - Audit closure: D3 + D4 are the last two `cli-architect` items that
    needed Architect input; only the two big-effort items remain
    (Storage Port refactor and Open Kinds — both scoped in
    `docs/refactors/`).

- 9c5db60: Close L1 / L2 / L3 from the cli-architect review.

  - **L1 — Async FS off the per-node loop**: `cli/commands/refresh.ts` reads each target node's body inside a `for (node of targetNodes)` loop. The read is now `await readFile(...)` from `node:fs/promises` instead of `readFileSync`. The body still serializes today (extractor pass is awaited per node) but routing through `fs/promises` lets the event loop overlap any concurrent kernel work and removes a sync hop that would block on a slow disk. Bootstrap reads (config, settings, schemas, package.json, migration runners) stay sync — those are cold-path or whitelist category 4 in `AGENTS.md`.
  - **L3 — Error reporter helper**: new `cli/util/error-reporter.ts` exporting `formatErrorMessage(err: unknown): string`. Replaces 22 inline duplicates of `err instanceof Error ? err.message : String(err)` across `watch.ts`, `jobs.ts`, `conformance.ts`, `scan.ts`, `db.ts`, `init.ts`, `refresh.ts`, `config.ts`, `scan-compare.ts`. The helper deliberately stays minimal (no `--verbose` stack mode, no JSON envelope) — those grow when a concrete need surfaces.
  - **L2 — `db migrate --to` strict integer parse**: `Number.parseInt` accepted `'123abc'` as `123` and didn't reject negatives, so a typo could silently roll the migration ledger to an unexpected target. Tightened to require `String(parsed) === trimmed && parsed >= 0`; bad input now exits `2` per spec § Exit codes.

  Side effect: the `formatErrorMessage` substitution in `init.ts:runFirstScan` dropped the function below the cyclomatic threshold; removed the no-longer-needed `eslint-disable-next-line complexity`.

  What was a false positive in the original review (no work needed):

  - **L4 — `console.*` mixed with `this.context.std*`**: zero matches in `src/cli/` or `src/kernel/`. The lint rule + existing CLI discipline already enforce this.

- 369213c: Continue the complexity sweep — 5 more functions reduced or disabled with rationale:
  - `splitStatements` — char-by-char SQL state machine; justified inline disable.
  - `plugins.ts:execute` (PluginsListCommand) — extracted `renderBuiltInBundleRow` and `renderPluginRow` per-row helpers.
  - `collectApplicableKindWarnings` — extracted `appendUnknownKindWarnings`.
  - `collectKnownKinds` and `collectExplorationDirWarnings` — extracted shared `forEachProviderInstance` iterator (built-ins + user-plugin Providers in one place).
  - `accumulateExecutionRow` — justified inline disable (5-accumulator fold; per-accumulator helpers wouldn't make the algorithm clearer).
  - `validateAndStrip` — extracted `applyValidationError` per-error helper.
- e9e04c7: Continue the complexity sweep:
  - `refresh.ts:execute` and `scan-compare.ts:execute` — justified `eslint-disable-next-line complexity` with comments. The remaining cyclomatic count comes from CLI ergonomics (multiple try/catch + flag combinatorics) and the inner work already lives in extracted helpers.
  - `kernel/adapters/sqlite/history.ts:aggregateHistoryStats` (18) — extracted `accumulateExecutionRow` for the per-row folding (totals, per-failure-reason, per-action, per-period, per-node). Helper stays at 15 due to the natural multi-accumulator nature of the operation; main function now below threshold.
- aa550a6: Code-quality follow-up to commit `518180d` — final wave of the
  ongoing complexity sweep ("hasta menos de 8") plus a tightening pass
  on the ESLint config so the workspace lint is now fully strict.
  **Patch bump**: zero public API changes (every refactored function
  keeps its exported signature; no new exports); pure internal
  restructuring + dev-tooling.

  ## Why

  The previous round brought the lint baseline to 67 warnings across
  splits + justified disables. This wave closes the remaining offenders
  (splits where naming the steps adds value, disables-with-rationale on
  the orchestrators / parsers / per-row mappers where every branch is
  intrinsic to the contract), then promotes every quality rule from
  `'warn'` to `'error'` so future regressions fail CI instead of
  piling up silently. Net `-67` warnings → **lint is now silent (0
  errors, 0 warnings)**.

  ## What

  ### 1. ESLint config tightening (`src/eslint.config.js`)

  Every quality rule now fails CI instead of warning:

  - `complexity` (max 8)
  - `no-console` (allow `[warn, error, log]`)
  - `@typescript-eslint/no-empty-function`
  - `preserve-caught-error`
  - `no-useless-assignment`

  Plus three hygiene fixes that were latent in the previous config:

  - `no-irregular-whitespace` now uses `{ skipStrings, skipComments,
skipRegExps, skipTemplates }` so legitimate ZWSP / BOM literals
    inside the YAML BOM-detection regex and block-comment escaping in
    docstrings stop firing as errors.
  - `@stylistic/quotes` deprecation closed: `allowTemplateLiterals:
true` → `'always'`.
  - `**/dist/**` added to `ignores` so the workspace's nested `dist/`
    (e.g. `cli/dist/...`) gets skipped, not just the root one.

  ### 2. Render-function splits (the "honest" splits)

  - `cli/commands/init.ts` — `writeDryRunPlan` (was 11): extracted
    `dryRunFileMessage` (overwrite-vs-write phrasing per file).
  - `cli/commands/show.ts` — `renderHuman` (was 10): extracted
    `renderNodeHeader` (id + optional fields + weight + tokens) and
    `renderIssuesSection` (issues block).
  - `cli/commands/export.ts` — `renderNodesByKindSection` (was 11):
    extracted `renderNodeBullet`.
  - `cli/commands/help.ts` — `renderVerbBlock` (was 9): extracted
    `renderVerbFlags` and `renderVerbExamples`.
  - `cli/commands/plugins.ts` — `renderPluginDetail` (was 11):
    extracted `renderExtensionsList`. The remaining body keeps a
    justified `eslint-disable-next-line complexity` because the
    optional-fields-with-fallback row pattern (`?? '?'`,
    `?? '(unknown)'`) genuinely shapes the verb output; further
    extraction would be ceremony.
  - `cli/commands/scan-compare.ts` — `renderDeltaHuman` (was 14):
    extracted `renderDeltaNodes`, `renderDeltaLinks`,
    `renderDeltaIssues` per-section helpers.

  ### 3. Justified inline `complexity` disables (~25 sites)

  Each disable carries an inline comment explaining why splitting
  would scatter intent. Categorised:

  - **CLI orchestrators with multi-flag handling** (~10):
    `scan.ts:execute` (38), `refresh.ts:execute` (18),
    `init.ts:execute` (13), `db.ts` `DbReset` (21) /
    `DbMigrate` (30), `conformance.ts:execute` (13),
    `scan-compare.ts:execute` (18), `history.ts:execute` ×2
    (14, 12), `orphans.ts` undo-rename arrow (14),
    `plugins.ts` `PluginsDoctor.execute` (15) and `toggle` (11),
    `check.ts:detectProbRuleIds` (9),
    `config.ts:iterDotPaths` (10),
    `list.ts:#countIssuesPerNode` (9),
    `init.ts:runFirstScan` (9),
    `help.ts:renderVerbBlock` (9),
    `history.ts:renderTable` (10),
    `show.ts:aggregateLinks` (11),
    `watch.ts:runWatchLoop` and `runOnePass` (long-running watch
    lifecycle).
  - **Parsers / state machines** (3):
    `kernel/scan/query.ts:parseExportQuery` (11),
    `kernel/adapters/sqlite/plugin-migrations-validator.ts:splitStatements`
    (19), `objectName` (10).
  - **Multi-accumulator folds** (2):
    `kernel/adapters/sqlite/history.ts:accumulateExecutionRow` (15),
    `conformance/index.ts:applyJsonPathComparator` (16).
  - **Migration runners with per-file safe-apply** (2):
    `kernel/adapters/sqlite/migrations.ts:applyMigrations` (14),
    `kernel/adapters/sqlite/plugin-migrations.ts:applyPluginMigrations`
    (14).
  - **Pure column mappers** (2):
    `kernel/adapters/sqlite/scan-persistence.ts:nodeToRow` (13),
    `linkToRow` (12) — every `??` adds one cyclomatic branch.
  - **Discriminated-union dispatchers** (~6):
    `extensions/rules/{trigger-collision,link-conflict}/index.ts:evaluate`
    (12 each),
    `extensions/rules/trigger-collision/index.ts:analyzeTriggerBucket`
    (9), `conformance/index.ts:evaluateAssertion` (12),
    `runConformanceCase` (10), `runPriorScansSetup` (12),
    `deepEqual` (11).
  - **Kernel / adapter helpers** (~5):
    `kernel/orchestrator.ts:walkAndExtract` (28),
    `runScanInternal` (11), `indexPriorSnapshot` (10),
    `computeCacheDecision` (10), `reuseCachedLink` (11),
    `buildHookContext` (10);
    `extensions/providers/claude/index.ts:walkMarkdown` (9);
    `extensions/formatters/ascii/index.ts:format` (12);
    `kernel/adapters/plugin-loader.ts:{loadOne, applyIdCollisions,
loadStorageSchemas, #loadAndValidateExtensionEntry}`;
    `kernel/adapters/sqlite/history.ts:{executionToRow, listExecutions,
findStrandedStateOrphans, migrateNodeFks}`;
    `kernel/config/loader.ts:recordSources`;
    `cli/util/plugin-runtime.ts:{composeScanExtensions, bucketLoaded}`;
    `cli/commands/plugins.ts:{collectKnownKinds,
collectApplicableKindWarnings, collectExplorationDirWarnings,
resolveToggleTarget, forEachProviderInstance}`.

  ### 4. Real fixes (not just disables)

  - `kernel/adapters/sqlite/jobs.ts:120` — `let entries: string[] = []`
    → `let entries: string[]` (initial value was dead, the catch
    returns early). Closes a `no-useless-assignment` finding for real.
  - `kernel/adapters/sqlite/migrations.ts:200` and
    `kernel/adapters/sqlite/plugin-migrations.ts:243` — re-thrown
    errors now carry `{ cause: err }`, satisfying
    `preserve-caught-error` and giving better stack traces on
    migration failure.
  - `cli/commands/scan-compare.ts:197,204` — same `{ cause: err }`
    fix on dump-load and JSON-parse errors.

  ### 5. `silent-logger.ts` — file-level disable for the no-op contract

  Added `/* eslint-disable @typescript-eslint/no-empty-function */`
  at the top of `kernel/adapters/silent-logger.ts`. The whole point
  of `SilentLogger` is that every method is empty; adding an
  inline disable to each of the 5 methods would be noise.

  Same justified inline disable on the `dispatch: async () => {}`
  no-op fast path in `kernel/orchestrator.ts:makeHookDispatcher`.

  ## Net effect

  - Lint baseline before this wave (commit `518180d`): 67 warnings.
  - After this commit: **0 errors, 0 warnings — lint is silent.**
  - Tests: **602 / 602** still green.
  - Build: clean.
  - Every quality rule is now `'error'`, so the next regression
    fails CI instead of accumulating quietly.

- 66ea293: Extract `buildFreshNodeAndValidateFrontmatter` from `walkAndExtract` (orchestrator). Internal-only refactor — moves the `else` branch (no cache hit: build a fresh `Node` and run frontmatter validation) into a focused helper. `walkAndExtract` complexity drops from 35 to 33. No public API change; behaviour preserved.
- a785a16: Three follow-up tests for the open-node-kinds refactor — close gaps the Phase E smoke test left implicit.

  - `external-provider-kind.test.ts` gains two cases: (a) a Provider declares `cursorRule` with a strict per-kind frontmatter schema → the kernel emits `frontmatter-invalid` for any node whose frontmatter does not match, exactly as it does for the built-in claude catalog; (b) a misbehaving Provider whose `classify(...)` returns a kind absent from its `kinds` map → the kernel reports the mismatch via `frontmatter-invalid` with `data.errors === 'no-schema'` instead of crashing.
  - `scan-readers.test.ts` (`sm list --kind <external>`) — pins that the verb's `WHERE kind = ?` filter accepts external-Provider kinds end-to-end. Plants a `kind: 'cursorRule'` row alongside the claude fixtures and asserts the listing surfaces only it under `--kind cursorRule`. Catches a regression where someone retypes the column to `NodeKind` and quietly drops external rows.
  - `node-enrichments.test.ts` (`sm refresh` Test (f.5)) — pins that `sm refresh <external-kind-path>` exits 0 without rejecting the kind. Built-in extractors don't declare `applicableKinds: ['cursorRule']`, so the applicable set is empty and refresh persists zero det enrichments — but it MUST get there without a cast failure or filter rejection.

  These tests add 0 production code and 3 cases to the suite. 617 tests pass; npm run validate exit 0.

- b3debbe: Phase E of the open-node-kinds refactor — end-to-end smoke verification baked into the test suite.

  Adds `test/external-provider-kind.test.ts`: a fake "Cursor" Provider classifies `.cursor/rules/*.md` into `kind: 'cursorRule'` (a string the built-in Claude Provider does NOT know), and the test runs the full pipeline:

  1. `runScanWithRenames` — orchestrator persists the open kind through `IProvider.classify(...) → string`.
  2. `persistScanResult` — SQLite adapter writes the row; the dropped `ck_scan_nodes_kind` CHECK no longer rejects.
  3. `loadScanResult` — `rowToNode` returns the open string (no `as NodeKind` cast).
  4. `applyExportQuery({ kinds: ['cursorRule'] })` — the export query parser accepts the arbitrary kind and filters the snapshot down to the two seeded rows.

  If any layer regresses to the closed-enum behaviour (a stray cast, a forgotten CHECK, a renamed column missed by the migration), the test fails before the regression reaches a release.

  Audit findings:

  - `validate-all` rule's `FRONTMATTER_BY_KIND: Record<NodeKind, …>` map is decorative today (suppressed via `void` to keep the wire ready for when the schema-validators loader exposes per-kind frontmatter validators). It does NOT close the kind set at runtime — the rule validates every node against the `node` schema (which is open post-Phase A). External-Provider kinds pass through unaffected.
  - No built-in rule does `switch (node.kind) { case 'skill': ...; default: never }`. The trigger-collision rule's `ADVERTISING_KINDS` is a `Set<string>` that simply doesn't fire for kinds outside it — exactly the right behaviour.

  What's done across the whole refactor (Phases A → E):

  - Spec (`@skill-map/spec`, minor): JSON Schema + db-schema.md prose + action.schema.json all carry an open string for `kind`.
  - TS (`@skill-map/cli`, minor): `Node.kind: string`, `IProvider.classify(...): string`, `TNodeKind = string`. `NodeKind` survives as the Claude Provider catalog alias with a clarifying docstring.
  - SQL (`@skill-map/cli`, minor): the closed-kind `CHECK in (...)` constraints are removed from `001_initial.sql` directly (pre-1.0 fold; mirrors how `002_scan_meta` was folded back). Fresh DBs apply the open `kind` column from the first migration; no separate `003_open_node_kinds.sql` is needed.
  - Tests: 613 pass; the new `external-provider-kind.test.ts` is the cross-layer guard.

- 518180d: Code-quality follow-up to commit `369213c` — eighth batch of the
  ongoing complexity sweep ("hasta menos de 8"). Eight functions
  addressed: two splits into focused private helpers, six justified
  inline disables on CLI orchestrators / safe-apply loops where the
  cyclomatic count is intrinsic to the contract. **Patch bump**: zero
  public API changes (every refactored function keeps its exported
  signature; no new exports); pure internal restructuring.

  ## Why

  The previous round closed `splitStatements`, `plugins`, `history` and
  `config` and brought the lint baseline from 84 -> 75. This batch
  continues the same playbook: split where naming the steps adds value,
  disable-with-rationale where every branch is one flag in a multi-flag
  verb and splitting would scatter intent. Net `-8` warnings in one
  commit and four functions dropped fully below the threshold.

  ## What

  ### Splits (extracted helpers)

  #### `src/cli/commands/plugins.ts` — `PluginsShowCommand.execute` (21 -> <8)

  Two private helpers, one per detail-rendering branch:

  - `renderBuiltInDetail(builtIn)` — header + extensions list for a
    built-in bundle row.
  - `renderPluginDetail(match)` — header + manifest fields + extensions
    list for a discovered user plugin.

  `execute` is now a thin orchestrator: load the registry, resolve
  `builtIn` vs `match`, pick the renderer, emit. The two renderers
  mirror each other in shape (both return `string[]`) so the
  `builtIn ? renderBuiltInDetail(builtIn) : renderPluginDetail(match!)`
  ternary at the call site reads as a table of contents.

  #### `src/cli/commands/show.ts` — `renderHuman` (14 -> 10)

  One private helper, parametrised over direction:

  - `renderLinksSection(label, links, projectField, arrow)` — the
    `(N total, M unique)` header, `(none)` placeholder, and grouped
    per-link lines. Used for both "Links out" (project on `target`,
    arrow `->`) and "Links in" (project on `source`, arrow `<-`).

  `renderHuman` now spreads the helper twice instead of inlining two
  near-identical 8-line blocks. Aggregation behaviour and JSON output
  are unchanged.

  ### Justified inline complexity disables

  Each of these is a CLI orchestrator or per-file safe-apply transaction
  where the cyclomatic count is intrinsic to multi-flag handling,
  multi-accumulator folds, or per-file rollback semantics. Splitting per
  branch would distance the validations / guards from the state they
  shape. Each disable carries a comment explaining the call-site
  contract.

  - `src/cli/commands/db.ts` — `DbResetCommand.execute` (21) and
    `DbMigrateCommand.execute` (30). Multi-flag verbs: `--state` vs
    `--hard` mutex, `--dry-run`, `--yes`, `--kernel-only`,
    `--plugin <id>`, `--status`, `--to`. The early-return chain is the
    clearest expression of the flag semantics.
  - `src/cli/commands/history.ts` — `HistoryCommand.execute` (14). Many
    optional filter flags (`--node`, `--action`, `--status`, `--since`,
    `--until`, `--limit`, `--json`, `--quiet`); each branch is
    single-purpose and tightly coupled to the filter it shapes.
  - `src/cli/commands/orphans.ts` — undo-rename arrow function (14).
    Destructive verb with per-`ruleId` validation chain
    (`auto-rename-medium` vs `auto-rename-ambiguous`) before the FK
    migration runs in a transaction.
  - `src/cli/commands/scan-compare.ts` — `renderDeltaHuman` (14). Three
    parallel sections (nodes / links / issues), each with
    added/removed/changed loops; per-section format differs slightly so
    a single helper would need a per-section adapter that hides the
    parallel structure.
  - `src/kernel/adapters/sqlite/migrations.ts` — `applyMigrations` (14).
    Per-file transactional safe-apply with backup + dry-run guards;
    rollback semantics live at the loop level.
  - `src/kernel/adapters/sqlite/plugin-migrations.ts` —
    `applyPluginMigrations` (14). Same shape as `applyMigrations` plus
    plugin-id ledger scoping.

  ## Net effect on lint

  - Previous baseline (commit `369213c`): 75 warnings.
  - After this commit: **67 warnings** (-8 net).
  - Four functions dropped fully below threshold via splits or disables;
    zero new warnings introduced.
  - 602 / 602 tests still green.

- 5ca7c36: Continue the complexity-reduction sweep — six more high-complexity
  functions split into focused helpers in a single batch. **Patch bump**:
  zero public API changes (no exported signatures touched, no new
  exports), pure internal restructuring; 602 / 602 tests still green
  after each split individually and after the batch.

  ## Why

  Follows the chain `91fea6a` → `efa8972` → `66ea293` → `6d031d8` →
  `4fbb23c` → `11c4382`, per the standing request to push every
  function below the lint complexity threshold of 8. This batch picks
  off the next six offenders across kernel, CLI commands, an extension
  rule, and the plugin-runtime helper layer. The chain is deliberately
  small per commit so each split is reviewable in isolation and the
  "behavior identical" claim is easy to verify.

  ## What

  ### `src/kernel/orchestrator.ts` — finish the `walkAndExtract` split (audit V4 follow-up)

  Refactored `reusePriorNode` to share its body via a new
  `cloneNodeAndReshapeLinks` helper. Both the full-cache-hit branch
  (still inside `reusePriorNode`) and the partial-cache-hit branch (now
  delegates to `cloneNodeAndReshapeLinks` directly) share one code path
  for the clone + link reshape + frontmatter issue re-emit.
  `reusePriorNode` adds the `extractorRuns` records on top.

  Effect: `walkAndExtract` 33 → 28; `cloneNodeAndReshapeLinks` and the
  trimmed `reusePriorNode` both sit below threshold.

  ### `src/cli/commands/refresh.ts` — split `execute` (30 → <8)

  Two private methods on `RefreshCommand`:

  - `#resolveTargetNodes` — handles the `--stale` vs `<nodePath>`
    decision, returns `{ ok: true, nodes } | { ok: false, exitCode }`.
  - `#runDetExtractorsAcrossNodes` — reads node bodies off disk, runs
    every applicable deterministic extractor per node, counts
    probabilistic skips.

  Added `ScanResult` to the kernel imports for the typed parameter.

  ### `src/cli/commands/init.ts` — split `execute` (25 → <8)

  The `--dry-run` branch was 60+ lines with many `existsSync()`
  conditionals plus a 3-way `.gitignore` plural / singular / unchanged
  switch. Two free helpers now: `writeDryRunPlan` writes the full plan
  to stdout; `writeDryRunGitignorePlan` is a sub-helper for the
  `.gitignore` preview phrasing. New `writeDryRunPlan` sits at 11 — the
  conditional density is intrinsic to the dry-run preview, further
  splitting would dilute clarity.

  ### `src/cli/commands/help.ts` — extract `renderVerbBlock` (19 → <8)

  The per-verb body of the markdown renderer (heading, description,
  details, flags table, examples block) was inlined inside two nested
  `for` loops. Pulled out as `renderVerbBlock(verb): string[]`. New
  helper at 9.

  ### `src/extensions/rules/trigger-collision/index.ts` — extract `analyzeTriggerBucket` (19 → <8)

  The per-bucket ambiguity analysis (advertisers / invocations /
  canonical comparison plus the issue construction) was an 80-line `for`
  body. Pulled into a free function returning `Issue | null`. New helper
  at 9.

  ### `src/cli/util/plugin-runtime.ts` — extract `accumulateBuiltInScanExtensions` (16 → 9)

  The bucketing of built-in extensions by kind (`switch` over
  `provider` / `extractor` / `rule` / `hook` inside nested `for`s) moved
  into a private helper. Caller passes the buckets object as a
  parameter; the helper mutates them in place. The remaining 9 in
  `composeScanExtensions` is the env-flag layer that follows, which
  still adds branches.

  ## Net effect on lint

  - Previous baseline (after `11c4382`): 81 warnings.
  - After this commit: **81 warnings** (no net change — each removed
    monster is replaced by 1 marginal helper at 9-11).
  - However, **6 functions dropped below threshold**: `refresh.ts:execute`,
    `init.ts:execute`, `help.ts:renderMarkdown`,
    `trigger-collision:evaluate`; plus `walkAndExtract` and
    `composeScanExtensions` reduced significantly.
  - Tests: 602 / 602 green; `npm run build -w src` green;
    `npm run lint -w src` green (0 errors).

  ## Out of scope

  The remaining ~24 warnings are mostly small (10-14 cyclomatic) and
  will be tackled in subsequent commits, same one-batch-per-session
  cadence.

- efa8972: Code-quality follow-up to commit `91fea6a` — split the next three
  high-complexity offenders into focused private helpers. **Patch bump**:
  zero public API changes (every refactored function keeps its exported
  signature; no new exports); pure internal restructuring.

  ## Why

  The previous round closed `walkAndExtract` (47 -> 35) but left three
  "monster" call sites that the lint pass kept flagging week after week.
  Three sequential algorithm steps stuffed into one body each is the
  shape that makes the lint warning pile feel permanent — once the steps
  are named, the warning disappears and the next reader gets a free
  table of contents.

  ## What

  ### `src/kernel/orchestrator.ts` — `detectRenamesAndOrphans` (24 -> <8)

  Five private helpers, one per step of the spec'd pipeline:

  - `findHighConfidenceRenames(opts)` — step 1, body-hash match.
  - `buildFrontmatterRenameCandidates(opts)` — step 2, bucket newPaths
    by `frontmatterHash`.
  - `claimSingletonRenames(opts)` — step 3a, medium-confidence
    singletons.
  - `flagAmbiguousRenames(opts)` — step 3b, multi-candidate ambiguity.
  - `flagOrphans(opts)` — step 4, unclaimed deletions.

  `detectRenamesAndOrphans` itself is now a 15-line orchestrator that
  threads the shared `claimedDeleted` / `claimedNew` / `issues`
  collections through the helpers in order. Every helper sits below the
  complexity threshold (no new lint warnings introduced). The mutation
  contract — helpers update the supplied sets in place — is documented
  on each JSDoc.

  ### `src/kernel/adapters/sqlite/scan-persistence.ts` — `persistScanResult` (23 -> <8)

  The async transaction callback was 180+ lines doing four distinct
  things. Three new private helpers, all taking the live `Transaction`
  plus the slice of state they own:

  - `replaceAllScanZone(trx, result, scannedAt, extractorRuns)` —
    the replace-all on `scan_*` tables + `scan_extractor_runs`.
  - `upsertEnrichmentLayer(trx, result, renameOps, enrichments)` —
    A.8 enrichment steps 1+2+3 (rename migration + drop disappeared +
    upsert fresh).
  - `flagStaleProbabilisticEnrichments(trx, result, enrichments)` —
    A.8 enrichment step 4 (mark stale prob rows).

  The transaction body is now ~10 lines orchestrating: rename FK
  migration, stranded-orphan detection (still inline because it's small
  and tightly coupled to `result.issues` / `result.stats` mutation),
  then the three helpers. Added `Transaction<IDatabase>` import from
  `kysely` to type the helper parameters.

  ### `src/kernel/adapters/sqlite/scan-persistence.ts` — `nodeToRow` / `linkToRow` justified disables

  These are pure column-by-column mappings: every `??` adds one to
  cyclomatic count, but there are zero branches. Splitting would be
  ceremony for a function with one purpose. Added
  `// eslint-disable-next-line complexity` with a comment on each
  explaining the justification.

  ### `src/kernel/scan/query.ts` — `parseExportQuery` (15 -> 11)

  Two private helpers extracted for the validators that contained the
  inner loops (the switch over `key` had inline `for (v of values)`
  with throw-on-invalid):

  - `parseKindValues(values)` — validates kind tokens, returns
    `NodeKind[]`.
  - `parseHasValues(values)` — validates has tokens, returns boolean
    (true iff `issues` is present).

  `parseExportQuery` still sits at 11 — just above the threshold of 8.
  Further splitting would dilute clarity (the remaining body is the
  clause loop itself plus the unknown-key default), so the residual
  warning is acceptable for now.

  ## Net effect on lint

  - Previous baseline (commit `91fea6a`): 84 warnings.
  - After this commit: **80 warnings** (-4 net).
  - Three "monster" complexity sites eliminated (24, 23 -> <8). One
    reduced (15 -> 11). Two justified disables (13 and 12, pure
    mappings).
  - Zero new warnings introduced — every extracted helper is below
    threshold.
  - 602 / 602 tests still green.

  ## Out of scope

  Three high-complexity sites remain and are intentionally left for
  their own dedicated session, because each carries enough behavioural
  risk that a focused testing pass before the split is the right
  approach:

  - `scan.ts:execute()` (complexity 38, 338 lines) — the main scan
    command; regressions would break the most-used CLI verb.
  - `loadOne` in `plugin-loader.ts` (complexity 31) — flagged by the
    audit; same reasoning.
  - `walkAndExtract` (still at 35 from earlier) — more splits possible
    (the partialCacheHit / buildNode branches), but this commit focuses
    on net-new wins.

- 33cfea4: Close audit item SD4 — clean ROADMAP "Step N / Phase N" references from kernel docstrings. 78 refs eliminated or reworded; 22 algorithm-internal "Step N" / "Phase N" comments preserved (they describe numbered steps inside an algorithm, not roadmap milestones — `trigger-normalize.ts`, `scan-persistence.ts:upsertEnrichmentLayer`, `plugin-loader.ts:loadOne`, `orchestrator.ts:detectRenamesAndOrphans` and friends). Updated one assertion in `hook-extension.test.ts` so the test no longer pins the literal string "Step 10" in the deferral message.
- 4fbb23c: Split `evaluateJsonPath` (complexity 25) and `runConformanceCase` (complexity 20) in `src/conformance/index.ts`. Internal-only refactor — no public API change. Extracted helpers: `traverseJsonPath` (pure walker over a parsed segment list), `applyJsonPathComparator` (justified inline disable for the 4-comparator chain), `runPriorScansSetup` (the priorScans replay loop). Both monsters drop below or just above the threshold; no test regressions.
- 11c4382: Split `renderMarkdown` (complexity 19) in `src/cli/commands/export.ts`. Extracted `countIssuesPerNode` (issue index helper) and `renderNodesByKindSection` (the per-kind nodes block with grouping + sorting + rendering). `renderMarkdown` itself drops below the threshold; the extracted section helper sits at 11 (parallel branches over `KIND_ORDER`, manageable). Pure refactor, no public API change.
- 6d031d8: Code-quality follow-up to commit `66ea293` — split the audit's other
  big offender, `loadOne` in `src/kernel/adapters/plugin-loader.ts`
  (310 lines, complexity 31), into focused private helpers. **Patch
  bump**: zero public API changes (the `PluginLoader` class still
  exposes the same `loadOne(pluginPath): Promise<IDiscoveredPlugin>`
  signature; new helpers are `#`-prefixed truly-private methods plus
  one private free function); pure internal restructuring.

  ## Why

  `loadOne` was the last "monster" call site flagged by the pre-1.0
  audit and explicitly deferred in `refactor-complexity-splits-followup`
  as needing a dedicated session. Three sequential phases (manifest
  parse + validation, per-extension import + kind validation, storage
  schema compile) stuffed into one body, with the per-extension loop
  itself doing six sub-checks plus a 30-line hook-trigger validation
  block inline. Once each phase is named, the warning disappears and
  the next reader gets a free table of contents.

  ## What

  Three extractions, all in `src/kernel/adapters/plugin-loader.ts`:

  - `#parseAndValidateManifest(pluginPath)` (private method, ~75 lines)
    — phase 1: read `plugin.json`, AJV-validate the manifest shape,
    enforce the directory-name == manifest.id structural rule, validate
    specCompat (range syntax + satisfies installed spec version).
    Returns either the validated manifest or an `IDiscoveredPlugin`
    with the appropriate failure status (`invalid-manifest` /
    `incompatible-spec`).
  - `#loadAndValidateExtensionEntry(pluginPath, manifest, relEntry)`
    (private async method, ~100 lines) — phase 3 inner loop body: 6
    sub-checks per extension entry (file exists, dynamic import with
    timeout, has-kind, kind-is-known, pluginId match, kind-specific
    manifest validation including hook trigger pre-check), with the
    `pluginId` injection and shallow-clone of the runtime instance.
  - `validateHookTriggers(...)` (private free function) — extracted
    because the hook-specific trigger validation was a 30-line block
    inside the extension loop body that was hurting both readability
    and complexity.

  Both methods/functions return discriminated unions
  (`{ ok: true; ... } | { ok: false; failure: IDiscoveredPlugin }`) so
  the caller (`loadOne`) stays a thin orchestrator: ~30 lines of
  "manifest -> enabled check -> loop entries -> storage schemas ->
  success result".

  ## Net effect on lint

  - Previous baseline (after `66ea293`): 80 warnings.
  - After this commit: **81 warnings** (+1 net).
  - `loadOne` itself: **31 -> 10** (-21 — massive drop, just barely
    above the threshold of 8).
  - `#loadAndValidateExtensionEntry` new helper at **13** (the new
    warning, but contained — much easier to reason about than the
    original monolith).
  - `#parseAndValidateManifest` and `validateHookTriggers` both <8
    (no warnings).
  - 602 / 602 tests still green.

  The +1 net is misleading — the architectural improvement is the
  central method dropping from 31 to 10. The helper at 13 is the next
  splitting target if anyone wants to keep going.

- Updated dependencies [f8a7125]
  - @skill-map/spec@0.10.0

## 0.7.0

### Minor Changes

- 88afe24: Cleanup pass post-v0.8.0 — finishing the renames and wiring the
  conformance kill-switches.

  **Pre-1.0 minor bump** per `spec/versioning.md` § Pre-1.0. The schema
  field rename below is technically breaking, but ships as a minor while
  the spec stays `0.Y.Z`.

  ## Spec changes (`@skill-map/spec`)

  ### Breaking — `conformance-case.schema.json`

  - **Rename `setup.disableAllDetectors` → `setup.disableAllExtractors`.**
    Finishes the kind rename Detector → Extractor introduced in 0.8.0
    (Phase 2 of the plug-in model overhaul). The previous name was the
    last residue and it never reached a release where anything consumed
    it.
  - **`setup.disableAll{Providers,Extractors,Rules}` are now consumed
    end-to-end.** Until this release the three toggles were declared in
    the schema and accepted by the runner, but the runner never threaded
    them anywhere — the `kernel-empty-boot` case happened to pass
    because its fixture is empty. The runner now injects
    `SKILL_MAP_DISABLE_ALL_{PROVIDERS,EXTRACTORS,RULES}=1` into the
    child process environment when the matching toggle is `true`, and
    the CLI's scan composer drops every extension of the disabled kind
    from the in-scan pipeline regardless of granularity gates and
    `--no-built-ins`. Each toggle now has a docstring on the schema
    property pointing at the env-var convention.
  - `kernel-empty-boot` case updated for the rename.
  - `conformance/README.md` example updated.

  ### Non-breaking — copy fixes

  - Comments and docstrings across `architecture.md` and friends already
    refer to "Extractor" everywhere; only the schema field stayed on the
    old name. No prose changes in this bump.

  ## CLI changes (`@skill-map/cli`)

  ### Breaking — `IDiscoveredPlugin.status` enum

  - **Rename `'loaded'` → `'enabled'`.** The schema enum
    (`plugins-registry.schema.json`) already used `enabled` since 0.8.0;
    the runtime drifted to `loaded` and has now been pulled back so the
    runtime status matches the spec contract. `'disabled'`, the
    semantic pair, was already aligned. Every consumer (`sm plugins
list`, `sm plugins doctor`, `sm db prune` plugin filter, runtime
    plugin composer) updated. No published consumers exist.

  ### Non-breaking — sweep cleanup

  - Old `Detector` / `detector` references (kind name, manifest field
    names, JSDoc, comments, test fixture filenames, test variable
    names) replaced with `Extractor` / `extractor` across the
    production code and test suite. Excludes historical CHANGELOG
    entries, explicit migration notes ("Renamed from Detector"), and
    test data strings whose semantics are independent of the kind
    name (e.g. `'@FooDetector'` in trigger normalization tests).
  - A residual reference to "an audit reading `ScanResult.issues`" in
    `validate-all`'s docstring rewritten without the removed kind name.

  ## Tests

  - `plugin-runtime-branches.test.ts` — five new unit tests covering
    the env-var kill-switch in `composeScanExtensions` (per kind, all
    three together, and stray-value resilience).
  - `conformance-disable-flags.test.ts` — four new e2e tests pointing
    the runner at a populated fixture with each toggle in turn (and a
    baseline) so a regression in the env-var pipeline shows up
    structurally rather than relying on the empty-fixture coincidence.

### Patch Changes

- Updated dependencies [88afe24]
  - @skill-map/spec@0.9.0

## 0.6.0

### Minor Changes

- 6dad772: v0.8.0 — Pre-1.0 stabilization pass.

  This release combines two coherent pre-1.0 cleanup pieces that
  both push the project closer to v1.0 stability: the cli-architect
  audit review pass and the plugin model overhaul.

  Pre-1.0 minor bumps per `versioning.md` § Pre-1.0; breaking
  changes allowed within minor while in `0.Y.Z`. No real downstream
  ecosystem exists yet, so the breaking surface costs nothing
  today.

  ## Part 1 — Pre-1.0 audit review pass

  Pre-1.0 review pass — `cli-architect` audit findings.

  Internal audit run by the `cli-architect` agent in REVIEW mode
  produced a Critical / High / Medium / Low / Nit catalog. This
  pass bundles the implementation of every actionable finding into
  one unit so the review can be read end-to-end. **Pre-1.0 minor
  bump**: a few breaking surface changes ride along (CLI sub-verb
  split, exit-code enum exposed, plugin loader option). No
  published downstream consumers exist yet.

  ### Spec changes (`@skill-map/spec`)

  - **`cli-contract.md`** — `sm scan compare-with <dump> [roots...]`
    is now a sub-verb instead of a `--compare-with <path>` flag on
    `sm scan`. Read-only delta report against a saved `ScanResult`
    JSON dump. Read-only — does not modify the DB. Same exit codes
    (`0` empty delta / `1` drift / `2` operational error). Old flag
    form removed.
  - **`cli-contract.md`** — exit-code `2` "Operational error" row
    clarified to mention environment / runtime mismatches (wrong
    Node version, missing native dependency) explicitly. The
    "unhandled exception" catch-all already covered the case; this
    just removes ambiguity for future implementers.
  - **`cli-contract.md`** — new normative section **§Dry-run**
    between §Exit codes and §Verb catalog defining the contract for
    any verb exposing `-n` / `--dry-run`: no observable side effects
    (DB / FS / config / network / spawns), no auto-provisioning of
    scope directories, output mirrors the live mode with explicit
    "would …" framing, exit codes mirror the live mode, dry-run
    MUST short-circuit `--yes` / `--force` confirmation prompts.
    Per-verb opt-in: the flag is not global, verbs that don't
    declare it MUST reject it as an unknown option. Verb catalog
    rows for `sm init`, `sm db reset` (default + `--state` +
    `--hard`), and `sm db restore` amended to declare and describe
    their `--dry-run` previews.

  ### CLI changes (`@skill-map/cli`)

  #### Critical — kernel & adapter hygiene

  - **C1 — `runScanInternal` decomposed.** The 290-line monolith in
    `kernel/orchestrator.ts` split into a thin composer + four pure
    functions: `validateRoots`, `indexPriorSnapshot`,
    `walkAndDetect`, `runRules`. Composer is now 89 lines reading
    top-to-bottom through the pipeline phases. Zero behavioural
    change.
  - **C2 — `withSqlite(options, fn)` helper.** Single utility at
    `cli/util/with-sqlite.ts` standardises the open / use / close
    idiom every read-side command was open-coding. Eliminates four
    classes of boilerplate bugs (forgotten close, `autoBackup`
    drift, double-close, missing `try/finally`). Migrated 20 call
    sites across `check`, `export`, `graph`, `history`, `init`,
    `jobs`, `list`, `orphans`, `plugins`, `scan`, `show`, `watch`,
    plus `cli/util/plugin-runtime.ts`. Companion `tryWithSqlite`
    short-circuits when the DB file does not exist, replacing the
    `if (existsSync) { withSqlite(...) }` chain. In `scan.ts` the
    read-prior + persist double-open consolidated into a single
    `withSqlite` callback that brackets read prior → run scan →
    guard → persist when `willPersist`. Saves one migration
    discovery pass + one WAL setup per normal scan (~50–100ms).

  #### High — UX & contract integrity

  - **H3 — `--dry-run` semantics unified across `init` / `db reset`
    / `db restore`.** The new spec §Dry-run codifies the "no
    writes, reads OK" contract; three verbs that did not previously
    expose a preview now do: - `sm init --dry-run` — previews the would-create lines for
    `.skill-map/`, `settings.json`, `settings.local.json`,
    `.skill-mapignore`, the `.gitignore` entries that would be
    appended (deduped against the existing file), the DB
    provisioning, and the first-scan trigger. Honours `--force`
    for the would-overwrite preview. Re-init over an existing
    scope without `--force` still exits 2 (same gate as live). - `sm db reset --dry-run` (default + `--state`) — opens the DB
    read-only, computes the row count per `scan_*` (and `state_*`
    when `--state`) table, and prints them. No `DELETE`
    statements issued. Bypasses the `--state` confirmation prompt
    entirely. - `sm db reset --hard --dry-run` — reports the DB file path and
    size that would be unlinked; missing-file case prints a clear
    no-op line instead of an error. - `sm db restore <src> --dry-run` — validates the source exists
    (still exits 5 if missing), reports the source size and
    whether the target would be created or overwritten, plus the
    WAL / SHM sidecars that would be dropped. Bypasses the
    confirmation prompt.
    Implementation: new helper `previewGitignoreEntries(scopeRoot,
entries)` in `init.ts` mirrors `ensureGitignoreEntries` parsing
    so the preview tracks the live outcome exactly. Texts moved
    into `cli/i18n/init.texts.ts` and `cli/i18n/db.texts.ts` per
    the N4 pattern. **9 new tests** under `init-cli.test.ts` (5
    cases) and `db-cli.test.ts` (9 cases) cover the previews + the
    spec invariants ("DB file checksum unchanged after dry-run",
    "scope directory absent after dry-run", "source-not-found
    still exits 5", "confirmation prompt skipped under dry-run").
  - **H1 — Centralised exit codes.** New `cli/util/exit-codes.ts`
    exporting `ExitCode` (`Ok` / `Issues` / `Error` / `Duplicate` /
    `NonceMismatch` / `NotFound`) and the type alias `TExitCode`.
    Every `Command#execute()` migrated from numeric literals (123
    sites across 17 files) to the enum. Single source of truth
    aligned with `spec/cli-contract.md` §Exit codes. **Bug fix
    surfaced en passant:** `sm job prune` returned `2` for "DB
    missing" while every other read-side verb returned `5` via
    `assertDbExists`; corrected to use the shared helper and return
    `NotFound`. Companion test updated to expect `5`.
  - **H2 — Plugin loader timeout.** `IPluginLoaderOptions.loadTimeoutMs`
    (default `5000`, exported as `DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS`).
    Each dynamic `import()` now races against a timer; on timeout
    the plugin is reported as `load-error` with a message naming
    the elapsed budget and pointing at top-level side effects as
    the likely cause (network call, infinite loop, large blocking
    work). Without this a plugin with a hanging top-level `await`
    blocks every host CLI command indefinitely.
  - **H4 — `--strict` self-validates `--json` output.** When
    `sm scan --strict --json` is invoked, the produced `ScanResult`
    is validated against `scan-result.schema.json` before stdout.
    Catches the case where a custom detector emits a Link that
    passes the shallow `validateLink` guard but fails the full
    schema, which would silently land in stdout and break a
    downstream `sm scan compare-with -`.
  - **H5 — External-link discrimination uses URL-shape regex.**
    `isExternalUrlLink` was string-matching `http://` / `https://`
    only; any other URL scheme (`mailto:`, `data:`, `file:///`,
    `ftp://`) was silently classified as internal and polluted the
    graph as a fake internal link with `byPath` lookups that always
    missed. Replaced with the RFC 3986 scheme regex
    (`/^[a-z][a-z0-9+\-.]+:/i`), guarding against Windows-style
    absolute paths via the ≥ 2-char scheme constraint.
  - **H6 — Prior snapshot validated under `--strict`.** Both
    `sm scan` and `sm watch`, when run with `--strict`, validate
    the DB-resident `ScanResult` against the spec schema before
    handing it to the orchestrator. A DB corrupted manually or
    mid-rollback used to slip nodes with malformed `bodyHash` /
    `frontmatterHash` into the rename heuristic, where the
    dereference would silently produce spurious matches.

  #### Medium — surface & extensibility

  - **M1 — `sm scan compare-with` sub-verb.** New
    `ScanCompareCommand` in `cli/commands/scan-compare.ts`; the
    `--compare-with` flag is removed from `ScanCommand`. The
    sub-verb form structurally rejects flag combos that used to
    require runtime guards (`--changed`, `--no-built-ins`,
    `--allow-empty`, `--watch`): Clipanion rejects them at parse
    time as unknown options.
  - **M2 — `kernel/index.ts` enumerated exports.** Replaced the two
    `export type *` wildcards (from `./types.js` and
    `./ports/index.js`) with explicit named exports. Same set of
    public types — the DTS size and tests confirm parity. Going
    forward, any new domain type or port change requires an
    explicit edit to the barrel, preventing silent surface drift.
  - **M3 — Build hack documented (workaround retained).** Tried to
    replace the post-build `restoreNodeSqliteImports` pass with
    `external: ['node:sqlite']` in `tsup.config.ts`. Esbuild marks
    the specifier as external but still strips the `node:` prefix;
    same outcome with `[/^node:/]` regex and `packages: 'external'`
    (which also externalises real npm deps). Reverted to the
    post-build `replaceAll` pass, with a docstring documenting
    every workaround attempted so the next agent does not repeat
    the spike.
  - **M4 — `tryWithSqlite` helper.** See C2.
  - **M5 — `CamelCasePlugin` trap documented.** Added a
    trap-warning block to `SqliteStorageAdapter`'s docstring:
    `sql.raw` / `sql\`...\``template literals do NOT pass through
the`CamelCasePlugin`; raw SQL fragments must use snake_case to
    match the migrations.
  - **M6 — Per-extension error reporting.** When the orchestrator
    drops a link emitted with an undeclared kind or an issue with
    an invalid severity, it now emits a `type: 'extension.error'`
    `ProgressEvent` instead of silently swallowing. The CLI
    subscribes via the new `createCliProgressEmitter(stderr)`
    helper and renders those events as `extension.error: <message>`
    on stderr. Plugin authors finally see WHY their link / issue
    disappears from the result. Wired in `scan` (normal +
    compare-with), `watch`, and `init`.
  - **M7 — Type naming convention documented (no rename).** Top-of-
    file docstring in `kernel/types.ts` and a new section in
    `AGENTS.md` describe the four-bucket convention the codebase
    has always implicitly followed: domain types (no prefix,
    mirrors spec schemas), hexagonal ports (`Port` suffix), runtime
    extension contracts (`I` prefix), internal shapes (`I`
    prefix). Mass rename was rejected after a cost-benefit pass —
    naming changes are cheap to write but expensive to review;
    existing names are mostly coherent. The agent base
    (`_plugins/minions/shared/architect.md`) gained a "Naming
    conventions check" sub-section in REVIEW mode so future audits
    reach the same conclusion.

  #### Low / nit — cleanup

  - **L1 — `omitModule` JSON replacer precision.** Identifies the
    ESM namespace by `[Symbol.toStringTag] === 'Module'` instead of
    matching every `module` key blindly. A plugin manifest that
    legitimately ships an unrelated `module` field (e.g. a string
    property in `metadata`) is no longer silently dropped from
    `sm plugins list --json` output.
  - **L2 — Stub verbs flagged in `--help`.** Every
    `not-yet-implemented` verb in `cli/commands/stubs.ts` carries a
    `(planned)` suffix on its `description`, surfaced in
    `sm --help`. The `notImplemented` helper now writes
    `<verb>: not yet implemented (planned).` on stderr instead of
    promising a specific Step number — roadmap step numbers shift
    mid-flight, stale promises in `--help` are worse than no
    promise.
  - **L3 — Dead `eslint-disable` removed** from
    `cli/util/plugin-runtime.ts`.
  - **N1 — `Link.source` vs `Link.sources` doc clarified.** Both
    fields now carry inline doc-comments calling out the singular /
    plural naming trap. Spec-frozen, but the ambiguity is the
    easiest way to misread the type for new contributors.
  - **N2 — `sm check` Usage examples expanded.** The `-g/--global`
    and `--db <path>` flags were declared but missing from the
    `Usage.examples` block — asymmetry with `sm scan` and the rest
    of the read-side verbs that ship the same flags. Two examples
    added: `sm check --global` and `sm check --db
/path/to/skill-map.db`.
  - **N4 — Error / hint strings extracted to `*.texts.ts` modules
    with `{{name}}` template interpolation.** Pre-1.0 is the
    natural moment to seed the pattern before the string set grows.
    The workspace `ui/` already has a sibling layout at
    `ui/src/i18n/` (functions returning template literals); CLI
    takes a deliberately different shape — flat string templates
    with `{{name}}` placeholders, interpolated by a tiny
    `tx(template, vars)` helper. Rationale: the template form is
    **drop-in compatible with Transloco / Mustache / Handlebars**
    (the syntax they all share) so the day this project migrates to
    a real i18n library, the strings move as-is. Functions would
    have to be re-shaped first.

            Helper at `kernel/util/tx.ts`. Contract:

            - Every `{{name}}` token MUST have a matching key in the vars
              object — missing key throws (silent fallback hides
              forgotten args in production).
            - `null` / `undefined` values throw — caller coerces
              upstream.
            - Whitespace inside the braces tolerated (`{{ name }}`) so
              long templates wrap cleanly across `+`-joined lines.
            - Plural / conditional logic does NOT live in the template;
              the caller picks `*_singular` vs `*_plural` keys.

            Files created:

            - `kernel/util/tx.ts` — the helper itself, with 13 tests in
              `test/tx.test.ts` (single / multi token, whitespace,
              missing / null / undefined keys, identifier shapes, error
              truncation).
            - `kernel/i18n/orchestrator.texts.ts` — frontmatter
              malformed/invalid templates, `extension.error` payloads,
              root validation errors.
            - `kernel/i18n/plugin-loader.texts.ts` — every `load-error` /
              `invalid-manifest` / `incompatible-spec` reason, plus the
              import timeout message.
            - `cli/i18n/scan.texts.ts` — `sm scan` flag-clash / scan
              failure / guard / summary templates, plus the `sm scan

        compare-with`dump-load errors.

    -`cli/i18n/watch.texts.ts`—`sm watch`lifecycle templates. -`cli/i18n/init.texts.ts`—`sm init`templates including
    the`--dry-run`previews and the singular/plural pair for
    gitignore updates. -`cli/i18n/db.texts.ts`—`sm db reset`/`sm db restore` templates including their`--dry-run`previews. -`cli/i18n/cli-progress-emitter.texts.ts`— the
    `extension.error: ...` stderr line.

            String content moved verbatim — every existing test that
            matches on stderr / stdout content keeps passing. Trivial
            single-token strings (`'No issues.\n'`) and rare per-handler
            bespoke phrases stay inline; the pattern is now established
            for whoever wants to migrate them in a follow-up.

            Note on `ui/` divergence: today the two workspaces use
            different shapes for their text tables (functions in `ui/`,
            templates in `cli/`). Aligning them is a follow-up — the day a
            real i18n library lands, both converge on its native shape.
            The CLI shape is closer to the eventual destination.

  - **N6 — `TIssueSeverity` aliased to `Severity`.** SQLite schema
    type now reads `type TIssueSeverity = Severity` instead of
    duplicating the union literal. Keeps DB and runtime in
    lock-step if the union ever evolves.

  ### Migrations consolidation (kernel DB)

  - **`src/migrations/001_initial.sql` + `002_scan_meta.sql`**
    consolidated into a single `001_initial.sql`. Pre-1.0 with no
    released DBs to forward-migrate, the two-file split was a
    historical accident from an incremental shipment. After
    consolidation: same 12 tables, same constraints, same indexes;
    `PRAGMA user_version` of a freshly-initialised DB is now `1`
    instead of `2`. Migration runner is unchanged (it tolerates any
    count of `NNN_*.sql` files).

  ### Test coverage (Part 1)

  - New tests for H2 (plugin loader timeout — 2 cases),
    M6 (orchestrator `extension.error` emission — 3 cases),
    CLI progress emitter wiring (4 cases). The compare-with suite
    (`scan-compare.test.ts`, 9 cases) was migrated to
    `ScanCompareCommand` and the three flag-clash tests dropped
    (the flags are now structurally absent on the sub-verb). Test
    totals: 479 (start of pass) → 488 (after H2/M6 tests) → 485
    (after the three flag-clash deletions).

  ### Deferred / out of scope

  The findings below were reviewed but did not warrant code
  changes; each has its own resolution noted alongside.

  - **L4 — `runScan` / `runScanWithRenames` unification.** Already
    resolved by C1 (both are thin wrappers around
    `runScanInternal`).
  - **L5 — Node-version-guard exit code.** Reviewed against the
    updated exit-code table; existing `2` is correct under
    "operational error / unhandled exception". Spec table got the
    environment-mismatch clarification (above).
  - **L6 — `loadSchemaValidators()` cache.** Already cached at
    module level since Step 5.12.
  - **L7 — `pkg with { type: 'json' }` portability.** Stable in
    Node ≥ 22; `engines.node": ">=24.0"` covers it. No fallback
    needed.
  - **N3 — `compare-with` "dump not found" exit code.** The error
    paths in `ScanCompareCommand` already use the `ExitCode.Error`
    enum (= 2) for dump load failures, matching the spec clause for
    operational errors.
  - **N5 — Exit-code list completeness.** Verified the comment in
    `cli/entry.ts` against `spec/cli-contract.md` §Exit codes —
    identical, no edit needed.

  ## Part 2 — Plugin model overhaul (5-phase implementation)

  ### Summary

  The plugin model received a comprehensive overhaul before
  stabilizing at v1.0. Plugin kinds total after this bump: **6**
  (Provider, Extractor, Rule, Action, Formatter, Hook). All
  breakings are pre-1.0 minor per `versioning.md` § Pre-1.0.

  ### Phase 1 (commit 7354c26) — Foundation

  Five sub-phases, additive or pre-1.0 minor breakings:

  - **A.4** — three-tier frontmatter validation model documented in
    `plugin-author-guide.md` (default permissive + `unknown-field`
    rule + `scan.strict` promote-to-error). Behavior unchanged.
  - **A.5** — plugin id global uniqueness: `directory ==
manifest.id` rule, new status `id-collision` (sixth),
    validation in boot/scan/doctor. Cross-root collisions block
    both involved plugins; user resolves by renaming.
  - **A.6** — extension ids qualified `<plugin-id>/<ext-id>` in
    registry. Built-ins classified into `claude/*` (4 Claude-
    specific) and `core/*` (7 kernel built-ins) bundles. New
    `Registry.get/find` APIs; `defaultRefreshAction` schema
    requires the qualified pattern; `extension.error` events emit
    qualified ids.
  - **A.10** — optional `applicableKinds` filter on Detector
    manifest; fail-fast skip for non-matching kinds (zero CPU/LLM
    cost); doctor warning for kinds not declared by any installed
    Provider. Empty array invalid; absence preserves apply-to-all
    default.
  - **Granularity** — Built-ins now respect `config_plugins`
    enable/disable via granularity-aware filtering. New
    `IBuiltInBundle` shape with `granularity: 'bundle' |
'extension'`; `claude` ships as bundle (all-or-nothing), `core`
    as extension (each toggleable). User plugins default to bundle;
    opt in via `granularity` in `plugin.json`. Both plugin ids and
    qualified extension ids accepted as keys in `config_plugins`
    and `settings.json#/plugins` (no schema change needed).

  550/550 tests pass (+33 vs baseline 517).

  ### Phase 2 (commit ae3eaa6) — Renames

  Four sub-phases, all breaking but allowed in minor pre-1.0:

  - **2a (Renderer → Formatter)** — Kind, types, files renamed.
    Method `render(ctx)` → `format(ctx)`; manifest field `format`
    → `formatId` (TS clash resolution). Same contract: graph →
    string, deterministic-only.
  - **2b (Adapter → Provider)** — New required field
    `explorationDir` on the manifest (e.g. `~/.claude` for the
    Claude Provider). DB schema migrated in-place (column
    `nodes.adapter` → `nodes.provider`, etc.). The
    hexagonal-architecture `RunnerPort.adapter` /
    `StoragePort.adapter` is unchanged.
  - **2c (Audit removed)** — Audit kind removed. The single
    built-in `validate-all` migrated to a Rule (qualified id
    `core/validate-all`, `evaluate(ctx) → Issue[]`). CLI verbs
    `sm audit *` removed; users invoke via `sm check --rules
core/validate-all`.
  - **2d (Detector → Extractor)** — Method signature changes from
    `detect(ctx) → Link[]` to `extract(ctx) → void` — output flows
    through three ctx callbacks: `emitLink`, `enrichNode`, `store`.
    Built-ins migrated maintain functional parity using `emitLink`.
    Persistence of `enrichNode` deferred to Phase 4 (A.8 stale
    layer); orchestrator buffers in memory today.

  554/554 cli + 32/32 testkit pass.

  ### Phase 3 (commit 34f993e) — Schema relocation

  **A.2** — Per-kind frontmatter schemas relocate from spec to the
  Provider that declares them. Spec keeps only `frontmatter/base`
  (universal).

  - 5 schemas moved (`git mv`):
    `spec/schemas/frontmatter/{skill,agent,command,hook,note}.schema.json`
    → built-in Claude Provider's `schemas/` directory. New `$id`:
    `https://skill-map.dev/providers/claude/v1/frontmatter/<kind>`.
    Cross-package `$ref` resolves via the spec base's `$id`
    (`https://skill-map.dev/spec/v0/frontmatter/base.schema.json`);
    AJV resolves by `$id` when both schemas register on the same
    instance.
  - Provider manifest gains a required `kinds` map subsuming three
    former fields: `emits` (now derives from
    `Object.keys(kinds)`), the flat `defaultRefreshAction` map (now
    per-entry inside `kinds[<kind>].defaultRefreshAction`), and the
    new `schema` (path to the per-kind schema relative to the
    provider directory).
  - Built-in Claude Provider migrated: 5 kind entries (skill,
    agent, command, hook, note), each with `schema`, `schemaJson`
    (runtime field, AJV-compiled at load), and qualified
    `defaultRefreshAction` (`claude/summarize-<kind>`).
  - Kernel orchestrator parse phase asks the Provider for the
    schema via `IProviderFrontmatterValidator` (composed by scan
    via `buildProviderFrontmatterValidator`) instead of reading
    from spec/. Flow: validate base → look up provider → validate
    per-kind schema from Provider.
  - `schema-validators.ts` catalog loses the 5 per-kind frontmatter
    entries; only `frontmatter-base` remains kernel-known.
    `plugin-loader`'s `stripFunctionsAndPluginId` now also strips
    `schemaJson` (runtime-only) from each `kinds` entry before
    AJV-validating the manifest.
  - Coverage matrix: 28 → 23 schemas (the 5 per-kind frontmatter
    schemas are now Provider-owned and ship with their own
    conformance suite in Phase 5 / A.13).

  556/556 cli + 32/32 testkit pass.

  ### Phase 4 (commit e62695f) — Probabilistic infra

  Five sub-phases, all breaking but allowed in minor pre-1.0:

  - **4a (A.9)** — fine-grained Extractor cache via new
    `scan_extractor_runs` table. Resolves gap where newly
    registered Extractors silently skipped cached nodes; cache hit
    logic now per-(node, extractor). Uninstalled Extractors cleaned
    (rows + orphan links). Migration in-place.
  - **4b (A.12)** — opt-in `outputSchema` for plugin custom
    storage. Manifest gains `storage.schema` (Mode A) and
    `storage.schemas` (Mode B) for AJV validation of
    `ctx.store.write/.set` calls. Throws on shape violation;
    default absent = permissive.
  - **4c (A.8)** — enrichment layer + stale tracking. New
    `node_enrichments` table persists per-(node, extractor)
    partials separately from author's frontmatter (immutable).
    Probabilistic enrichments track `body_hash_at_enrichment`; scan
    flags `stale=1` on body change (NOT deleted, preserves LLM
    cost). Helper `mergeNodeWithEnrichments` filters stale +
    last-write-wins. New verbs `sm refresh <node>` and
    `sm refresh --stale` (stubs awaiting Step 10).
  - **4d (A.11)** — sixth plugin kind `hook`. Declarative
    subscriber to a curated set of 8 lifecycle events (`scan.*`,
    extractor/rule/action.completed,
    job.spawning/completed/failed). Other events deliberately not
    hookable. Manifest declares `triggers[]` (load-time validated)
    and optional `filter`. Three new kernel events added to
    catalog. Dual-mode (det dispatched in-process; prob deferred to
    Step 10).
  - **4e (A.7)** — `sm check --include-prob` opt-in flag (stub).
    Default `sm check` unchanged: det only, CI-safe. With flag:
    detects prob rules, emits stderr advisory; full dispatch awaits
    Step 10. Combines with `--rules`, `-n`, `--no-plugins`.

  591/591 cli + 32/32 testkit pass.

  ### Phase 5 (commit 03b5a65) — Conformance + cleanup

  **A.13** — Conformance fixture relocation:

  - 3 cases moved (`git mv`): `basic-scan`, `orphan-detection`,
    `rename-high` →
    `src/extensions/providers/claude/conformance/cases/`. 11
    fixture files (`minimal-claude/`, `orphan-{before,after}/`,
    `rename-high-{before,after}/`) moved alongside.
  - New `coverage.md` per-Provider listing the 5 frontmatter
    schemas (skill, agent, command, hook, note) and their cases.
  - New verb `sm conformance run [--scope spec|provider:<id>|all]`.
    Discovery by convention at `<plugin-dir>/conformance/`. The
    existing runner gains optional `fixturesRoot` (default
    `<specRoot>/conformance/fixtures` for compat); tooling using
    the public API of `@skill-map/cli/conformance` keeps working.
    `--json` deferred — reporter shape not yet frozen.
  - Spec keeps only the kernel-agnostic case (`kernel-empty-boot`)
    and the universal preamble fixture. Coverage matrix downgrades
    conservatively (rows that depended on `basic-scan` are now
    partial or missing, with cross-link to the Provider's matrix).

  ROADMAP cleanup:

  - The three "Status: target state for v0.8.0 — spec catch-up
    pending" banners on §Plugin system / §Frontmatter standard /
    §Enrichment are removed; prose shifts from future to present
    ("kinds from v0.7.0 are renamed" → "were renamed in spec
    0.8.0"; Model B enrichment now describes the shipped
    `node_enrichments` table with `body_hash_at_enrichment` rather
    than "table or column set decided in PR").
  - Decision-log entry for the working session rewritten to
    reflect "shipped" rather than "pending".
  - Last-updated header gains an "implementation" paragraph
    listing the four prior phase commits.

  593/593 cli + 32/32 testkit pass (+2 vs Phase 4 baseline).
  spec:check green (40 files hashed — down from 53 because the
  Claude-specific cases and fixtures left the spec's hash set).

  ### Breaking changes for plugin authors (Part 2)

  Manifest renames:

  - `kind: 'adapter'` → `kind: 'provider'`
  - `kind: 'detector'` → `kind: 'extractor'`
  - `kind: 'renderer'` → `kind: 'formatter'`
  - `kind: 'audit'` removed (migrate to `kind: 'rule'`).

  Method signatures:

  - Detector `detect(ctx) → Link[]` → Extractor `extract(ctx) →
void` (output via `ctx.emitLink` / `ctx.enrichNode` /
    `ctx.store`).
  - Renderer `render(ctx) → string` → Formatter `format(ctx) →
string`.

  Manifest fields:

  - Provider gains required `explorationDir`.
  - Provider's flat `defaultRefreshAction` map replaced by per-kind
    entries inside `kinds[<kind>].defaultRefreshAction` (must
    follow qualified pattern `<plugin-id>/<ext-id>`).
  - Provider's `emits` derives from `Object.keys(kinds)` (the
    manifest field is gone).
  - Provider's per-kind schemas declared via `kinds[<kind>].schema`
    (path relative to provider dir).
  - Renderer's `format` field renamed to `formatId` on the
    Formatter manifest (TS clash resolution).
  - New plugin kind `hook` with `triggers[]` + optional `filter`.
  - Optional `outputSchema` (`storage.schema` / `storage.schemas`)
    for Mode A / Mode B plugin custom storage.
  - Optional `applicableKinds` filter on Extractor manifest.

  Extension ids:

  - All extension ids must be qualified
    `<plugin-id>/<extension-id>` (built-ins classified into
    `claude/*` and `core/*`).

  DB schema:

  - Two new tables added in-place to `001_initial.sql` (pre-1.0
    consolidation, no production DBs to migrate):
    `scan_extractor_runs` and `node_enrichments`.
  - Column rename `nodes.adapter` → `nodes.provider` (and parallel
    in `result.adapters` → `result.providers`).

  ## Test stats

  593/593 cli + 32/32 testkit pass (post-Phase 5).
  Two new DB tables (`scan_extractor_runs`, `node_enrichments`)
  added in-place to `001_initial.sql` (pre-1.0 consolidation, no
  production DBs to migrate). The 5 per-kind frontmatter schemas
  relocated from spec/ to the Claude Provider package.

### Patch Changes

- Updated dependencies [6dad772]
  - @skill-map/spec@0.8.0

## 0.5.0

### Minor Changes

- 0463a0f: Step 9.1 — plugin runtime wiring. Drop-in plugins discovered under
  `<scope>/.skill-map/plugins/<id>/` now participate in the read-side
  pipeline: their detectors / rules emit links + issues during `sm scan`,
  and their renderers are selectable via `sm graph --format <name>`.

  New surface:

  - `loadPluginRuntime(opts)` helper at `src/cli/util/plugin-runtime.ts`
    centralises discovery, layered enabled-resolver (settings.json + DB
    override `config_plugins`), failure-mode-to-warning conversion, and
    manifest-row collection. Single source of truth for any verb that
    needs plugin extensions on the wire.
  - `composeScanExtensions` + `composeRenderers` merge built-in and plugin
    contributions into the shapes the orchestrator + graph command consume.
  - `--no-plugins` flag added to `sm scan`, `sm scan --watch`, `sm watch`,
    and `sm graph`. Pairs with `--no-built-ins` for kernel-empty-boot
    parity.
  - Failed plugins (`incompatible-spec` / `invalid-manifest` / `load-error`)
    emit one stderr line each and are skipped; the kernel keeps booting.
    Disabled plugins silently drop out of the pipeline (their `sm plugins
list` row already conveys intent).

  Bug fix collateral: the plugin loader now strips function-typed
  properties from a plugin's runtime export before AJV-validating it
  against the extension-kind schema. The kind schemas use
  `unevaluatedProperties: false` to keep the manifest shape strict;
  without the strip, real plugins shipping `detect` / `render` /
  `evaluate` methods always failed validation. Built-ins were unaffected
  because they never went through the loader.

  Out of scope for 9.1, picked up later in Step 9:

  - `sm export --format` does not consult the renderer registry today;
    its formats (`json`, `md`, `mermaid`) are hand-rolled. Flipping it
    to use renderers is a future enhancement, not on the Step 9 critical
    path.
  - Plugin migrations + `sm db migrate --kernel-only` / `--plugin <id>`
    flags + triple protection ship as Step 9.2.
  - `@skill-map/testkit` package ships as Step 9.3.
  - Plugin author guide ships as Step 9.4.

  5 new tests at `src/test/plugin-runtime.test.ts` cover plugin detector
  contribution, `--no-plugins` opt-out on both scan and graph, broken-
  manifest tolerance, and plugin-renderer selection. Test count
  389 → 394.

- 0463a0f: Step 9.2 — plugin migrations + triple protection. Plugins declaring
  `storage.mode === 'dedicated'` can now ship their own SQL migrations
  under `<plugin-dir>/migrations/NNN_<name>.sql`, and `sm db migrate`
  applies them after the kernel pass. Two new flags from
  `spec/cli-contract.md:304` light up:

  - `--kernel-only` — skip plugin migrations entirely.
  - `--plugin <id>` — run migrations for one plugin (skips the kernel
    pass; assumes kernel is already up to date). Mutually exclusive
    with `--kernel-only`.

  Triple-protection rule (every object a plugin migration touches MUST
  live in the namespace `plugin_<normalizedId>_*`):

  - **Layer 1 — discovery**: every pending file is parsed + validated
    before any of them run. Failure aborts the whole batch with no DB
    writes.
  - **Layer 2 — apply**: same validator runs immediately before
    `db.exec(sql)`, defending against TOCTOU edits between discovery
    and apply.
  - **Layer 3 — post-apply catalog assertion**: after each plugin's
    batch commits, `sqlite_master` is compared against a pre-batch
    snapshot. Any new object outside the prefix is reported as an
    intrusion (exit code 2; ledger row still written for whatever
    applied cleanly so the breach is loud).

  Implementation: pragmatic regex parser per the Arquitecto's pick.
  Whitelist of allowed DDL (`CREATE` / `DROP` / `ALTER` over `TABLE` /
  `INDEX` / `TRIGGER` / `VIEW`) + DML (`INSERT` / `UPDATE` / `DELETE`)
  on prefixed objects. Forbidden keywords (`BEGIN` / `COMMIT` /
  `ROLLBACK` / `PRAGMA` / `ATTACH` / `DETACH` / `VACUUM` / `REINDEX` /
  `ANALYZE`) abort validation. Schema qualifiers other than `main.`
  are rejected. Comments are stripped first so `-- CREATE TABLE evil;`
  and `/* … */` blocks can't smuggle hidden DDL past the regex.

  Lights up `storage.mode === 'dedicated'` end-to-end: the existing
  `config_schema_versions` table records plugin migrations under
  `(scope='plugin', owner_id=<plugin-id>)`. Plugins with `mode === 'kv'`
  or no `storage` field are skipped silently — the kernel-owned
  `state_plugin_kvs` table is already there. Each migration runs in
  its own transaction with the ledger insert in the same transaction
  so partial failures roll back cleanly.

  New modules:

  - `src/kernel/adapters/sqlite/plugin-migrations-validator.ts` —
    `normalizePluginId`, `stripComments`, `splitStatements`,
    `validatePluginMigrationSql`, `snapshotCatalog`,
    `detectCatalogIntrusion`, `assertNoNormalizationCollisions`. Pure,
    no IO.
  - `src/kernel/adapters/sqlite/plugin-migrations.ts` —
    `discoverPluginMigrations`, `planPluginMigrations`,
    `applyPluginMigrations`, `readPluginLedger`. Mirrors the kernel
    runner shape for consistency.

  CLI surface:

  - `DbMigrateCommand` learns `--kernel-only` and `--plugin <id>`. The
    `--status` summary now lists kernel + per-plugin ledgers.
  - Plugin discovery uses the `loadPluginRuntime` helper from 9.1, so
    the resolver layering (settings.json + DB override) stays in
    lock-step with `sm plugins list`.

  43 new tests across two files (`plugin-migrations-validator.test.ts`,
  `plugin-migrations.test.ts`) cover id normalization, comment stripping,
  statement splitting, prefix enforcement (green path + 9 violation
  shapes), catalog intrusion detection, runner integration (green path,
  Layer 1 abort, idempotent re-run, dry-run), and the CLI flag matrix
  (`--kernel-only`, `--plugin <id>`, missing-id exit 5, mutual exclusion,
  `--status` formatting). Test count 394 → 437.

### Patch Changes

- 0463a0f: Step 9.3 — `@skill-map/testkit` lands as a separate workspace + npm
  package (per the Arquitecto's pick of independent versioning over a
  subpath export). Plugin authors install it alongside `@skill-map/cli`
  and use it to unit-test detectors, rules, renderers, and audits
  without spinning up the full skill-map runtime.

  New surface (all stable through v1.0 except the runner stand-in,
  flagged `experimental` until Step 10 lands the job subsystem
  contract):

  - **Builders** — `node()`, `link()`, `issue()`, `scanResult()` produce
    spec-aligned domain objects with sensible defaults. Override only
    the fields a given test cares about.
  - **Context factories** — `makeDetectContext`, `makeRuleContext`,
    `makeRenderContext`, `detectContextFromBody`. Per-kind context shapes
    the kernel injects into extension methods.
  - **Fakes** — `makeFakeStorage` (in-memory KV stand-in for `ctx.store`,
    matches the Storage Mode A surface) and `makeFakeRunner` (queue +
    history `RunnerPort` stand-in for probabilistic extensions).
  - **Run helpers** — `runDetectorOnFixture(detector, opts)`,
    `runRuleOnGraph(rule, opts)`, `runRendererOnGraph(renderer, opts)`.
    Most plugin tests reduce to one line: build the fixture, call the
    helper, assert on the result.

  Collateral on `@skill-map/cli`: `src/kernel/index.ts` now re-exports
  the extension-kind interfaces (`IDetector`, `IRule`, `IRenderer`,
  `IAdapter`, `IAudit` and their context shapes) so plugin authors can
  type-check their extensions against the same surface the kernel
  consumes. Patch-level bump because the change is purely additive.

  The testkit workspace ships its own `tsup` build (5 KB of runtime,
  10 KB of types) and pins every dep at exact versions per the
  monorepo policy. `@skill-map/cli` is marked `external` in the bundle
  so the published testkit stays a thin layer over the user's installed
  cli version.

  30 new tests under `testkit/test/*.test.ts` cover builder defaults +
  overrides, context factory shapes, KV stand-in semantics (set / get /
  list-by-prefix / delete), fake-runner queueing + history + reset, and
  the three high-level run helpers. Tests run in their own
  `npm test --workspace=@skill-map/testkit` step (independent from cli's
  test command).

  Out of scope for 9.3, picked up in 9.4:

  - Plugin author guide (`spec/plugin-author-guide.md`) referencing the
    testkit by example.
  - Reference plugin under `examples/hello-world/` (Arquitecto's pick:
    in the principal repo, not a separate one).
  - Diagnostics polish on the loader's `reason:` strings.

- 0463a0f: Step 9.4 — plugin author guide + reference plugin + diagnostics polish.
  **Step 9 fully closed** with this changeset.

  ### Spec — plugin author guide (additive prose)

  New document at `spec/plugin-author-guide.md` covering:

  - Discovery roots (`<project>/.skill-map/plugins/`,
    `~/.skill-map/plugins/`, `--plugin-dir <path>`).
  - Manifest fields with the normative schema reference.
  - `specCompat` strategy — narrow ranges pre-`v1.0.0`, `^1.0.0`
    recommendation post-`v1.0.0`.
  - The six extension kinds with one minimal worked example each
    (detector, rule, renderer in full; adapter / audit / action flagged
    for later expansion alongside Step 10).
  - Storage choice (KV vs Dedicated) cross-linking `plugin-kv-api.md`
    and the Step 9.2 triple-protection rule.
  - Execution modes (deterministic / probabilistic) cross-linking
    `architecture.md`.
  - Testkit usage with `runDetectorOnFixture`, `runRuleOnGraph`,
    `runRendererOnGraph`, `makeFakeRunner`.
  - The five plugin statuses (`loaded` / `disabled` / `incompatible-spec`
    / `invalid-manifest` / `load-error`) and how to read them.
  - Stability section (document is stable; widening additions are minor
    bumps; breaking edits are major).

  `spec/package.json#files` updated to ship the new doc; `spec/index.json`
  regenerated (57 → 58 hashed files). `coverage.md` unchanged because the
  guide is prose, not a schema.

  ### Reference plugin — `examples/hello-world/`

  Smallest viable plugin in the principal repo (Arquitecto's pick: in
  the main repo, not separate). One detector (`hello-world-greet`)
  emitting `references` links per `@greet:<name>` token in node bodies.
  Includes:

  - `plugin.json` declaring one extension and pinning `specCompat: ^1.0.0`.
  - `extensions/greet-detector.mjs` — runtime instance with both
    manifest fields and the `detect` method.
  - `README.md` — what it does, file layout, three-step "try it
    locally" recipe, what's intentionally missing (storage,
    multi-extension, probabilistic mode), pointers for production-grade
    patterns.
  - `test/greet-detector.test.mjs` — four-assertion test using
    `@skill-map/testkit`, runnable via `node --test` with no build step.

  Verified end-to-end: the example plugin loads cleanly under
  `sm plugins list`, scans contribute its links to the persisted graph,
  and the testkit-based test passes. The example is **not** registered
  as a workspace — it's intentionally standalone so users can copy it.

  ### CLI — diagnostics polish on `PluginLoader.reason`

  Each failure-mode reason string now carries an actionable hint:

  - `invalid-manifest` (JSON parse): names the manifest path, suggests
    validating the JSON.
  - `invalid-manifest` (AJV): names the manifest path AND points at
    `spec/schemas/plugins-registry.schema.json#/$defs/PluginManifest`.
  - `invalid-manifest` (specCompat not a valid range): suggests a range
    shape (`"^1.0.0"`).
  - `incompatible-spec`: suggests two remediations (update the plugin's
    `specCompat`, or pin sm to a compatible spec version).
  - `load-error` (extension file not found): includes the absolute
    resolved path, pointer to `plugin.json#/extensions`.
  - `load-error` (default export missing kind): lists the valid kinds.
  - `load-error` (unknown kind): lists the valid kinds.
  - `load-error` (extension manifest schema fails): names the
    per-kind schema (`spec/schemas/extensions/<kind>.schema.json`).

  6 new tests under `test/plugin-loader.test.ts` (`Step 9.4 diagnostics
polish` describe block) assert each hint shape is present without
  pinning the full text. Test count 437 → **443 cli + 30 testkit = 473**.

  ### Step 9 closed

  The four sub-steps — 9.1 (plugin runtime wiring), 9.2 (plugin
  migrations + triple protection), 9.3 (`@skill-map/testkit` workspace),
  9.4 (author guide + reference plugin + diagnostics polish) — together
  turn `skill-map` plugins from "discovered but inert" into a
  first-class authoring surface with documentation, tests, and a
  working reference. Next step: **Step 10 — job subsystem + first
  probabilistic extension** (wave 2 begins).

- Updated dependencies [0463a0f]
  - @skill-map/spec@0.7.1

## 0.4.0

### Minor Changes

- a73f3f4: Step 7.1 — File watcher (`sm watch` / `sm scan --watch`)

  Long-running watcher that subscribes to the scan roots, debounces
  filesystem events, and triggers an incremental scan per batch. Reuses
  the existing `runScanWithRenames` pipeline, the `IIgnoreFilter` chain
  (`.skill-mapignore` + `config.ignore` + bundled defaults), and the
  `scan.*` non-job events from `job-events.md` — one ScanResult per
  batch, emitted as ndjson under `--json`.

  **Spec changes (minor)**:

  - `spec/schemas/project-config.schema.json` — new `scan.watch` object
    with a single key `debounceMs` (integer ≥ 0, default 300). Groups
    bursts of filesystem events (editor saves, branch switches, npm
    installs) into a single scan pass. Set to 0 to disable debouncing.
  - `spec/cli-contract.md` §Scan — documents `sm watch [roots...]` as
    the primary verb and `sm scan --watch` as the alias. Watcher
    respects the same ignore chain as one-shot scans, emits one
    ScanResult per batch (ndjson under `--json`), closes cleanly on
    `SIGINT` / `SIGTERM`, exits 0 on clean shutdown. Exit-code rule
    carved out for the watcher: per-batch error issues do not flip the
    exit code (the loop keeps running); operational errors still exit 2.

  No new events. No new ports. The watcher is implementation-defined
  inside the kernel package; a future `WatchPort` can be added when /
  if a non-Node implementation needs to swap the chokidar wrapper.

  **Runtime changes (minor — new verb + new config key)**:

  - `chokidar@5.0.0` pinned in `src/package.json` (single new runtime
    dependency, MIT). Chokidar v5 requires Node ≥ 20.19; the project
    already pins `engines.node: ">=24.0"` so this is a no-op for
    consumers. Brings in `readdirp@5` as a transitive.
  - `src/kernel/scan/watcher.ts` — `IFsWatcher` interface + concrete
    `ChokidarWatcher` wrapping `chokidar.watch()` with the existing
    `IIgnoreFilter` plumbed through, debouncer, batch coalescing,
    and explicit `stop()` for clean teardown.
  - `src/cli/commands/watch.ts` — new `WatchCommand`. `sm scan
--watch` delegates to the same code path so the two surfaces are
    byte-aligned (no parallel implementations).
  - `src/config/defaults.json` — new `scan.watch.debounceMs: 300`
    default.

  **Why minor (not patch)**: new public verb (`sm watch`), new public
  config key (`scan.watch.debounceMs`), and a new flag on an existing
  verb (`sm scan --watch`). All three are surface additions, not bug
  fixes — minor under both the spec and the runtime semver policies.
  No breaking changes; existing `sm scan` without `--watch` is
  byte-identical to before.

  **Roadmap**: Step 7 — Robustness, sub-step 7.1 (chokidar watcher).
  Trigger normalization is implicit-already-landed (cabled into every
  detector at Steps 3–4 with full unit tests in
  `src/kernel/trigger-normalize.test.ts`); we do not write a sub-step
  for it. Next sub-steps: 7.2 detector conflict resolution, 7.3 `sm
job prune` + retention enforcement.

- a73f3f4: Step 7.2 — Detector conflict resolution

  Two pieces:

  1.  **New built-in rule `link-conflict`** (`src/extensions/rules/link-conflict/`).
      Surfaces detector disagreement. Groups links by `(source, target)` and
      emits one `warn` Issue per pair where the set of distinct `kind` values
      has size ≥ 2. Agreement (single kind across multiple detectors) is
      silent — by design, to avoid massive noise on real graphs.
      Issue payload (`data`) carries `{ source, target, variants }` where
      each `variant` is `{ kind, sources: detectorId[], confidence }`. Variant
      sources are deduped + sorted; confidence is the highest across rows
      of the same kind (`high` > `medium` > `low`).

      This is the kernel piece of Decision #90 read-time "consumers that
      need uniqueness aggregate at read time" — the rule is one such
      consumer, on the alarming side. Storage stays untouched (one row
      per detector, no merge, no dedup). Severity is `warn`, not `error`:
      the rule cannot pick which kind is correct, so per `cli-contract.md`
      §Exit codes the verb stays exit 0.

  2.  **`sm show` pretty link aggregation** (`src/cli/commands/show.ts`).
      The human renderer now groups `linksOut` / `linksIn` by `(endpoint,
kind, normalizedTrigger)` and prints one row per group with the
      union of detector ids in a `sources:` field. The section header
      reports both the raw row count and the unique-after-grouping count
      (`Links out (12, 9 unique)`). When N > 1 detector emits the same
      logical link, the row also gets a `(×N)` suffix.

                                                     `--json` output is byte-identical to before — raw rows, no merge.
                                                     Storage is byte-identical to before. The grouping is purely a
                                                     read-time presentation choice for human eyes.

  **Spec changes (patch)**:

  - `spec/cli-contract.md` §Browse — `sm show` row clarifies that pretty
    output groups identical-shape links and that `--json` emits raw rows.
    Patch (not minor) because the JSON contract is unchanged; the human
    output format is non-normative anyway.

  **Runtime changes (minor — new rule + new presentation)**:

  - New rule `link-conflict` registered in `src/extensions/built-ins.ts`.
  - `sm show` pretty output groups links + reports unique counts.

  **UI inspector aggregation deferred to Step 13**: the current Flavor A
  inspector renders the `Relations` card from `node.frontmatter.metadata.{
related, requires, supersedes, provides, conflictsWith}` directly — it
  does NOT consume `linksOut` / `linksIn` rows from `scan_links`. There
  is no link table to aggregate today. When Step 13's Flavor B lands (Hono
  BFF + WS + full link panel from scan), the aggregation logic from
  `src/cli/commands/show.ts` will need to be ported.

  **Roadmap**: Step 7 — Robustness, sub-step 7.2 (detector conflict
  resolution). Closes one of the three remaining frentes; 7.3 (`sm job
prune` + retention) still pending. Decision #90 unchanged: storage
  keeps raw per-detector rows. The `related` vs LLM-amplification
  discussion is documented in `.tmp/skill-map-related-test/` (status
  quo retained — fields stay opt-in under `metadata.*`; revisit if
  real-world amplification appears).

  **Tests**: 327 → 335 (+8 new for the rule, no regressions).

- a73f3f4: Step 7.3 — `sm job prune` retention GC

  Lands the real implementation behind the existing stub. Closes Step 7.

  **Behaviour**:

  - Default: applies the configured retention policy. For each terminal
    status (`completed` / `failed`) with a non-null
    `jobs.retention.<status>` value, deletes `state_jobs` rows whose
    `finished_at < Date.now() - policySeconds * 1000` and unlinks each
    row's MD file in `.skill-map/jobs/`. Default `completed` policy is
    30 days (2592000s); default `failed` is `null` (never auto-prune,
    preserving failure history for analysis).
  - `--orphan-files`: ALSO scans `.skill-map/jobs/` for MD files whose
    absolute path is not referenced by any `state_jobs.file_path` and
    unlinks them. Runs AFTER retention so freshly-pruned files don't
    double-count. Useful when the DB was wiped or a runner crashed
    mid-render.
  - `--dry-run` / `-n`: reports what would be pruned without touching
    the DB or the FS. Output shape is identical to live mode (`dryRun:
true` distinguishes them under `--json`).
  - `--json`: emits a structured document on stdout — `{ dryRun,
retention: { completed: { policySeconds, deleted, files }, failed:
{...} }, orphanFiles: { scanned, deleted } | { scanned: false } }`.

  **Implementation**:

  - New module `src/kernel/adapters/sqlite/jobs.ts`: `pruneTerminalJobs`
    (DB-only — returns count + filePaths so the CLI does the unlink) and
    `listOrphanJobFiles` (FS scan + DB cross-reference).
  - New command file `src/cli/commands/jobs.ts`: `JobPruneCommand`.
  - `src/cli/commands/stubs.ts` no longer exports `JobPruneCommand`; the
    stub registration was removed from `STUB_COMMANDS`.
  - `src/cli/entry.ts` registers `JobPruneCommand` from the new file.

  **Spec invariants honoured**:

  - `state_executions` is NOT touched (per `spec/db-schema.md` §Persistence
    zones — append-only through v1.0).
  - Pruning runs only on explicit invocation; no implicit GC during
    normal verb execution (per `spec/job-lifecycle.md` §Retention and
    GC).
  - DB-missing → exit 2 with a clear message ("run `sm init` first").
  - File-unlink failures (already missing, permission denied) are
    swallowed silently — a stale file path doesn't fail the verb;
    the DB row is already gone.

  **Tests**: 327 → 341 (+14 covering helpers + CLI: empty DB, retention
  cutoff, dry-run, orphan-files mode, json shape, default policies).

  **Roadmap**: closes Step 7. All four frentes listed when 7 opened
  (trigger normalization, chokidar, conflict resolution, sm job prune)
  are now landed. Trigger normalization stayed implicit-already-done
  (cabled at Steps 3–4). Step 8 (Diff + export) is next.

- d3ad73c: Step 8.1 — `sm graph [--format <name>]` real implementation

  Replaces the long-standing stub with a real read-side verb that renders
  the persisted graph through any registered renderer. First sub-step of
  Step 8 (Diff + export).

  **Behaviour**:

  - Reads the DB via the existing `loadScanResult` driving adapter
    (`src/kernel/adapters/sqlite/scan-load.ts`); never persists.
  - Resolves the renderer by `format` field — default `ascii`. The lookup
    is over `builtIns().renderers`; plugin-supplied renderers will plug in
    through the same loader path that `sm scan` uses for adapters /
    detectors / rules, scheduled for Step 9 (plugin author UX).
  - Trailing newline normalisation: appends `\n` only if the renderer's
    output didn't already end in one. Safe to pipe.

  **Flags**:

  - `--format <name>` — must match a registered renderer's `format` field.
    Default `ascii`. `mermaid` and `dot` ship at Step 12 as drop-in
    built-ins; the verb requires no further changes when they land.
  - `--db <path>` and `-g/--global` — standard read-side scope flags
    (delegate to `resolveDbPath`).

  **Exit codes** (per `spec/cli-contract.md` §Exit codes):

  - `0` — render succeeded.
  - `2` — bad flag or unhandled error.
  - `5` — DB missing OR no renderer registered for the requested format.

  The empty-DB case (migrated but never scanned) renders the zero-graph
  ("0 nodes, 0 links, 0 issues") and exits `0` on purpose: graph is a
  read-side reporter, not a guard. Pair it with `sm doctor` (Step 10) for
  state assertions.

  **Wiring**:

  - New command at `src/cli/commands/graph.ts`.
  - Registered in `src/cli/entry.ts`.
  - Removed from `STUB_COMMANDS` in `src/cli/commands/stubs.ts`; the
    remaining `export` stub now points at Step 8.3 (was Step 3, stale).
  - `context/cli-reference.md` regenerated via `npm run cli:reference`;
    CI's `cli:check` job stays green.

  **Tests** (`src/test/graph-cli.test.ts`, 5 cases): default format renders
  two-node fixture; explicit `--format ascii` matches default; unknown
  `--format mermaid` exits 5 with "Available: ascii"; missing DB exits 5;
  empty DB renders zero-graph at exit 0. Total: 346 → **351** (+5).

  **No spec change**: the `sm graph [--format ...]` row in
  `spec/cli-contract.md` was already in place since Step 0a. This is pure
  runtime catch-up — wiring the verb that the spec already promised.

- d3ad73c: Step 8.2 — `sm scan --compare-with <path>` delta report

  Second sub-step of Step 8 (Diff + export). Adds a flag to `sm scan` that
  loads a saved `ScanResult` dump, runs a fresh scan in memory, and emits
  a delta between the two snapshots. Never touches the DB.

  **Flag**:

  - `--compare-with <path>` — string, optional. Points at a JSON file
    conforming to `scan-result.schema.json` (typically the output of an
    earlier `sm scan --json > baseline.json` invocation).

  **Behaviour**:

  - Loads the dump, parses it, validates against `scan-result.schema.json`
    via the existing `loadSchemaValidators()` adapter.
  - Runs a fresh scan with the same wiring as a normal `sm scan` (built-ins,
    layered config, ignore filter, strict mode). Skips persistence — the
    verb's contract is read-only.
  - Computes a delta via the new `computeScanDelta` kernel helper and
    emits a report.

  **Identity contract** (recorded in `src/kernel/scan/delta.ts`):

  - **Node** identity = `path`. Two nodes with the same path are the same
    node; differences become a `changed` entry annotated with the reason
    (`'body'` / `'frontmatter'` / `'both'`) so a renderer / summariser can
    decide whether the change is interesting.
  - **Link** identity = `(source, target, kind, normalizedTrigger ?? '')`.
    Mirrors the `sm show` aggregation key and Step 7.2's `link-conflict`
    rule — the `sources[]` union and confidence are presentation facets
    that don't constitute identity.
  - **Issue** identity = `(ruleId, sorted nodeIds, message)`. Matches the
    diff key `spec/job-events.md` §issue.\* defines for future job events,
    so consumers can reuse the same logic.

  No "changed" bucket for links / issues — identity already captures
  everything that matters there. Nodes get one because the path stays
  stable while the body / frontmatter rewrites, and that change matters
  to downstream consumers (renderers, summarisers, the UI inspector).

  **Output**:

  - Pretty (default): one-line header with totals per bucket, then a
    `## nodes` / `## links` / `## issues` section per non-empty bucket
    using `+` (added), `-` (removed), `~` (changed) prefixes. Identical
    scans get a `(no differences)` hint.
  - `--json`: emits the `IScanDelta` object — `{ comparedWith, nodes:
{ added, removed, changed }, links: { added, removed }, issues:
{ added, removed } }`. Schema is implementation-defined pre-1.0 per
    `spec/cli-contract.md` and intentionally not pinned to a separate
    `delta.schema.json` until consumers materialise.

  **Exit codes** (per `spec/cli-contract.md` §Exit codes):

  - `0` — empty delta. Snapshot matches the dump byte-for-identity.
  - `1` — non-empty delta. Pre-commit / pre-merge wiring trips here.
  - `2` — operational error: dump file missing, malformed JSON, or
    schema-violating dump.

  **Combo rules**:

  - `--compare-with` cannot be combined with `--changed`, `--no-built-ins`,
    `--allow-empty`, or `--watch`. The first three are incoherent (a
    zero-filled or partial current scan makes the delta meaningless); the
    last is a different lifecycle.
  - `--dry-run` is implicit (no DB writes happen anyway), so the combo is
    silently allowed as a no-op.
  - `--strict` and `--no-tokens` are honoured — they affect what the
    fresh scan produces, which then drives the delta.

  **Kernel surface**:

  - New module `src/kernel/scan/delta.ts` exporting `computeScanDelta`,
    `isEmptyDelta`, `IScanDelta`, `INodeChange`, `TNodeChangeReason`.
  - Re-exported from `src/kernel/index.ts` for plugin authors and
    alternative drivers.

  **Tests** (`src/test/scan-compare.test.ts`, 12 cases): identical fixture
  → empty delta exit 0; body / frontmatter edits surface with the right
  reason; new file → added node + added link; deleted file → removed node;
  `--json` shape matches `IScanDelta`; missing / non-JSON / schema-violating
  dumps exit 2; combo rejections for `--changed`, `--no-built-ins`,
  `--watch`. Test count: 351 → **363** (+12).

  **No spec change**: the `sm scan --compare-with <path>` row in
  `spec/cli-contract.md` was already in place since Step 0a. This is pure
  runtime catch-up — wiring the verb that the spec already promised.

- 13727a3: Step 8.3 — `sm export <query> --format <json|md|mermaid>` real implementation

  Third and final sub-step of Step 8 (Diff + export). Replaces the stub
  with a real verb that filters the persisted graph through a minimal
  query language and emits the resulting subset as JSON or Markdown.
  **Step 8 is now fully closed.**

  **Query syntax** (v0.5.0; spec calls it "implementation-defined pre-1.0"):

  - Whitespace-separated `key=value` tokens; AND across keys.
  - Values within one token are comma-separated; OR within one key.
  - Keys: `kind` (skill / agent / command / hook / note), `has` (`issues`
    today; `findings` / `summary` reserved for Steps 10 / 11), `path`
    (POSIX glob — `*` matches a single segment, `**` matches across
    segments).
  - Empty query (`""`) is valid and exports every node.

  Examples:

  sm export "kind=command" --format json
  sm export "kind=skill,agent has=issues" --format md
  sm export "path=.claude/commands/\*\*" --format json
  sm export "" --format md

  **Subset semantics** (recorded in `src/kernel/scan/query.ts`):

  - A node passes when every specified filter matches (AND across keys,
    OR within values).
  - Links survive only when BOTH endpoints are in the filtered set — the
    exported subgraph is closed. Boundary edges would confuse "I asked
    for a focused view" with "I asked for the focus and its neighbours".
  - Issues survive when ANY of their `nodeIds` is in scope. Cross-cutting
    issues (e.g. `trigger-collision` over two advertisers) stay visible
    even when the user filtered to one of the parties — that's the
    scenario where the user actively wants to see the conflict.

  **Format support at v0.5.0**:

  - `json` — emits `{ query, filters, counts: {nodes, links, issues},
nodes, links, issues }`. Schema is implementation-defined pre-1.0
    per `spec/cli-contract.md` and intentionally not pinned to a separate
    `export.schema.json` until consumers materialise.
  - `md` — Markdown report grouped by node kind (same `KIND_ORDER` as the
    ASCII renderer for visual consistency); per-node issue counts inline;
    separate `## links` and `## issues` sections.
  - `mermaid` — exits 5 with a clear pointer to Step 12 (when the mermaid
    renderer lands as a built-in). Surfacing it now would require a
    synthesis layer this verb shouldn't carry.

  **Exit codes** (per `spec/cli-contract.md` §Exit codes):

  - `0` — render succeeded.
  - `5` — DB missing OR unsupported format OR invalid query.

  **Kernel surface**:

  - New module `src/kernel/scan/query.ts` exporting `parseExportQuery`,
    `applyExportQuery`, `IExportQuery`, `IExportSubset`, and
    `ExportQueryError`. Pure (no IO). Re-exported from `src/kernel/index.ts`
    for plugin authors and alternative drivers.
  - Micro-glob → RegExp converter rolled in-module (zero-deps; supports
    `*` and `**` only). The grammar is intentionally minimal so the spec
    doesn't bind us to a specific glob library before v1.0.

  **Wiring**:

  - New command at `src/cli/commands/export.ts`.
  - Registered in `src/cli/entry.ts`.
  - Removed from `STUB_COMMANDS` in `src/cli/commands/stubs.ts`.
  - `context/cli-reference.md` regenerated via `npm run cli:reference`;
    `cli:check` stays green.

  **Tests** (`src/test/export-cli.test.ts`, 26 cases across two suites):

  - `parseExportQuery` unit tests (12): empty / whitespace / kind /
    multi-value / has / path / combined / unknown key / unknown kind /
    unknown has / malformed token / empty value list / duplicate key.
  - `applyExportQuery` semantic tests (7): empty query → everything;
    kind filter + closed subgraph; has=issues; path glob with `*` and
    `**`; AND across keys; ANY-nodeId rule for issues.
  - `ExportCommand` handler tests (7): default JSON, kind filter, MD
    rendering, mermaid → exit 5, unsupported format → exit 5, invalid
    query → exit 5, missing DB → exit 5.

  Total: 363 → **389** (+26).

  **No spec change**: the `sm export <query> --format json|md|mermaid` row
  in `spec/cli-contract.md` was already in place since Step 0a. This is
  pure runtime catch-up — wiring the verb that the spec already promised.

### Patch Changes

- b067f35: Runtime catch-up — thread `mode: 'deterministic'` explicitly through the built-in detectors and rules

  The execution-modes spec lift (separate changeset, `@skill-map/spec` major)
  defined the per-kind capability matrix and added the optional `mode` field
  to `Detector` / `Rule` schemas with default `deterministic`. Manifests stayed
  valid without an update because the field is optional, but the project
  policy is to thread the mode explicitly so a future probabilistic extension
  is a visible deviation, not a silent flip of the default.

  **Runtime changes**:

  - `src/kernel/types.ts` — new exported type
    `TExecutionMode = 'deterministic' | 'probabilistic'` mirroring
    `spec/architecture.md` §Execution modes. Re-exported from
    `src/kernel/extensions/index.ts` so plugin authors importing from the
    kernel barrel get it.
  - `src/kernel/extensions/detector.ts` — `IDetector` gains optional
    `mode?: TExecutionMode`. Optional matches the schema (default
    `deterministic`); existing third-party detectors compile unchanged.
  - `src/kernel/extensions/rule.ts` — `IRule` gains optional
    `mode?: TExecutionMode`. Same defaulting story; the prior "rules MUST
    be deterministic" claim in the doc-comment dropped to match the schema
    rewrite.
  - All four built-in detectors (`frontmatter`, `slash`, `at-directive`,
    `external-url-counter`) and all four built-in rules
    (`trigger-collision`, `broken-ref`, `superseded`, `link-conflict`) now
    declare `mode: 'deterministic'` explicitly.
  - `validate-all` audit, `claude` adapter, and `ascii` renderer are
    intentionally untouched — audits derive mode from `composes[]` at load
    time, and adapters / renderers are deterministic-only at the system
    boundaries (the schemas forbid the field on those three kinds).

  **New test** (`src/test/built-ins-modes.test.ts`, 5 cases) asserts the
  invariant: every built-in detector and rule declares
  `mode: 'deterministic'`; the audit / adapter / renderer manifests do NOT
  declare the field. Locks the project policy as a compile-time + runtime
  guarantee. Test count: 341 → **346** (+5).

  **No behavioural change**: the orchestrator does not yet consult
  `mode` — every built-in is already deterministic, and the kernel routing
  that rejects probabilistic extensions from scan-time hooks lands with
  the first probabilistic extension at Step 10. Today the field is
  metadata that consumers (`sm plugins doctor`, future `sm extensions
list --mode probabilistic`, the UI inspector) can read.

  **Why patch (not minor)**: pure runtime catch-up to a spec change that
  already shipped. No new public API, no new verb, no new behaviour. The
  optional `mode?` on `IDetector` / `IRule` is a backwards-compatible
  additive widen — existing code that constructs these objects keeps
  compiling without an update.

- Updated dependencies [d730094]
- Updated dependencies [a73f3f4]
- Updated dependencies [a73f3f4]
  - @skill-map/spec@1.0.0

## 0.3.3

### Patch Changes

- 16e782a: Fix `tsc --noEmit` regressions surfaced by CI after the Step 6
  follow-up commits (`7d4b143`, `4669267`). The commits validated
  through `tsup` (which does not enforce `noUncheckedIndexedAccess` /
  `exactOptionalPropertyTypes`) but tripped CI's stricter `npm run
typecheck` step. Eight TS errors across six files; runtime behaviour
  unchanged.

  **Type fixes**:

  - `src/cli/commands/config.ts` — `setAtPath` / `deleteAtPath` /
    `pruneEmptyAncestors` indexed `segments[i]` directly under
    `noUncheckedIndexedAccess`. Added an early-return guard for
    empty paths and non-null assertions on segment access.
  - `src/cli/commands/init.ts` — `GITIGNORE_ENTRIES as const` narrowed
    `length` to `2`, making the pluralization branch (`=== 1`) a TS
    "no-overlap" error. Dropped `as const` and typed it as
    `readonly string[]`.
  - `src/cli/commands/plugins.ts` — `TogglePluginsBase` extends
    Clipanion's `Command` but never implemented the abstract
    `execute()`. Marked the class `abstract` so only its concrete
    subclasses (`PluginsEnableCommand` / `PluginsDisableCommand`)
    need to implement it.
  - `src/kernel/config/loader.ts` — direct cast between
    `IEffectiveConfig` and `Record<string, unknown>` is no longer
    accepted; routed through `unknown` at both `deepMerge` call
    sites.
  - `src/kernel/scan/ignore.ts` — under `exactOptionalPropertyTypes`,
    `IBuildIgnoreFilterOptions` did not accept `undefined` even
    though the runtime tolerated it. Widened the three optional
    fields to `T | undefined` so callers can forward
    `readIgnoreFileText()` (which returns `string | undefined`)
    without a guard.
  - `src/test/config-loader.test.ts` — `match(warnings[0], …)`
    failed under `noUncheckedIndexedAccess`; added non-null
    assertions (the lines above already verify `length === 1`).

  **Prevention** — encadenar typecheck antes del test runner:

  - `src/package.json` — `test` and `test:ci` now run
    `tsc --noEmit && node --import tsx --test ...`. Local `npm test`
    picks up strict-mode regressions immediately instead of waiting
    for CI.

  Test count unchanged: 312 of 312 pass.

- f41dbad: Step 6.2 — Layered config loader for `.skill-map/settings.json`. Walks the
  six canonical layers (defaults → user → user-local → project → project-local
  → overrides), deep-merges per key, validates each layer against the
  `project-config` JSON schema, and is resilient per-key: malformed JSON,
  schema violations, and type mismatches emit warnings and skip the offending
  input without invalidating the rest of the layer. Strict mode (`--strict`,
  wired in 6.3+) re-routes every warning to a thrown `Error`.

  **Runtime change**:

  - `src/config/defaults.json` — bundled defaults derived from `project-config.schema.json`
    property descriptions (autoMigrate, tokenizer, scan._, jobs._, history.share, i18n.locale).
  - `src/kernel/config/loader.ts` — `loadConfig(opts)` entry point. Returns
    `{ effective, sources, warnings }`:
    - `effective` — fully merged `IEffectiveConfig`.
    - `sources` — `Map<dotPath, layerName>` so `sm config show --source` (6.3)
      can answer who set what.
    - `warnings` — accumulated diagnostics; empty when the load was clean.
  - Layer dedup: when `scope === 'global'`, project layers (4/5) resolve to
    the same files as user layers (2/3) and are skipped to avoid double-merging
    the same source.
  - Deep-merge semantics: nested objects merge per key; arrays replace whole;
    `null` values are preserved (e.g. `jobs.retention.failed`).
  - Schema-failure handling: AJV errors are walked once; `additionalProperties`
    errors strip the unknown key, type/const/etc. errors strip the offending
    leaf. The cleaned object is then merged so a single bad value never
    invalidates the rest of the layer.
  - No CLI surface yet — `sm config` verbs (6.3) and `--strict` flag
    (6.3+) consume this loader; the API is internal until then.

  **Tests**: `src/test/config-loader.test.ts` covers defaults application,
  five-layer precedence, override layer, global-scope dedup, deep-merge
  nested objects + array replacement + null preservation, malformed-JSON
  warning + skip, unknown-key strip, type-mismatch strip, partial-bad-file
  continues, non-object root rejection, and three strict-mode escalations
  (JSON / schema / unknown-key).

  Test count: 213 → 231 (+18).

- f41dbad: Step 6.3 — `sm config list / get / set / reset / show` go from
  stub-printing-"not implemented" to real implementations. The five verbs
  share the layered loader from 6.2 and gain a `--strict` flag on
  the read side that escalates merge warnings to fatal errors.

  **Runtime change**:

  - `src/cli/commands/config.ts` — five Clipanion commands plus shared
    helpers (`getAtPath`, `setAtPath`, `deleteAtPath` with empty-parent
    pruning, JSON-first value coercion, dot-path → human formatter).
  - `src/cli/commands/stubs.ts` — five `Config*Command` classes removed;
    `STUB_COMMANDS` array shrunk; replaced-at-step comment kept.
  - `src/cli/entry.ts` — registers the new `CONFIG_COMMANDS` array.
  - `context/cli-reference.md` — regenerated from `sm help --format md`;
    CLI version line now reflects the live `0.3.x` value (the file had
    drifted at PR #12 against the prior stub descriptions).

  **Verb semantics**:

  - `sm config list [--json] [-g] [--strict]` — prints the merged
    effective config. Human mode emits sorted `key.path = value` lines;
    `--json` emits the JSON object. Exempt from `done in <…>` per
    `spec/cli-contract.md` §Elapsed time.
  - `sm config get <key> [--json] [-g] [--strict]` — leaf value
    by dot-path. Unknown key → exit 5. `--json` wraps in JSON literals
    so callers can pipe into `jq`. Exempt from elapsed-time.
  - `sm config show <key> [--source] [--json] [-g] [--strict]` —
    identical to `get` plus optional `--source` that surfaces the winning
    layer (`defaults / user / user-local / project / project-local /
override`). For nested objects, the highest-precedence descendant
    wins. `--source --json` emits `{ value, source }`. Exempt from
    elapsed-time.
  - `sm config set <key> <value> [-g]` — writes to project file by
    default; `-g` writes to user file. JSON-parses the raw value first so
    CLI ergonomics produce booleans / numbers / arrays / objects naturally
    (unparseable falls through as plain string). Result is re-validated
    against `project-config.schema.json`; schema violation → exit 2 with
    the file untouched. In-scope verb — emits `done in <…>` to stderr.
  - `sm config reset <key> [-g]` — strips the key from the target file;
    prunes now-empty parent objects so the file stays tidy. Idempotent —
    absent key prints "No override at <path>" and exits 0. In-scope verb.

  **Tests**: `src/test/config-cli.test.ts` exercises every verb through
  the real `bin/sm.mjs` binary with isolated `HOME` and `cwd` per test:
  list defaults / project / `--json`, get leaf / object / `--json` /
  unknown-key, show `--source` on leaf and nested object, show `--source
--json`, show without `--source`, set project default + `-g` + nested
  dot-path + invalid → exit 2 + preserves siblings + emits `done in`,
  reset basic + idempotent absent + `-g` + parent-pruning.

  Test count: 231 → 252 (+21).

- f41dbad: Step 6.4 — `.skill-mapignore` parser + scan walker integration.
  Layered ignore filter composes bundled defaults + `config.ignore`
  (from `.skill-map/settings.json`) + `.skill-mapignore` file content;
  the walker honours it so reorganising `node_modules`, `dist`, drafts,
  or any user-defined private dir keeps them out of the scan in one
  predictable place.

  **New dependency**: `ignore@7.0.5` (zero-deps, MIT, gitignore-spec
  compliant — same library used by eslint, prettier). Pinned exact per
  AGENTS.md.

  **Runtime change**:

  - `src/config/defaults/skill-mapignore` — bundled defaults file shipped
    with the CLI (`.git/`, `node_modules/`, `dist/`, `build/`, `out/`,
    `.next/`, `.cache/`, `.tmp/`, `.skill-map/`, `*.log`, `.DS_Store`,
    `Thumbs.db`, `*.swp`, `*~`). Copied into `dist/config/defaults/` by
    tsup `onSuccess`.
  - `src/kernel/scan/ignore.ts` — `buildIgnoreFilter({ configIgnore?,
ignoreFileText?, includeDefaults? })` returns an `IIgnoreFilter` with
    one method, `ignores(relativePath)`. Layer order is fixed: defaults
    → `configIgnore` → `ignoreFileText`. Bundled defaults loaded once
    (module-level cache); resolves a small candidate-list of paths to
    cover both the dev layout (`src/`) and the bundled layout (`dist/`).
  - `src/kernel/scan/ignore.ts` also exports `readIgnoreFileText(scopeRoot)`
    — convenience to read `<scopeRoot>/.skill-mapignore` and feed it to
    `buildIgnoreFilter`.
  - `src/kernel/extensions/adapter.ts` — `IAdapter.walk` signature
    changes: `options.ignore?: string[]` → `options.ignoreFilter?:
IIgnoreFilter`. The old shape was unused (no caller passed it), so
    no compat shim ships.
  - `src/extensions/adapters/claude/index.ts` — walker tracks the
    current relative path during recursion and consults the filter for
    every directory and file. The previous hard-coded `DEFAULT_IGNORE`
    set is removed; the bundled defaults provide the same baseline.
    Adapters that omit `ignoreFilter` get the bundled-defaults filter as
    a defensive fallback, so kernel-empty-boot and direct adapter tests
    still skip `.git` / `node_modules` / `.tmp`.
  - `src/kernel/orchestrator.ts` — `RunScanOptions.ignoreFilter?:
IIgnoreFilter` plumbed through to every `adapter.walk(...)` call.
  - `src/cli/commands/scan.ts` — `ScanCommand` loads layered config and
    composes the filter from `cfg.ignore` + the project's
    `.skill-mapignore`, then passes it via `runOptions.ignoreFilter`.

  **Tests**: `src/test/scan-ignore.test.ts` — 14 tests covering filter
  defaults (skip / preserve / empty path), `configIgnore` patterns and
  directory globs, ignore-file text parsing with comments and blanks,
  three-layer combination including negation that respects gitignore's
  "can't re-include from excluded directory" rule, `includeDefaults:
false` opt-out, `readIgnoreFileText` present / missing, plus four
  end-to-end runScan integrations (`.skill-mapignore` excludes drafts,
  `config.ignore` excludes a private dir, defaults still skip
  `node_modules` / `.git` without extra config, file-glob negation
  re-includes a single file inside an otherwise-excluded directory).

  Test count: 252 → 266 (+14).

- 8a4667f: Step 6.5 — `sm init` scaffolding. Replaces the
  "not-implemented" stub with a real bootstrap verb that provisions
  everything Step 6 has built so far in one command:

  - `<scopeRoot>/.skill-map/` directory.
  - `settings.json` with `{ "schemaVersion": 1 }` (minimal, validated
    against `project-config.schema.json`).
  - `settings.local.json` with `{}` (placeholder for personal overrides;
    appended to `.gitignore` so it never gets committed).
  - `.skill-mapignore` at the scope root, copied byte-for-byte from
    `src/config/defaults/skill-mapignore`.
  - `<scopeRoot>/.skill-map/skill-map.db` provisioned via
    `SqliteStorageAdapter.init()` (auto-applies kernel migrations).
  - First scan: walks the scope, persists `scan_*` tables. Exit code
    mirrors `sm scan` — 1 if any `error`-severity issues land.

  Project scope (default = cwd): also appends two entries to
  `<cwd>/.gitignore` (`.skill-map/settings.local.json`,
  `.skill-map/skill-map.db`); creates the file if missing, leaves
  existing entries untouched, never duplicates. Comments and blank
  lines in an existing `.gitignore` survive.

  Global scope (`-g`): same scaffolding under `$HOME/.skill-map/`. No
  `.gitignore` is written — `$HOME` isn't a repo.

  Re-running over an existing scope errors with exit 2 unless `--force`
  is passed. `--no-scan` skips the first scan (useful in CI where the
  operator wants to provision before populating roots). `--force`
  overwrites `settings.json`, `settings.local.json`, and `.skill-mapignore`
  but keeps the DB and any other state in `.skill-map/`.

  **Runtime change**:

  - `src/cli/commands/init.ts` — new file. The `runFirstScan` helper
    loads the layered config, builds the ignore filter
    (defaults + `config.ignore` + the `.skill-mapignore` it just wrote),
    runs `runScanWithRenames`, and persists. Inline (not subprocess) so
    the parent owns the elapsed line and stdio cleanly.
  - `src/cli/commands/stubs.ts` — `InitCommand` removed; replaced-at-step
    comment kept.
  - `src/cli/entry.ts` — registers the new `InitCommand`.
  - `src/kernel/scan/ignore.ts` — new `loadBundledIgnoreText()` export;
    re-uses the module-level cache so `sm init` reads the defaults file
    once across the process lifetime.
  - `context/cli-reference.md` — regenerated; init's flag table and
    examples block now appear in the reference.

  **Tests**: `src/test/init-cli.test.ts` — 7 tests through the real
  binary covering project-scope scaffolding (files present, schemaVersion
  set, ignore template populated), `.gitignore` create-when-missing,
  `.gitignore` merge without duplicating an existing entry, re-init
  blocked without `--force`, `--force` overwrites, default first-scan
  finds and counts a seeded `.claude/agents/foo.md`, global scope under
  `HOME/.skill-map/` with no `.gitignore` written and no leakage into
  `cwd`.

  Test count: 266 → 273 (+7).

- 8a4667f: Step 6.6 — `sm plugins enable / disable` + the `config_plugins`
  override layer they read from. The two stub verbs become real, and
  the `PluginLoader` finally honours user intent: a disabled plugin
  surfaces in `sm plugins list` with status `disabled`, but its
  extensions are NOT imported and the kernel will not run them.

  **Decision (recorded in spec)**: enable/disable resolution favours the
  DB row over `settings.json` over the installed default. The DB
  override is local-machine; `settings.json` is the team-shared baseline.
  A developer can locally disable a misbehaving plugin without
  committing the toggle to the team's config; conversely, a baseline
  that explicitly enables a plugin is overridable per-machine. The rule
  is documented in `spec/db-schema.md` §`config_plugins`.

  **Spec change (additive, patch)**:

  - `spec/db-schema.md` — appended an "Effective enable/disable
    resolution" subsection under `config_plugins` documenting the
    three-layer precedence (DB > `settings.json` > installed default).
    No schema changes; the `config_plugins` table itself was already
    defined in the initial migration.

  **Runtime change**:

  - `src/kernel/types/plugin.ts` — `TPluginLoadStatus` gains a `disabled`
    variant. JSDoc explains all five states.
  - `src/kernel/adapters/sqlite/plugins.ts` — new file. Storage helpers
    over the `config_plugins` table: `setPluginEnabled` (upsert),
    `getPluginEnabled` (single read), `loadPluginOverrideMap` (bulk
    read for one round-trip per process), `deletePluginOverride`
    (idempotent drop, used by future `sm config reset plugins.<id>`).
  - `src/kernel/config/plugin-resolver.ts` — new file.
    `resolvePluginEnabled` implements the precedence above;
    `makeEnabledResolver` curries the layered config and DB map into
    the `(id) => boolean` shape `IPluginLoaderOptions.resolveEnabled`
    expects.
  - `src/kernel/adapters/plugin-loader.ts` — new optional
    `resolveEnabled` callback in `IPluginLoaderOptions`. When supplied,
    the loader checks AFTER manifest + specCompat validation and
    short-circuits with `status: 'disabled'` (manifest preserved,
    extensions array omitted, reason `"disabled by config_plugins or
settings.json"`). Omitting the callback keeps the legacy "always
    load" behaviour for tests / kernel-empty-boot.
  - `src/cli/commands/plugins.ts` — wires the loader to the resolver:
    every read (`list / show / doctor`) loads `config_plugins` once and
    feeds the resolver. Two new commands `PluginsEnableCommand` and
    `PluginsDisableCommand` write to the DB. `--all` toggles every
    discovered plugin; `<id>` and `--all` are mutually exclusive.
    `sm plugins doctor` now treats `disabled` as intentional (does not
    contribute to the issue list, does not flip exit code).
  - `src/cli/commands/plugins.ts` — adds `off` to the status icon legend
    in human output (`off  mock-a@0.1.0 · disabled by config_plugins or
settings.json`).
  - `src/cli/commands/stubs.ts` — `PluginsEnableCommand` and
    `PluginsDisableCommand` removed; replaced-at-step comment kept.
  - `context/cli-reference.md` — regenerated; the two new verbs appear
    with their flag tables.

  **Tests**:

  - `src/test/plugin-overrides.test.ts` — 8 unit tests covering storage
    round-trip (upsert + read), `loadPluginOverrideMap` bulk read,
    `deletePluginOverride` idempotency, resolver precedence (default ⇒
    true, `settings.json` overrides default, DB overrides
    `settings.json`), `makeEnabledResolver` currying, and PluginLoader
    surfacing `disabled` status with manifest preserved + no extensions
    - omitting the resolver still loads.
  - `src/test/plugins-cli.test.ts` — 9 end-to-end tests via the binary:
    `disable <id>` writes a DB row + `sm plugins list` reflects `off`,
    `enable <id>` flips back, `--all` covers every discovered plugin,
    unknown id → exit 5, no-arg → exit 2, both `<id>` and `--all` →
    exit 2, `settings.json` baseline overridden by DB `enable`,
    `settings.json` baseline applies when DB has no row, and
    `sm plugins doctor` exits 0 when the only non-loaded plugin is
    intentionally disabled.

  Test count: 273 → 291 (+18).

- 8a4667f: Step 6.7 — Frontmatter strict mode. The orchestrator now validates each
  node's parsed frontmatter against `frontmatter/<kind>.schema.json`
  during `sm scan` and emits a `frontmatter-invalid` issue when the shape
  doesn't conform. Severity is `warn` by default (scan still exits 0);
  `--strict` (CLI) or `scan.strict: true` (config) promote every such
  finding to `error` so the scan exits 1.

  **Runtime change**:

  - `src/kernel/adapters/schema-validators.ts` — registers
    `frontmatter-skill / -agent / -command / -hook / -note` as named
    top-level validators (they were already loaded as supporting schemas
    via the AJV `$ref` graph; this step exposes them through the
    `validate(name, data)` surface). Reuses the module-level cache from
    Step 5.12 — the validators compile once per process.
  - `src/kernel/orchestrator.ts` — new `RunScanOptions.strict?: boolean`
    field. After each adapter yields a node, the orchestrator validates
    the parsed frontmatter (skipping when no `---` fence is present, so
    fence-less notes stay clean). A failure produces a single
    `frontmatter-invalid` issue with `severity: 'warn' | 'error'` per
    the `strict` flag, the path in `nodeIds`, the AJV error string in
    `message`, and `data: { kind, errors }` for downstream tools.
    Issues collected during the walk land in the result alongside the
    rule-emitted ones.
  - Incremental-scan (`--changed`) preservation: a per-path
    `priorFrontmatterIssuesByNode` index walks the prior result once;
    on a cache hit, the previously-emitted frontmatter issue is re-pushed
    (re-validating would be wasted work since `frontmatterHash` is
    unchanged). The `strict` flag still applies on the second pass — a
    cached `warn` from the first scan becomes `error` on a strict
    re-run.
  - `src/cli/commands/scan.ts` — new `--strict` flag. The CLI also reads
    `cfg.scan.strict` (already in the project-config schema since 0.1)
    and passes `strict: this.strict || cfg.scan.strict === true` to
    `runScan`. CLI flag wins when both are set.
  - `context/cli-reference.md` — regenerated; `--strict` appears under
    `sm scan` with its description.

  **Tests**:

  - `src/test/scan-frontmatter-strict.test.ts` — 12 tests covering
    fence-less files (no issue), fenced-but-incomplete frontmatter
    (warn issue, message names the missing field), `strict: true`
    promotion to error, valid frontmatter (no issue), type-mismatch
    on a base field (`name: 42` flagged), per-kind schemas
    (skill / command / hook / note each emit one issue with the
    matching `data.kind`), incremental preservation of the cached
    issue, incremental + strict promotion, and four CLI tests via
    the binary (`sm scan` exit 0 with warnings, `--strict` → exit 1,
    `scan.strict: true` config → exit 1, `--strict` overrides
    `scan.strict: false` config).
  - `src/test/scan-readers.test.ts` — `rollback.md` fixture extended to
    include `description` + `metadata` so the `--issue` filter test
    remains semantically correct (rollback.md is the issue-free node).
  - `src/test/scan-benchmark.test.ts` — 500-MD perf budget bumped from
    2000ms → 2500ms with a comment explaining the AJV per-file cost
    (~50-80μs × 500 = ~25-40ms over the prior ceiling). Warm-scan
    reality on a developer laptop stays around 1.0-1.2s; the new
    ceiling preserves headroom for slow CI without lowering the bar.

  Test count: 291 → 303 (+12).

- 7d4b143: Step 6 follow-up — unify the `--strict-config` flag (introduced in 6.2
  for the layered loader) with the existing `--strict` flag (introduced
  in 6.7 for frontmatter validation). One name, same intent across every
  verb that touches user input: "fail loudly on any validation
  warning".

  **CLI surface change** (renamed flag, same Option.Boolean):

  - `sm config list / get / show` — `--strict-config` → `--strict`.
  - `sm scan --strict` — already did frontmatter strict; now ALSO
    propagates strict to `loadConfig` so a bogus key in
    `settings.json` aborts the scan instead of being silently
    skipped.
  - `sm init --strict` — new. Propagates strict to BOTH the loader
    (so user-layer warnings during the first-scan path become
    fatal) and the first-scan's frontmatter validator. Affects only
    the path that actually loads config — `sm init --no-scan`
    skips the loader entirely so `--strict` has nothing to enforce
    there.

  The user-visible motivation: one flag to remember. Internally each
  verb still routes the boolean to whichever validations are reachable
  from its execution path; the conflated name reflects the conflated
  intent ("strict mode = no silent input fixups").

  **Runtime change**:

  - `src/cli/commands/config.ts` — `Option.Boolean('--strict-config',
false)` becomes `Option.Boolean('--strict', false)` in three
    commands (list / get / show). Local field renamed `strictConfig`
    → `strict`. Module JSDoc rewritten to point at the unified
    contract.
  - `src/cli/commands/scan.ts` — `loadConfig` call in `ScanCommand`
    now passes `strict: this.strict` and is wrapped in a try/catch
    emitting `sm scan: <message>` + exit 2 on throw, matching the
    config-verbs UX from the prior follow-up.
  - `src/cli/commands/init.ts` — new `Option.Boolean('--strict',
false)` on `InitCommand`; threaded through `runFirstScan` to
    both the `loadConfig` call (try/catch) and the `runScan` options.
  - `context/cli-reference.md` — regenerated; `sm init --strict` flag
    description now appears in the reference.

  **Spec / docs**:

  - `ROADMAP.md` — every `--strict-config` reference renamed to
    `--strict` (header status, §Configuration body, completeness
    marker, Step 14 `sm ui` flag list).
  - `ui/src/models/settings.ts` JSDoc — same rename.
  - `.changeset/step-6-2-config-loader.md`,
    `.changeset/step-6-3-config-verbs.md`,
    `.changeset/step-6-followup-version-strict-config.md` — all
    flag mentions in pending changeset bodies updated so the
    generated CHANGELOG entries match the shipping flag name.

  **Tests**:

  - `src/test/config-cli.test.ts` — `--strict-config` references in
    the existing `sm config — --strict UX` describe block renamed to
    `--strict`. Test count unchanged.
  - `src/test/scan-frontmatter-strict.test.ts` — new
    `--strict unification` describe block with two end-to-end CLI
    tests: `sm scan --strict` aborts on a bogus loader key (and
    the lenient `sm scan` still tolerates it), and `sm init --strict`
    surfaces the same bogus key during the first-scan path.

  Test count: 310 → 312 (+2).

  No `@skill-map/spec` change — the rename is CLI-only; the spec never
  defined the flag (only the feature semantics).

- 4669267: Step 6 follow-up — two UX polish fixes surfaced during the post-Step-6
  manual walkthrough.

  **`sm version` db-schema field**: was hardcoded `'—'` (carried over from
  Step 1a as a placeholder). The command now resolves the project DB path
  via the shared `resolveDbPath` helper, opens the DB read-only when it
  exists, and reads `PRAGMA user_version` (kept in sync by the migrations
  runner since Step 1a). Returns `'—'` for every failure mode (missing
  DB, unreadable file, malformed pragma) so an informational verb can
  never crash on a bad DB.

  - Pre-fix: `db-schema —` regardless of DB state.
  - Post-fix: `db-schema —` when no DB; `db-schema 2` after `sm init`
    (= MAX kernel migration version applied).

  **`sm config --strict` UX**: the loader's strict-mode `throw`
  was reaching Clipanion's default error handler, producing "Internal
  Error: ..." with a five-line stack trace and exit code 1. Now wrapped
  in a per-command `tryLoadConfig` helper that catches the throw, writes
  a one-line `sm config: <message>` to stderr, and returns exit code 2
  (operational error) per `spec/cli-contract.md` §Exit codes. Applied to
  `sm config list`, `sm config get`, and `sm config show` — every read
  verb that exposes `--strict`.

  - Pre-fix: stack trace + exit 1.
  - Post-fix: clean stderr line + exit 2.

  **Runtime change**:

  - `src/cli/commands/version.ts` — new `resolveDbSchemaVersion()` helper
    uses `node:sqlite` `DatabaseSync` in read-only mode + `PRAGMA
user_version`. Three failure paths all collapse to `'—'`. JSDoc
    expanded with the resolution contract.
  - `src/cli/commands/config.ts` — new `tryLoadConfig()` private wrapper
    catches `loadConfig` throws (only emitted under `--strict`).
    Three call sites in `ConfigListCommand`, `ConfigGetCommand`, and
    `ConfigShowCommand` updated to early-return with the wrapper's exit
    code.

  **Tests**:

  - `src/test/cli.test.ts` — two new tests under the existing `CLI binary`
    suite: `sm version` shows `db-schema —` when no DB exists in cwd
    (uses `EMPTY_DIR`), and reports the numeric `user_version` after
    `sm init --no-scan` provisions a DB in a tmpdir. Test asserts the
    number matches `\d+` and is `>= 1` rather than pinning a specific
    value, so it survives future kernel migrations.
  - `src/test/config-cli.test.ts` — new `sm config — --strict UX`
    describe block (5 tests): warning + exit 0 without the flag,
    clean-message + exit 2 with the flag (and explicit assertion that
    no `Internal Error` / stack-trace lines leak through), wrapper
    applied uniformly to `list / get / show`, and malformed-JSON path
    also routes through the clean-error path.

  Test count: 303 → 310 (+7).

- Updated dependencies [f41dbad]
- Updated dependencies [8a4667f]
  - @skill-map/spec@0.6.1

## 0.3.2

### Patch Changes

- dacd4d9: Move the auto-generated CLI reference from `docs/cli-reference.md` to
  `context/cli-reference.md`. Spec change is editorial: `cli-contract.md`
  references the file path in three spots (`--format md` description, the
  NORMATIVE introspection section, and the "Related" link list); all three
  updated to the new location. No schema or behavioural change.

  Reference impl: `scripts/build-cli-reference.mjs` writes to the new path,
  the `cli:reference` / `cli:check` npm scripts point there, and `sm help`
  output (which embeds the path in the `--format md` flag description) is
  regenerated. The `docs/` folder is gone.

- 551f6ec: Persist scan results to SQLite (scan_nodes/links/issues).

  `sm scan` now writes the ScanResult into `<cwd>/.skill-map/skill-map.db`
  with replace-all semantics across `scan_nodes`, `scan_links`, and
  `scan_issues`. The DB is auto-migrated on first run. Persistence is
  skipped under `--no-built-ins` so the kernel-empty-boot conformance
  probe cannot wipe an existing snapshot.

  Also fixes the bundled-CLI default migrations directory: the prior
  resolver assumed an unbundled `kernel/adapters/sqlite/` path layout,
  which silently missed `dist/migrations/` in the tsup-bundled CLI.

- 4c34af1: Step 4.10 — scenario coverage. Pure regression-test growth, no behavior
  changes, no new dependencies, no migrations, no spec edits. Backfills
  the scenarios surfaced by the manual end-to-end validation in
  `.tmp/sandbox/` that the existing test suite did not codify:

  - Hash discrimination: body-only edits leave `frontmatter_hash` and
    `bytes_frontmatter` byte-equal; frontmatter-only edits leave
    `body_hash` and `bytes_body` byte-equal. Locks in that the two
    SHA-256 streams are independent.
  - `external_refs_count` lifecycle across body edits: 0 → 2 → 2 (dedup) →
    1 (malformed URL silently dropped), and `scan_links.target_path`
    never carries an `http(s)` value at any step.
  - Replace-all ID rotation: synthetic `scan_links.id` /
    `scan_issues.id` are not promised to round-trip across re-scans;
    the natural keys (source/kind/target/normalized-trigger and
    ruleId/nodeIds) do. Documents the contract via assertion.
  - Deletion-driven dynamic broken-ref re-evaluation, full-scan path:
    companion to the existing incremental-path test. Confirms rules
    always re-run over the merged graph even on the all-fresh path.
  - Trigger-collision interaction with `--changed`: editing one
    advertiser keeps the collision firing (cached node still claims
    the trigger); deleting one advertiser clears it.
  - `sm scan --no-tokens` at the CLI handler level (the existing test
    exercised the orchestrator only): default → `tokens_total`
    populated; `--no-tokens` → null; default again → repopulated.
  - `sm scan --changed --no-built-ins` rejection: exit 2 with an
    explanatory stderr, no DB I/O.

  Test count delta: 133 → 143.

- 4c34af1: Step 4.11 — three layers of defense against accidental DB wipes when
  `sm scan` receives invalid or empty inputs:

  - `runScan` validates every root path exists as a directory before
    walking, throwing on the first failure (was: silently yielded zero
    files via the claude adapter swallowing `ENOENT` in `readdir`).
  - `sm scan` surfaces the validation error with exit code 2 and a clear
    stderr message naming the bad path.
  - `sm scan` refuses to overwrite a populated DB with a zero-result scan
    unless `--allow-empty` is passed. Prevents the typo-trap reported in
    the e2e validation: `sm scan -- --dry-run` (where clipanion's `--`
    made `--dry-run` a positional root that did not exist) silently
    cleared the user's data. The new flag is opt-in by design — the
    natural case of "empty repo on first scan" is preserved (DB starts
    empty, scan returns 0 rows, persist proceeds without prompting).

  Test count delta: 143 → 151.

- 551f6ec: Compute per-node token counts via `js-tiktoken`.

  `runScan` now populates `node.tokens` (frontmatter / body / total) using
  the `cl100k_base` BPE — the modern OpenAI tokenizer used by
  GPT-4 / GPT-3.5-turbo. The encoder is constructed once per scan and
  reused across nodes (the BPE table is heavyweight to load). Tokens are
  computed against the raw frontmatter bytes (not the parsed YAML
  object) so the count stays reproducible from on-disk content.

  The new `sm scan --no-tokens` flag opts out of tokenization; `node.tokens`
  is left undefined, which is spec-valid because the field is optional in
  `spec/schemas/node.schema.json`. Persistence already handles the absence
  (maps to NULL across `tokens_frontmatter` / `tokens_body` / `tokens_total`).

- 551f6ec: Add `external-url-counter` detector and orchestrator-level segregation for
  external pseudo-links.

  The new detector scans node bodies for `http(s)://` URLs, normalizes them
  (lowercase host, drop fragment, preserve scheme / port / path / query),
  dedupes per node, and emits one `references` pseudo-link per distinct URL
  at `low` confidence. URL parsing uses Node's built-in WHATWG `URL` — no
  new dependency.

  `runScan` now partitions emitted links into internal (graph) and external
  (URL pseudo-link) sets by checking `target.startsWith('http://')` or
  `'https://'`. Internal links flow through the rules layer, populate
  `linksOutCount` / `linksInCount`, and land in `result.links` and
  `scan_links` as before. External pseudo-links are counted into
  `node.externalRefsCount` and then dropped — they never reach rules,
  never appear in `result.links`, and never persist to `scan_links`. This
  keeps the spec's `link.kind` enum locked and `scan_links` semantically
  clean (graph relations only) while giving the inspector a cheap "external
  references" badge.

  This is the drop-in proof from Step 2: the kernel boots, detectors plug
  in, and a new built-in extension lands without spec or migration changes.

- 551f6ec: Add `sm scan -n` / `--dry-run` (in-memory, no DB writes) and `sm scan
--changed` (incremental scan against the persisted prior snapshot).

  `-n` / `--dry-run` runs the full pipeline in memory and skips every DB
  operation (no auto-migration, no persistence). The human-mode summary
  now ends with `Would persist N nodes / M links / K issues to <path>
(dry-run).` so the operator sees what would land. `--json` output is
  unchanged.

  `--changed` opens the project DB read-side, loads the prior snapshot via
  the new `loadScanResult` helper, walks the filesystem, and reuses
  unchanged nodes (matched by `path` + `bodyHash` + `frontmatterHash`).
  Only new / modified files run through the detector pipeline; rules
  always re-run over the merged graph (issue state can change for an
  unchanged node when a sibling moves). Persistence semantics are
  unchanged — replace-all over the merged ScanResult — so the on-disk
  shape stays canonical regardless of how the result was assembled.

  Combination rules:

  - `--changed --no-built-ins` is rejected with exit code 2 — a
    zero-filled pipeline has nothing to merge against.
  - `--changed -n` is supported: load the prior, compute the merged
    result, emit it, do NOT persist. Useful for "what would change?"
    inspection.
  - `--changed` against an empty / missing DB degrades to a full scan and
    prints `--changed: no prior snapshot found; running full scan.` to
    stderr. Exit code unaffected.

  Internals: `runScan` gains an optional `priorSnapshot` field on
  `RunScanOptions`. The orchestrator emits `scan.progress` events with a
  new `cached: boolean` field so future UIs can show the
  reused-vs-reprocessed delta. External pseudo-links are never persisted,
  so for cached nodes the prior `externalRefsCount` is preserved as-is;
  new / modified nodes recompute it from a fresh detector pass. The
  `loadScanResult` helper documents the external-pseudo-link omission
  explicitly — it returns zero pseudo-links by definition, but the
  per-node count survives in the loaded node row.

- 551f6ec: Promote `sm list`, `sm show`, `sm check` from stubs to real
  implementations backed by the persisted `scan_*` snapshot.

  `sm list [--kind <k>] [--issue] [--sort-by <field>] [--limit N] [--json]`
  emits a tabular view (PATH / KIND / OUT / IN / EXT / ISSUES / BYTES) of
  every node in `scan_nodes`. `--kind` and `--issue` filter rows; the
  issue filter uses a SQL `EXISTS` over `scan_issues` so the work stays
  in the DB. `--sort-by` is whitelisted (`path`, `kind`, `bytes_total`,
  `links_out_count`, `links_in_count`, `external_refs_count`) — anything
  else exits 2 with a clear stderr message. Numeric columns sort
  descending by default so `--sort-by bytes_total --limit N` returns the
  heaviest nodes; textual columns sort ascending. `--json` emits a flat
  array conforming to `node.schema.json`.

  `sm show <node.path> [--json]` prints the per-node detail view: header
  with kind / adapter, optional title / description / stability /
  version / author lines, the bytes (and tokens, when present) triple
  split, the parsed frontmatter, links out, links in, and current
  issues. `--json` emits `{ node, linksOut, linksIn, issues, findings,
summary }`; `findings` is reserved as `[]` and `summary` as `null`
  until Step 10 (`state_findings`) and Step 11 (`state_summaries`) ship.
  A missing path exits 5 with `Node not found: <path>` on stderr.

  `sm check [--json]` reads every row from `scan_issues`, prints them
  grouped by severity (errors first, then warns, then infos) as
  `[<severity>] <ruleId>: <message> — <node-paths>`, and exits 1 if any
  issue carries severity `error`, otherwise 0. Equivalent to
  `sm scan --json | jq '.issues'` but without the walk-and-detect cost.
  `--json` emits an `Issue[]`.

  All three verbs honor the `-g/--global` and `--db <path>` global flags,
  and exit 5 with `DB not found at <path>; run \`sm scan\` first.` when
  the snapshot has not been persisted yet.

  Internals: extracted the `resolveDbPath` and DB-existence guard from
  `sm db` into a shared `cli/util/db-path.ts` so the read-side commands
  and the lifecycle commands stay byte-aligned on path resolution.
  Promoted the row→Node / row→Link / row→Issue mappers in
  `scan-load.ts` from private helpers to module exports so the readers
  reuse the exact mapping the incremental loader uses, keeping the
  read-side aligned with the spec schemas.

- 551f6ec: Add Step 4.6 acceptance coverage: a self-scan test and a 500-MD
  performance benchmark.

  `src/test/self-scan.test.ts` runs `runScan` directly against the
  project repo (no persistence — never writes `.skill-map/skill-map.db`)
  with the full built-in pipeline and asserts: `schemaVersion === 1`;
  every node, link, and issue conforms to its authoritative spec
  schema (mirrors the `validate-all` audit's per-element strategy);
  nodes count > 0; the expected node kinds appear (relaxed to allow
  `command` and `hook` as missing today since neither
  `.claude/commands/` nor `.claude/hooks/` exists in the working tree
  — the tolerated-missing set auto-tightens the moment either grows
  a real file); no `error`-severity issues survive; tokens are
  populated for ≥ 1 node (Step 4.2 smoke test); `externalRefsCount > 0`
  for ≥ 1 node (Step 4.3 smoke test). Failures print actionable detail
  (missing kinds present, full per-issue dump) so a regression is
  diagnosable without re-running with extra logging.

  `src/test/scan-benchmark.test.ts` materialises 500 synthetic
  markdown files under `<repo>/.tmp/scan-bench-<random>/` (gitignored,
  project-local per AGENTS.md) — 100 each of agents, commands, hooks,
  skills (with `SKILL.md` per-skill subdir), and notes — each carrying
  a slash invocation, an `@`-directive, and an http URL so every
  detector fires. Ten agents share the same `name` so
  `trigger-collision` has work to do; some commands cross-reference
  each other through `metadata.related[]`. Asserts the full scan
  (tokenize + 4 detectors + 3 rules) completes within a 2000 ms
  budget (measured ~930 ms locally), `nodesCount === 500`, and
  `linksCount > 0`. Always prints a `[bench] 500 nodes / N links / M
issues in Tms` line to stderr so a CI failure surfaces the actual
  measurement, not a bare assertion. Comment above the threshold
  documents the escape hatch (profile cl100k_base cold-start before
  bumping; never disable).

  Adds `.tmp` to the `claude` adapter's `DEFAULT_IGNORE` set so the
  walker never traverses transient AI/test artifacts. Without this,
  the benchmark's fixture would appear in the self-scan and races
  between the two tests would flake the suite. The convention is
  already enforced everywhere else (gitignore, AGENTS.md), so the
  adapter now matches.

  Both tests run inside the standard `npm test` / `npm run test:ci`
  flow; no separate `bench` script is needed (runtime delta well under
  a second).

- 551f6ec: Reconcile the runtime `ScanResult` shape with `spec/schemas/scan-result.schema.json`.

  The runtime has been silently violating the spec since Step 0c. The
  spec is the source of truth and has been correct all along; this change
  is a one-way fix — `src/` catches up to `spec/`. No spec edit, no
  spec changeset.

  What changed at the runtime boundary:

  - `scannedAt` is now `number` (Unix milliseconds, integer ≥ 0). It used
    to be an ISO-8601 `string` that the persistence layer parsed back to
    an int via `Date.parse()`; both conversions are gone. The DB column
    has always been `INTEGER` — only the in-memory shape moved.
  - `scope` is now emitted: `'project' | 'global'`. Defaults to
    `'project'`; overridable via the new `RunScanOptions.scope?` field.
    The CLI surface (`sm scan`) hardcodes `'project'` for now — the
    `--global` flag wiring lands in Step 6 (config + onboarding).
  - `roots` is now hard-required to be non-empty. `runScan` throws
    `"runScan: roots must contain at least one path (spec requires
minItems: 1)"` when called with `roots: []`. The CLI already
    defaults `roots = ['.']` when no positional args are supplied, so
    the throw is a programming-error guard, not a user-visible regression.
  - `adapters: string[]` is now emitted (the ids of every adapter that
    participated in classification; `[]` when no adapter ran). Optional
    in spec; emitted unconditionally for self-describing output.
  - `scannedBy: { name, version, specVersion }` is now emitted.
    `name` is hardcoded `'skill-map'`; `version` is read once at module
    init from this package's `package.json` (static JSON import, same
    pattern as `cli/version.ts`); `specVersion` reuses the existing
    `installedSpecVersion()` helper from the plugin loader (reads
    `@skill-map/spec/package.json#version` off disk, with a safe fallback
    to `'unknown'`).
  - `stats.filesWalked: number` is now emitted. Counts every `IRawNode`
    yielded by the adapter walkers. With one adapter it equals
    `nodesCount`; with future multi-adapter scans on overlapping roots
    it will diverge.
  - `stats.filesSkipped: number` is now emitted. Spec definition: "Files
    walked but not classified by any adapter." Today every walked file
    IS classified (the `claude` adapter's `classify()` always returns a
    kind, falling back to `'note'`), so this is **always 0**. Wired now
    so the field shape is spec-conformant; meaningful once multiple
    adapters compete (Step 9+).

  Ripple changes:

  - `persistScanResult` no longer parses `scannedAt`; it validates
    `Number.isInteger(scannedAt) && scannedAt >= 0` and uses the value
    as-is. The error message updated to "expected non-negative integer
    ms"; the matching test case renamed from "rejects an unparseable
    scannedAt" to "rejects a non-integer scannedAt".
  - `loadScanResult` returns a synthetic envelope: `scannedAt` is
    derived from `max(scan_nodes.scanned_at)` (or `Date.now()` for
    empty snapshots); `scope` defaults to `'project'`; `roots: ['.']`
    to satisfy the spec's `minItems: 1` (NOT load-bearing — the
    orchestrator's incremental path only reads `nodes` / `links` /
    `issues` from a prior, never the meta); `adapters: []`;
    `stats.filesWalked` / `filesSkipped` / `durationMs` are zeroed.
    The header comment documents the omissions and points at the
    follow-up `state_scan_meta` table that would let the loader return
    real values.
  - `ScanCommand` (`sm scan`) explicitly passes `scope: 'project'` into
    `runScan`. No change to the CLI surface.

  Self-scan acceptance test (`src/test/self-scan.test.ts`) upgraded:
  the per-element node / link / issue validation is replaced with a
  single top-level `scan-result.schema.json` validation. This is the
  strong assertion for the reconciliation: the whole `ScanResult` now
  parses against the authoritative top-level schema.

  **Breaking change for runtime consumers**: anyone who was reading the
  buggy ISO `scannedAt` string off `result` (or from `JSON.stringify(result)`
  via `sm scan --json`) now sees an integer. The fix is one line:
  `new Date(result.scannedAt)`. The runtime contract was buggy — the
  spec said integer all along — but the buggy runtime was the de-facto
  contract for downstream tooling tracking the `0.3.x` line, so call
  this out explicitly. `schemaVersion` stays at 1 because the spec did
  not move.

- 551f6ec: Three fixes surfaced by the Step 4 end-to-end validation:

  - `sm scan` exit code now matches `sm check`: returns `1` only when issues
    at `error` severity exist (was: `1` on any issue, including warn / info).
    Honors `spec/cli-contract.md` §Exit codes. The exit code is now
    consistent across `--json` and the human format — previously the
    `--json` branch always returned `0`, which made an agent loop scripting
    `sm scan --json | jq` blind to error-severity issues.
  - `sm show` human output now reports `External refs: <N>` after the
    Weight section. The `--json` output already exposed
    `node.externalRefsCount`; the human format had a parity gap. Rendered
    unconditionally (including `External refs: 0`) for honest reporting.
  - `sm scan --changed` no longer drops `supersedes`-inversion links from
    cached nodes. The frontmatter detector emits `supersededBy` edges with
    `source = newer-node` and `target = older-node`; the prior cached-reuse
    filter incorrectly required `link.source === node.path`, which dropped
    these inverted edges (the source path is often not even a real node).
    Repro on the skill-map repo: `sm scan` then `sm scan --changed`
    previously yielded 470 → 468 links; both now yield 470 with the link
    sets set-equal. The fix introduces an `originatingNodeOf(link,
priorNodePaths)` helper in the orchestrator: for `kind === 'supersedes'`
    it falls back to `link.target` only when `link.source` is not a known
    prior node path, which handles BOTH the inverted case (originating =
    target) and the forward `metadata.supersedes[]` case (originating =
    source). Frontmatter is currently the only detector that emits
    cross-source links — a future detector adding another inversion case
    would escalate to a persisted `Link.detectedFromPath` field with a
    schema bump rather than extending this heuristic.

- 4c34af1: Two more fixes from the Step 4 end-to-end validation pass:

  - `trigger-collision` rule now also detects cases where two nodes advertise
    the same trigger via their `frontmatter.name` (e.g. two commands both
    named `deploy` in different files — the canonical example in the rule's
    own doc comment). Previously the rule only fired on case-mismatch
    invocations between different sources; commands competing for a
    namespace silently passed because the implementation iterated `links`
    alone and never looked at `nodes`. The rule now buckets two kinds of
    claims on each normalized trigger — advertisements (`'/' +
frontmatter.name` for `command` / `skill` / `agent` nodes) and
    invocations (raw `link.target`) — and emits one `error` issue per
    bucket with two or more distinct advertiser paths, two or more distinct
    invocation forms, or one advertiser plus a non-canonical invocation
    (e.g. an upper-cased trigger against a lower-cased advertiser name).
    Issue payload exposes
    `{ normalizedTrigger, invocationTargets, advertiserPaths }` so callers
    can render either side.
  - `sm scan` now runs `PRAGMA wal_checkpoint(TRUNCATE)` after persisting,
    so external read-only tools (sqlitebrowser, DBeaver, ad-hoc `sqlite3`
    clients) see fresh state without manual intervention. Previously the
    main `.db` could lag the `.db-wal` arbitrarily — for typical small-repo
    scans the WAL never crossed the 1000-page auto-checkpoint threshold,
    so the canonical snapshot stayed in the sidecar indefinitely. The
    checkpoint runs on the top-level Kysely handle (not inside the
    transaction); cost is `~ms` on small DBs and there are no concurrent
    readers to contend with.

- 9a89124: Step 5.1 — Persist scan-result metadata in a new `scan_meta` table so
  `loadScanResult` returns real values for `scope` / `roots` / `scannedAt` /
  `scannedBy` / `adapters` / `stats.filesWalked` / `stats.filesSkipped` /
  `stats.durationMs` instead of the synthetic envelope shipped at Step 4.7.

  **Spec change (additive, minor)**:

  - New `scan_meta` table in zone `scan_*`, single-row (CHECK `id = 1`).
    Columns: `scope`, `roots_json`, `scanned_at`, `scanned_by_name`,
    `scanned_by_version`, `scanned_by_spec_version`, `adapters_json`,
    `stats_files_walked`, `stats_files_skipped`, `stats_duration_ms`.
    `nodesCount` / `linksCount` / `issuesCount` are not stored — they are
    derived from `COUNT(*)` of the sibling tables.
  - Replaced atomically with the rest of `scan_*` on every `sm scan`.

  **Runtime change**:

  - New kernel migration `002_scan_meta.sql`.
  - `IScanMetaTable` added to `src/kernel/adapters/sqlite/schema.ts` and
    bound in `IDatabase`.
  - `persistScanResult` writes the row (and deletes prior rows in the same
    transaction).
  - `loadScanResult` reads from `scan_meta` when the row exists; degrades
    to the previous synthetic envelope when it does not (DB freshly
    migrated, never scanned, or pre-5.1 snapshot).
  - The Step 4.7 follow-up notes in `scan-load.ts` documenting the
    synthetic envelope are simplified to describe both branches.

  Test count: 151 → 154 (+3 covering meta round-trip, replace-all
  single-row invariant, and synthetic-fallback on empty DB).

- 9a89124: Step 5.10 — Two polish fixes for the `sm history` CLI surfaces, both
  surfaced during end-to-end walkthrough.

  **Fix 1 — `sm history` (human) table columns no longer collapse**:
  the previous `formatRow` padded every non-ID column to a flat 11
  chars. The STARTED column writes a 20-char ISO-8601 timestamp
  (`2026-04-26T14:00:00Z`), which exceeds the 11-char width — `padEnd`
  silently no-ops when content is longer than the target width, so the
  timestamp ran into the next ACTION cell with zero whitespace
  between (`...T14:00:00Zsummarize`). Replaced with a per-column
  `COL_WIDTHS` array sized so the longest expected content fits with
  ≥2 trailing spaces:

  | Column   | Width | Rationale                      |
  | -------- | ----- | ------------------------------ |
  | ID       | 28    | truncate to 26 + 2 padding     |
  | STARTED  | 22    | 20-char ISO + 2 padding        |
  | ACTION   | 26    | truncate to 24 + 2 padding     |
  | STATUS   | 12    | longest enum (`completed`) + 3 |
  | DURATION | 10    | longest format (`1m 42s`) + 3  |
  | TOKENS   | 14    | typical `12345/6789` + buffer  |
  | NODES    | 6     | small int + buffer             |

  **Fix 2 — `sm history stats --json` `elapsedMs` accuracy**: the field
  was captured at `stats` construction time, BEFORE
  `loadSchemaValidators()` (which loads + AJV-compiles 29 schemas from
  disk on every CLI invocation, ~100 ms cold). Result: the JSON
  reported `elapsedMs: 10` while stderr showed `done in 111ms` —
  divergence of ~10× that misled anyone trying to correlate the two
  numbers. Fixed by re-stamping `stats.elapsedMs = elapsed.ms()` AFTER
  the validator load but BEFORE serialise. Schema validation is
  order-independent for `elapsedMs` (any non-negative integer
  satisfies the schema), so re-stamping post-validate is safe. The
  ~10 ms remaining gap (serialise + write) is below user-perception
  threshold.

  The validator load itself is still uncached — addressing that is a
  deeper refactor (module-level cache or pre-compiled validators) and
  out of scope for this polish pass.

  Test: 1 new in `src/test/history-cli.test.ts` — "table columns do
  not collapse" — asserts the rendered output contains an ISO
  timestamp followed by ≥2 spaces before the action id. Catches the
  pre-5.10 regression directly.

  Test count: 206 → 207.

- 9a89124: Step 5.11 — `sm history` human renderer now shows `failure_reason`
  inline when present, so the human path stops hiding info that's
  already in `--json`.

  Before:

  ```
  h-008  ...  audit-bar  failed     200ms  50/0     1
  h-006  ...  audit-foo  cancelled  50ms   20/0     1
  ```

  After:

  ```
  h-008  ...  audit-bar  failed (runner-error)         200ms  50/0   1
  h-006  ...  audit-foo  cancelled (user-cancelled)    50ms   20/0   1
  ```

  `completed` rows are unchanged (no parens noise). The STATUS column
  widened from 12 to 30 chars to fit the longest enum
  (`cancelled (user-cancelled)` = 26).

  Test count: 207 → 208.

- 9a89124: Step 5.12 — `loadSchemaValidators()` now caches the compiled validator
  set at module level. Before: every call paid ~100 ms cold to read +
  AJV-compile 17 schemas (plus 8 supporting `$ref` targets). After: the
  first call costs the same; every subsequent call in the same process
  returns the same instance for free.

  For a one-shot CLI like `sm history stats --json`, this is a no-op
  (only one call per process). The win shows up once a future verb
  validates at multiple boundaries — likely candidates: `sm doctor`,
  `sm record`, plugin manifest re-checks, the audit pipeline. Lays the
  groundwork without forcing those callers to thread a cached
  validators bundle through their call stacks.

  Test-only escape hatch `_resetSchemaValidatorsCacheForTests()`
  exported so tests can re-trigger the cold load deterministically. The
  public `loadSchemaValidators` signature is unchanged.

  Test count: 208 → 211 (+3 in `kernel/adapters/schema-validators.test.ts`).

- 9a89124: Step 5.13 — `frontmatter_hash` is now computed over a CANONICAL YAML
  form of the parsed frontmatter, not over the raw text bytes.

  **Why**: a YAML formatter pass on the user's editor (Prettier YAML,
  IDE autoformat, manual indent fix, key reordering) used to silently
  break the medium-confidence rename heuristic — two files with
  identical logical frontmatter but different YAML formatting got
  different `frontmatter_hash` values, so the heuristic saw them as
  "different frontmatter" and demoted what should have been a
  medium-confidence rename to an `orphan` issue. Surfaced during the
  end-to-end walkthrough (the `cat <<EOF` output didn't byte-match the
  file written via the Write tool, even though both blocks looked
  identical to a human).

  **How**: new `canonicalFrontmatter(parsed, raw)` helper in
  `kernel/orchestrator.ts`. Re-emits the parsed frontmatter via
  `yaml.dump` with deterministic options:

  - `sortKeys: true` — keys in lexicographic order regardless of
    declaration order.
  - `lineWidth: -1` — no auto-wrap.
  - `noRefs: true` — no `*alias` shorthand.
  - `noCompatMode: true` — modern YAML 1.2 output.

  Comments are lost (they're not semantic). Hash is then `sha256` of
  that canonical string instead of `raw.frontmatterRaw`.

  **Fallback**: when the adapter's parse failed silently (yields
  `parsed = {}` for non-empty `raw`), we fall back to hashing the raw
  text so a malformed-YAML file still hashes deterministically against
  itself across rescans. Without this, every malformed file would
  collapse to the same `sha256(yaml.dump({}))` and erroneously match
  each other for rename.

  **Migration impact**: existing DBs have `frontmatter_hash` values
  computed over raw text. After this lands, the next `sm scan` will
  see every file as "frontmatter changed" (cache miss in `--changed`
  mode; otherwise cosmetic). No data loss. `state_*` rows aren't
  affected — they key on `node.path`, not on `frontmatter_hash`. Once
  the new hashes settle, behaviour stabilises.

  Tests: 2 new in `src/test/scan-mutation.test.ts`:

  - "two files with the same logical frontmatter but DIFFERENT YAML
    formatting hash to the same fm_hash" — exercises key reordering,
    quote-style change, trailing-newline change, all in one fixture
    pair.
  - "logically-different frontmatters still produce different
    fm_hashes" — guard against canonicalization collapsing distinct
    values.

  Test count: 211 → 213.

- 9a89124: Step 5.2 — Storage helpers for the history readers (`sm history`,
  `sm history stats`) and for the rename heuristic / `sm orphans` verbs
  landing in 5.3 — 5.6.

  New module `src/kernel/adapters/sqlite/history.ts` with four entry
  points, all accepting either a `Kysely<IDatabase>` or a
  `Transaction<IDatabase>` so callers can compose them inside a larger
  tx (the rename heuristic does this):

  - `insertExecution(db, exec)` — write a `state_executions` row.
    Surfaces today through tests; consumed by `sm record` / `sm job run`
    at Step 9.
  - `listExecutions(db, filter)` — read with optional filters: `nodePath`
    (JSON-array containment via `json_each`, mirroring the
    `sm list --issue` subquery in `cli/commands/list.ts`), `actionId`
    (exact match on `extension_id`), `statuses[]`, `sinceMs` /
    `untilMs` (since inclusive, until exclusive), `limit`. Sorted
    most-recent first.
  - `aggregateHistoryStats(db, range, period, topN)` — totals,
    per-action token rollup (sorted desc by `tokensIn + tokensOut`),
    per-period bucketing via `bucketStartMs` (UTC `day` / `week` /
    `month`), top-N nodes by frequency (tie-break `lastExecutedAt`
    desc), and error rates: global, per-action, and per-failure-reason.
    The per-failure-reason map ALWAYS includes all six enum values
    (zero-filled), so dashboards see a predictable shape.
  - `migrateNodeFks(trx, fromPath, toPath)` — repoint every `state_*`
    reference to a node from `fromPath` to `toPath`. Handles the three
    FK shapes the kernel uses today: simple column on `state_jobs`,
    JSON-array contents on `state_executions.node_ids_json`
    (pull-modify-update), and composite PKs on `state_summaries`,
    `state_enrichments`, `state_plugin_kvs` (delete + insert at the new
    PK). Composite-PK collisions are resolved conservatively: the
    destination row is preserved (it represents the live node's
    history), the migrating row is dropped, and the drop is reported
    back via `IMigrateNodeFksReport.collisions[]` so callers can surface
    a diagnostic. The empty-string sentinel for plugin-global keys is
    intentionally skipped.

  Exports `bucketStartMs(dateMs, period)` for direct use by the
  `sm history stats` CLI (5.4) and to keep bucketing testable in
  isolation.

  New domain types in `src/kernel/types.ts`: `ExecutionRecord`,
  `ExecutionKind`, `ExecutionStatus`, `ExecutionFailureReason`,
  `ExecutionRunner`, plus `HistoryStats` and its sub-shapes —
  mirroring `spec/schemas/execution-record.schema.json` and
  `spec/schemas/history-stats.schema.json` respectively.

  Test count: 154 → 169 (+15 covering insert/list filter axes,
  bucket boundaries for day/week/month, totals + per-action +
  per-period + top-nodes + error-rates aggregation including the
  all-six-keys failure-reason invariant, FK migration across the
  three shapes, sentinel preservation, and conservative collision
  resolution).

- 9a89124: Step 5.3 — `sm history` CLI lands. The stub is removed from
  `stubs.ts`; the real implementation lives at `src/cli/commands/history.ts`
  and is registered in `cli/entry.ts`.

  Surface (matches `spec/cli-contract.md` §History):

  - `-n <path>` — restrict to executions whose `nodeIds[]` contains `<path>`
    (JSON-array containment via `json_each`, mirroring the
    `sm list --issue` subquery).
  - `--action <id>` — exact match on `extension_id`.
  - `--status <s,...>` — comma-separated subset of
    `completed,failed,cancelled`. Unknown values rejected with exit 2.
  - `--since <ISO>` / `--until <ISO>` — Unix-ms boundaries on
    `started_at`. Since inclusive, until exclusive (per the schema's
    `range` semantics). Unparseable input → exit 2.
  - `--limit N` — positive integer cap. Non-positive → exit 2.
  - `--json` — emits an array conforming to
    `spec/schemas/execution-record.schema.json` (no top-level
    `elapsedMs` for array outputs, per `cli-contract.md` §Elapsed time).
  - `--quiet` — suppresses the `done in <…>` stderr line.

  Exit codes follow `cli-contract.md`: 0 ok (including empty result),
  2 bad flag, 5 DB missing.

  New shared util `src/cli/util/elapsed.ts` (`startElapsed` /
  `formatElapsed` / `emitDoneStderr`) carries the §Elapsed time
  formatting (`34ms` / `2.4s` / `1m 42s`). Used by `sm history` /
  `sm history stats` only — retrofitting `list` / `show` / `check` /
  `scan` is a known drift kept out of Step 5 scope.

  Tests: 9 new under `src/test/history-cli.test.ts` covering the missing
  DB, empty DB, --json schema validation, every filter axis (-n, --status,
  window boundaries), and bad-input exit codes.

  `context/cli-reference.md` regenerated.

  Test count: 169 → 184.

- 9a89124: Step 5.4 — `sm history stats` CLI lands alongside `sm history` in
  `src/cli/commands/history.ts`. The stub is removed from `stubs.ts`
  and the real class registered in `cli/entry.ts`.

  Surface (matches `spec/cli-contract.md` §History):

  - `--since <ISO>` / `--until <ISO>` — window boundaries. Since defaults
    to `null` (all-time); until defaults to `now()`. Both validated.
  - `--period day|week|month` — bucket granularity. Default `month`. Bucket
    start computed in UTC (`bucketStartMs` from 5.2): day = 00:00 of the
    date, week = Monday 00:00 UTC, month = day-1 00:00 UTC.
  - `--top N` — caps the `topNodes` array. Default 10. Non-positive → exit 2.
  - `--json` — emits a `HistoryStats` object conforming to
    `spec/schemas/history-stats.schema.json`. The output is **self-validated
    before emit** via `loadSchemaValidators().validate('history-stats', …)` —
    same pattern as `src/test/self-scan.test.ts` — so a runtime shape
    regression surfaces as exit 2 with a clear stderr message rather than
    drifting silently.
  - `--quiet` — suppresses the `done in <…>` stderr line.

  Top-level `elapsedMs` is included in the JSON object per the schema.
  Stderr always carries `done in <formatted>` unless `--quiet`.

  The per-failure-reason map ALWAYS contains all six enum values
  (`runner-error`, `report-invalid`, `timeout`, `abandoned`,
  `job-file-missing`, `user-cancelled`), zero-filled when a reason has
  no occurrences — predictable shape for dashboards.

  Tests: 6 new in `src/test/history-cli.test.ts` covering schema
  self-validation, day-period bucketing, invalid `--period`, `--top`
  cap, `range.since` shape (`null` vs ISO string), and the empty-DB
  all-zero totals path.

  `context/cli-reference.md` regenerated.

- 9a89124: Step 5.5 — Auto-rename heuristic lands at scan time per
  `spec/db-schema.md` §Rename detection.

  **Orchestrator changes**:

  - New post-rule phase in `runScan` that classifies the diff
    `priorPaths \ currentPaths` × `currentPaths \ priorPaths`:
    - **High** (body hash match): emits a `RenameOp` with confidence
      `high`. NO issue — silent migration per spec.
    - **Medium** (frontmatter hash, exactly one remaining candidate
      after high pass): emits `RenameOp` + `auto-rename-medium` issue
      (severity `warn`) with `data: { from, to, confidence: 'medium' }`.
    - **Ambiguous** (frontmatter hash, more than one remaining
      candidate): emits `auto-rename-ambiguous` issue with
      `data: { to, candidates: [<old1>, <old2>, …] }` and `nodeIds: [to]`.
      NO migration; the candidates fall through to the orphan pass.
    - **Orphan**: every unclaimed deletion yields an `orphan` issue
      (severity `info`) with `data: { path: <deletedPath> }`.
  - 1-to-1 matching is enforced (a `newPath` claimed by an earlier
    stage cannot be reused). Iteration is lex-asc on both sides for
    deterministic output across runs and conformance fixtures.
  - Body-hash match wins over frontmatter-hash match (high pass runs
    before medium pass and consumes its `newPath`).

  **API surface**:

  - `runScan(kernel, opts)` continues to return `ScanResult` only —
    preserved for backward compatibility with tests and external
    consumers.
  - New `runScanWithRenames(kernel, opts)` returns
    `{ result: ScanResult; renameOps: RenameOp[] }` — the variant `sm scan`
    consumes so it can hand `renameOps` to `persistScanResult` for
    in-tx FK migration.
  - New `detectRenamesAndOrphans(prior, currentNodes, issues)` exported
    for direct testing and reuse by future surfaces (e.g. `sm orphans`
    reconciliation paths).
  - New `RenameOp` type exported from `kernel/index.ts`:
    `{ from: string; to: string; confidence: 'high' | 'medium' }`.

  **Persistence changes**:

  - `persistScanResult(db, result, renameOps?)` accepts an optional
    ops list. The migration runs **first inside the tx** (via the
    Step 5.2 `migrateNodeFks` helper), then the scan zone replace-all.
    A failure during FK migration rolls back the entire scan persist —
    either all renames land or none do (per spec). Returns
    `{ renames: IMigrateNodeFksReport[] }` so callers can surface
    collision diagnostics.

  **`sm scan`**:

  - Switches to `runScanWithRenames` and forwards the ops to
    `persistScanResult`. No new flags. CLI exit code semantics are
    unchanged: `auto-rename-medium` and `auto-rename-ambiguous` are
    `warn`-severity and `orphan` is `info`-severity, so they do NOT
    trip exit code 1 (which still requires at least one `error`).

  Test count: 184 → 190 (+6: high happy path, medium issue + FK
  migration, ambiguous N:1 leaving FKs intact, orphan info-issue,
  body-wins-frontmatter precedence, deterministic 1-to-1 lex matching).

  `context/cli-reference.md` unchanged — `sm scan` flag surface stays
  identical.

- 9a89124: Step 5.6 — `sm orphans` verbs land. The three stubs are removed from
  `stubs.ts`; the real implementations live at
  `src/cli/commands/orphans.ts` and are registered as `ORPHANS_COMMANDS`
  in `cli/entry.ts`.

  **`sm orphans [--kind orphan|medium|ambiguous] [--json]`**:
  Lists every active issue with `ruleId IN (orphan, auto-rename-medium,
auto-rename-ambiguous)`. `--json` emits an array of `Issue` objects
  (per `spec/schemas/issue.schema.json`); the human path renders a
  one-line summary per issue grouped by ruleId.

  **`sm orphans reconcile <orphan.path> --to <new.path>`**:
  Forward direction. Validates `<new.path>` exists in `scan_nodes`
  (exit 5 otherwise) and that an active `orphan` issue with
  `data.path === <orphan.path>` exists (exit 5 otherwise). Migrates
  state\_\* FKs via `migrateNodeFks` (5.2) inside a single transaction
  along with the `DELETE FROM scan_issues` of the resolved orphan
  issue. Surfaces composite-PK collision diagnostics on stderr when
  they occur.

  **`sm orphans undo-rename <new.path> [--from <old.path>] [--force]`**:
  Reverse direction. Resolves the active `auto-rename-medium` or
  `auto-rename-ambiguous` issue on `<new.path>`:

  - For `auto-rename-medium`, reads `data.from` (omit `--from`).
    Passing a `--from` that does not match `data.from` → exit 2.
  - For `auto-rename-ambiguous`, requires `--from <old.path>` to pick
    one of `data.candidates` (exit 5 if missing or not in candidates).

  Migrates state\_\* FKs back to the prior path (the reverse of what the
  heuristic did), deletes the auto-rename issue, and emits a new
  `orphan` issue on the prior path (per spec: "the previous path
  becomes an `orphan`"). Destructive — prompts via `readline` unless
  `--force`.

  **Refactor**: the `confirm()` helper used by `sm db restore` /
  `sm db reset --state` / `sm db reset --hard` is extracted to
  `src/cli/util/confirm.ts` so `sm orphans undo-rename` reuses the
  exact same prompt shape (`<question> [y/N] `, stderr-emitting
  readline interface). `db.ts` now imports it; behaviour identical.

  Test count: 190 → 201 (+11 covering: list happy path, --kind filter,
  --kind invalid, reconcile happy path / target-missing / no-issue,
  undo-rename medium force, --from mismatch, no-issue exit 5,
  ambiguous --from required + outside-candidates + valid).

  `context/cli-reference.md` regenerated.

- 9a89124: Step 5.7 — Conformance coverage for the rename heuristic.

  **Spec change (additive, minor)**:

  - `spec/schemas/conformance-case.schema.json` gains
    `setup.priorScans: Array<{ fixture, flags? }>` — an ordered list of
    staging scans the runner executes BEFORE the main `invoke`. Each
    step replaces every non-`.skill-map/` directory in the scope with
    the named fixture and runs `sm scan` (with optional flags). The DB
    persists across steps because `.skill-map/` is preserved between
    swaps. After the last step, the runner copies the top-level
    `fixture` and runs the case's `invoke`.

    Required to express scenarios that need a prior snapshot (rename
    heuristic, future incremental cases). The schema is purely
    additive — every existing case keeps passing without modification.

  - Two new conformance cases under `spec/conformance/cases/`:

    - **`rename-high`** — moving a single file with identical body
      triggers a high-confidence auto-rename. Asserts:
      `stats.nodesCount === 1`, `stats.issuesCount === 0`,
      `nodes[0].path === skills/bar.md`. Verifies the spec invariant
      that high-confidence renames emit NO issue.
    - **`orphan-detection`** — deleting a file with no replacement
      emits exactly one `orphan` issue (severity `info`). Asserts the
      `ruleId` and `severity` directly.

  - Four new fixture directories under `spec/conformance/fixtures/`:
    `rename-high-before/`, `rename-high-after/`,
    `orphan-before/`, `orphan-after/`.

  - `spec/conformance/coverage.md`: row I (Rename heuristic) flips
    from `🔴 missing` to `🟢 covered`. Notes the medium / ambiguous
    branches stay covered by `src/test/rename-heuristic.test.ts` for
    now (assertion vocabulary in the schema is not rich enough to
    express "the issues array contains an item with ruleId X and
    data.confidence === 'medium'" — when the conformance schema gains
    array-filter assertions, those branches can land here too).

  **Runtime change**:

  - `src/conformance/index.ts` runner: implements `setup.priorScans`.
    Helper `replaceFixture(scope, specRoot, fixture)` clears every
    top-level entry in the scope except `.skill-map/`, then copies the
    named fixture on top. Used by both staging steps and the main
    `fixture` phase.
  - `src/test/conformance.test.ts`: includes the two new cases in the
    Step-0b subset. Total conformance cases passing in CI: 1 → 3.

  **`spec/index.json`** regenerated (50 → 57 files). `npm run spec:check`
  green.

  Test count: 201 → 203 (+2 conformance cases). The Step 5 totals close
  at: 151 → 203 (+52 across 7 sub-steps).

- 9a89124: Step 5.8 — fire the rename heuristic on every `sm scan`, not just
  `sm scan --changed`. Closes the follow-up flagged at the close of
  Step 5.

  Before this change, `priorSnapshot` in `RunScanOptions` carried two
  coupled responsibilities:

  1. Source for the rename heuristic (5.5).
  2. Source for cache reuse (5.4 / Step 4.4 — skip detectors on
     hash-matching nodes).

  Loading prior was gated on `--changed` in `scan.ts`, so a plain
  `sm scan` after reorganising files emitted no rename / orphan issues
  and migrated no `state_*` FKs. The user-visible expectation — and a
  defensible reading of the spec ("`sm scan` is the only surface that
  triggers automatic rename detection") — is that **every** `sm scan`
  fires the heuristic.

  The fix decouples the two responsibilities:

  - New `RunScanOptions.enableCache?: boolean` (default `false`).
    Controls cache reuse only. The orchestrator's "cached" check is now
    `enableCache && prior !== null && hashes match`.
  - `priorSnapshot` reverts to a single meaning: "data from the prior
    scan". Always passed when a prior exists, regardless of `--changed`.
  - `scan.ts` always loads the prior when the DB exists and the user
    isn't running `--no-built-ins`. The `--changed`-only stderr warning
    ("no prior snapshot found") survives — without `--changed` the
    empty-prior path is silent (it's the normal first-scan behaviour).
  - `scan.ts` sets `enableCache: this.changed` when `priorSnapshot` is
    passed, so `--changed` keeps its perf win and the contract for
    cache-reliant tests doesn't break.

  Behaviour matrix after the fix:

  | Invocation                      | Prior loaded? | Cache reuse? | Rename heuristic? |
  | ------------------------------- | ------------- | ------------ | ----------------- |
  | `sm scan` (DB exists)           | yes           | no           | yes               |
  | `sm scan` (DB empty)            | no            | n/a          | no                |
  | `sm scan --changed` (DB exists) | yes           | yes          | yes               |
  | `sm scan --changed` (DB empty)  | no — warns    | n/a          | no                |
  | `sm scan --no-built-ins`        | no            | n/a          | no (no walk)      |

  `--changed --no-built-ins` rejection (exit 2) stays as-is — the
  combination is still incoherent.

  Tests:

  - `scan-incremental.test.ts` — pre-existing tests assert on cache
    events; they now pass `enableCache: true` explicitly to keep that
    contract under test.
  - `cli.test.ts` — new e2e: write file → `sm scan` → delete file →
    `sm scan --json` (no --changed) → assert one `orphan` issue in the
    result. Closes the gap at the binary level.

  Test count: 203 → 204.

  Internal API note: `runScanWithRenames` continues to return
  `{ result, renameOps }`. Both the heuristic and the cache use the
  same prior data, so the wrapper's signature didn't change.

- 9a89124: Step 5.9 — Orphan issues now persist across scans as long as `state_*`
  has stranded references. Closes a gap surfaced during end-to-end
  walkthrough.

  **The bug**: `persistScanResult` does `DELETE FROM scan_issues` before
  inserting the new issues. The per-scan rename heuristic
  (`detectRenamesAndOrphans`) only emits `orphan` for paths in `prior \
current` of the _immediately preceding_ scan. So after a deletion-scan
  emitted an `orphan` issue, the very next scan (with no further
  mutations) wiped that issue and emitted nothing — leaving the stranded
  `state_*` rows invisible. Worst consequence:
  `sm orphans reconcile <orphan.path>` requires an active orphan issue,
  so once the issue silently expired, the user had no way to reconcile
  the stranded references.

  This contradicts `spec/db-schema.md` §Rename detection:

  > "the kernel emits an issue (...) and keeps the `state_*` rows
  > referencing the dead path untouched **until the user runs
  > `sm orphans reconcile`** or accepts the orphan."

  The "until" language implies the issue stays surfaceable as long as
  the stranded refs remain.

  **The fix**: new `findStrandedStateOrphans(trx, livePaths)` helper in
  `src/kernel/adapters/sqlite/history.ts` sweeps every node reference
  across `state_jobs`, `state_executions` (json_each over the JSON
  array), `state_summaries`, `state_enrichments`, and `state_plugin_kvs`
  (skipping the empty-string sentinel for plugin-global keys). Returns
  the set of distinct `node_id` values not present in the live snapshot,
  deterministically lex-asc.

  `persistScanResult` calls the sweep AFTER applying `renameOps` and
  BEFORE the replace-all of `scan_issues`. For each stranded path not
  already covered by a per-scan orphan issue, it appends a new orphan
  issue to `result.issues`. Then the replace-all writes the augmented
  list. `result.stats.issuesCount` is updated to keep `sm scan --json`
  self-consistent.

  **Behaviour**:

  - High / medium renames migrate state\_\* → no stranded refs → no extra
    orphan issues. Unchanged.
  - Ambiguous → state stays on the old paths → next scan emits orphans
    for each previously-stranded path automatically.
  - Pure orphan (deleted, no rename match) → emits orphan in the same
    scan, persists across subsequent scans until the user reconciles
    via `sm orphans reconcile <path> --to <new.path>` or rewrites the
    state row manually.
  - Once `state_*` no longer references the dead path, the next scan
    emits no orphan for it. Self-healing.

  The sweep is deduplicated against per-scan emissions via
  `knownOrphanPaths`, so the same path never appears twice in
  `scan_issues` after a single scan.

  Tests: 2 new in `rename-heuristic.test.ts`:

  - "orphan issue persists across subsequent scans while state\_\*
    references the dead path" — 4 scans walking the full lifecycle
    (seed → delete → re-scan persistence → reconcile-via-state-edit).
  - "per-scan orphan and stranded sweep do not duplicate the same path"
    — same path emitted by both pathways, only 1 issue in result.

  Test count: 204 → 206.

- Updated dependencies [dacd4d9]
- Updated dependencies [9a89124]
- Updated dependencies [9a89124]
  - @skill-map/spec@0.6.0

## 0.3.1

### Patch Changes

- 18d758a: Editorial pass across spec/ and src/ docs: convert relative-path text references (e.g. `plugin-kv-api.md`, `schemas/node.schema.json`) to proper markdown links, so they resolve on GitHub and in renderers. No normative or behavioural changes — prose, schemas, and CLI contract are unchanged.
- b6c46f8: Pin all dependencies to exact versions in `src/package.json` (no `^` / `~` ranges). Matches the new repo-wide rule in `AGENTS.md`. No runtime behaviour change — all versions match what the lockfile already resolves to. Re-evaluate when `src/` flips to public (published libs usually prefer caret ranges so consumers can dedupe).
- 48c386b: First npm publish of `@skill-map/cli` — name registration. The package was previously private; flipping `private: false` plus adding `publishConfig.access: public` lets the next "Version Packages" merge publish to the npm registry under the `@skill-map` org alongside `@skill-map/spec`. Status remains preview / pre-1.0 (Steps 0a-3 done; full scan lands at Step 4). Subsequent releases follow the standard changeset flow.
- Updated dependencies [18d758a]
  - @skill-map/spec@0.5.1

## 0.3.0

### Minor Changes

- 128a678: Step 1a — Storage + migrations.

  Lands `SqliteStorageAdapter` behind `StoragePort`. Uses a bespoke `NodeSqliteDialect` for Kysely (Kysely's official `SqliteDialect` ships `better-sqlite3` — native, forbidden by Decision #7; the kernel runtime is Node 24+ with zero native deps). The dialect reuses Kysely's pure-JS `SqliteAdapter` / `SqliteIntrospector` / `SqliteQueryCompiler` and plugs a minimal Driver over `node:sqlite`'s `DatabaseSync`. CamelCasePlugin bridges camelCase TypeScript field names to the spec-mandated snake_case SQL.

  The migrations runner (`src/kernel/adapters/sqlite/migrations.ts`) discovers `NNN_snake_case.sql` files, diffs them against the `config_schema_versions` ledger (scope = `kernel`, owner = `kernel`), and applies pending files inside per-file `BEGIN / COMMIT` transactions. The ledger insert and `PRAGMA user_version` update share the migration's transaction so partial success can't drift the state. Auto-backup fires before any apply — WAL checkpoint then file copy to `.skill-map/backups/skill-map-pre-migrate-v<N>.db`. `tsup.config.ts` gained an `onSuccess` hook that copies `src/migrations/` to `dist/migrations/`; `package.json#files` now includes `migrations/` so published artifacts ship the SQL.

  `src/migrations/001_initial.sql` provisions every kernel table from `spec/db-schema.md`: 3 `scan_*`, 5 `state_*`, 3 `config_*` with full CHECK constraints (enum guards on kind / stability / confidence / severity / job status / failure reason / runner / execution kind / execution status / schema version scope / boolean verified flag / boolean config_plugins.enabled), every named index declared in the spec, and the unique partial index on `state_jobs(action_id, node_id, content_hash) WHERE status IN ('queued','running')` that enforces the duplicate-job detection contract from `spec/job-lifecycle.md`.

  `sm db` command surface (per `spec/cli-contract.md` §Database):

  - `sm db backup [--out <path>]` — WAL checkpoint + file copy.
  - `sm db restore <path> [--yes]` — copies source over target and clears stale WAL sidecars; destructive, prompts by default.
  - `sm db reset [--state] [--hard] [--yes]` — default truncates `scan_*` (non-destructive, no prompt); `--state` also truncates `state_*`; `--hard` removes the DB file and its sidecars. Destructive modes prompt by default.
  - `sm db shell` — spawns the system `sqlite3` binary with inherited stdio; ENOENT produces a pointed error pointing at the install steps for macOS / Debian / Ubuntu and the `sm db dump` fallback.
  - `sm db dump [--tables ...]` — `sqlite3 -readonly path .dump` to stdout.
  - `sm db migrate [--dry-run|--status|--to <n>|--no-backup]` — default applies pending; `--status` prints applied vs pending; `--dry-run` previews without writing; `--to` caps the applied range; `--no-backup` skips the pre-apply copy.

  `--kernel-only` and `--plugin <id>` from the CLI contract are deferred to Step 1b when the plugin loader introduces plugin-authored migrations; they would be no-ops today.

  Acceptance test (`src/test/storage.test.ts`) covers the ROADMAP §Step 1a round-trip — fresh scope → migrate --dry-run → apply → write a row → backup → "corrupt" the row → restore → verify the original row came back — plus narrower checks around CamelCasePlugin field mapping, CHECK constraint enforcement at the DB layer, and the unique partial index behaviour (duplicate queued job rejected, same tuple allowed once the blocking job completes). 24 of 24 tests pass.

  Classification: minor per `spec/versioning.md` §Pre-1.0 (`0.Y.Z`). First real feature surface after the Step 0b bootstrap; `skill-map` bumps `0.2.0 → 0.3.0`.

- a0e6578: Step 1b — Registry + plugin loader.

  Wires AJV Draft 2020-12 validation against the schemas published by `@skill-map/spec` and ships the default `PluginLoader` implementation on top of it.

  **`src/kernel/adapters/schema-validators.ts`** compiles 17 reusable validators from the spec (11 top-level + 6 extension-kind). A single Ajv instance is used so `$ref` resolution works across `allOf` composition (every extension kind extends `extensions/base` via `allOf`). Supporting schemas (frontmatter, summaries) register first so targets resolve during compile. Eager compilation at load time means a spec corruption is a hard boot error, not a deferred surprise. `ajv-formats` is enabled for `uri` / `date` / `date-time`. A dedicated `validatePluginManifest()` targets `plugins-registry.schema.json#/$defs/PluginManifest` so callers don't hand-filter the combined `oneOf`.

  **`src/kernel/types/plugin.ts`** hand-writes the plugin-surface types (`IPluginManifest`, `TPluginStorage`, `ILoadedExtension`, `IDiscoveredPlugin`, `TPluginLoadStatus`). Per the updated DTO-gap note, this hand-curated mirror stays in place until Step 2's real adapter arrives as a third consumer that justifies a canonical typed-DTO export from `@skill-map/spec`.

  **`src/kernel/adapters/plugin-loader.ts`** implements the full load pass:

  1. Discover plugin directories under the configured search paths; each direct child containing a `plugin.json` is a plugin root.
  2. Parse + AJV-validate the manifest — any failure (JSON parse error, schema mismatch, malformed `specCompat` range) returns `status: 'invalid-manifest'`.
  3. `semver.satisfies(installedSpecVersion, manifest.specCompat)` with `includePrerelease: true` — mismatch returns `status: 'incompatible-spec'` with the manifest preserved for diagnostics.
  4. Dynamic-import every path in `manifest.extensions[]`, expecting a default export with a string `kind` field. File missing, import failure, missing/unknown kind, or default export failing its kind schema all return `status: 'load-error'` with a precise reason.

  Never throws — the kernel always keeps booting, regardless of how broken a plugin is.

  **CLI: `sm plugins list / show / doctor`** land in `src/cli/commands/plugins.ts`:

  - `list` tabulates discovered plugins with a status glyph and either their extension list (on success) or their failure reason.
  - `show <id>` dumps a single plugin's manifest + extensions + load status; exit 5 when not found.
  - `doctor` returns exit 0 when every plugin loads, exit 1 otherwise — script-friendly readiness check.

  All three support `-g / --global` (global scope only), `--plugin-dir <p>` (explicit override, handy for tests), and `--json` on list / show. The `module` field on loaded extensions is omitted from JSON output to avoid circular-reference serialization errors.

  **Side fix** surfaced while wiring AJV against the extension-kind schemas: the six kind schemas paired `additionalProperties: false` with `allOf: [{ $ref: base.schema.json }]`, a Draft 2020-12 composition footgun where each sub-schema applies its closed-content rule independently. The fix (shipped as a `@skill-map/spec` patch in the same commit train) switches kind schemas to `unevaluatedProperties: false` and removes closure from base; closed-content now survives the allOf composition.

  **Spec resolution**: `@skill-map/spec`'s `exports` field does not expose `package.json`, so `require.resolve('@skill-map/spec/package.json')` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Both `resolveSpecRoot()` in the validators and `installedSpecVersion()` in the loader now resolve `@skill-map/spec/index.json` (always exported) and walk one directory up. Zero spec-side changes needed.

  **Acceptance test** (`src/test/plugin-loader.test.ts`) codifies the ROADMAP criterion across 8 cases: empty search paths return `[]`; a green-path plugin with one detector extension loads and reports its extensions; both `invalid-manifest` sub-cases (missing required fields, unparseable JSON) surface; `incompatible-spec` preserves the manifest for diagnostics; both `load-error` sub-cases (missing extension file, default export failing its kind schema) surface; and a mixed scenario proves the kernel keeps going when one plugin in the search path is bad.

  Classification: minor per `spec/versioning.md` §Pre-1.0. Second feature surface after Step 1a; `skill-map` bumps `0.3.0 → 0.4.0`.

  Deferred to Step 2: `sm db migrate --kernel-only` / `--plugin <id>` (wait for real plugin migrations + triple protection), plugin-authored migrations themselves (require SQL AST parsing + prefix injection), and closing the typed-DTO gap.

- 8bda522: Step 1c — Orchestrator + CLI dispatcher + introspection.

  Closes Step 1 (all three sub-steps done). Three deliverables land in this bump:

  **Real scan orchestrator.** `src/kernel/orchestrator.ts` replaces the Step 0b stub with a pipeline that actually walks the Registry — pulling adapters, detectors, and rules from the registered set, iterating in canonical order, and emitting `scan.started` / `scan.completed` through a `ProgressEmitterPort`. The kernel-empty-boot invariant is preserved because with zero extensions the iteration produces a zero-filled valid `ScanResult`. Concrete extension runtime interfaces (`adapter.walk()`, `detector.detect()`, `rule.evaluate()`) are not yet defined; the iteration sites carry `TODO(step-2)` markers so the Step 2 drop-in test stays honoured. New adapter `InMemoryProgressEmitter` handles default in-process event fan-out; WebSocket-backed emitter lands at Step 13.

  **Full CLI surface.** `src/cli/commands/stubs.ts` ships 35 Clipanion command classes covering every verb from `spec/cli-contract.md` that doesn't yet have a real implementation. Each stub registers the final path with the contract's declared flags typed correctly (boolean vs string vs array) and a `Usage` block carrying category / description / details — so `sm help` sees the full surface today and the drift-check script has something to diff against. `execute()` writes a one-liner pointing at the Step that will implement it and returns exit 2. Grouped by module in contract order: setup (init, doctor), config (5), browse (list/show/check/findings/graph/export/orphans*), actions, jobs (submit/list/show/preview/claim/run/status/cancel/prune), record, history, plugins toggle (enable/disable), audits, serve. Real commands from Step 1a (`sm db *`) and Step 1b (`sm plugins list/show/doctor`) + `sm scan`+`sm version` stay on their real implementations.

  **Introspection: `sm help --format human|md|json`.** `src/cli/commands/help.ts` walks `this.cli.definitions()` to introspect every registered verb. `human` delegates to Clipanion's own `cli.usage()` so the terminal output matches the built-in exactly. `json` emits a structured surface dump matching `cli-contract.md` §Help — `{ cliVersion, specVersion, globalFlags, verbs[] }` with each verb carrying `{ name, category, description, details, examples, flags[] }`. `md` emits canonical markdown grouped by category. Single-verb mode (`sm help scan --format json`) emits one block. Unknown verb returns exit 5; unknown format returns exit 2.

  **Auto-generated `docs/cli-reference.md`.** `scripts/build-cli-reference.mjs` runs `sm help --format md` via tsx and writes the result to `docs/cli-reference.md` (290 lines, 6.5 KB). Root package.json gains `cli:reference` (regenerate) and `cli:check` (CI drift check — exits 1 on mismatch with a pointer to the regenerate command). `cli-contract.md` mandates this file is NOT hand-edited in the reference impl; the CI check enforces that.

  **Acceptance test green.** The `kernel-empty-boot` conformance case runs end-to-end through the real `bin/sm.mjs` → real `runScan()` path (no longer via the stub). 36 of 36 tests pass — 32 prior + 4 new covering scan event emission, empty-registry orchestrator iteration, and InMemoryProgressEmitter subscribe/unsubscribe.

  Classification: minor per `spec/versioning.md` §Pre-1.0. Third feature surface after Steps 1a and 1b; `skill-map` bumps `0.4.0 → 0.5.0-pre` territory in the roadmap scheme, formally landing as a minor bump.

- eedaf90: Step 2 — First extension instances.

  Ships the reference implementation's eight built-in extensions and the orchestrator wiring that turns `sm scan` from a zero-filled stub into a real pipeline.

  **Runtime contracts** (`src/kernel/extensions/`): five TypeScript interfaces mirroring the six extension-kind manifest schemas — `IAdapter`, `IDetector`, `IRule`, `IRenderer`, `IAudit`. A plugin's default export IS the runtime instance: the manifest fields (`id`, `kind`, `version`, `stability`, …) and the callable method(s) (`walk`, `detect`, `evaluate`, `render`, `run`) live on the same object, so ESM dynamic imports don't need a `new` dance.

  **Shared utility `trigger-normalize`**: the six-step Unicode pipeline (NFD → strip `Mn` → lowercase → separator unification → whitespace collapse → trim) from `spec/architecture.md` §Detector trigger normalization. Every detector that emits invocation-style links uses it; the `trigger-collision` rule keys on its output.

  **Adapter: `claude`.** Walks Claude Code's on-disk conventions (`.claude/agents/`, `.claude/commands/`, `.claude/hooks/`, `.claude/skills/<name>/SKILL.md`, plus `notes/**/*.md` and a catch-all → `note`), parses frontmatter via js-yaml (tolerant of malformed YAML), uses an async iterator so large scopes don't buffer, and honours a default ignore set (`.git`, `node_modules`, `dist`, `.skill-map`) plus any extras the caller passes.

  **Detectors: `frontmatter`, `slash`, `at-directive`.** Frontmatter extracts structured refs from `metadata.supersedes[]`, `supersededBy` (inverted so the edge points from the new node), `requires[]`, `related[]`. Slash matches `/<command>` tokens in the body with namespace support (`/skill-map:explore`), dedupes on normalized trigger. At-directive matches `@<handle>` with email filtering (`foo@bar.com` skipped) and both scope/name and ns:verb namespaces.

  **Rules: `trigger-collision`, `broken-ref`, `superseded`.** Trigger-collision buckets links by `trigger.normalizedTrigger` and emits error for any bucket with ≥2 distinct targets. Broken-ref resolves path-style targets against `node.path` and trigger-style targets against `frontmatter.name` (normalized, with the leading sigil stripped) — warn severity because authors commonly reference external artifacts. Superseded surfaces every `metadata.supersededBy` as an info finding on the source node.

  **Renderer: `ascii`.** Plain-text dump grouped by node kind, then links, then issues. Minimal — mermaid/dot live as later drop-ins.

  **Audit: `validate-all`.** Post-scan consistency check via AJV against `node.schema.json` / `link.schema.json` / `issue.schema.json`. Plugin manifests are already validated at load time by the PluginLoader (Step 1b), so this audit focuses on user content.

  **Orchestrator wire-up.** `runScan()` now actually iterates: for each adapter, walk roots → classify → build Node (sha256 body/frontmatter hashes, triple-split bytes, stability/version/author denormalised), feed scope-appropriate detectors, collect links, denormalise `linksOutCount` / `linksInCount`, then run every rule over the graph. Links emitting a kind outside the detector's declared `emitsLinkKinds` allowlist are silently dropped.

  **`sm scan`** defaults to the built-in set and exits 1 when the scan surfaces issues (per `cli-contract.md` §Exit codes). A new `--no-built-ins` flag reproduces the kernel-empty-boot zero-filled parity for conformance.

  **Drop-in proof.** The orchestrator iterates `registry.all('<kind>')` — adding a 4th detector is one new file under `src/extensions/detectors/` plus one entry in `src/extensions/built-ins.ts`. Zero kernel edits. Step 4's `external-url-counter` ships as the live proof.

  **Tests.** 52 new tests across normalization, claude adapter, three detectors, three rules, ascii renderer, validate-all audit, and an end-to-end scan against a fixture — 88 of 88 passing. The test glob widened to pick up the colocated `extensions/**/*.test.ts` and `kernel/**/*.test.ts` files that match the `src/extensions/README.md` convention ("each extension is a directory with a manifest + implementation + a sibling `*.test.ts`").

  **Side touches.** `js-yaml` now runs on both sides of the workspace boundary (ui had it since Step 0c; the adapter brings it to src). `docs/cli-reference.md` regenerated to reflect the new `--no-built-ins` flag on `sm scan`.

  Classification: minor per `spec/versioning.md` §Pre-1.0. Fourth feature surface after Steps 1a / 1b / 1c; `skill-map` bumps to the next minor.

### Patch Changes

- Updated dependencies [69572fd]
- Updated dependencies [2699276]
  - @skill-map/spec@0.5.0

## 0.2.0

### Minor Changes

- 3e89d8f: Bump minimum Node version to **24+** (active LTS since October 2025).

  - `engines.node: ">=24.0"` in the reference-impl package.json (root + `src/`).
  - `@types/node` bumped to `^24.0.0`.
  - ROADMAP Decision #1, Stack conventions, and AGENTS.md aligned.

  Rationale: Node 22.5 gave us stable `node:sqlite` but 24 is now the active LTS (Node 22 enters maintenance Oct 2026). The jump buys built-in WebSocket (unblocks Step 13 without a `ws` dependency), the modern ESM loader API, and several runtime improvements Kysely / Clipanion already rely on. No known dependency blocks the bump. Users still on Node 20 are already outside LTS and are not supported.

### Patch Changes

- 5935948: Align kernel domain types with `spec/schemas/`. The Step 0b stub types for `Node`, `Link`, `Issue`, `Extension`, and `PluginManifest` were invented names that diverged from the normative schemas; they compiled only because the `runScan` stub never materialized any instance. This patch closes the drift before Step 4 starts consuming the types in earnest.

  - **`Node`** now matches `node.schema.json`: `path`, `kind`, `adapter`, `bodyHash`, `frontmatterHash`, `bytes` (triple-split `{ frontmatter, body, total }`), `linksOutCount`, `linksInCount`, `externalRefsCount` required; `title`, `description`, `stability`, `version`, `author`, `frontmatter`, `tokens` optional. Removed ad-hoc `name` / `metadata`.
  - **`Link`** now matches `link.schema.json`: `source` (was `from`), `target` (was `to`), `kind` (new discriminator `invokes | references | mentions | supersedes`), `confidence: 'high' | 'medium' | 'low'` (was `exact | fuzzy`), `sources: string[]` (was singular `detector`), `trigger: { originalTrigger, normalizedTrigger } | null` (was flat top-level), plus optional `location`, `raw`.
  - **`Issue`** now matches `issue.schema.json`: `ruleId` (was `rule`), `severity: 'error' | 'warn' | 'info'` (was `'warning'`), `nodeIds` (was `nodes`), plus optional `linkIndices`, `detail`, `fix`, `data`. Removed top-level `id` (DB-only autoincrement, not in the schema).
  - **`Extension`** extended with `version` (required), plus optional `description`, `stability`, `preconditions`, `entry` — matches `spec/schemas/extensions/base.schema.json`.
  - **`PluginManifest`** renamed `entries` → `extensions` (string paths); added `description`, `storage` (`oneOf` `kv | dedicated`), `author`, `license`, `homepage`, `repository` — matches `spec/schemas/plugins-registry.schema.json`.
  - New exported types: `NodeKind`, `LinkKind`, `Confidence`, `Severity`, `Stability`, `TripleSplit`, `LinkTrigger`, `LinkLocation`, `IssueFix`, `PluginStorage`.
  - **Tests**: imports normalized from `.ts` → `.js` (runtime-correct with `verbatimModuleSyntax`). `tsconfig.include` now lists `test/**/*`; `exclude` no longer skips `test` — typecheck covers tests going forward. Added coverage for `sm scan <roots...> --json` passing custom roots through. Dead copy-paste (`void k`) removed from the ISO-8601 test.
  - **Conformance runner cleanup**: removed `PATH_SEP` re-export (consumers import `sep` from `node:path` directly) and `caseFixturePath` helper (dead parameter, zero consumers). `assertSpecRoot` retained as defensive API.

  Classification: patch. Public types were unreleased Step 0b stubs; no consumer relied on the old shapes. The changes are corrections toward the already-published spec contract, not new behaviour.

- 1455cb1: Fix `sm version`: the `spec` line now reports the `@skill-map/spec` npm package version (e.g. `0.2.0`) instead of the `index.json` payload-shape version (which was `0.0.1` in every release).

  The CLI was reading `specIndex.specVersion`, which the spec renamed to `indexPayloadVersion` in the same release and was never the right field for this purpose — the payload version tracks changes to `index.json`'s own shape, not the spec a user is running against. `sm version` now reads `specIndex.specPackageVersion` (new top-level field in `@skill-map/spec`, populated from `spec/package.json.version`).

  Requires `@skill-map/spec` ≥ the release that introduces `specPackageVersion`. No CLI surface change; only the value changes in the output line.

- Updated dependencies [334c51a]
- Updated dependencies [3e89d8f]
- Updated dependencies [334c51a]
- Updated dependencies [d41b9ae]
- Updated dependencies [93ffe34]
- Updated dependencies [d41b9ae]
- Updated dependencies [5935948]
- Updated dependencies [1455cb1]
- Updated dependencies [1455cb1]
- Updated dependencies [93ffe34]
- Updated dependencies [1455cb1]
- Updated dependencies [334c51a]
- Updated dependencies [93ffe34]
- Updated dependencies [93ffe34]
- Updated dependencies [d41b9ae]
- Updated dependencies [93ffe34]
- Updated dependencies [93ffe34]
  - @skill-map/spec@0.3.0

## 0.1.0

### Minor Changes

- 5b3829a: Step 0b — Implementation bootstrap:

  - `src/` workspace scaffolded (TypeScript strict, Node ESM, tsup build, tsx test loader).
  - Hexagonal skeleton: 5 ports (`StoragePort`, `FilesystemPort`, `PluginLoaderPort`, `RunnerPort`, `ProgressEmitterPort`) + `Registry` covering the six extension kinds + kernel shell + `runScan` stub that returns a well-formed empty `ScanResult`.
  - CLI (Clipanion v4): `sm --version`, `sm --help`, `sm scan [roots...] [--json]`. Binary wrapper at `bin/sm.mjs`.
  - Contract test runner (`src/conformance/index.ts`): loads a case JSON, provisions a tmp scope, invokes the binary, evaluates 5 of 6 assertion types (`file-matches-schema` marked NYI — lands with Step 2 when ajv is introduced).
  - Unit + integration tests with `node:test`: 13 tests covering the Registry, kernel, CLI surface, and conformance runner.
  - CI extended with `build-test` job (typecheck + tsup + tests).

  First cut of the reference implementation.

### Patch Changes

- Updated dependencies [5b3829a]
- Updated dependencies [4e0aec4]
  - @skill-map/spec@0.1.0
