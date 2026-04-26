# Database schema

Normative catalog of tables owned by the kernel. Plugins MAY add their own tables under a strict prefix (see [`plugin-kv-api.md`](./plugin-kv-api.md)). An implementation MUST provision every kernel table described here and MUST reject writes that violate the stated constraints.

The spec assumes a relational, SQL-like store but is **engine-agnostic**. The reference implementation uses SQLite (`node:sqlite`) + Kysely + `CamelCasePlugin`. Alternative backends (Postgres, DuckDB, in-memory) are permitted as long as:

- Atomic single-statement transitions are available for the job claim (see [`job-lifecycle.md`](./job-lifecycle.md)).
- Migrations track applied versions per scope.
- Read isolation avoids phantom reads inside a single scan write.

---

## Scope and location

Two scopes. Each has its own database file and its own migration ledger.

| Scope | Default DB location | Scan roots |
|---|---|---|
| `project` (default) | `./.skill-map/skill-map.db` | The current repository. |
| `global` (`-g`) | `~/.skill-map/skill-map.db` | User-level skill directories (e.g. `~/.claude/`). |

The project DB is gitignored by default. Teams MAY opt in to sharing it by setting `history.share: true` in `.skill-map.json` — the file is then committed and the execution log becomes a team artifact. Both zones use the same schema.

The `--db <path>` CLI flag overrides location for both scopes as an escape hatch.

---

## Zones

Every kernel table belongs to exactly one zone, identified by a mandatory name prefix.

| Zone | Prefix | Nature | Regenerable | Backed up | Example |
|---|---|---|---|---|---|
| Scan | `scan_` | Output of the last scan. Truncated and repopulated by `sm scan`. | Yes | No | `scan_nodes` |
| State | `state_` | Persistent operational data: jobs, executions, summaries, enrichment, plugin KV. | No | Yes | `state_jobs` |
| Config | `config_` | User-owned configuration: plugin enable/disable, preferences, migration ledger. | No | Yes | `config_plugins` |

`sm db reset` drops `scan_*` only (non-destructive — equivalent to forcing the next scan from a clean slate). `sm db reset --state` also drops `state_*` (destructive to operational history). `sm db reset --hard` deletes the DB file entirely. `sm db backup` preserves `state_*` + `config_*`; `scan_*` is always regenerated on demand and is never included in backups.

---

## Naming conventions (normative)

These rules apply to every kernel table and to every plugin-authored table under its prefix.

- **Tables**: `snake_case`, plural. Zone prefix REQUIRED. Example: `scan_nodes`, `state_jobs`.
- **Columns**: `snake_case`. Primary key column is always `id`.
- **Foreign keys**: `<referenced_table_singular>_id`. Example: `job_id` references `state_jobs.id`.
- **Timestamps**: suffix `_at`, type `INTEGER` (Unix milliseconds). Example: `created_at`, `claimed_at`.
- **Durations**: suffix `_seconds` or `_ms`. Example: `ttl_seconds`, `duration_ms`.
- **Booleans**: prefix `is_` or `has_`. Stored as `INTEGER` (`0`/`1`) per SQLite convention; other engines use their native boolean.
- **Hashes**: suffix `_hash`, `TEXT`, hex-encoded lowercase. Example: `body_hash`, `content_hash`.
- **JSON blobs**: suffix `_json`, `TEXT`. Parsed on read, serialized on write.
- **Counts**: suffix `_count`, `INTEGER`. Example: `links_out_count`.
- **Enums**: plain column + `CHECK` constraint listing allowed values. Values are kebab-case lowercase. No lookup tables.
- **Indexes**: named `ix_<table>_<cols>`. Example: `ix_state_jobs_status`.
- **Constraints**: `fk_`, `uq_`, `ck_` prefixes.
- **SQL keywords**: UPPERCASE. Identifiers lowercase.

The kernel MUST reject any plugin migration that violates these rules at validation time (see `plugin-kv-api.md`).

Domain types exposed to driving adapters use `camelCase`. The SQLite reference impl uses Kysely's `CamelCasePlugin` to bridge `snake_case ↔ camelCase` at the port boundary.

---

## Table catalog: zone `scan_`

### `scan_nodes`

One row per detected node, matching [`schemas/node.schema.json`](./schemas/node.schema.json).

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `path` | TEXT | PRIMARY KEY | Relative path from scope root. Canonical node identifier. |
| `kind` | TEXT | NOT NULL, CHECK in (`skill`, `agent`, `command`, `hook`, `note`) | |
| `adapter` | TEXT | NOT NULL | Adapter extension id. |
| `title` | TEXT | NULL | |
| `description` | TEXT | NULL | |
| `stability` | TEXT | CHECK in (`experimental`, `stable`, `deprecated`) OR NULL | Denormalized from frontmatter. |
| `version` | TEXT | NULL | Denormalized from frontmatter. |
| `author` | TEXT | NULL | Denormalized. |
| `frontmatter_json` | TEXT | NOT NULL | Full parsed frontmatter as JSON. |
| `body_hash` | TEXT | NOT NULL | sha256, hex. |
| `frontmatter_hash` | TEXT | NOT NULL | sha256, hex. |
| `bytes_frontmatter` | INTEGER | NOT NULL | |
| `bytes_body` | INTEGER | NOT NULL | |
| `bytes_total` | INTEGER | NOT NULL | |
| `tokens_frontmatter` | INTEGER | NULL | NULL when tokenization disabled. |
| `tokens_body` | INTEGER | NULL | |
| `tokens_total` | INTEGER | NULL | |
| `links_out_count` | INTEGER | NOT NULL DEFAULT 0 | |
| `links_in_count` | INTEGER | NOT NULL DEFAULT 0 | |
| `external_refs_count` | INTEGER | NOT NULL DEFAULT 0 | |
| `scanned_at` | INTEGER | NOT NULL | Unix ms. |

Indexes: `ix_scan_nodes_kind`, `ix_scan_nodes_adapter`, `ix_scan_nodes_body_hash` (rename heuristic).

### `scan_links`

One row per detected link, matching [`schemas/link.schema.json`](./schemas/link.schema.json).

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | |
| `source_path` | TEXT | NOT NULL | FK semantically; MAY be unenforced for performance. |
| `target_path` | TEXT | NOT NULL | MAY point to a missing node (broken ref). |
| `kind` | TEXT | NOT NULL, CHECK in (`invokes`, `references`, `mentions`, `supersedes`) | |
| `confidence` | TEXT | NOT NULL, CHECK in (`high`, `medium`, `low`) | |
| `sources_json` | TEXT | NOT NULL | JSON array of detector ids. |
| `original_trigger` | TEXT | NULL | |
| `normalized_trigger` | TEXT | NULL | |
| `location_line` | INTEGER | NULL | |
| `location_column` | INTEGER | NULL | |
| `location_offset` | INTEGER | NULL | |
| `raw` | TEXT | NULL | |

Indexes: `ix_scan_links_source_path`, `ix_scan_links_target_path`, `ix_scan_links_normalized_trigger`.

### `scan_issues`

One row per rule-emitted issue, matching [`schemas/issue.schema.json`](./schemas/issue.schema.json).

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | |
| `rule_id` | TEXT | NOT NULL | |
| `severity` | TEXT | NOT NULL, CHECK in (`error`, `warn`, `info`) | |
| `node_ids_json` | TEXT | NOT NULL | JSON array. |
| `link_indices_json` | TEXT | NULL | JSON array of `scan_links.id`. |
| `message` | TEXT | NOT NULL | |
| `detail` | TEXT | NULL | |
| `fix_json` | TEXT | NULL | |
| `data_json` | TEXT | NULL | |

Indexes: `ix_scan_issues_rule_id`, `ix_scan_issues_severity`.

### `scan_meta`

Single-row table holding the metadata of the last persisted scan. Lets `loadScanResult` return the real `scope` / `roots` / `scannedAt` / `scannedBy` / `adapters` / `stats.filesWalked|filesSkipped|durationMs` instead of synthesising them. Replaced atomically with the rest of the `scan_*` zone on every `sm scan`.

`nodesCount` / `linksCount` / `issuesCount` are not stored here — they derive from `COUNT(*)` of the sibling tables.

| Column | Type | Constraint |
|---|---|---|
| `id` | INTEGER | PRIMARY KEY, CHECK `id = 1` |
| `scope` | TEXT | NOT NULL, CHECK in (`project`, `global`) |
| `roots_json` | TEXT | NOT NULL | JSON array of strings (filesystem roots walked). |
| `scanned_at` | INTEGER | NOT NULL | Unix milliseconds. |
| `scanned_by_name` | TEXT | NOT NULL |
| `scanned_by_version` | TEXT | NOT NULL |
| `scanned_by_spec_version` | TEXT | NOT NULL |
| `adapters_json` | TEXT | NOT NULL | JSON array of adapter ids. |
| `stats_files_walked` | INTEGER | NOT NULL |
| `stats_files_skipped` | INTEGER | NOT NULL |
| `stats_duration_ms` | INTEGER | NOT NULL |

No indexes (single row).

---

## Table catalog: zone `state_`

### `state_jobs`

Matching [`schemas/job.schema.json`](./schemas/job.schema.json). See [`job-lifecycle.md`](./job-lifecycle.md) for the state machine and transitions.

| Column | Type | Constraint |
|---|---|---|
| `id` | TEXT | PRIMARY KEY |
| `action_id` | TEXT | NOT NULL |
| `action_version` | TEXT | NOT NULL |
| `node_id` | TEXT | NOT NULL |
| `content_hash` | TEXT | NOT NULL |
| `nonce` | TEXT | NOT NULL |
| `priority` | INTEGER | NOT NULL DEFAULT 0 |
| `status` | TEXT | NOT NULL, CHECK in (`queued`, `running`, `completed`, `failed`) |
| `failure_reason` | TEXT | NULL, CHECK in (`runner-error`, `report-invalid`, `timeout`, `abandoned`, `job-file-missing`, `user-cancelled`) |
| `runner` | TEXT | NULL, CHECK in (`cli`, `skill`, `in-process`) |
| `ttl_seconds` | INTEGER | NOT NULL |
| `file_path` | TEXT | NULL |
| `created_at` | INTEGER | NOT NULL |
| `claimed_at` | INTEGER | NULL |
| `finished_at` | INTEGER | NULL |
| `expires_at` | INTEGER | NULL |
| `submitted_by` | TEXT | NULL |

Indexes: `ix_state_jobs_status`, `ix_state_jobs_action_node_hash` (unique partial index WHERE `status IN ('queued','running')` for duplicate detection).

### `state_executions`

Matching [`schemas/execution-record.schema.json`](./schemas/execution-record.schema.json).

| Column | Type | Constraint |
|---|---|---|
| `id` | TEXT | PRIMARY KEY |
| `kind` | TEXT | NOT NULL, CHECK in (`action`, `audit`) |
| `extension_id` | TEXT | NOT NULL |
| `extension_version` | TEXT | NOT NULL |
| `node_ids_json` | TEXT | NOT NULL DEFAULT '[]' |
| `content_hash` | TEXT | NULL |
| `status` | TEXT | NOT NULL, CHECK in (`completed`, `failed`, `cancelled`) |
| `failure_reason` | TEXT | NULL |
| `exit_code` | INTEGER | NULL |
| `runner` | TEXT | NULL |
| `started_at` | INTEGER | NOT NULL |
| `finished_at` | INTEGER | NOT NULL |
| `duration_ms` | INTEGER | NULL |
| `tokens_in` | INTEGER | NULL |
| `tokens_out` | INTEGER | NULL |
| `report_path` | TEXT | NULL |
| `job_id` | TEXT | NULL |

Indexes: `ix_state_executions_extension_id`, `ix_state_executions_started_at`, `ix_state_executions_job_id`.

### `state_summaries`

One row per `(node_id, summarizer_action_id)`. See [`schemas/summaries/`](./schemas/summaries/).

| Column | Type | Constraint |
|---|---|---|
| `node_id` | TEXT | NOT NULL |
| `kind` | TEXT | NOT NULL, CHECK in kind enum |
| `summarizer_action_id` | TEXT | NOT NULL |
| `summarizer_version` | TEXT | NOT NULL |
| `body_hash_at_generation` | TEXT | NOT NULL |
| `generated_at` | INTEGER | NOT NULL |
| `summary_json` | TEXT | NOT NULL |

Primary key: `(node_id, summarizer_action_id)`. Indexes: `ix_state_summaries_generated_at`.

### `state_enrichments`

One row per `(node_id, provider_id)`.

| Column | Type | Constraint |
|---|---|---|
| `node_id` | TEXT | NOT NULL |
| `provider_id` | TEXT | NOT NULL |
| `data_json` | TEXT | NOT NULL |
| `verified` | INTEGER | NULL (0/1/NULL) |
| `fetched_at` | INTEGER | NOT NULL |
| `stale_after` | INTEGER | NULL |

Primary key: `(node_id, provider_id)`. Indexes: `ix_state_enrichments_stale_after`.

### `state_plugin_kvs`

Shared key-value store for plugins that declared storage mode `kv`. See [`plugin-kv-api.md`](./plugin-kv-api.md) for the accessor contract.

| Column | Type | Constraint |
|---|---|---|
| `plugin_id` | TEXT | NOT NULL |
| `node_id` | TEXT | NULL | Optional scoping by node. |
| `key` | TEXT | NOT NULL |
| `value_json` | TEXT | NOT NULL |
| `updated_at` | INTEGER | NOT NULL |

Primary key: `(plugin_id, node_id, key)` with `node_id` using a sentinel empty string when NULL to satisfy PK constraints on engines that reject NULL in PK columns. Indexes: `ix_state_plugin_kvs_plugin_id`.

---

## Table catalog: zone `config_`

### `config_plugins`

Persists user-toggled enable/disable overrides. Discovery is still filesystem-based; this table records user intent.

| Column | Type | Constraint |
|---|---|---|
| `plugin_id` | TEXT | PRIMARY KEY |
| `enabled` | INTEGER | NOT NULL DEFAULT 1 |
| `config_json` | TEXT | NULL |
| `updated_at` | INTEGER | NOT NULL |

### `config_preferences`

General-purpose key-value for user preferences (`sm config set`).

| Column | Type | Constraint |
|---|---|---|
| `key` | TEXT | PRIMARY KEY |
| `value_json` | TEXT | NOT NULL |
| `updated_at` | INTEGER | NOT NULL |

### `config_schema_versions`

Migration ledger. One row per successfully applied migration, per scope.

| Column | Type | Constraint |
|---|---|---|
| `scope` | TEXT | NOT NULL, CHECK in (`kernel`, `plugin`) |
| `owner_id` | TEXT | NOT NULL | `kernel` for kernel migrations, plugin id otherwise. |
| `version` | INTEGER | NOT NULL |
| `description` | TEXT | NOT NULL |
| `applied_at` | INTEGER | NOT NULL |

Primary key: `(scope, owner_id, version)`.

The kernel ALSO maintains `PRAGMA user_version` (or the engine equivalent) as a fast pre-check for kernel migrations. A mismatch between `user_version` and `config_schema_versions` is a diagnostic flagged by `sm doctor`.

---

## Migrations

- **Format**: `.sql` files. Up-only. Rollback is `sm db restore <backup>`.
- **Naming**: `NNN_snake_case.sql` where `NNN` is 3-digit sequential, zero-padded. Example: `001_initial.sql`, `042_add_provenance.sql`.
- **Location**: kernel migrations in `src/migrations/` (reference impl); plugin migrations in `<plugin-dir>/migrations/`.
- **Wrapping**: the kernel wraps each file in `BEGIN; ... ; COMMIT;`. Files contain DDL only.
- **Strict versioning**: no idempotency is required. `CREATE TABLE IF NOT EXISTS` is DISCOURAGED in kernel migrations (but permitted in plugin migrations, at the plugin author's discretion).
- **Auto-apply**: on startup, unless `autoMigrate: false` in config. A backup is written to `.skill-map/backups/skill-map-pre-migrate-v<N>.db` before applying.
- **Plugin migration order**: plugins are migrated after kernel migrations and in stable alphabetical order by plugin id. A failing plugin migration disables only that plugin; other plugins and the kernel continue.

`sm db migrate` controls migration flow manually: `--dry-run`, `--status`, `--to <n>`, `--kernel-only`, `--plugin <id>`, `--no-backup`.

---

## Plugin storage

Two modes declared in `plugin.json` (see [`schemas/plugins-registry.schema.json`](./schemas/plugins-registry.schema.json)).

| Mode | Manifest | Backing |
|---|---|---|
| **KV** (mode A) | `"storage": { "mode": "kv" }` | Shared `state_plugin_kvs`. See [`plugin-kv-api.md`](./plugin-kv-api.md). |
| **Dedicated** (mode B) | `"storage": { "mode": "dedicated", "tables": [...], "migrations": [...] }` | Plugin-owned tables, prefixed `plugin_<normalized_id>_`. |

Normalization of `plugin_id` for the prefix:

1. Lowercase.
2. Replace `[^a-z0-9]` with `_`.
3. Collapse runs of `_`.
4. Strip leading/trailing `_`.

Example: `@skill-map/cluster-triggers` → `skill_map_cluster_triggers` → prefix `plugin_skill_map_cluster_triggers_`.

Collisions after normalization are a load-time error; both plugins are disabled with reason `invalid-manifest`.

### Triple protection for mode B

The kernel MUST enforce all three layers **in this exact order** for every plugin migration:

1. **Parse** — the kernel parses each plugin migration SQL file into an AST. Parse errors disable the plugin with status `load-error`.
2. **DDL validation (pre-rewrite)** — the AST is validated against the original table names authored by the plugin. Kernel MUST reject, before any rewrite:
   - References (FK / trigger / view) to any kernel table (prefix `scan_`, `state_`, `config_`) or to another plugin's table (prefix `plugin_<other-id>_`).
   - `DROP` / `ALTER` / `TRUNCATE` against anything outside the plugin's own logical table names.
   - `ATTACH DATABASE` statements.
   - Global `PRAGMA` statements (anything not scoped to a plugin-owned table).
   Rejection here is intentional: validation runs **before** prefix injection so kernel tables are named as the plugin wrote them, making the reject test straightforward.
3. **Prefix injection (rewrite)** — the kernel rewrites the AST so every table name the plugin authored becomes `plugin_<normalizedId>_<originalName>` if it doesn't already carry the prefix. Index and constraint names get the same treatment. A plugin CANNOT create un-prefixed tables.
4. **Scoped connection (runtime)** — at runtime, the plugin receives a `Database` wrapper (not a raw handle). The wrapper rejects any query that touches tables whose name doesn't start with this plugin's prefix. This is the last-line defense: even if a migration-time layer were bypassed, runtime queries still cannot reach out-of-namespace data.

Step 4 is separate from 1–3 because it applies at query time, not migration time. Together the four steps form the "triple protection" referenced across the spec (the name predates the explicit parse step).

Honest note: plugins are user-placed code. Protection guards against accidents (a plugin that mistakenly names a table `state_jobs`), not against hostile plugins. A malicious plugin running in the same process can bypass any JS-level guard. Post-v1.0 evaluates sandboxing (worker threads, VM contexts) and/or signing.

---

## Backups

- `sm db backup [--out <path>]` — WAL checkpoint (SQLite; engine-equivalent for others) + file copy.
- Default backup location: `.skill-map/backups/<timestamp>.db`.
- Auto-backup before migrations: `.skill-map/backups/skill-map-pre-migrate-v<N>.db`.
- `sm db restore <path>` swaps the current DB with the supplied file. Interactive confirmation required unless `--force`.

Backups include `state_*` + `config_*` only; `scan_*` is regenerated after restore by running `sm scan`.

---

## Rename detection (automatic)

`scan_nodes.path` is the canonical node identifier in v0. Moving a file therefore rewrites the primary key, which would orphan every `state_*` row referencing the old path (`state_executions.node_ids_json`, `state_jobs.node_id`, `state_summaries.node_id`, `state_enrichments.node_id`).

Implementations MUST apply a rename heuristic at scan time **before** committing the new scan transaction:

1. Compute the set `deletedPaths` (rows present in the previous `scan_nodes` but absent from the new walk) and `newPaths` (rows present in the new walk but absent from the previous scan).
2. For each pair `(deletedPath, newPath)` where `newPath.bodyHash == deletedPath.bodyHash` → classify as **high-confidence rename**. The kernel MUST:
   - Update every `state_*` row whose `node_id` equals `deletedPath` to reference `newPath`.
   - Emit no issue. Log at `info` level.
3. Remaining pairs where `newPath.frontmatterHash == deletedPath.frontmatterHash` (body differs, frontmatter is a perfect match) → classify as **medium-confidence rename**. The kernel MUST:
   - Apply the same FK migration.
   - Emit an issue with `ruleId: auto-rename-medium` (severity `warn`) pointing to both paths. The issue's `data` MUST include `{ from: <old.path>, to: <new.path>, confidence: "medium" }` so `sm orphans undo-rename <new.path>` can read the prior path without user input.
4. Any `deletedPath` left without a match after steps 2–3 becomes an **orphan**: the kernel emits an issue with `ruleId: orphan` (severity `info`) and keeps the `state_*` rows referencing the dead path untouched until the user runs `sm orphans reconcile <dead.path> --to <new.path>` or accepts the orphan.

Matching is 1-to-1: once a `newPath` is claimed as the rename target of some `deletedPath`, no other deletion can match it in the same scan. Ambiguity (two deletions share a body hash with the same new path) → fall back to the orphan path for all candidates, with issue `auto-rename-ambiguous` listing every conflict. `auto-rename-ambiguous` issues MUST populate `data` with `{ to: <new.path>, candidates: [<old.path.a>, <old.path.b>, ...] }`; in this case `sm orphans undo-rename` requires the user to pass `--from <old.path>` to disambiguate.

Note on casing: `bodyHash` / `frontmatterHash` / `ruleId` / `data` are the domain-object field names (per `node.schema.json` and `issue.schema.json`). The SQLite reference impl stores the same values in `body_hash` / `frontmatter_hash` / `rule_id` / `data_json` columns; the storage adapter bridges the two (see §Naming conventions above). The heuristic is specified against the domain types, not the columns.

The heuristic runs inside the scan transaction, so either all renames land or none do. `sm scan` is the only surface that triggers automatic rename detection. Two manual verbs exist for cases the heuristic missed or got wrong:

- `sm orphans reconcile <orphan.path> --to <new.path>` — forward direction. Attaches FKs of an orphan to a live node. Use when the heuristic could not match (semantic rename, body rewrite).
- `sm orphans undo-rename <new.path>` — reverse direction. Reads `issue.data.from` from the active `auto-rename-medium` (or `--from`-disambiguated `auto-rename-ambiguous`) issue on `<new.path>`, migrates `state_*` FKs back, and resolves the issue. The prior path becomes an `orphan`. Use when the heuristic matched two unrelated files that happened to share a frontmatter hash.

Both verbs operate on FK ownership only; neither edits files on disk.

---

## Integrity

`sm doctor` MUST check at least:

- DB file exists and is readable.
- `PRAGMA quick_check` (or equivalent) returns OK.
- Applied migration version matches code-bundled migrations.
- No orphan job files (`.skill-map/jobs/*.md` without a matching DB row).
- No orphan DB rows (jobs whose `file_path` does not exist).
- No plugin in `load-error` or `incompatible-spec` status.

Failures are reported with suggested remediation (e.g., "run `sm db migrate`", "run `sm job prune --orphan-files`").

---

## See also

- [`architecture.md`](./architecture.md) — `StoragePort` interface definition and dependency rules.
- [`plugin-kv-api.md`](./plugin-kv-api.md) — `ctx.store` accessor for mode A / mode B persistence.
- [`job-lifecycle.md`](./job-lifecycle.md) — atomic claim and TTL/reap semantics that drive `state_jobs`.
- [`cli-contract.md`](./cli-contract.md) — `sm db` verb surface (reset, backup, restore, migrate).

---

## Stability

The **three-zone model** and the **naming conventions** are stable as of spec v1.0.0. Adding a fourth zone is a major bump.

The **table catalog** above is stable within a spec major version. Adding a column to a kernel table is a minor bump (consumers MUST ignore unknown columns). Adding a table is a minor bump. Removing or renaming a column is a major bump.

Plugin storage mode names (`kv`, `dedicated`) are stable. Adding a third mode is a minor bump.
