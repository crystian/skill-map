# Spec changelog

## 0.17.0

### Minor Changes

- 77579b3: Add a `sm db browser` sub-command that opens the project's SQLite DB in DB Browser for SQLite (sqlitebrowser GUI). Read-only by default; pass `--rw` to enable writes. Replaces the previous `scripts/open-sqlite-browser.js` standalone script.

  The root `npm run sqlite` shortcut now invokes the project-built CLI binary (`node src/bin/sm.js db browser`) instead of the standalone script. This guarantees the locally compiled CLI is used, not whichever `sm` resolves on PATH (a globally installed `@skill-map/cli` would otherwise shadow the in-development version).

  Spec: `cli-contract.md` documents the new sub-command in the verb table and the §Database section.

- 696008a: Add a `--no-ui` flag to `sm serve`. With it, the BFF stops serving the Angular bundle (stale or otherwise) and the root `/` renders an inline dev-mode placeholder pointing the user at `npm run ui:dev` + `http://localhost:4200/`. Used by the root `bff:dev` shortcut so iterating on the BFF alongside the Angular dev server doesn't surface a stale UI by accident.

  Mutually exclusive with `--ui-dist <path>` (rejected with exit 2). Combining `--no-ui` with the default `--open` emits a non-fatal stderr warning suggesting `--no-open` (the auto-opened tab would land on the placeholder rather than the live UI). `/api/*` and `/ws` remain fully functional; only the static SPA is suppressed.

  Spec impact: `spec/cli-contract.md` documents the new flag in the `sm serve` signature and the §Server flags table, including the mutual-exclusion + warning rules.

- bd5e360: Trim `frontmatter/base.schema.json` to the truly universal contract: `name` + `description` are the only required fields, every node on every Provider, and `additionalProperties: true` lets vendor-specific keys flow through silently.

  The previous base inadvertently curated a Claude-flavored shape (`tools`, `allowedTools`, full `metadata` block with `version` required, etc.). skill-map AGGREGATES vendor specs, it does not curate them — so per-vendor frontmatter shapes belong in the Provider that emits the kind. The Anthropic-specific catalog now lives entirely under `src/built-in-plugins/providers/claude/schemas/` and absorbs Anthropic's documented frontmatter verbatim (see the matching `@skill-map/cli` changeset).

  The future home for skill-map-only annotation fields (provenance, cross-vendor metadata, source URL, supersedes/supersededBy) is a deferred decision — sidecar file vs in-frontmatter block — tracked separately. Existing files that carry `metadata: { version, ... }` continue to validate without any change because of `additionalProperties: true`; nothing breaks at the consumer edge.

  Decision #55 (full metadata block in the universal base) is superseded by this change.

  Breaking but greenfield-permitted per `versioning.md` § Pre-1.0: ships as a minor bump because `@skill-map/spec` is still 0.x and Decision #55 had not reached any released consumer that mandates the prior shape. Stays minor; the first 1.0.0 is a deliberate stabilization moment, not a side-effect of this PR.

## 0.16.0

### Minor Changes

- c981430: Rename the project ignore file from `.skill-mapignore` to `.skillmapignore` (no dash).

  Rationale: drop the dash for consistency with `.gitignore` / `.npmignore` / `.dockerignore` and friends — those tools use a contiguous lowercase token, and adopting the same shape removes the visual stutter when listing dotfiles. The rename also avoids confusion between the public artifact and the package id `@skill-map/*` which uses a dash by convention.

  Breaking change pre-1.0:

  - `sm init` now scaffolds `.skillmapignore` instead of `.skill-mapignore`. Existing projects must `mv .skill-mapignore .skillmapignore` manually — no compat reader (greenfield rule, see `feedback_greenfield_no_versioning.md`).
  - The bundled defaults asset moved from `src/config/defaults/skill-mapignore` to `src/config/defaults/skillmapignore`.
  - `sm serve` and `sm watch` now watch `.skillmapignore` (not `.skill-mapignore`) for live filter rebuilds.
  - Spec and JSON Schema (`spec/cli-contract.md` § `sm init`, `spec/schemas/project-config.schema.json` § `ignore`) updated; `spec/index.json` regenerated.
  - All in-repo fixtures, docs (ROADMAP, context/\*, AGENTS.md, web/app.js), tests, and skills (sm-tutorial, foblex-flow indirectly) updated in the same commit.

  Historical CHANGELOG entries that reference `.skill-mapignore` are intentionally left untouched — they document past behaviour.

## 0.15.0

### Minor Changes

- d7e8dd9: Rename the tester onboarding verb and its companion Claude Code skill from `sm-guide` to `sm-tutorial` across spec, CLI, bundled materialised payload, runtime state file, and report file. Breaking change to the public CLI surface (`sm guide` is gone — no compat shim); pre-1.0 so it ships as a minor bump per the project's pre-1.0 policy (no major while a workspace stays in `0.Y.Z`).

  Spec: `spec/cli-contract.md` — the `sm guide` verb section is renamed to `sm tutorial`. Same shape, same exit codes, same `--force` semantics — only the identifier flips. Materialised file becomes `<cwd>/sm-tutorial.md`; integrity block in `spec/index.json` regenerated.

  CLI (`@skill-map/cli`): `sm guide` → `sm tutorial`; `src/cli/commands/guide.ts` → `tutorial.ts` (`GuideCommand` → `TutorialCommand`, `SM_GUIDE_FILENAME` → `SM_TUTORIAL_FILENAME`); `src/cli/i18n/guide.texts.ts` → `tutorial.texts.ts` (`GUIDE_TEXTS` → `TUTORIAL_TEXTS`, all string templates updated to mention `sm-tutorial.md` and `@sm-tutorial.md`); `src/tsup.config.ts` build step `copyGuideSkill()` → `copyTutorialSkill()` writing the bundled payload to `dist/cli/tutorial/sm-tutorial.md` instead of `dist/cli/guide/sm-guide.md`. Test file `src/test/guide-cli.test.ts` → `tutorial-cli.test.ts` with updated regex assertions and SKILL.md byte-match anchor pointing at `.claude/skills/sm-tutorial/SKILL.md`.

  Skill: `.claude/skills/sm-guide/` → `.claude/skills/sm-tutorial/`. Frontmatter `name: sm-guide` → `sm-tutorial`. Triggers list updated (`"tutorial", "sm-tutorial", "tutorial me", "start the tutorial"`). Internal whitelist updated (`sm-tutorial.md`, `tutorial-state.yml`, `sm-tutorial-report.md`). Runtime state file renamed `guide-state.yml` → `tutorial-state.yml` (top-level YAML key `guide:` → `tutorial:`). Report file renamed `sm-guide-report.md` → `sm-tutorial-report.md`. Colloquial Spanish "guía" inside tester-facing prose stays where it reads naturally — only identifiers (path names, command names, frontmatter, technical references) flip to `tutorial`.

  ROADMAP: setup-and-state verb table updated to `sm tutorial [--force]`.

  No backwards-compat alias is shipped: the tester base for this verb is tiny and a clean break is safer than maintaining two names.

## 0.14.1

### Patch Changes

- 34d57db: Doc-only fix to remove a misleading reading of "built-in kinds" in the Node schema and one test, plus a small batch of internal CLI refactors and tightened null checks. No external surface change.

  Spec / docs:

  - `spec/schemas/node.schema.json` — the top-level `description` previously read "built-in kinds today are skill, agent, command, hook, note", which suggested those kinds were a kernel-level concept. They are not — the kernel treats `kind` as an open string, and the five names are emitted by the **built-in Claude Provider**. Re-worded to attribute the catalog to the Claude Provider, matching the wording already used on the `kind` field, in `spec/README.md`, in `src/kernel/types.ts`, and in `src/kernel/adapters/sqlite/schema.ts`.
  - `src/test/extractor-applicable-kinds.test.ts` — three comments tightened from "built-in kind" to "built-in Claude Provider kind" for consistency.

  Internal CLI refactors (no behaviour change):

  - `src/cli/commands/config.ts` — extracted an `isPlainObject` predicate (replaces the duplicated `!!v && typeof v === 'object' && !Array.isArray(v)` check inside `enumerateConfigPaths`) and a `safeGetAtPath` helper that wraps `getAtPath` + `ForbiddenSegmentError` handling so each read verb's `run()` no longer repeats the try/catch + instanceof shape.
  - `src/cli/commands/db.ts` — pulled the SQL number serialiser into `formatSqlNumber` (NaN / ±Infinity collapse to NULL) so `formatSqlValue` reads as a flat dispatcher.
  - `src/cli/util/parse-error.ts` — moved the verb-scoped error formatting (incl. the missing-positionals special case) into a `formatVerbScopedError` helper so the top-level dispatcher in `formatParseError` stays flat. Removed the now-stale "dispatcher pattern" eslint-disable comment.
  - `src/kernel/adapters/sqlite/scan-load.ts` — tightened `parseJsonObject` / `parseJsonArray` null checks from `s == null` to `s === null || s === undefined` to remove the implicit-coercion pattern flagged by lint.

  No contract change (no field/type/required edits). `spec/index.json` regenerated.

## 0.14.0

### Minor Changes

- 8f2a66d: Bare `sm` defaults to `sm serve` instead of printing help

  `sm` invoked with no arguments now starts the Web UI server when a
  `.skill-map/` project exists in the current working directory
  (equivalent to `sm serve`). When no project is found, it prints a
  one-line hint pointing to `sm init` and `sm --help` on stderr and
  exits with code `2`. `sm --help` and `sm -h` continue to print
  top-level help — help is now reserved for explicit flags.

  **Spec change** (`spec/cli-contract.md` §Binary): the prior wording —
  _"`sm`, `sm --help`, `sm -h` MUST all print top-level help"_ — is
  replaced by two separate clauses. Help invocation requires `--help` or
  `-h`; bare invocation routes to the server with the hint-and-exit
  fallback when no project exists.

  **CLI change** (`src/cli/entry.ts`): empty argv is intercepted before
  Clipanion sees it. If `defaultProjectDbPath(cwd)` exists, the args
  are rewritten to `['serve']`. Otherwise the hint is printed via the
  `tx()` i18n shim and the process exits `2`. `RootHelpCommand` no
  longer carries `Command.Default`; it remains the handler for `--help`
  and `-h` only.

  **Why pre-1.0 minor instead of major**: `spec/` and `src/` are both
  in `0.Y.Z`. Per `spec/versioning.md` §Pre-1.0, breaking changes ship
  as minor bumps until the deliberate 1.0 stabilization. The conformance
  suite required no updates (no case asserted bare-sm = help).

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
