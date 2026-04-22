# Spec changelog

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

  These families ship at Step 12 of the reference impl alongside the WebSocket broadcaster. Marking them experimental keeps the shape mutable until real UI consumers exercise the stream; promotion to `stable` is a later minor bump.

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
  - **Coverage matrix**: row `29` for `history-stats.schema.json` (blocked by Step 4); artifact row `L` for the elapsed-time reporting invariant (blocked by Step 3).

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

  - **Remove** `history.retentionDays`. The field promised execution-record GC, but `ROADMAP.md` §Step 6 and the job-retention section make it explicit that `state_executions` is append-only in `v0.1` and that the kernel does not use this key. Declaring a config key whose behaviour is "silently ignored" is worse than not declaring it — consumers would wire it in and never see an effect. The field will be re-introduced in a later minor bump when the GC path actually lands, with a concrete default and enforcement semantics.

  **Editorial:**

  - `history.share.description` mentioned `./.skill-map/history.json` — an artefact of the pre-SQLite architecture. The actual DB is `./.skill-map/skill-map.db` (see `db-schema.md` §Scope and location). Description corrected; field itself unchanged.

  Classification: minor per §Pre-1.0 (`0.Y.Z` may contain breaking changes in a minor bump). Integrity block regenerated via `npm run spec:index`. Companion prose in `ROADMAP.md §Notable config keys` updated in the same change.

  **Migration for consumers**: any `.skill-map.json` that set `history.retentionDays` will now fail schema validation (`additionalProperties: false` on `history`). Remove the key; no kernel behaviour changes because nothing was consuming it.

- 93ffe34: Promote the trigger-normalization pipeline (Decision #21) from implicit to normative in `spec/architecture.md`.

  Before this change, `link.trigger` carried `originalTrigger` and `normalizedTrigger` fields (defined in `schemas/link.schema.json`), and the `trigger-collision` rule keyed on the normalized value — but no spec prose documented **how** to normalize. The pipeline lived only in `AGENTS.md §Decisions already locked` and in `ROADMAP.md` as a one-line Step 6 bullet. That left implementations free to diverge, which silently breaks the `trigger-collision` rule across implementations (two conforming CLIs could disagree on whether `hacer-review` and `Hacer Review` collide).

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

  The second pending case, `preamble-bitwise-match`, is deferred to Step 9 (requires `sm job preview` from the job subsystem).

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

### Changed

- `cli-contract.md`: `--all` is no longer a global flag. It is valid only on verbs that explicitly document fan-out semantics: `sm job submit`, `sm job run`, `sm job cancel`, and `sm plugins enable/disable`.
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
