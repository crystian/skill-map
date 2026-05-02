# Spec changelog

## 0.12.0

### Minor Changes

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

## 0.11.0

### Minor Changes

- f8fca25: Step 10 prep — job artifacts move into the database (B2: content-addressed storage)

  Removes the on-disk `.skill-map/jobs/<id>.md` and `.skill-map/reports/<id>.json` artifacts from the spec. Rendered job content and report payloads now live in the kernel database; the filesystem is no longer a normative layer of the job lifecycle. Pre-1.0 minor breaking per `versioning.md` § Pre-1.0.

  **Why**: every other piece of operational state (`state_summaries`, `state_enrichments`, `state_plugin_kvs`, `node_enrichments`) already lives in the DB. Jobs and reports were the only outliers — and being outliers cost real complexity (orphan-file detection, partial backups, two-source-of-truth GC). With B2 (content-addressed dedup keyed on the existing `content_hash`), retries / `--force` / cross-node fan-out reuse a single content blob, so DB-only does not blow up storage on heavy users.

  **Schema changes**

  - New table `state_job_contents` (`content_hash` PK, `content` TEXT, `created_at`). Content-addressed: multiple `state_jobs` rows MAY reference the same row.
  - `state_jobs.file_path` removed. The rendered content is fetched via `state_job_contents.content_hash` join.
  - `state_executions.report_path` → `state_executions.report_json` (TEXT, parsed-JSON-on-read per the `_json` naming convention).

  **Schema-typed contract changes**

  - `Job.filePath` removed.
  - `ExecutionRecord.reportPath` → `ExecutionRecord.report` (object/null — the parsed JSON payload).
  - `Job.failureReason` and `ExecutionRecord.failureReason` enums: `job-file-missing` → `content-missing` (defensive failure-mode label for DB corruption where a job row outlives its content row; the runtime invariant should keep this state unreachable).
  - `history-stats.schema.json` `perFailureReason` mirrors the rename.

  **CLI surface changes**

  - `sm job preview <id>` now prints the rendered content from `state_job_contents` (no file). Same output, different source.
  - `sm job claim --json` is the contracted Skill-agent handover: returns `{id, nonce, content}` so the agent can call `sm record` afterwards with the nonce in hand. The plain-stdout form (id only) is preserved for legacy scripts.
  - `sm record --report <path-or-dash>` accepts a file path OR `-` (stdin); the kernel reads the payload and stores it inline in `report_json`. The on-disk report file becomes operationally ephemeral — implementations SHOULD remove it after the kernel acknowledges the callback (courtesy GC, not normative).
  - `sm job prune --orphan-files` removed. Replaced by automatic `state_job_contents` GC inside `sm job prune`: deletes terminal jobs past retention, then collects orphan content rows in the same transaction.
  - `sm doctor` checks change accordingly: drops the "orphan job files / orphan DB rows pointing at missing files" pair; adds two DB-internal checks (`state_jobs` rows whose `content_hash` is missing from `state_job_contents`; `state_job_contents` rows referenced by zero `state_jobs` rows).

  **Event stream changes**

  - `job.spawning.data.jobFilePath` → `job.spawning.data.contentHash` (references the content row instead of a file path).
  - `job.callback.received.data.reportPath` and `job.completed.data.reportPath` → `executionId` (references the `state_executions` row that holds the inline report payload). Reports are intentionally NOT inlined in events — consumers query the row when they need the body.

  **Architecture changes**

  - `RunnerPort.run(jobFilePath, options)` → `run(jobContent, options)` returning `{report, ...}` instead of `{reportPath, ...}`. Path-based reporting is no longer part of the port contract. Runners that need an actual file (the canonical case being `claude -p` reading stdin from a path) materialize a temp file inside `run()` and remove it after spawn — temp files are operational, not normative.

  **Atomicity edge cases consolidated**

  `spec/job-lifecycle.md` §Atomicity edge cases drops the four file-related rows. Two new DB-internal cases take their place: `state_jobs` row outliving its `state_job_contents` row (failure: `content-missing`); `state_job_contents` row with no live job references (GC straggler — `sm job prune` collects).

  **Files touched**

  - `spec/db-schema.md` — new `state_job_contents` section, `state_jobs.file_path` removed, `state_executions.report_path` → `report_json`, integrity section rewritten.
  - `spec/job-lifecycle.md` — §Submit step 8 rewritten (DB store), §Atomic claim documents `--json` shape, §Atomicity edge cases consolidated, §Record callback rewritten for `--report` path-or-stdin semantics, §Retention extended to cover `state_job_contents` GC, failure-reason rename.
  - `spec/cli-contract.md` — `sm job preview` / `sm job claim` / `sm job prune` rows updated, `sm job prune --orphan-files` row removed, `sm record` block rewritten with `<path-or-dash>`, `sm doctor` integrity bullets updated.
  - `spec/prompt-preamble.md` — §How the kernel applies step 5 rewritten (DB store, no file).
  - `spec/architecture.md` — §`RunnerPort` operations + reference impls updated for content-string + parsed-report shape.
  - `spec/job-events.md` — `job.spawning` / `job.callback.received` / `job.completed` payloads changed.
  - `spec/conformance/README.md` + `coverage.md` — `preamble-bitwise-match` references updated to `sm job preview` stdout.
  - `spec/schemas/job.schema.json` — `filePath` property removed, failure-reason enum rename.
  - `spec/schemas/execution-record.schema.json` — `reportPath` → `report` (object/null), failure-reason enum rename.
  - `spec/schemas/history-stats.schema.json` — `perFailureReason` enum rename.
  - `spec/index.json` regenerated (40 files hashed); `npm run spec:check` green.

  **Migration for consumers**

  - Any consumer reading `state_jobs.file_path` or `state_executions.report_path` reads from the renamed columns / DB-only paths instead.
  - Any tooling that watched `.skill-map/jobs/*.md` or `.skill-map/reports/*.json` needs to query the DB or call the relevant `sm` verb.
  - `--orphan-files` flag callers must drop the flag; `sm job prune` already does the equivalent automatically.
  - Skill agents drain via `sm job claim --json` (id + nonce + content together) instead of `sm job claim` + reading a file.

  **Out of scope**

  The reference impl side of this (migration that adds `state_job_contents` + drops `state_jobs.file_path`; storage-adapter helpers; runtime piping in `ClaudeCliRunner` for the temp-file dance) lands in follow-up changesets under `@skill-map/cli`. The spec change above is self-contained: shipping it alone changes nothing at runtime, but unblocks the implementation phases.

## 0.10.0

### Minor Changes

- f8a7125: Open `Node.kind` to any Provider-declared string (Phase A — spec only).

  The kernel always documented `IProvider.kinds` as "open by design" so future Cursor / Obsidian / Roo Providers can declare their own kinds. The spec, however, had three layers underneath that closed it back to the original five-value Claude Provider catalog (`skill` / `agent` / `command` / `hook` / `note`):

  - `node.schema.json#/properties/kind` carried `enum: [<5 values>]` — AJV-rejected anything else.
  - `db-schema.md` § `scan_nodes` and § `state_summaries` mandated `CHECK in (<5 values>)` SQL constraints.
  - `extensions/action.schema.json#/.../filter/kind` had the same closed list for the per-action applicability filter.

  This phase opens the spec end:

  - `node.schema.json#/properties/kind` → `{ "type": "string", "minLength": 1 }` with a description naming the built-in Claude catalog so consumers know the default contract.
  - `db-schema.md` drops both `CHECK in (...)` constraint rows. Both columns stay `TEXT NOT NULL`.
  - `extensions/action.schema.json#/.../filter/kind` widens to `{ items: { "type": "string", "minLength": 1 } }`.

  The TS side (`Node.kind: string`, `IProvider.classify(...): { kind: string; ... }`, Kysely `TNodeKind = string`) and the SQL `002_open_node_kinds` migration that drops the live CHECK constraints land in follow-up phases under `@skill-map/cli`. Phase A is a safe checkpoint: shipping the spec change alone changes nothing at runtime (the kernel still emits closed kinds, the live DB still enforces the existing CHECK), but it unblocks the rest of the refactor and aligns the source-of-truth artifact with the design intent.

  Migration for consumers:

  - Anyone validating an exported `Node` JSON against `node.schema.json` now accepts external-Provider kinds.
  - Any UI / dashboard / script that hard-coded the closed enum elsewhere (filter chips, assertion sets) needs to widen to `string` and accept whatever an enabled Provider declares.

  Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0 (this is breaking for consumers that relied on the enum, but pre-1.0 breakings ship as minor).

## 0.9.0

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

## [Unreleased]

### Minor

- **`sm serve` row + `### Server` subsection** in `cli-contract.md` —
  Step 14.1 promotes `sm serve` from an implementation-defined stub to a
  documented surface. The verb row at `§Verb catalog` › `### Server`
  expands the flag set to the full 14.1 contract: `--port` (default
  `4242`), `--host` (default `127.0.0.1`, loopback-only through v0.6.0),
  `--scope project|global`, `--db <path>`, `--no-built-ins`,
  `--no-plugins`, `--open` / `--no-open`, `--dev-cors`, `--ui-dist
<path>` (hidden). New `#### Server` subsection documents the
  single-port mandate, the boot-with-missing-DB resilience contract
  (`/api/health` returns `db: 'missing'`), the v14.1 endpoint surface
  (`GET /api/health` real, `ALL /api/*` 404 stubs, `GET /ws` upgrade-only,
  static + SPA fallback), the structured error envelope shape, and the
  flag table. Marked `*(Stability: experimental — locks at v0.6.0.)*` —
  endpoints fill at v14.2, broadcaster at v14.4. Additive minor per
  `versioning.md` § Pre-1.0 (no breaking change to the existing row's
  semantics; the old wording was strictly less specific).

### Minor (breaking, pre-1.0)

- **`Node.kind` opens to any non-empty string (was the closed enum
  `skill` / `agent` / `command` / `hook` / `note`).** The kernel always
  permitted external Providers — `IProvider.kinds` is documented as
  "open by design" so a future Cursor / Obsidian / Roo Provider can
  declare its own kinds — but the `node.schema.json` enum + the
  `scan_nodes.kind` SQL CHECK + the closed TS `NodeKind` union closed
  three layers underneath. Effects:
  - `node.schema.json#/properties/kind` switches from `enum: [...5
values]` to `{ "type": "string", "minLength": 1 }`. The
    description still names the built-in Claude Provider catalog so
    consumers know what to expect from the default install.
  - `db-schema.md` drops the `CHECK in (...)` constraint on
    `scan_nodes.kind` and `state_summaries.kind`. Both columns stay
    `TEXT NOT NULL`.
  - `extensions/action.schema.json#/.../filter/kind` (the per-kind
    filter for action applicability) widens the same way: `items:
{ type: 'string', minLength: 1 }` instead of the closed enum.
    Migration: consumers who validate exported `Node` JSON against
    `node.schema.json` will now accept external-Provider kinds. Any
    consumer that hard-coded the closed enum elsewhere (UI filter chip
    set, scripted assertions) needs to widen to "string". The TS +
    SQL counterpart lands in `@skill-map/cli` (kernel TS contract +
    migration `002_open_node_kinds`).
- **`conformance-case.schema.json` — rename `setup.disableAllDetectors`
  → `setup.disableAllExtractors`.** Finishes the kind rename Detector →
  Extractor introduced in 0.8.0 (Phase 2 of the plug-in model
  overhaul). The previous name was a residue from an unfinished sweep
  and never reached a release that consumed it.
- **`setup.disableAll{Providers,Extractors,Rules}` are now wired
  end-to-end.** Until this release the toggles were declared in the
  schema but the runner threaded them nowhere; the `kernel-empty-boot`
  case happened to pass because its fixture is empty. The runner now
  injects `SKILL_MAP_DISABLE_ALL_{PROVIDERS,EXTRACTORS,RULES}=1` into
  the child process environment per toggle, and the CLI's scan
  composer drops every extension of the disabled kind from the
  in-scan pipeline (overriding granularity gates and `--no-built-ins`).
  Migration: any case JSON authored against the unwired schema needs
  to swap `disableAllDetectors` for `disableAllExtractors`; behaviour
  changes only when the toggles were already `true` (those cases will
  now actually disable the kind, where previously they relied on
  fixture content for the same outcome).

### Patch

- Updated `conformance/cases/kernel-empty-boot.json` for the field
  rename above.
- Updated `conformance/README.md` example for the field rename above.
- Schema docstrings added to each `disableAll*` property documenting
  the env-var convention the runner uses.

## 0.8.0

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

## [Unreleased]

### Minor Changes

- Conformance fixture relocation (Phase 5 / A.13). The conformance suite splits along ownership lines: spec-owned cases (kernel-agnostic, today only `kernel-empty-boot` plus the deferred `preamble-bitwise-match`) keep living under `spec/conformance/`; Provider-owned cases that exercise a Provider's own kind catalog move next to that Provider's manifest, under `<plugin-dir>/conformance/`. The reference impl's Claude Provider now hosts `basic-scan`, `rename-high`, and `orphan-detection` together with their `minimal-claude` / `orphan-{before,after}` / `rename-high-{before,after}` fixtures at `src/extensions/providers/claude/conformance/`. The split mirrors the spec 0.8.0 Phase 3 schema relocation: cases that depend on Claude-specific kinds (`skill`) belong with the Provider that declares the kind, not in the spec. New CLI verb `sm conformance run [--scope spec|provider:<id>|all]` (default `all`) drives both buckets in one invocation; `--scope spec` and `--scope provider:claude` narrow to a single suite for targeted runs and CI matrices. The reference runner gains an optional `fixturesRoot` parameter so cases can resolve their fixtures against the Provider's directory instead of the spec's. `spec/conformance/README.md` updated for the dual-ownership layout (spec-owned + Provider-owned tables, `sm conformance run` documented, runner pseudocode amended). `spec/conformance/coverage.md` retargeted: rows that used to credit `basic-scan` (now Provider-owned) downgrade to `kernel-empty-boot`-only or `🔴 missing` and point to the Provider's coverage file (`src/extensions/providers/claude/conformance/coverage.md`); the rename-heuristic non-schema row notes the Provider ownership. `spec/cli-contract.md` adds a §Conformance subsection under §Verb catalog and adds `sm conformance run` to the elapsed-time §Scope. `spec/architecture.md` opening sentence credits both buckets. Pre-1.0 minor per `versioning.md` § Pre-1.0; breaking only for tooling that hard-codes the previous case paths under `spec/conformance/cases/{basic-scan,rename-high,orphan-detection}.json` — no real ecosystem affected today (the reference impl's runner already migrates).

- `sm check` gains `--include-prob` opt-in flag for probabilistic Rule dispatch (Phase 4 / A.7). Default unchanged: deterministic only, CI-safe — same status quo behaviour. With the flag, the verb loads the plugin runtime, finds Rules with `mode === 'probabilistic'` (filtered by `--rules` if set), and emits a stderr advisory naming the skipped rule ids. Full dispatch lands when the job subsystem ships at Step 10; until then the flag is a stub — prob rules never produce issues, never alter the exit code. New companion flag `--async` is reserved for the future encoding (returns job ids without waiting once jobs land); today it is a no-op the advisory mentions. Companion filters `-n <node.path>` and `--rules <ids>` (comma-separated qualified or short ids) added to `sm check` for granular reads — they restrict the persisted-issue list AND filter which prob rules surface in the advisory. Does NOT extend to `sm scan` or `sm list`. Documented in `cli-contract.md` §Browse and `plugin-author-guide.md` §Rules. Pre-1.0 minor per `versioning.md` § Pre-1.0; additive — no consumer breakage.

- Sixth plugin kind `hook` added (Phase 4 / A.11). Reacts declaratively to a curated set of 8 lifecycle events — `scan.started`, `scan.completed`, `extractor.completed`, `rule.completed`, `action.completed`, `job.spawning`, `job.completed`, `job.failed`. Other events (per-node `scan.progress`, `model.delta`, `run.*`, `job.claimed`, `job.callback.received`) are deliberately NOT hookable: too verbose, internal to the runner, or covered elsewhere. Manifest declares `triggers[]` (validated against the hookable set; an unknown trigger yields `invalid-manifest` at load time with a directed reason naming the offending trigger and the full hookable list) and an optional `filter` object (top-level field equality match against the event payload; cross-field validation is best-effort in v0.x). Dual-mode: `deterministic` (default) runs `on(ctx)` in-process during the dispatch of the matching event, synchronously between emission and the next pipeline step; `probabilistic` is enqueued as a job (deferred to the job subsystem at Step 10 — probabilistic hooks load but skip dispatch with a stderr advisory until then). Hooks REACT to events; they cannot mutate the pipeline, block emission, or alter outputs. Errors are caught by the dispatcher (logged through `extension.error` with `kind: 'hook-error'`) and never block the main flow. Three new event types added to the catalog so the aggregated Extractor / Rule / Action triggers have a normative shape: `extractor.completed` (one per Extractor, after the full walk), `rule.completed` (one per Rule, after issue validation), `action.completed` (one per Action invocation, after report recording — lands alongside the job subsystem at Step 10). New schema `schemas/extensions/hook.schema.json` (`$id` `https://skill-map.dev/spec/v0/extensions/hook.schema.json`); `schemas/extensions/base.schema.json#/properties/kind/enum` extended with `hook`. Documented in `architecture.md` §Extension kinds (table extended from 5 to 6 rows), §Mode capability matrix (Hook dual-mode), §Hook · curated trigger set (new dedicated section); `plugin-author-guide.md` retitled "## The six extension kinds" with a new Hooks subsection (worked example: Slack notifier on `scan.completed`); `job-events.md` cross-links Hook from each of the 8 hookable triggers, adds the three new aggregated event entries, and updates the experimental tag scope. Coverage matrix grows from 23 to 24 rows. Pre-1.0 minor per `versioning.md` § Pre-1.0; additive — no consumer breakage. Existing extension kinds (`provider`, `extractor`, `rule`, `action`, `formatter`) are untouched.

- Enrichment layer formalized (Phase 4 / A.8). New kernel table `node_enrichments(node_path, extractor_id, body_hash_at_enrichment, value_json, stale, enriched_at, is_probabilistic)` stores `ctx.enrichNode(partial)` outputs separately from the author's frontmatter (which remains IMMUTABLE from any Extractor — both deterministic and probabilistic). Per-Extractor attribution is preserved (one row per `(node, extractor)` pair). Probabilistic enrichments track `body_hash_at_enrichment`; when the scan loop sees a body change, those rows are flagged `stale = 1` (NOT deleted, so the LLM cost is preserved). Deterministic enrichments regenerate via the A.9 fine-grained cache and pisar via PRIMARY KEY conflict on the next re-extract — they are never stale-flagged. Read-side helper `mergeNodeWithEnrichments(node, enrichments)` produces a "merged view" by filtering stale rows, sorting by `enriched_at` ASC, and spread-merging onto the author frontmatter (last-write-wins per field). Stale visibility is opt-in (`includeStale: true`). Rules / `sm check` / `sm export` consume `node.frontmatter` directly (deterministic CI-safe baseline); enrichment consumption is opt-in by the caller. New verbs `sm refresh <node>` (granular) and `sm refresh --stale` (batch) re-run Extractors and upsert fresh enrichment rows — STUBBED until the job subsystem ships at Step 10: deterministic Extractors persist for real, probabilistic Extractors emit a stderr advisory and skip without touching their stale rows. Migration `001_initial.sql` updated in place per the pre-1.0 consolidation precedent (no released DBs to forward-migrate). Documented in `db-schema.md` §`node_enrichments`, `architecture.md` §Extractor · enrichment layer, `cli-contract.md` §Scan, and `plugin-author-guide.md` §Extractors. Pre-1.0 minor per `versioning.md` § Pre-1.0; additive — no consumer breakage.

- Plugin manifest gains optional `storage.schemas` map (Mode B / dedicated) and `storage.schema` (Mode A / KV) for opt-in JSON Schema validation of custom storage writes. AJV-validates `ctx.store.write(table, row)` and `ctx.store.set(key, value)` before persisting; throws on shape violation. Default absent = permissive (status quo). `emitLink` and `enrichNode` keep their universal kernel validation regardless. A schema file missing on disk or failing AJV compile at load time surfaces as `load-error` with a directed reason naming the plugin, the table (Mode B), and the schema path. Pre-1.0 minor per `versioning.md` § Pre-1.0; additive — no consumer breakage. Documented in `plugin-author-guide.md` §Storage and referenced from `architecture.md` §Extractor · output callbacks.

- New kernel table `scan_extractor_runs(node_path, extractor_id, body_hash_at_run, ran_at)` — fine-grained Extractor cache breadcrumbs (Phase 4 / A.9). Replaces the previous "trust the node-level body+frontmatter hash" model that silently bypassed any Extractor newly registered between scans. Cache decision per `(node, extractor)` pair: a new Extractor registered between scans yields a partial cache hit (only the newcomer runs over the cached node); an uninstalled Extractor's rows disappear via replace-all, and links whose sources are exclusively that Extractor disappear with them. Documented in `db-schema.md` §`scan_extractor_runs`. Migration `001_initial.sql` updated in place per the pre-1.0 consolidation precedent (no released DBs to forward-migrate). Pre-1.0 minor per `versioning.md` § Pre-1.0; additive — no consumer breakage.

- Per-kind frontmatter schemas relocate from spec to the Provider that declares them. Spec keeps only `frontmatter/base.schema.json` (universal — fields common to every node across every Provider). The Claude Provider gains a `kinds` map declaring its catalog (`skill` / `agent` / `command` / `hook` / `note`) with per-kind `schema` + `defaultRefreshAction`. The pre-0.8 flat fields `emits: string[]` and `defaultRefreshAction: { <kind>: actionId }` collapse into the new map: `emits` is removed (derived from `Object.keys(kinds)`); each `defaultRefreshAction[<kind>]` value moves into `kinds[<kind>].defaultRefreshAction`. The kernel parse phase asks the Provider for the schema instead of reading from `spec/schemas/frontmatter/<kind>.schema.json`. Schema files moved: `spec/schemas/frontmatter/{skill,agent,command,hook,note}.schema.json` → `src/extensions/providers/claude/schemas/{skill,agent,command,hook,note}.schema.json`; their `$id` updates from `https://skill-map.dev/spec/v0/frontmatter/<kind>.schema.json` to `https://skill-map.dev/providers/claude/v1/frontmatter/<kind>.schema.json`; their `$ref: 'base.schema.json'` updates to `$ref: 'https://skill-map.dev/spec/v0/frontmatter/base.schema.json'` (absolute `$ref`-by-`$id` so AJV resolves cross-package against the spec base registered into the same instance). `spec/schemas/extensions/provider.schema.json` updated: `kinds` is required, `emits` and the old shape of `defaultRefreshAction` removed. `spec/conformance/coverage.md` matrix shrinks from 28 to 23 rows (the five per-kind frontmatter rows belong to the Provider's own conformance suite, planned in Phase 5). `spec/index.json` no longer lists the per-kind schemas. `architecture.md` §Provider section retitled `Provider · kinds catalog and explorationDir`; `plugin-author-guide.md` Provider example updated; `README.md` directory tree updated to reflect spec/frontmatter/ now holds only `base.schema.json`. Pre-1.0 minor per `versioning.md` § Pre-1.0; breaking for any plugin or test referencing `spec/schemas/frontmatter/<kind>.schema.json` paths or `$id`s, the old `provider.emits` field, or the flat `provider.defaultRefreshAction` map — no real ecosystem affected today.

- Plugin kind `renderer` renamed to `formatter`. Method renamed `render(ctx) → format(ctx)`. Manifest field `format` (the identifier consumed by `--format`) renamed to `formatId` to avoid clashing with the new method name. Same contract otherwise: graph → string, deterministic-only. Aligns with industry tooling (ESLint formatter, Mocha reporter, Pandoc writer). `schemas/extensions/renderer.schema.json` renamed to `formatter.schema.json`; the `kind` const flips from `"renderer"` to `"formatter"`; `base.schema.json#/properties/kind/enum` updated. `architecture.md`, `cli-contract.md`, `plugin-author-guide.md`, `README.md` updated to match (Extension kinds table, Execution modes table, testkit helper names, worked CSV example). `conformance/coverage.md` row 28 retargeted at the new schema filename. Pre-1.0 minor per `versioning.md` § Pre-1.0; breaking for any plugin or test referencing `kind: "renderer"`, `IRenderer`, `r.format`, or `render(ctx)` — no real ecosystem affected today.

- Plugin kind `'detector'` renamed to `'extractor'`. Method signature
  changes from `detect(ctx) → Link[]` to `extract(ctx) → void` — output
  flows through three new ctx callbacks: `emitLink(link)` (kernel `links`
  table), `enrichNode(partial)` (kernel enrichment layer, persisted into
  `node_enrichments` per A.8), and the existing `ctx.store` (plugin's
  own table). The Extractor absorbs what would have been a separate
  `Enricher` kind via `enrichNode`. Built-ins migrated:
  `claude/frontmatter`, `claude/slash`, `claude/at-directive`,
  `core/external-url-counter` — all use `emitLink` to maintain
  functional parity with their Detector ancestors. Schema files
  renamed: `schemas/extensions/detector.schema.json` →
  `schemas/extensions/extractor.schema.json`. Persisted DB rows are
  unaffected (link `sources` carry extractor ids verbatim — the field
  was always free-form). Pre-1.0 minor per `versioning.md` § Pre-1.0;
  breaking for any plugin or test referencing `'detector'` as the
  kind, `IDetector`, or the old `Link[]` return signature — no real
  ecosystem affected today.

- Plugin kind `'audit'` removed. The single built-in `'validate-all'`
  migrated to a Rule (qualified id `'core/validate-all'`, method
  `evaluate(ctx) → Issue[]`). The kind had dual personality (composer +
  standalone reporter); the standalone reporter case is naturally a Rule,
  and the composer case is deferred to post-1.0 if a real use case
  appears. CLI verbs `'sm audit run'` and `'sm audit show'` removed;
  users invoke the rule via `sm check --rules core/validate-all`.
  `state_executions.kind` enum narrowed to `['action']` (audit was the
  only other value); the column is preserved as a forward-compatibility
  lever. Schema files removed: `schemas/extensions/audit.schema.json`.
  Coverage matrix shrinks from 29 to 28 rows. Pre-1.0 minor per
  `versioning.md` § Pre-1.0; breaking for any plugin or test referencing
  the audit kind, `IAudit`, `TAuditReport`, or `sm audit` verbs — no
  real ecosystem affected today.

- Plugin kind `'adapter'` renamed to `'provider'`. Manifest gains required
  field `'explorationDir'` (filesystem directory where the Provider's
  content lives, e.g. `'~/.claude'` for the Claude Provider). Built-in
  `claudeAdapter` renamed to `claudeProvider`. The hexagonal-architecture
  `'adapter'` (`RunnerPort.adapter`, `StoragePort.adapter`,
  `FilesystemPort.adapter`, `PluginLoaderPort.adapter`) is unchanged —
  distinct concept, distinct namespace.
  Persisted schema fields renamed: `node.adapter` → `node.provider`,
  `scan-result.adapters` → `scan-result.providers` (pre-1.0 minor — no
  production DBs to migrate; `001_initial.sql` was edited in place per
  the consolidation precedent already established for pre-1.0).
  Project config field renamed: `project-config.adapters` →
  `project-config.providers`. Schema files renamed:
  `schemas/extensions/adapter.schema.json` →
  `schemas/extensions/provider.schema.json`. Pre-1.0 minor per
  `versioning.md` § Pre-1.0; breaking for any plugin or test referencing
  `'adapter'` as the kind, `IAdapter`, or any persisted/config schema
  field renamed above — no real ecosystem affected today.

## 0.7.1

### Patch Changes

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

## 0.7.0

### Minor Changes

- d730094: Spec — Execution modes (deterministic / probabilistic) lifted to a first-class architectural property

  Frames a meta-property of skill-map that was previously implicit and scattered:
  **every analytical extension is one of two modes** — `deterministic` (pure code,
  runs in scan-time pipelines) or `probabilistic` (invokes an LLM through
  `RunnerPort`, runs only as queued jobs). The dual-mode capability now spans four
  of the six extension kinds; Adapter and Renderer remain locked to deterministic
  because they sit at the system boundaries (filesystem and graph-to-string) where
  non-determinism would break boot reproducibility and snapshot diffing.

  **Spec changes:**

  - `architecture.md` — new top-level section **§Execution modes** before
    §Extension kinds. Defines the two modes, the per-kind capability matrix
    (Detector / Rule / Action dual-mode by manifest declaration; Audit dual-mode
    with mode **derived** from `composes[]`; Adapter / Renderer deterministic-only),
    the runtime separation (`deterministic` runs in `sm scan` / `sm check`;
    `probabilistic` runs only via `sm job submit <kind>:<id>`), and the
    `RunnerPort` injection contract for probabilistic extensions.
  - `architecture.md` §Extension kinds — table updated: each row clarifies the
    mode posture (Adapter / Renderer marked deterministic-only; Detector / Rule /
    Action marked dual-mode; Audit marked derived-mode).
  - `architecture.md` §Stability — new clause: execution modes and the per-kind
    capability matrix are stable as of v1.0.0; adding a third mode, changing
    which kinds are dual-mode, or changing the audit's derivation rule is a major
    bump.

  **Schema changes:**

  - `schemas/extensions/detector.schema.json`:
    - New optional `mode` field (`deterministic` | `probabilistic`, default
      `deterministic`). Omitting is equivalent to deterministic — keeps existing
      detectors valid without an update.
    - Description updated to spell out the dual-mode contract.
  - `schemas/extensions/rule.schema.json`:
    - Same shape: new optional `mode` field with default `deterministic`.
    - Description rewritten — the previous "Rules MUST be deterministic" claim
      moved into the deterministic-mode contract; probabilistic rules are now
      explicitly allowed and run only as queued jobs.
  - `schemas/extensions/action.schema.json`:
    - **Breaking** — `mode` enum renamed: `local` → `deterministic`,
      `invocation-template` → `probabilistic`. Pre-1.0; no consumers depend on
      the old values (no third-party action plugins shipped). Description, the
      two `if/then` branches, and the `expectedDurationSeconds` /
      `promptTemplateRef` field descriptions updated accordingly.
    - **Bug fix** — the schema previously declared `allOf` twice at the root
      (lines 6–8 and 71–80); the second silently overrode the first, dropping
      `$ref: base.schema.json`. Both blocks are now merged into a single `allOf`
      so the action schema actually composes the base shape.
  - `schemas/extensions/audit.schema.json`:
    - Description rewritten — the "deterministic workflow" claim is replaced by
      the **derived-mode** rule: the audit's effective mode is computed from
      `composes[]` at load time. If every composed primitive is deterministic,
      the audit is deterministic; if any is probabilistic, the audit is
      probabilistic and dispatches as a job. Declaring `mode` directly is a
      load-time error.
    - `composes[]` description updated to mention that each primitive's mode
      participates in derivation; dangling references stay a load-time error.
    - `reportSchemaRef` description updated: probabilistic audits MUST extend
      `report-base.schema.json` (carries `safety` / `confidence`); deterministic
      audits MAY extend it but are not required to.
  - `schemas/extensions/adapter.schema.json`:
    - Description updated to state explicitly that adapters are deterministic-only
      and that `mode` MUST NOT appear. Recommendation for users who want
      LLM-assisted classification: write a probabilistic Detector that emits
      classification hints as `Link[]`.
  - `schemas/extensions/renderer.schema.json`:
    - Description updated to state that renderers are deterministic-only and
      that `mode` MUST NOT appear. Probabilistic narrators of the graph belong
      in jobs and emit Findings, not in renderer manifests.

  **Why major (despite pre-1.0 minor norm):**

  Renaming the `Action.mode` enum (`local` → `deterministic`,
  `invocation-template` → `probabilistic`) is breaking by definition. No
  third-party Actions exist yet, but the rename touches the canonical surface and
  deserves the bump. New optional fields on Detector / Rule and the new derived-
  mode contract on Audit are additive and would have been minor on their own.

  **Implementation work intentionally NOT included here:**

  - `src/extensions/built-ins.ts` and the per-extension TS files keep working
    unchanged because the new `mode` is optional with `deterministic` default.
    Explicitly threading `mode: 'deterministic'` through every built-in is a
    follow-up.
  - `RunnerPort` injection through `ctx.runner` for probabilistic extensions is
    spec'd here; the actual context plumbing lands with the first probabilistic
    extension (Step 10 — first summarizer). `MockRunner` continues to satisfy
    tests until then.
  - Conformance case `extension-mode-derivation` (audit composes mixed
    primitives → derives `probabilistic`) is mentioned in `architecture.md` and
    pending under `spec/conformance/coverage.md` for the next release.
  - ROADMAP.md rephrase of Steps 10–11 (from "summarizers" to "wave 2:
    probabilistic extensions") and a positioning section in `README.md` follow
    in separate commits to keep this changeset spec-only.

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

### Patch Changes

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

## 0.6.1

### Patch Changes

- f41dbad: Step 6.1 — Spec migration: rename the canonical config file from
  `.skill-map.json` (single project-root file) to `.skill-map/settings.json`
  inside the `.skill-map/` scope folder, with a sibling `.skill-map/settings.local.json`
  partner for machine-specific overrides. Aligns the spec with the layered
  config hierarchy described in the roadmap (library defaults → user → user-local
  → project → project-local → env / flags).

  **Spec change (breaking, minor under pre-1.0 versioning policy)**:

  - `spec/schemas/project-config.schema.json` description updated to point at
    `.skill-map/settings.json` and explicitly mention the `.local.json` partner
    and the layered-merge contract. The schema _shape_ (keys, types, validation
    rules) is unchanged — only the on-disk filename moves. Consumers that read
    values without caring about the source path are unaffected; consumers that
    hard-code the filename must update.
  - `spec/db-schema.md` §Scopes: `history.share: true` reference updated to
    `.skill-map/settings.json`.
  - `spec/conformance/coverage.md` row #6 description updated to reference the
    new path and the optional `settings.local.json` overlay.

  **Why minor (not major) at pre-1.0**: per `spec/versioning.md` §Pre-1.0,
  breaking changes ARE allowed in minor bumps while the spec is `0.y.z`. The
  shape of the data is unchanged; only the file name on disk moves.

  **No backward-compat shim**: there is no real implementation of the loader
  yet (lands in 6.2), so no live consumer reads `.skill-map.json` today. The
  only known prior reference is the demo `mock-collection/.claude/commands/init*.md`
  fixture, which is updated together with `sm init` in 6.5.

  **Runtime change**: none in 6.1 — pure spec edit. The matching loader,
  `sm init`, and `sm config` verbs land in subsequent sub-steps.

  **Roadmap update**: `ROADMAP.md` §Configuration "Spec migration" call-out
  flipped from "pending" to "landed Step 6.1, 2026-04-27".

  Test count: unchanged (213 → 213 — spec-only edit).

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

## 0.6.0

### Minor Changes

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

## 0.5.1

### Patch Changes

- 18d758a: Editorial pass across spec/ and src/ docs: convert relative-path text references (e.g. `plugin-kv-api.md`, `schemas/node.schema.json`) to proper markdown links, so they resolve on GitHub and in renderers. No normative or behavioural changes — prose, schemas, and CLI contract are unchanged.

## 0.5.0

### Minor Changes

- 69572fd: Align `spec/index.json` with the manifest changes declared in the `0.3.0` changelog (they had been documented but never written to the file), and fix two small referential drifts surfaced in the same audit pass.

  **`spec/index.json`** — closes the gap between what `0.3.0` notes promised and what actually shipped:

  - `specVersion` top-level field renamed to `indexPayloadVersion`. The old name collided semantically with `specPackageVersion` and with every other use of `specVersion` in the spec (compat logic, `scan-result.specVersion`, `sm help --format json`). `indexPayloadVersion` describes the shape of `index.json` itself and bumps only when this manifest's structure changes — pinned at `0.0.1` today. **This is the breaking rename already announced in the `0.3.0` release notes.**
  - `schemas.topLevel` gains `history-stats` (shape for `sm history stats --json`, already referenced from `cli-contract.md` §History and hashed under `integrity.files`).
  - New `schemas.extensions` subsection listing the 7 kind-manifest schemas (`base`, `adapter`, `detector`, `rule`, `action`, `audit`, `renderer`) — already required by `architecture.md` §Extension kinds for load-time manifest validation and already present under `schemas/extensions/`.

  **`spec/versioning.md` §Change process step 4** — the parenthetical `(see CLAUDE.md: "Every feature: update spec/ first, then src/")` was stale. `CLAUDE.md` has been a bare `@AGENTS.md` pointer since the 18d0c20 dedup; the rule itself lives in `AGENTS.md`. Reference fixed.

  **`spec/CHANGELOG.md` 0.3.0 entry** — text-only renumber of "decision #40a" → "decision #40". The sub-letter was a leftover from an unreleased draft; the roadmap Decision log uses `40` as the canonical anchor (see companion ROADMAP edit).

  Classification: minor per §Pre-1.0 (`0.Y.Z`). The `specVersion → indexPayloadVersion` rename is breaking for any consumer that read the old field, but the old name never shipped alongside a file that spelled it `indexPayloadVersion` — the rename is being applied here for the first time, not re-applied. The `topLevel`/`extensions` additions are purely additive.

### Patch Changes

- 2699276: Fix the extension-kind schemas so they actually validate against real extension manifests.

  The six kind schemas (`schemas/extensions/action.schema.json`, `adapter.schema.json`, `audit.schema.json`, `detector.schema.json`, `renderer.schema.json`, `rule.schema.json`) used `additionalProperties: false` together with `allOf: [{ $ref: "base.schema.json" }]` — a classic JSON Schema Draft 2020-12 footgun. `additionalProperties` is evaluated independently per schema in an `allOf`, so when a consumer validated `{ id, kind, version, emitsLinkKinds, defaultConfidence }` against `detector.schema.json`, detector's `additionalProperties: false` rejected `id` / `version` / `description` (defined only on `base`) and base's own `additionalProperties: false` would have rejected `emitsLinkKinds` / `defaultConfidence` — the union of both closures is empty. No real extension could ever pass validation.

  Discovered during Step 1b while wiring the AJV validators in `skill-map` (kernel plugin loader). The right fix is `unevaluatedProperties: false` — it sees through `allOf` composition and only rejects keys that no sibling schema declared.

  Changes:

  - Every kind schema: `additionalProperties: false` → `unevaluatedProperties: false` at the manifest level. Nested `additionalProperties: false` declarations inside `$defs` / `properties` were likewise replaced with `unevaluatedProperties: false` where they participate in `allOf` composition (e.g. `action.schema.json#/$defs/Parameter`, `audit.schema.json` nested items).
  - `extensions/base.schema.json`: closure removed entirely. Closed-content is now enforced only on the kind schemas, which see base's properties as "evaluated" through the `allOf` — adding closure to base too would force every kind to re-list every base key to stay valid.
  - `base.schema.json` description updated to spell out the new composition rule so a future reader does not accidentally re-introduce the footgun.

  Classification: patch. No normative shape changes — every manifest that was _supposed_ to pass under the old schemas still passes under the new ones, and the authored intent (closed content on kind manifests, additive base fields) is preserved. Consumers that never wired strict JSON Schema validation see zero behavioural change.

## 0.4.0

### Minor Changes

- 334c51a: Document `--all` as targeted fan-out, not a global flag, in `spec/cli-contract.md`.

  `--all` is valid only on verbs whose contract explicitly lists it:

  - `sm plugins enable <id> | --all` and `sm plugins disable <id> | --all`.
  - `sm job cancel <job.id> | --all` (cancels every `queued` and `running` job).
  - `sm job submit <action> --all` and `sm job run --all`.

  Unsupported `--all` usage is an operational error (exit `2`), the same as any other unknown or invalid flag.

  Classification: minor — targeted fan-out semantics are additive for the listed verbs, while avoiding a global flag contract.

- 3e89d8f: Audit-driven alignment pass. Multiple normative additions and a casing cleanup:

  - **Extension schemas**: add `spec/schemas/extensions/{base,adapter,detector,rule,action,audit,renderer}.schema.json` (7 new files). `architecture.md` §Extension kinds now points to them and mandates manifest validation at load time. Unblocks the "contract tests for the 6 kinds" invariant.
  - **Adapter `defaultRefreshAction`**: normatively required on every `Adapter` extension. Maps node `kind` → `actionId` and drives the UI's `🧠 prob` button. Previously mentioned only in ROADMAP (Decision #45); now part of the schema.
  - **Triple protection for mode B**: `db-schema.md` now specifies the exact order — parse → DDL validation → prefix injection → scoped connection. Validation runs **before** the rewrite so kernel-table references are caught under their authored names.
  - **Automatic rename heuristic**: new `db-schema.md` §Rename detection. On scan, `body_hash` match → high-confidence auto-rename with `state_*` FK migration; `frontmatter_hash` match → medium-confidence, same migration + `auto-rename-medium` issue; no match → orphan with issue. Replaces the prior "scan emits orphans, user runs `sm orphans reconcile` manually" flow.
  - **Skill agent envelope**: `job-events.md` now mandates a synthetic `r-ext-<ts>-<hex>` run envelope (`run.started mode=external` → `job.claimed` → `job.callback.received` → `job.completed|failed` → `run.summary`) around jobs claimed by a Skill agent without entering `sm job run`. Keeps the WebSocket broadcaster contract ("every job event inside a run envelope") intact across both runner paths.
  - **"Skill runner" → "Skill agent"**: `architecture.md` and `job-lifecycle.md` clarify that the Skill path is a peer driving adapter (alongside CLI and Server), NOT a `RunnerPort` implementation. Only `ClaudeCliRunner` and its test fake implement the port. Name was misleading; structure unchanged.
  - **Casing**: `db-schema.md` `auto_migrate` → `autoMigrate`; `README.md` prose mention `spec-compat` → `specCompat`. Brings prose into sync with the camelCase rule already enforced by the schemas.
  - **Coverage matrix**: new `spec/conformance/coverage.md` tracks each schema (and each non-schema normative artifact) against its conformance case. 28 schemas + 11 artifact invariants catalogued; 19 schemas and 10 artifacts flagged as missing, each with a step-blocker note. Release gate: v1.0.0 requires every row 🟢 or explicitly deferred.

  Classification: minor per §Pre-1.0 (`0.Y.Z`). The new required field `defaultRefreshAction` on the Adapter kind is technically breaking — no conforming Adapter ships in the reference impl yet, so the impact is zero. Post-1.0 the same change would be major.

### Patch Changes

- 93ffe34: Editorial pass: remove "MVP" terminology from four prose documents.

  The project shipped two competing readings of "MVP" — sometimes "`v0.5.0`", sometimes "the whole product through `v1.0`". That drift produced contradictions in companion docs (e.g. the summarizer pattern: was `v0.8.0` or `v0.5.0` supposed to ship them?). To close the ambiguity once, `ROADMAP.md` and `AGENTS.md` standardised on explicit versioned releases and `post-v1.0` in the same audit window. This change brings the four spec prose touches that still said "MVP" into the same vocabulary.

  - **`cli-contract.md` §Jobs**: `sm job run --all` description `(MVP: sequential)` → `(sequential through v1.0; in-runner parallelism deferred)`.
  - **`job-events.md` §Event catalog**: `(post-MVP)` parallel-run note → `(deferred to post-v1.0)`.
  - **`job-lifecycle.md` §Concurrency**: `MVP (v0.x): one job at a time.` → `Through v1.0 (spec v0.x): one job at a time.`
  - **`plugin-kv-api.md` §Backup and retention**: `sm plugins forget <id> (post-MVP)` → `sm plugins forget <id> (deferred to post-v1.0)`.

  Classification: patch. Editorial only — no schema, exit code, verb signature, or MUST/SHOULD statement changes meaning. All four replacements preserve the technical content; only the label changes from project-scoped ("MVP") to version-scoped (`v1.0`), which is the convention the rest of the spec already uses. Integrity block regenerated.

## 0.3.0

### Minor Changes

- 334c51a: Promote `--all` to a normative universal flag in `spec/cli-contract.md §Global flags`.

  Any verb that accepts a target identifier (`-n <node.path>`, `<job.id>`, `<plugin.id>`) MUST accept `--all` as "apply to every eligible target matching the verb's preconditions". Mutually exclusive with a positional target or `-n <path>` on the same invocation. Verbs that inherently target everything (`sm scan` without `-n`, `sm list`, `sm check`, `sm doctor`) accept the flag as a no-op for script-composition uniformity. Verbs where fan-out is nonsensical (`sm record`, `sm init`, `sm version`, `sm help`, `sm config get/set/reset/show`, `sm db *`, `sm serve`) MUST reject `--all` with exit `2`.

  Concretely extended in this pass:

  - `sm plugins enable <id> | --all` and `sm plugins disable <id> | --all`.
  - `sm job cancel <job.id> | --all` (cancels every `queued` and `running` job).

  Already normative before this change: `sm job submit <action> --all` and `sm job run --all`.

  Classification: minor — new global flag semantics, backward compatible (existing invocations without `--all` behave identically). ROADMAP Decision #60 stays as the canonical narrative; this changeset brings the spec into line with it.

- 3e89d8f: Audit-driven alignment pass. Multiple normative additions and a casing cleanup:

  - **Extension schemas**: add `spec/schemas/extensions/{base,adapter,detector,rule,action,audit,renderer}.schema.json` (7 new files). `architecture.md` §Extension kinds now points to them and mandates manifest validation at load time. Unblocks the "contract tests for the 6 kinds" invariant.
  - **Adapter `defaultRefreshAction`**: normatively required on every `Adapter` extension. Maps node `kind` → `actionId` and drives the UI's `🧠 prob` button. Previously mentioned only in ROADMAP (Decision #45); now part of the schema.
  - **Triple protection for mode B**: `db-schema.md` now specifies the exact order — parse → DDL validation → prefix injection → scoped connection. Validation runs **before** the rewrite so kernel-table references are caught under their authored names.
  - **Automatic rename heuristic**: new `db-schema.md` §Rename detection. On scan, `body_hash` match → high-confidence auto-rename with `state_*` FK migration; `frontmatter_hash` match → medium-confidence, same migration + `auto-rename-medium` issue; no match → orphan with issue. Replaces the prior "scan emits orphans, user runs `sm orphans reconcile` manually" flow.
  - **Skill agent envelope**: `job-events.md` now mandates a synthetic `r-ext-<ts>-<hex>` run envelope (`run.started mode=external` → `job.claimed` → `job.callback.received` → `job.completed|failed` → `run.summary`) around jobs claimed by a Skill agent without entering `sm job run`. Keeps the WebSocket broadcaster contract ("every job event inside a run envelope") intact across both runner paths.
  - **"Skill runner" → "Skill agent"**: `architecture.md` and `job-lifecycle.md` clarify that the Skill path is a peer driving adapter (alongside CLI and Server), NOT a `RunnerPort` implementation. Only `ClaudeCliRunner` and its test fake implement the port. Name was misleading; structure unchanged.
  - **Casing**: `db-schema.md` `auto_migrate` → `autoMigrate`; `README.md` prose mention `spec-compat` → `specCompat`. Brings prose into sync with the camelCase rule already enforced by the schemas.
  - **Coverage matrix**: new `spec/conformance/coverage.md` tracks each schema (and each non-schema normative artifact) against its conformance case. 28 schemas + 11 artifact invariants catalogued; 19 schemas and 10 artifacts flagged as missing, each with a step-blocker note. Release gate: v1.0.0 cut requires every row 🟢 or explicitly deferred.

  Classification: minor per §Pre-1.0 (`0.Y.Z`). The new required field `defaultRefreshAction` on the Adapter kind is technically breaking — no conforming Adapter ships in the reference impl yet, so the impact is zero. Post-1.0 the same change would be major.

- d41b9ae: Close two gaps surfaced in the audit pass: config keys that `ROADMAP.md` promised but `project-config.schema.json` did not declare, and WebSocket event families that `ROADMAP.md §UI` mentioned ("scan updates + issue changes") but `job-events.md` did not cover.

  **`project-config.schema.json` — new optional fields, all non-breaking:**

  - `autoMigrate: boolean` (default `true`) — auto-apply pending kernel + plugin migrations at startup after auto-backup. `false` → startup fails fast if migrations are pending.
  - `tokenizer: string` (default `cl100k_base`) — name of the offline tokenizer; stored alongside counts so consumers know which encoder produced them.
  - `scan.maxFileSizeBytes: integer` (default `1048576`) — files larger are skipped with an `info` log.
  - `jobs.ttlSeconds: integer` (default `3600`) — global fallback TTL when an action manifest omits `expectedDurationSeconds` (typically `mode: local` actions where the field is advisory).
  - `jobs.perActionPriority: { <actionId>: integer }` — per-action priority overrides. Frozen on `state_jobs.priority` at submit time; overrides action manifest `defaultPriority`; overridden by CLI `--priority`. Ratifies decision #40 in the schema.
  - `jobs.retention: { completed, failed }` — GC policy for `state_jobs` rows. Defaults: `completed = 2592000` (30 days), `failed = null` (never auto-prune; keep for post-mortem). `sm job prune` reads these; no implicit pruning during normal verbs.

  **`job-events.md` — new `Non-job events` section, Stability: experimental across v0.x:**

  - `scan.*`: `scan.started`, `scan.progress` (throttled ≥250 ms), `scan.completed`.
  - `issue.*`: `issue.added`, `issue.resolved` — emitted after `scan.completed` when the new scan's issue set differs from the previous one. Diff key: `(ruleId, nodeIds sorted, message)`.
  - Synthetic run ids follow the existing `r-<mode>-YYYYMMDD-HHMMSS-XXXX` pattern (`r-scan-...`, `r-check-...`) alongside `r-ext-...` for external Skill claims.

  These families ship at Step 13 of the reference impl alongside the WebSocket broadcaster. Marking them experimental keeps the shape mutable until real UI consumers exercise the stream; promotion to `stable` is a later minor bump.

  Classification: minor per §Pre-1.0. All additions are optional fields in a permissive config schema and new event types outside the stable job family — zero impact on existing implementations. Matching `ROADMAP.md` §Notable config keys and §Progress events updates land in the same change.

- d41b9ae: Align the frontmatter tools story with Claude Code's own conventions (the audit pass surfaced that the spec had `tools` on agent only and no equivalent for skills, while `ROADMAP.md` decision #55 referenced a non-existent `expected-tools` field).

  **`spec/schemas/frontmatter/base.schema.json` — two new top-level optional fields:**

  - `tools: string[]` — **allowlist**. When present, the host MUST restrict the node to exactly these tools. Matches Claude Code's subagent `tools` frontmatter. Kind-specific interpretation: an `agent` uses it to lock the spawned subagent; a `skill` uses it as a declarative hint (skills typically inherit their parent's tools, but the field is carried for parity and discovery); other kinds use it as information only.
  - `allowedTools: string[]` — **pre-approval**. Tools the host MAY use without per-use permission prompts while the node is active. Distinct from `tools`: every other tool remains callable, governed by the host's normal permission settings. Matches Claude Code's skill `allowed-tools` frontmatter. Accepts argument-scoped patterns where the host supports them (e.g. `Bash(git add *)`).

  **`spec/schemas/frontmatter/agent.schema.json`:** `tools` removed from the kind-specific body because it now lives on `base` and is inherited via `allOf`. The agent schema's title/description updated to reflect that only `model` remains kind-specific. Consumers reading `tools` from an agent frontmatter see no behavioural change — the field is still there, just sourced from `base`.

  `expectedTools` on `extensions/action.schema.json` is unchanged. That field is a hint from an action template to the runner (which tools the rendered prompt expects access to) — a distinct semantics from the node-level `tools` / `allowedTools` pair, and the name difference preserves the distinction.

  Classification: minor per §Pre-1.0. Additions to `base` are optional fields in a permissive schema (no break for existing frontmatter). Removing `tools` from the agent schema's own properties is compatible because `allOf: [base]` continues to supply it — any document that validated before still validates, any document that used `additionalProperties: true` is unaffected. Matching `ROADMAP.md` updates (§Frontmatter standard, decision #55) land in the same change.

- 5935948: Add `sm history stats` schema and normative elapsed-time reporting.

  - **New schema** `spec/schemas/history-stats.schema.json`. Shape for `sm history stats --json`: `range` (configurable via `--since` / `--until`), `totals`, `tokensPerAction[]`, `executionsPerPeriod[]` (granularity via `--period day|week|month`, default `month`), `topNodes[]` (length via `--top N`, default 10), `errorRates` (global + per-action + per failure reason — all failure-reason enum values always present with `0` when unseen for predictable dashboards), and top-level `elapsedMs`. Duration stats in `tokensPerAction[]`: `durationMsMean` + `durationMsMedian` for MVP; percentiles deferred to a later minor bump.
  - **cli-contract.md §Elapsed time** (new normative section). Every verb that does non-trivial work MUST report its own wall-clock:
    - **Pretty (stderr)**: last line `done in <formatted>` where `<formatted>` ∈ `{ <N>ms | <N.N>s | <M>m <S>s }`. Suppressed by `--quiet`.
    - **JSON stdout**: top-level `elapsedMs` when the shape is an object; schemas whose shape is an array or ndjson don't carry it (stderr is the sole carrier).
    - **Exempt** verbs (sub-millisecond, informational): `sm --version`, `sm --help`, `sm version`, `sm help`, `sm config get`, `sm config list`, `sm config show`.
    - Measurement spans from after arg-parsing to before terminal write.
  - **cli-contract.md** `sm history stats` entry: flags enumerated (`--since`, `--until`, `--period`, `--top`) and schema referenced.
  - **Coverage matrix**: row `29` for `history-stats.schema.json` (blocked by Step 5); artifact row `L` for the elapsed-time reporting invariant (blocked by Step 4).

  Classification: minor per §Pre-1.0. The elapsed-time contract introduces a SHOULD-emit line that didn't exist before — no existing consumer breaks, and the line goes to stderr where it doesn't clash with stdout JSON.

- 1455cb1: Normative `priority` for jobs.

  The `state_jobs.priority` column (INTEGER, default `0`) existed in the schema and was used by the atomic-claim SQL (`ORDER BY priority DESC, createdAt ASC`), but no surface let the user set it. This release closes the gap:

  - **`cli-contract.md` §Jobs**: new flag `sm job submit ... --priority <n>`. Integer; higher runs first; default `0`; negatives permitted (deprioritize).
  - **`job-lifecycle.md` §Submit**: new step 6 resolving priority with precedence `action manifest defaultPriority → user config jobs.perActionPriority.<actionId> → flag`. The resolved value is frozen on submit and immutable for the life of the job. Ties in the claim order break by `createdAt ASC`.
  - Configuration key `jobs.perActionPriority.<actionId>`: optional per-action integer override.
  - Action manifest `defaultPriority`: optional integer; defaults to `0` when omitted.

  Classification: minor per `cli-contract.md` §Stability ("adding a flag is a minor bump"). No existing consumer breaks: jobs submitted before this release default to `0`, which is the identity element of the ordering. The claim SQL already read `priority`, so the wire protocol is unchanged.

- 1455cb1: Manifest alignment pass on `spec/index.json`: expose already-normative schemas, rename the payload-shape field, and add a stable version field consumers can rely on.

  - **Rename `specVersion` → `indexPayloadVersion`** (breaking). The old name collided semantically with every other use of `specVersion` (compat logic in `versioning.md`, `scan-result.specVersion`, `sm help --format json`). The field describes the shape of `index.json` itself, not the spec a caller implements.
  - **New `specPackageVersion`** top-level field, auto-populated by `scripts/build-spec-index.mjs` from `spec/package.json.version`. This is the source of truth for "which `@skill-map/spec` release is this", previously missing from the manifest — consumers had to read `package.json` separately, and `sm version` was incorrectly reporting the payload-shape version as the spec version.
  - **`schemas.topLevel`** gains `history-stats` (shape for `sm history stats --json`, already referenced in `cli-contract.md` §History).
  - **New `schemas.extensions` subsection** lists the 7 kind-manifest schemas (`base`, `adapter`, `detector`, `rule`, `action`, `audit`, `renderer`) already required by `architecture.md` §Extension kinds for load-time manifest validation.
  - **CHANGELOG fix** on the `[Unreleased]` v0.1.0 line: "10 event types" → "11 canonical event types plus one synthetic `emitter.error`". Text-only correction on a shipped release.
  - **README example** updated to show both fields side-by-side so the distinction is obvious to first-time consumers.
  - **Integrity block** regenerated.

  No schema contents change. The schema files and their normative status are unchanged since 0.1.0; the index now enumerates them all and uses unambiguous field names.

  **Migration for consumers**: any caller that reads `specIndex.specVersion` MUST switch to `specIndex.specPackageVersion` (for the release) or `specIndex.indexPayloadVersion` (for the manifest shape). The rename is the source of the `minor` bump rather than `patch` — pre-1.0 minors MAY contain breaking changes per `versioning.md` §Pre-1.0.

  Classification: minor per §Pre-1.0. One breaking rename + two additive fields + two additive schema subsections. The reference impl's `sm version` is updated in the same release to read `specPackageVersion`, so `sm version` now reports the actual npm package version (was the payload-shape version, a latent bug).

- 1455cb1: New CLI verb `sm orphans undo-rename <new.path> [--force]` to reverse a medium-confidence auto-rename.

  The scan's rename heuristic (added in the previous spec release) migrates `state_*` FKs automatically when a deleted path and a newly-seen path share the same `frontmatter_hash` ("medium" confidence, body differs) and emits an `auto-rename-medium` issue for the user to verify. Until now the spec said "revert via `sm orphans reconcile --to <old.path>`", but `sm orphans reconcile` is defined for the forward direction (orphan path → live node) and awkward for the reverse case where both paths exist.

  This release closes the gap with a dedicated reverse verb:

  - **`cli-contract.md` §Browse**: new row `sm orphans undo-rename <new.path> [--force]`. Requires an active `auto-rename-medium` or `auto-rename-ambiguous` issue targeting `<new.path>`. Reads the prior path from `issue.data_json.from`, migrates `state_*` FKs back, resolves the issue. Exit `5` if no matching active issue.
  - **`db-schema.md` §Rename detection**: issue payload now normative.
    - `auto-rename-medium.data_json` MUST include `{ from, to, confidence: "medium" }`.
    - `auto-rename-ambiguous.data_json` MUST include `{ to, candidates: [from_a, from_b, ...] }`. `sm orphans undo-rename` requires `--from <old.path>` to pick one.
  - **Destructive verb**: prompts for confirmation unless `--force`. After undo, the prior path becomes an `orphan` (file no longer exists), emitting the normal `orphan` issue on next scan.

  Rationale: dedicated name makes intent clear (forward = reconcile, reverse = undo-rename), failure is early (no active issue → immediate exit 5 with a helpful message), and the user does not re-type paths the kernel already knows.

  Classification: minor per `cli-contract.md` §Stability ("adding a verb is a minor bump"). No existing behavior changes; `sm orphans reconcile` semantics are unaffected.

- 334c51a: **Breaking**: rename two state-zone tables to comply with the normative plural rule in `db-schema.md §Naming conventions`.

  - `state_enrichment` → `state_enrichments`
  - `state_plugin_kv` → `state_plugin_kvs`

  Index names renamed in lockstep:

  - `ix_state_enrichment_stale_after` → `ix_state_enrichments_stale_after`
  - `ix_state_plugin_kv_plugin_id` → `ix_state_plugin_kvs_plugin_id`

  The two tables were the only kernel-owned state-zone tables violating the rule "Tables: `snake_case`, plural" — every other catalog entry (`state_jobs`, `state_executions`, `state_summaries`, `config_plugins`, `config_preferences`, `config_schema_versions`, `scan_nodes`, `scan_links`, `scan_issues`) was already plural. The exceptions were historical drift, not intentional.

  Updated spec artefacts:

  - `spec/db-schema.md` — table section headings, column comments, primary-key footers, index names, and the cross-reference list in §Rename heuristic.
  - `spec/cli-contract.md` — `sm db reset --state` row in §Database.
  - `spec/plugin-kv-api.md` — §Overview opener and every downstream reference.
  - `spec/schemas/plugins-registry.schema.json` — description of the `kv` mode `const`.

  **Migration for implementations**: no reference implementation has shipped the SQLite adapter yet (Step 1a lands it), so this is a rename-on-paper change. Any future kernel migration that creates these tables MUST use the plural names. Any third-party implementation already experimenting with the spec against the old names MUST rename before targeting `@skill-map/spec ≥ 0.3.0`.

  Classification: **minor with breaking change**, per `spec/versioning.md §Pre-1.0` which allows breaking changes on minor bumps while the spec is `0.y.z`. Reference-impl touch: `src/kernel/ports/plugin-loader.ts` comment updated; no code paths read these names at runtime yet.

  Companion prose updates in `ROADMAP.md` (§Persistence, §Plugin system, §Enrichment, §Summarizer pattern, Decision #61) and `AGENTS.md` (§Persistence).

- 93ffe34: Clean up `history.*` in `spec/schemas/project-config.schema.json`.

  **Breaking (pre-1.0 minor per `versioning.md` §Pre-1.0):**

  - **Remove** `history.retentionDays`. The field promised execution-record GC, but `ROADMAP.md` §Step 7 and the job-retention section make it explicit that `state_executions` is append-only in `v0.1` and that the kernel does not use this key. Declaring a config key whose behaviour is "silently ignored" is worse than not declaring it — consumers would wire it in and never see an effect. The field will be re-introduced in a later minor bump when the GC path actually lands, with a concrete default and enforcement semantics.

  **Editorial:**

  - `history.share.description` mentioned `./.skill-map/history.json` — an artefact of the pre-SQLite architecture. The actual DB is `./.skill-map/skill-map.db` (see `db-schema.md` §Scope and location). Description corrected; field itself unchanged.

  Classification: minor per §Pre-1.0 (`0.Y.Z` may contain breaking changes in a minor bump). Integrity block regenerated via `npm run spec:index`. Companion prose in `ROADMAP.md §Notable config keys` updated in the same change.

  **Migration for consumers**: any `.skill-map.json` that set `history.retentionDays` will now fail schema validation (`additionalProperties: false` on `history`). Remove the key; no kernel behaviour changes because nothing was consuming it.

- 93ffe34: Promote the trigger-normalization pipeline (Decision #21) from implicit to normative in `spec/architecture.md`.

  Before this change, `link.trigger` carried `originalTrigger` and `normalizedTrigger` fields (defined in `schemas/link.schema.json`), and the `trigger-collision` rule keyed on the normalized value — but no spec prose documented **how** to normalize. The pipeline lived only in `AGENTS.md §Decisions already locked` and in `ROADMAP.md` as a one-line Step 7 bullet. That left implementations free to diverge, which silently breaks the `trigger-collision` rule across implementations (two conforming CLIs could disagree on whether `hacer-review` and `Hacer Review` collide).

  Added under `architecture.md §Extension kinds`, paralleling the existing `Adapter · defaultRefreshAction` subsection:

  - **Detector · trigger normalization** — field contract, normative 6-step pipeline, and 8 worked examples.

  Pipeline (applied in exactly this order):

  1. Unicode NFD.
  2. Strip Unicode `Mn` (diacritics).
  3. Lowercase (locale-independent).
  4. Separator unification: hyphen / underscore / any whitespace run → single ASCII space.
  5. Collapse whitespace (run of ≥2 spaces → 1 space).
  6. Trim leading/trailing whitespace.

  Non-letter / non-digit characters outside the separator set (`/`, `@`, `:`, `.`, etc.) are **preserved** — stripping them is the detector's concern, not the normalizer's. This keeps namespaced invocations (`/skill-map:explore`, `@my-plugin/foo`) comparable in their intended form.

  §Stability in `architecture.md` updated: adding a new step at the end is a minor bump; reordering, removing, or changing any existing step (including the character classes in step 4) is a major bump. Implementations that produce different `normalizedTrigger` output for equivalent input are non-conforming.

  Classification: minor. The pipeline was always the intent (Decision #21 existed since the 2026-04-19 session) and `schemas/link.schema.json` already carried the fields, but this is the first time the spec prose binds implementations to a specific algorithm. A strict v0 implementation that did not normalize (or normalized differently) would begin failing conformance at the next spec release; worth a minor bump so plugin authors and alternative impls see it in the changelog.

  Companion prose in `ROADMAP.md §Trigger normalization` (Decision #21 now points here for full rationale + examples).

### Patch Changes

- 334c51a: Clarify `sm orphans undo-rename` signature in `spec/cli-contract.md §Browse` by surfacing the `[--from <old.path>]` flag in the command cell itself.

  The flag was already documented prose-only in `spec/db-schema.md §Rename heuristic` ("`auto-rename-ambiguous` issues ... `sm orphans undo-rename` requires the user to pass `--from <old.path>` to disambiguate") but was absent from the signature in the `cli-contract.md` table. A reader consulting only the CLI contract would miss the flag and assume the command took `<new.path>` alone.

  The row now:

  - Shows `[--from <old.path>] [--force]` in the signature.
  - Explicitly distinguishes the `auto-rename-medium` case (omit `--from`, previous path read from `issue.data_json`) from `auto-rename-ambiguous` (REQUIRES `--from` to pick from `data_json.candidates`).
  - Adds an exit-`5` condition for `--from` referencing a path not in `candidates`.

  No behavioural change — the flag was already normative and implementations were already expected to support it. Classification: patch (clarifying drift between two spec prose docs, not a new capability).

- 93ffe34: Split `sm db reset` into three explicit levels of destruction, each with distinct semantics.

  Before: `sm db reset` dropped BOTH `scan_*` and `state_*` in one command — so a user who wanted "please rescan from scratch" would wipe their job history, summaries, enrichment, and plugin KV data. The "reset" name suggested a soft operation; the behavior was aggressive.

  After:

  - `sm db reset` — drops `scan_*` only. Keeps `state_*` and `config_*`. Non-destructive, no prompt. Equivalent to asking for a fresh scan.
  - `sm db reset --state` — also drops `state_*` and every `plugin_<normalized_id>_*` table (mode B) plus `state_plugin_kvs` (mode A). Keeps `config_*`. Destructive; requires confirmation unless `--yes` (or `--force`, kept as an alias).
  - `sm db reset --hard` — deletes the DB file entirely. Keeps the plugins folder on disk. Destructive; requires confirmation unless `--yes`.

  Updated files:

  - `spec/cli-contract.md` §Database — new table rows and a rewritten confirmation paragraph.
  - `spec/db-schema.md` §Zones — one-liner rewritten to list all three levels.
  - `spec/plugin-kv-api.md` §Scope and lifecycle — three bullets replacing the single prior bullet, explicit about which reset level touches plugin storage.

  Classification: patch in intent but **behavior-changing for `sm db reset` without modifier**. Implementations of `v0.x` that currently drop `state_*` on `sm db reset` MUST narrow the behavior; users relying on the old "reset = wipe everything below config" workflow must switch to `sm db reset --state`. Classified as patch because the spec is pre-1.0 and no implementation has shipped the CLI yet (Step 1a lands storage + the `sm db *` verbs together — this is the first time the boundary is normative in code).

  Companion prose updates in `ROADMAP.md` §DB management commands and §Step 1a acceptance list.

- 93ffe34: Editorial pass: remove "MVP" terminology from four prose documents.

  The project shipped two competing readings of "MVP" — sometimes "CUT 1 / `v0.5.0`", sometimes "the whole product through `v1.0`". That drift produced contradictions in companion docs (e.g. the summarizer pattern: was `v0.8.0` or `v0.5.0` supposed to ship them?). To close the ambiguity once, `ROADMAP.md` and `AGENTS.md` standardised on `CUT 1` / `CUT 2` / `CUT 3` and `post-v1.0` in the same audit window. This change brings the four spec prose touches that still said "MVP" into the same vocabulary.

  - **`cli-contract.md` §Jobs**: `sm job run --all` description `(MVP: sequential)` → `(sequential through v1.0; in-runner parallelism deferred)`.
  - **`job-events.md` §Event catalog**: `(post-MVP)` parallel-run note → `(deferred to post-v1.0)`.
  - **`job-lifecycle.md` §Concurrency**: `MVP (v0.x): one job at a time.` → `Through v1.0 (spec v0.x): one job at a time.`
  - **`plugin-kv-api.md` §Backup and retention**: `sm plugins forget <id> (post-MVP)` → `sm plugins forget <id> (deferred to post-v1.0)`.

  Classification: patch. Editorial only — no schema, exit code, verb signature, or MUST/SHOULD statement changes meaning. All four replacements preserve the technical content; only the label changes from project-scoped ("MVP") to version-scoped (`v1.0`), which is the convention the rest of the spec already uses. Integrity block regenerated.

- 93ffe34: Refresh the `spec/README.md` §Repo layout tree so it matches reality.

  The previous tree was frozen at the Step 0a snapshot and listed only 20 schemas (9 top-level + 6 frontmatter + 5 summaries) plus outdated `(Step 0a phase N)` annotations. The actual spec ships 29 schemas (11 top-level + 7 extension + 6 frontmatter + 5 summaries) and the package adds `index.json` and `package.json`.

  Changes:

  - Show the full set of 29 JSON Schemas with a brace grouping per bucket, making the counts and the `allOf` inheritance (frontmatter kinds → base; summaries → report-base) legible at a glance.
  - Add the missing top-level schemas `conformance-case.schema.json` and `history-stats.schema.json`.
  - Add the whole `schemas/extensions/` folder (base + one per extension kind) — validated at plugin load.
  - List `package.json` and `index.json` explicitly so external readers know they are published assets.
  - Drop `(Step 0a phase N)` annotations — Step 0a is complete, the marker is noise.
  - Under `conformance/cases/`, note `basic-scan` and `kernel-empty-boot` as the two shipped cases and point at `../ROADMAP.md` for the deferred `preamble-bitwise-match` case.
  - Under `interfaces/`, clarify that `security-scanner.md` is a convention over the Action kind, NOT a 7th extension kind — the six kinds remain locked.

  Classification: patch. Editorial prose only — no normative schema, rule, or contract changes. Companion updates to `ROADMAP.md` (repo layout + package layout) ship alongside; they are outside the spec package and do not need a changeset.

- d41b9ae: Promote the casing rule from implicit (stated only in `CHANGELOG.md` §Conventions locked and in individual schema descriptions) to explicit, with a new **Naming conventions** section in `spec/README.md`. Two rules, both normative:

  - **Filesystem artefacts in kebab-case**: every file, directory, enum value, and `issue.ruleId` value. Values stay URL/filename/log-key safe without escaping.
  - **JSON content in camelCase**: every key in schemas, frontmatter, configs, manifests, job records, reports, event payloads, API responses. The SQL layer (`snake_case`) is the sole exception, bridged by the storage adapter.

  Companion alignment in `spec/db-schema.md` §Rename detection: the prose mixed column names (`body_hash`, `frontmatter_hash`, `rule_id`, `data_json`) with domain-object references. The heuristic is specified against the domain types (`bodyHash`, `frontmatterHash`, `ruleId`, `data`) as defined in `node.schema.json` / `issue.schema.json`; the SQLite columns are the storage shape, not the contract. Added a one-line casing note that points back to §Naming conventions so the bridge is explicit.

  Classification: patch. The rule itself is unchanged — it was already enforced by every shipped schema and repeated in `CHANGELOG.md`. The additions are purely documentary so new implementers find the rule without digging through the changelog, and so the rename-detection prose stops looking like it references SQLite-specific identifiers when it means domain-object fields.

- 93ffe34: Clarify the TTL resolution procedure in `spec/job-lifecycle.md`.

  The previous text defined the formula as `ttlSeconds = max(expectedDurationSeconds × graceMultiplier, minimumTtlSeconds)` and said the precedence chain was `global default → manifest → user config → flag`. Two problems:

  - When `expectedDurationSeconds` is absent from the manifest (typical for `mode: local` actions), the formula is undefined. The existing config key `jobs.ttlSeconds` was documented elsewhere as a "global fallback" but never tied into the formula.
  - The word "precedence" collapsed three distinct mechanisms — base value selection, formula application, and full override — into one list, so `minimumTtlSeconds` (a floor, never a default) appeared as the first entry of a "later wins" chain.

  This patch rewrites the §TTL precedence section as §TTL resolution, split into three explicit steps:

  1. **Base duration**: manifest `expectedDurationSeconds` OR config `jobs.ttlSeconds` (default `3600`).
  2. **Computed TTL**: `max(base × graceMultiplier, minimumTtlSeconds)`.
  3. **Overrides** (later wins, skips formula): `jobs.perActionTtl.<actionId>`, then `--ttl` flag.

  Five worked examples added. Negative / zero overrides are rejected at submit time (exit 2). A Stability note states the procedure is locked going forward — new override sources are minor, formula-shape changes are major. The §Submit checklist step 5 now references the new §TTL resolution section instead of inlining a broken one-liner.

  Classification: patch. No field or schema changed. Every existing manifest and config combination resolves to the same TTL except for the previously-undefined case (manifest without `expectedDurationSeconds`), which was silently implementation-defined; the new text makes the `jobs.ttlSeconds` fallback normative. Companion prose updates land in `ROADMAP.md §TTL per action` and §Notable config keys.

## 0.2.1

### Patch Changes

- b827431: Clarify the comment in `spec/README.md` §"Use — load a schema": `specIndex.specVersion` is the payload shape version baked into `index.json`, not the npm package version. The two may drift — bumping the npm package does not bump `specVersion` unless the shape of `index.json` itself changes.

## 0.2.0

### Minor Changes

- 79aed4d: **Breaking**: rename `dispatch-lifecycle.md` → `job-lifecycle.md`.

  ROADMAP decision #30 renamed the domain term "dispatch" to "job" (tables `state_jobs`, artifact "job file"). The spec prose filename had lagged behind; this change closes that gap.

  All internal references updated: `architecture.md`, `cli-contract.md`, `db-schema.md`, `prompt-preamble.md`, `versioning.md`, `schemas/job.schema.json`, `README.md`, and `package.json` `files` list. `index.json` regenerated.

  **Migration**: any external consumer that links to `spec/dispatch-lifecycle.md` (by URL or filename) MUST update to `spec/job-lifecycle.md`. The canonical URL becomes `https://skill-map.dev/spec/v0/job-lifecycle.md`.

  Classification: breaking change on a normative prose doc. Per `versioning.md` §Pre-1.0, minor bumps MAY contain breaking changes while the spec is `0.Y.Z`.

## 0.1.2

### Patch Changes

- f4214fe: Expand `spec/README.md` §Distribution with concrete install and usage snippets now that `@skill-map/spec` is live on npm: install command, loading a schema via `exports`, and a small integrity-verification example using the `index.json` sha256 block.

## 0.1.1

### Patch Changes

- bc0b217: Update `spec/conformance/README.md` wording: drop the "v0.1.0-alpha.0" label (we shipped `0.1.0`), and reflect that the suite now carries two cases (`basic-scan`, `kernel-empty-boot`) with a shared `minimal-claude` fixture.

## 0.1.0

### Minor Changes

- 5b3829a: Add conformance case `kernel-empty-boot`:

  - New file: `spec/conformance/cases/kernel-empty-boot.json`.
  - Exercises the boot invariant from `architecture.md`: with every adapter, detector, and rule disabled, scanning an empty scope MUST return a valid `ScanResult` with `schemaVersion: 1` and zero-filled stats.
  - Referenced in `conformance/README.md` (§"Cases explicitly referenced elsewhere in the spec"). Entry moved from "pending" to "current" in the case inventory.
  - Registered in `spec/index.json` and the integrity block (SHA256 regenerated).

  The second pending case, `preamble-bitwise-match`, is deferred to Step 10 (requires `sm job preview` from the job subsystem).

- 4e0aec4: Initial public spec surface (`v0.1.0`):

  - 21 JSON Schemas (draft 2020-12): 10 top-level, 6 frontmatter, 5 summaries.
  - 7 prose contracts (architecture, cli-contract, dispatch-lifecycle, job-events, prompt-preamble, db-schema, plugin-kv-api).
  - 1 interface doc (security-scanner).
  - Conformance stub: `basic-scan` case, `minimal-claude` fixture, verbatim `preamble-v1.txt`.
  - Machine-readable `index.json` with integrity hashes per file.

  This is the first tagged release of the skill-map specification.

Changelog for the **skill-map specification**, tracked independently from the reference CLI. See `versioning.md` for the policy that governs what constitutes a patch / minor / major change.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) as refined in `versioning.md`.

Each entry classifies changes into four sections:

- **Added** — new optional fields, schemas, or contracts.
- **Changed** — modifications to existing normative content. Breaking changes are called out explicitly.
- **Deprecated** — features scheduled for removal in a future major.
- **Removed** — features removed in a major bump.

Tag convention: `spec-vX.Y.Z` (distinct from CLI tags `cli-vX.Y.Z`).

---

## [Unreleased]

Initial public spec bootstrap (Step 0a phases 1–3).

### Added

- `cli-contract.md` — new normative section **§Dry-run** between §Exit codes and §Verb catalog. Codifies the contract every verb that exposes `-n` / `--dry-run` MUST honour: no observable side effects (DB / FS / config / network / spawns), no auto-provisioning of scope directories, output mirrors live mode with explicit "would …" framing, exit codes mirror live mode, dry-run MUST short-circuit `--yes` / `--force` confirmation prompts. Per-verb opt-in: the flag is not global and verbs that don't declare it MUST reject it as an unknown option (exit `2`). Verb catalog rows for `sm init`, `sm db reset` (default + `--state` + `--hard`), and `sm db restore` amended to declare and describe their `--dry-run` previews. Pre-1.0 minor (additive normative).
- `plugin-author-guide.md` — consolidated section on the three-tier frontmatter validation model (default permissive `additionalProperties: true` + always-active `unknown-field` rule emitting `warn` + `scan.strict` / `--strict` promoting warnings to `error`). Includes a worked example through all three tiers and an explicit note on why no "schema-extender" plugin kind exists (the path for custom validation is a deterministic Rule, not a new plugin kind). Editorial only. No normative change — the model already exists implicitly via `base.schema.json`'s permissive `additionalProperties` and `project-config.schema.json#/properties/scan/properties/strict`. Patch.
- `PluginManifest` gains optional `granularity` field (enum `bundle` / `extension`, default `bundle`). Built-in `claude` bundle is `granularity: bundle` (toggle the whole bundle); built-in `core` bundle is `granularity: extension` (each built-in toggle-able individually under `core/<ext-id>`). `sm plugins enable / disable` validates the supplied id against the bundle's declared granularity (bundle granularity rejects qualified ids; extension granularity rejects bare bundle ids) and persists in `config_plugins` with the appropriate key. `--all` operates only on bundle-granularity plugin ids; the "disable every kernel built-in" intent is served by `--no-built-ins`. `plugin-author-guide.md` adds a §Granularity — bundle vs extension section with the per-verb behaviour table and the built-in mapping; `architecture.md` §`PluginLoaderPort` documents the runtime split (loader's pre-import resolveEnabled is coarse / bundle-level; the CLI's runtime composer drops per-extension disabled extensions before they reach the orchestrator). Closes the spec-vs-impl drift between the spec promise that "no extension is privileged, removable" and the prior implementation where built-ins were always-on. Pre-1.0 minor per `versioning.md` § Pre-1.0; additive on the manifest schema, breaking only for users who relied on the `claude` adapter loading without an explicit `config_plugins` row (none today, since the row had no effect on built-ins before).
- Detector manifest gains optional `applicableKinds` filter (array, `minItems: 1`, kebab-case strings, `uniqueItems: true`). When declared, the kernel skips invocation for nodes whose `kind` is not in the list — fail-fast, before the detect context is built, so a probabilistic detector wastes zero LLM cost (and a deterministic detector zero CPU) on inapplicable nodes. Absent = applies to every kind (the default); no wildcard syntax. Empty array `[]` is rejected at load time. Unknown kinds (no installed Adapter declares them via `defaultRefreshAction`) load OK with a `sm plugins doctor` warning — the Provider may arrive later — and the doctor exit code is NOT promoted by the warning. `plugin-author-guide.md` adds a §Detector `applicableKinds` — narrow the pipeline section under Granularity with the per-shape behaviour table and a worked example; `architecture.md` adds a §Detector · `applicableKinds` filter subsection above trigger normalization; `schemas/extensions/detector.schema.json` declares the new property. Pre-1.0 minor per `versioning.md` § Pre-1.0; additive, non-breaking for existing detectors (they all behave as if `applicableKinds: undefined`).

### Changed

- `cli-contract.md`: `--all` is no longer a global flag. It is valid only on verbs that explicitly document fan-out semantics: `sm job submit`, `sm job run`, `sm job cancel`, and `sm plugins enable/disable`.
- `cli-contract.md`: `sm scan compare-with <dump> [roots...]` is now a sub-verb instead of a `--compare-with <path>` flag on `sm scan`. Read-only delta report against a saved `ScanResult` JSON dump. Same exit codes (`0` empty delta / `1` drift / `2` operational error). Old flag form removed. Pre-1.0 breaking change shipped as minor per `versioning.md` § Pre-1.0.
- Plugin discovery — directory name MUST equal manifest id (else `invalid-manifest`); cross-root id collisions yield new `id-collision` status (sixth status, both collided plugins blocked, no precedence). `plugin-author-guide.md` Diagnostics table grows from five to six rows; `architecture.md` §`PluginLoaderPort` documents the two enforcement points; `schemas/plugins-registry.schema.json#/$defs/DiscoveredPlugin/status` adds `id-collision` to the enum. Pre-1.0 minor per `versioning.md` § Pre-1.0; breaking for any plugin whose directory name does not match its manifest id, but no real ecosystem affected today.
- Plugin extensions are now identified by qualified ids `<plugin-id>/<extension-id>`. Built-in extensions adopt the `core/` namespace; the Claude adapter and its kind-aware detectors (frontmatter, slash, at-directive) live under `claude/`. The loader injects `pluginId` from `plugin.json#/id` into every extension at load time; an explicit `pluginId` field on an extension that disagrees with the manifest id is `invalid-manifest`. `architecture.md` §`PluginLoaderPort` documents the qualifier composition; `plugin-author-guide.md` adds a §Qualified extension ids section with the built-in mapping table; `schemas/extensions/base.schema.json` clarifies that extension `id` stays unqualified (single kebab-case segment, no `/`); `schemas/extensions/adapter.schema.json#/properties/defaultRefreshAction` now requires qualified action ids (pattern `^<plugin-id>/<action-id>$`). Pre-1.0 minor per `versioning.md` § Pre-1.0; breaking for any plugin or test that referenced an extension by short id.
- `cli-contract.md`: exit-code `2` "Operational error" row clarified to mention runtime / environment mismatches (wrong Node version, missing native dependency) explicitly. The "unhandled exception" catch-all already covered the case; this just removes ambiguity for future implementers.
- `job-events.md`: the common `runId` envelope now explicitly documents the optional mode segment (`r-<mode>-YYYYMMDD-HHMMSS-XXXX`) used by external Skill claims, scan runs, and standalone issue recomputations.
- `versioning.md` and related prose: replace ambiguous milestone terminology with explicit versioned release language.

### Added

- Foundation:
  - `README.md` — human-readable introduction and repo layout.
  - `versioning.md` — evolution policy, stability tags, 3-minor deprecation window.
  - `CHANGELOG.md` — this file.
- JSON Schemas (21 files, all draft 2020-12, camelCase keys):
  - Top-level (10): `node`, `link`, `issue`, `scan-result`, `execution-record`, `project-config`, `plugins-registry`, `job`, `report-base`, `conformance-case`.
  - Frontmatter (6): `base` + per-kind `skill` / `agent` / `command` / `hook` / `note`. Per-kind schemas extend `base` via `allOf`.
  - Summaries (5): per-kind `skill` / `agent` / `command` / `hook` / `note`. All extend `report-base` via `allOf`.
- Prose contracts:
  - `architecture.md` — hexagonal ports & adapters; 5 ports (`StoragePort`, `FilesystemPort`, `PluginLoaderPort`, `RunnerPort`, `ProgressEmitterPort`); 6 extension kinds (Adapter, Detector, Rule, Action, Audit, Renderer); kernel boundary + forbidden/permitted imports.
  - `cli-contract.md` — CLI surface: global flags, env vars, 30+ verbs (`sm init`, `sm scan`, `sm list`, `sm show`, `sm check`, `sm findings`, `sm graph`, `sm export`, `sm job *`, `sm record`, `sm history`, `sm plugins *`, `sm audit *`, `sm db *`, `sm serve`, `sm help`), exit codes (0–5 defined, 6–15 reserved), `--json` output rules, `--format json|md|human` introspection.
  - `dispatch-lifecycle.md` — job state machine (queued → running → completed | failed), atomic claim (`UPDATE ... RETURNING id`), duplicate prevention via `contentHash`, TTL with auto-reap, nonce authentication for `sm record`, sequential concurrency for MVP, retention and GC.
  - `job-events.md` — canonical event stream: envelope (`type`, `timestamp`, `runId`, `jobId`, `data`), 11 canonical event types (`run.started`, `run.reap.started`, `run.reap.completed`, `job.claimed`, `job.skipped`, `job.spawning`, `model.delta`, `job.callback.received`, `job.completed`, `job.failed`, `run.summary`) plus one synthetic error event (`emitter.error`, emitted only on serialization failure), three output adapters (`pretty`, `stream-output`, `json`), ordering rules.
  - `prompt-preamble.md` — verbatim normative preamble text that the kernel prepends to every rendered job file; `<user-content id="...">` delimiter contract with zero-width-space escaping; `safety` + `confidence` contract on model output; conformance fixture at `conformance/fixtures/preamble-v1.txt`.
  - `db-schema.md` — engine-agnostic table catalog: three zones (`scan_*`, `state_*`, `config_*`), naming conventions (snake*case, zone prefix, `_at` / `_ms` / `_hash` / `_json` / `_count` suffixes, `is*`/`has\_` prefixes), kernel table list per zone, migration rules (`.sql`files,`NNN_snake_case.sql`, up-only, auto-backup), plugin storage modes.
  - `plugin-kv-api.md` — `ctx.store` contract for mode A (`KvStore.get/set/delete/list`, plugin-scoped, optional node-scoped), mode B dedicated-tables rules (prefix injection, DDL validation, scoped Database wrapper), typed errors (`KvKeyInvalidError`, `KvValueNotSerializableError`, `KvValueTooLargeError`, `KvOperationFailedError`, `ScopedDbViolationError`). Mixing modes in a plugin is forbidden.
- Interfaces:
  - `interfaces/security-scanner.md` — convention over the Action kind (id prefix `security-`) for third-party security scanners (Snyk, Socket, custom). Defines `SecurityReport` shape extending `report-base.schema.json`, normative finding categories, deduplication rules, aggregation via `sm findings --security`. Marked `Stability: experimental` through v0.x.

### Conventions locked (normative)

- JSON Schema dialect: draft 2020-12.
- Casing: camelCase for all JSON keys (domain, configs, manifests, reports); kebab-case for filenames.
- `$id` scheme: `https://skill-map.dev/spec/v<major>/<path>.schema.json`. `v0` throughout pre-1.0; bumps to `v1` at the first stable release.
- Identity: `node.path` (relative to scope root) is the canonical node identifier in v0. Future UUID-based `node.id` lands with write-back.
- Required frontmatter: `name`, `description`, `metadata`, `metadata.version`.
- Frontmatter: `additionalProperties: true` (rules handle unknown fields). Summaries: `additionalProperties: false` (strict).
- Id prefixes: job `d-`, execution record `e-`, run `r-` (all `PREFIX-YYYYMMDD-HHMMSS-XXXX`).
- Exit codes: 0 ok / 1 issues / 2 error / 3 duplicate / 4 nonce-mismatch / 5 not-found.
- Deprecation window: 3 minor releases between `stable → deprecated` and removal.
- Storage modes: a plugin declares exactly one (`kv` or `dedicated`). Mixing forbidden.

### Conformance (stub)

- `conformance/README.md` — suite layout, case format, assertion types (`exit-code`, `json-path`, `file-exists`, `file-contains-verbatim`, `file-matches-schema`, `stderr-matches`), runner pseudocode.
- `conformance/fixtures/minimal-claude/` — 5 MDs (one per kind: skill, agent, command, hook, note) used as the first controlled corpus.
- `conformance/fixtures/preamble-v1.txt` — verbatim extraction of the preamble from `prompt-preamble.md`, checked byte-for-byte by the future `preamble-bitwise-match` case.
- `conformance/cases/basic-scan.json` — first declarative case. Scans the `minimal-claude` fixture; asserts `schemaVersion: 1`, 5 nodes, 0 issues.

### Packaging

- `package.json` at the spec root. Name: `@skill-map/spec`. Version `0.0.1` (first release line; spec versioning is strict pre-1.0 per `versioning.md`). `exports` surfaces `.` → `index.json`, plus every `./schemas/*.json`.
- `index.json` at the spec root. Machine-readable manifest of schemas, prose, interfaces, and conformance. Carries an `integrity` block with a sha256 per shipped file, deterministically regenerated by `scripts/build-spec-index.mjs`. CI blocks drift via `npm run spec:check`.
- `schemas/conformance-case.schema.json` — formal schema for entries under `conformance/cases/*.json`. Defines the `invoke` object and the six assertion types (`exit-code`, `json-path`, `file-exists`, `file-contains-verbatim`, `file-matches-schema`, `stderr-matches`) as a discriminated union via `oneOf`.

### Notes

- Pending for `spec-v0.1.0`: cases `kernel-empty-boot` and `preamble-bitwise-match` (referenced normatively in `architecture.md` and `prompt-preamble.md`). Land alongside Step 0b when the reference implementation exists to run them against.
- No tagged spec release yet. First tag (`spec-v0.1.0`) lands after Step 0b CI validates the implementation against this stub.
- Release pipeline: `@skill-map/spec` is published via [changesets](https://github.com/changesets/changesets). Every PR that touches `spec/` includes a `.changeset/*.md` declaring the bump; merging to `main` opens a "Version Packages" PR; merging that PR publishes to npm and tags the release. See `CONTRIBUTING.md`.
