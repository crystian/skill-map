# Spec changelog

## 0.13.1

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

## [Unreleased]

### Minor

- **Provider-driven kind presentation + `kindRegistry` envelope.** The Provider extension surface gains a required `kinds[*].ui` block (`label`, `color`, optional `colorDark`, optional `emoji`, optional discriminated icon `{ kind: 'pi', id }` or `{ kind: 'svg', path }`). Every payload-bearing REST envelope variant embeds a required `kindRegistry` field; sentinel envelopes (`health`, `scan`, `graph`) stay exempt. New conformance case `plugin-missing-ui-rejected` locks the loader's behaviour against drop-in Providers that omit the `ui` block.

- **`/api/nodes/:pathB64?include=body` body opt-in.** The single-node detail endpoint accepts `?include=body` to add `item.body: string | null` (read from disk on demand; `null` when the source file is missing or unreadable). Single-node response shape is `{ schemaVersion, kind: 'node', item, links: { incoming, outgoing }, issues }`. The body reader refuses absolute paths and any relative path that resolves outside the scope root.

- **`/ws` WebSocket protocol + watcher contract.** `### Server` documents the wire envelope (delegated to `job-events.md` §Common envelope), the event catalog (`scan.started` / `scan.progress` / `scan.completed` plus `extractor.completed` / `rule.completed` / `extension.error` plus the BFF-internal advisories `watcher.started` / `watcher.error`), connection lifecycle, the backpressure rule (4 MiB `bufferedAmount` → close 1009 + unregister), and the loopback-only assumption. `sm serve --no-watcher` flag added.

## 0.12.0

### Minor

- **`sm serve` + Hono BFF skeleton.** New `### Server` subsection in `cli-contract.md`. Endpoints at this bump: `GET /api/health` (real), `ALL /api/*` (structured 404 stub), `GET /ws` (no-op upgrade — closes with code 1000 + reason `'no broadcaster yet'`), static handler + SPA fallback. Loopback-only through v0.6.0; boot resilient to a missing DB (`/api/health` reports `db: 'missing'`). `sm serve` flag set: `--port` (default 4242), `--host` (default 127.0.0.1), `--scope`, `--db`, `--no-built-ins`, `--no-plugins`, `--open` / `--no-open`, `--dev-cors`, `--ui-dist`.

## 0.11.0

### Minor

- **Job artifacts move into the database (content-addressed).** New `state_job_contents(content_hash PK, content, created_at)`; `state_jobs.file_path` removed (rendered content fetched via join). `state_executions.report_path` → `state_executions.report_json` (parsed-JSON-on-read). `Job.filePath` removed; `ExecutionRecord.reportPath` → `ExecutionRecord.report` (parsed JSON / null). `RunnerPort.run(jobContent, options)` returns `{ report, ... }` — path-based reporting is no longer part of the port contract. `sm job preview` reads from the DB; `sm job claim --json` returns `{ id, nonce, content }`; `sm record --report <path-or-dash>` accepts a file path or stdin; `sm job prune --orphan-files` removed (the verb auto-collects orphan content rows). `sm doctor` integrity checks updated. Event payload renames: `job.spawning.data.jobFilePath` → `contentHash`; `job.callback.received.data.reportPath` and `job.completed.data.reportPath` → `executionId`. The `job-file-missing` failure-reason enum is preserved with shifted semantics: it now flags a missing `state_job_contents` row (DB-corruption-only state).

## 0.10.0

### Minor

- **`Node.kind` opens to any Provider-declared string.** `node.schema.json#/properties/kind` becomes `{ type: 'string', minLength: 1 }`; the `CHECK in (...)` SQL constraints on `scan_nodes.kind` and `state_summaries.kind` drop; `extensions/action.schema.json#/.../filter/kind` widens to a string array. Providers declare their own kind catalog through the `kinds` map; the spec no longer enumerates a closed set.

## 0.7.0

### Minor

- **Execution modes lifted to a first-class architectural property.** `architecture.md` gains §Execution modes defining the per-kind capability matrix: Extractor / Rule / Action / Hook are dual-mode (declared in manifest); Provider and Formatter are deterministic-only (boundary-positioned). Extractor / Rule schemas gain optional `mode` (default `deterministic`); Action's `mode` enum becomes `deterministic` / `probabilistic`; Provider / Formatter forbid the field.

## 0.6.1

### Patch

- **Config folder rename** — `.skill-map.json` (single project-root file) → `.skill-map/settings.json` inside the canonical `.skill-map/` scope folder, with a sibling `.skill-map/settings.local.json` for per-machine overrides.

## 0.6.0

### Minor

- **Persisted scan-result metadata.** New `scan_meta` table backs `loadScanResult` so `scope` / `roots` / `scannedAt` / `scannedBy` / `adapters` / `stats.{filesWalked,filesSkipped,durationMs}` are real values instead of synthesised on read.

## 0.5.0

### Minor

- **`spec/index.json` integrity sweep.** Reconciles `index.json` with the manifest changes documented in v0.3.0 but never written to the file. No prose / schema changes.

## 0.4.0

### Minor

- **`--all` documented as targeted fan-out** in `cli-contract.md`. Valid only on verbs whose contract explicitly lists it.

## 0.3.0

### Minor

- **`--all` promoted to a normative universal flag** in `cli-contract.md §Global flags`. Any verb that accepts a target identifier (`-n <node.path>`, `<job.id>`, `<plugin.id>`) MUST accept `--all` as "apply to every eligible target matching the verb's preconditions". Mutually exclusive with a positional target on the same invocation. Verbs where fan-out is nonsensical (`sm record`, `sm init`, `sm version`, `sm help`, `sm config get/set/reset/show`, `sm db *`, `sm serve`) MUST reject `--all` with exit `2`.

## 0.2.0

### Minor

- **`@skill-map/spec` published on npm.** First public release of the spec package.

## 0.1.0

### Minor

- **Initial public spec bootstrap.** Ships the JSON Schemas (draft 2020-12) for `Node` / `Link` / `Issue` / `ScanResult` / `ExecutionRecord` / `ProjectConfig` / `PluginsRegistry` / `Job` / `ReportBase` / `ConformanceCase` / `HistoryStats` plus the per-kind extension schemas (Provider / Extractor / Rule / Action / Formatter / Hook). Prose normative contracts: `cli-contract.md`, `architecture.md`, `db-schema.md`, `job-lifecycle.md`, `job-events.md`, `prompt-preamble.md`, `plugin-kv-api.md`. Conformance case `kernel-empty-boot` exercises the boot invariant (kernel boots and returns an empty `ScanResult` with zero registered extensions); `preamble-bitwise-match` is deferred to Step 10.
