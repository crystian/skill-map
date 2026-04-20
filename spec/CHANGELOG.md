# Spec changelog

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
  - `job-events.md` — canonical event stream: envelope (`type`, `timestamp`, `runId`, `jobId`, `data`), 10 event types (`run.started`, `run.reap.started`, `run.reap.completed`, `job.claimed`, `job.skipped`, `job.spawning`, `model.delta`, `job.callback.received`, `job.completed`, `job.failed`, `run.summary`), three output adapters (`pretty`, `stream-output`, `json`), ordering rules.
  - `prompt-preamble.md` — verbatim normative preamble text that the kernel prepends to every rendered job file; `<user-content id="...">` delimiter contract with zero-width-space escaping; `safety` + `confidence` contract on model output; conformance fixture at `conformance/fixtures/preamble-v1.txt`.
  - `db-schema.md` — engine-agnostic table catalog: three zones (`scan_*`, `state_*`, `config_*`), naming conventions (snake_case, zone prefix, `_at` / `_ms` / `_hash` / `_json` / `_count` suffixes, `is_` / `has_` prefixes), kernel table list per zone, migration rules (`.sql` files, `NNN_snake_case.sql`, up-only, auto-backup), plugin storage modes.
  - `plugin-kv-api.md` — `ctx.store` contract for mode A (`KvStore.get/set/delete/list`, plugin-scoped, optional node-scoped), mode B dedicated-tables rules (prefix injection, DDL validation, scoped Database wrapper), typed errors (`KvKeyInvalidError`, `KvValueNotSerializableError`, `KvValueTooLargeError`, `KvOperationFailedError`, `ScopedDbViolationError`). Mixing modes in a plugin is forbidden.
- Interfaces:
  - `interfaces/security-scanner.md` — convention over the Action kind (id prefix `security-`) for third-party security scanners (Snyk, Socket, custom). Defines `SecurityReport` shape extending `report-base.schema.json`, normative finding categories, deduplication rules, aggregation via `sm findings --security`. Marked `Stability: experimental` through v0.x.

### Conventions locked (normative)

- JSON Schema dialect: draft 2020-12.
- Casing: camelCase for all JSON keys (domain, configs, manifests, reports); kebab-case for filenames.
- `$id` scheme: `https://skill-map.dev/spec/v<major>/<path>.schema.json`. `v0` throughout pre-1.0; bumps to `v1` at the first stable cut.
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
