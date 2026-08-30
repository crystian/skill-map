# Database schema

Normative catalog of tables owned by the kernel. Plugins MAY add their own tables under a strict prefix (see [`plugin-kv-api.md`](./plugin-kv-api.md)). An implementation MUST provision every kernel table described here and MUST reject writes that violate the stated constraints.

The spec assumes a relational, SQL-like store but is **engine-agnostic**. The reference implementation uses SQLite (`node:sqlite`) + Kysely + `CamelCasePlugin`. Alternative backends (Postgres, DuckDB, in-memory) are permitted as long as:

- Atomic single-statement transitions are available for the job claim (see [`job-lifecycle.md`](./job-lifecycle.md)).
- Migrations track applied versions per scope.
- Read isolation avoids phantom reads inside a single scan write.

---

## Scope and location

One scope. Skill-map operates on the project scope only (`<cwd>/.skill-map/`). No global / user-level DB; the CLI never reads `$HOME` by default (see `cli-contract.md` §Scope is always project-local). To reach content outside the current repository the user passes a positional root to `sm scan [roots...]`, or places a symbolic link inside the tree (the walker follows it to its target); either way the results land in the same project DB.

| Scope | Default DB location | Scan roots |
|---|---|---|
| `project` | `<cwd>/.skill-map/skill-map.db` | The current repository, plus any positional roots or symlink targets the scan reached. |

The project DB is gitignored by default, together with its `-wal` / `-shm` sidecars (the scope ignore file, [`cli-contract.md` §Scope ignore file](./cli-contract.md)). Teams MAY share it by re-including it with a `!skill-map.db` line in that file; the file is then committed and the execution log becomes a team artifact. Use the `!` negation rather than deleting the line, a deleted entry is topped up again on the next scan while a negation is honoured.

The `--db <path>` CLI flag overrides the DB location as an escape hatch (debugging, custom layouts).

---

## Zones

Every kernel table belongs to exactly one zone, identified by a mandatory prefix.

| Zone | Prefix | Nature | Regenerable | Backed up | Example |
|---|---|---|---|---|---|
| Scan | `scan_` | Output of the last scan. Truncated and repopulated by `sm scan`. | Yes | Yes (rides the file copy) | `scan_nodes` |
| State | `state_` | Persistent operational data: jobs, executions, summaries, enrichment, plugin KV, the runtime activity-stats checkpoint. | No | Yes | `state_jobs` |
| Config | `config_` | Kernel-owned durable bookkeeping: the internal preference cache, migration ledger. User-facing configuration lives in `.skill-map/settings.json`, not here. | No | Yes | `config_preferences` |

`sm db reset` drops `scan_*` only (non-destructive, equivalent to forcing the next scan from a clean slate). `sm db reset --state` also drops `state_*` (destructive to operational history). `sm db reset --hard` deletes the DB file entirely. `sm db backup` is a WAL checkpoint plus a copy of the whole DB file, so `scan_*` rides along rather than being filtered out; it is regenerable, so a restored backup carrying stale scan rows is refreshed by the next `sm scan`.

**Active-provider lens change**: switching the `activeProvider` setting (see [`cli-contract.md` §Active provider lens](./cli-contract.md#active-provider-lens) and [`architecture.md` §Active Provider Lens](./architecture.md#active-provider-lens)) drops the `scan_*` zone atomically and triggers a fresh scan under the new lens. Same effect as `sm db reset` then `sm scan`, but one transaction so the user never sees an empty graph between the two. `state_*` and `config_*` are preserved. The lens value itself is NOT a DB row: `activeProvider` lives in `<cwd>/.skill-map/settings.json` (project config), so it is untouched by the zone drop.

---

## Naming conventions (normative)

These analyzers apply to every kernel table and to every plugin-authored table under its prefix.

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
- **Constraints**: `fk_`, `uq_`, `ck_` prefixes. Same caveat for plugins.
- **SQL keywords**: UPPERCASE. Identifiers lowercase.

The kernel MUST reject any plugin migration that violates these analyzers at validation time (see `plugin-kv-api.md`).

Domain types exposed to driving adapters use `camelCase`. The SQLite reference impl uses Kysely's `CamelCasePlugin` to bridge `snake_case ↔ camelCase` at the port boundary.

---

## Table catalog: zone `scan_`

### `scan_nodes`

One row per detected node, matching [`schemas/node.schema.json`](./schemas/node.schema.json).

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `path` | TEXT | PRIMARY KEY | Relative path from scope root. Canonical node identifier. |
| `kind` | TEXT | NOT NULL | Open-by-design (`node.schema.json#/properties/kind`): whatever the classifying Provider declares. Built-in catalogs: `claude` ships `skill` / `agent` / `command` / `mcp`; `codex` ships `agent`; `agent-skills` ships `skill`; `core/markdown` ships the format-named generic fallback `markdown` (universal, picks up any `.md` no vendor Provider claims, see `architecture.md` §Provider · dispatch order). The `antigravity` Provider reuses the `agent-skills` `skill` kind + classifier (manifest composition), so under its lens `.agents/skills/<n>/SKILL.md` rows carry `provider: 'antigravity'`, `kind: 'skill'`. External Providers MAY emit their own. |
| `provider` | TEXT | NOT NULL | Provider extension id. |
| `title` | TEXT | NULL | |
| `description` | TEXT | NULL | |
| `stability` | TEXT | CHECK in (`experimental`, `stable`, `deprecated`) OR NULL | Denormalized from frontmatter. |
| `version` | TEXT | NULL | Denormalized from frontmatter. |
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
| `modified_at_ms` | INTEGER | NULL | File `mtime` in Unix ms, captured at scan time from `lstat`. NULL for virtual / derived nodes (no backing file). Drives the UI "last modified" sortable column; never hashed. |
| `virtual` | INTEGER | NOT NULL DEFAULT 0 | 1 for a synthetic node with no backing file (e.g. `mcp://<server>` materialised by `core/mcp-tools` from a skill's `tools:` frontmatter), 0 for a file-backed node. Round-tripped so a DB-loaded prior recognises virtual nodes. |
| `derived_from_json` | TEXT | NULL | JSON array of the source node paths a virtual node was derived from. Drives cache-hit carry-forward + invalidation across incremental scans (a cached rescan skips the source's extractor, so the virtual node is re-injected from the prior while at least one source survives as a cache hit). NULL for non-virtual nodes. |

Indexes: `ix_scan_nodes_kind`, `ix_scan_nodes_provider`, `ix_scan_nodes_body_hash` (rename heuristic).

### `scan_links`

One row per detected link, matching [`schemas/link.schema.json`](./schemas/link.schema.json).

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | |
| `source_path` | TEXT | NOT NULL | FK semantically; MAY be unenforced for performance. |
| `target_path` | TEXT | NOT NULL | MAY point to a missing node (broken ref). |
| `kind` | TEXT | NOT NULL, CHECK in (`invokes`, `references`, `mentions`, `points`) | |
| `confidence` | REAL | NOT NULL, CHECK `>= 0.0 AND <= 1.0` | Numeric `[0,1]` (`link.schema.json#/properties/confidence`). The kernel's 1.0 baseline folded with every `score`-phase `ctx.adjustConfidence` op (the built-in detectors `core/name-reserved`, `core/reference-broken`, plus any third-party scorer); per-op attribution lives in `scan_link_scores`. Migrated from the legacy `high`/`medium`/`low` TEXT enum. |
| `sources_json` | TEXT | NOT NULL | JSON array of extractor ids. |
| `original_trigger` | TEXT | NULL | |
| `normalized_trigger` | TEXT | NULL | |
| `location_line` | INTEGER | NULL | |
| `location_column` | INTEGER | NULL | |
| `location_offset` | INTEGER | NULL | |
| `raw` | TEXT | NULL | |

Indexes: `ix_scan_links_source_path`, `ix_scan_links_target_path`, `ix_scan_links_normalized_trigger`.

### `scan_issues`

One row per analyzer-emitted issue, matching [`schemas/issue.schema.json`](./schemas/issue.schema.json).

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | |
| `analyzer_id` | TEXT | NOT NULL | |
| `severity` | TEXT | NOT NULL, CHECK in (`error`, `warn`, `info`) | |
| `node_ids_json` | TEXT | NOT NULL | JSON array. |
| `link_indices_json` | TEXT | NULL | JSON array of `scan_links.id`. |
| `message` | TEXT | NOT NULL | |
| `detail` | TEXT | NULL | |
| `fix_json` | TEXT | NULL | |
| `data_json` | TEXT | NULL | |

Indexes: `ix_scan_issues_analyzer_id`, `ix_scan_issues_severity`.

**Issue suppressions apply at EMISSION time, not read time.** Issues carry no stable row id (`id` is per-scan AUTOINCREMENT, the table is replace-all on every scan), so the durable dismissal grain is the value pair `(analyzer, data_json.target)` stored in the node's `annotations.issueSuppressions` (`.sm` sidecar, [`schemas/annotations.schema.json`](./schemas/annotations.schema.json)), a deliberate divergence from the findings READ-time lens above (`state_findings` rows survive re-runs and are worth lensing; `scan_issues` rows do not). `sm issues dismiss` additionally DELETEs the matching rows here so reads agree without waiting for a rescan; the delete converges regenerable machine state toward the next scan's output. **The KERNEL applies the suppression, not the analyzer.** The orchestrator's analyzer pass drops every emitted issue whose `(analyzer, data.target)` pair matches an active entry on ANY of the issue's `nodeIds`, right after severity validation and before the issue reaches the accumulator: the dismiss affordance is offered generically (any issue carrying a `data.target`), so honouring it must be generic too, and a deterministic analyzer, built-in or third-party, needs no suppression code to be dismissable. An analyzer consults the entries itself ONLY when the dismissal must also skip a SIDE EFFECT the central drop cannot undo, today just `core/reference-broken`'s confidence penalty on the flagged link. Contract for analyzers adopting value-keyed dismissal: the verbatim dismissable value MUST land in `data_json.target`, that column path is what the kernel's emission-time matcher, any analyzer-side guard, and the dismiss-time delete all key on. The per-node `.sm` grain has a project-level sibling: `core/reference-broken`'s committed `ignored-references` setting (`plugins.core.extensions.reference-broken.settings.ignored-references`, a `match-list`) is consulted at the same emission point and likewise skips both the issue and the confidence penalty, with no node anchor and no row to delete (the entries live in `settings.json`, not in `.sm`).

### `scan_meta`

Single-row table holding the last persisted scan's metadata. Lets `loadScanResult` return the real `roots` / `scannedAt` / `scannedBy` / `providers` / `stats.filesWalked|filesSkipped|durationMs` instead of synthesising them. Replaced atomically with the rest of `scan_*` on every `sm scan`.

`nodesCount` / `linksCount` / `issuesCount` are not stored here, they derive from `COUNT(*)` of the sibling tables.

| Column | Type | Constraint |
|---|---|---|
| `id` | INTEGER | PRIMARY KEY, CHECK `id = 1` |
| `roots_json` | TEXT | NOT NULL | JSON array of strings (filesystem roots walked). |
| `scanned_at` | INTEGER | NOT NULL | Unix milliseconds. |
| `scanned_by_name` | TEXT | NOT NULL |
| `scanned_by_version` | TEXT | NOT NULL |
| `scanned_by_spec_version` | TEXT | NOT NULL |
| `providers_json` | TEXT | NOT NULL | JSON array of Provider ids. |
| `stats_files_walked` | INTEGER | NOT NULL |
| `stats_files_skipped` | INTEGER | NOT NULL |
| `stats_duration_ms` | INTEGER | NOT NULL |
| `scan_ceiling` | INTEGER | NOT NULL | Effective walk ceiling for this scan (`--max-scan` override, else `scan.maxScan`, default 5000). The scan walks + reference-validates the full corpus up to this number. Carried on `ScanResult.scanCeiling`. |
| `scan_truncated` | INTEGER | NOT NULL | 1 when the walker reached `scan_ceiling` and dropped files in stable provider-walker order, 0 otherwise. Drives the UI "scan truncated" banner pointing at the `.skillmapignore` editor. Carried on `ScanResult.scanTruncated`. |
| `max_render_nodes` | INTEGER | NOT NULL | Effective map render cap (`--max-nodes` override, else `scan.maxNodes`, default 256). The full corpus is persisted regardless; this bounds only the graph projection (the folders tree shows everything). Carried on `ScanResult.maxRenderNodes`. |
| `tokenizer` | TEXT | NULL | Resolved offline encoder that produced this scan's per-node token counts (closed enum `cl100k_base` / `o200k_base`, see `project-config.md` / `project-config.schema.json` §tokenizer). Carried on the `ScanResult.tokenizer` wire field. NULL on a pre-feature DB or a scan with tokenization disabled. On `sm scan --changed` the orchestrator compares this against the freshly-resolved encoder and, when they differ (or the stored value is NULL), bypasses cached per-node token reuse so `buildNode` recomputes counts with the current encoder; changing the tokenizer thus invalidates prior counts. |
| `active_provider` | TEXT | NULL | Active provider LENS this scan ran under (the id of the gated Provider whose grammar the corpus was read with, see `architecture.md` §Active-lens scope for providers). Carried on the `ScanResult.activeProvider` wire field. NULL on a pre-feature DB or a project with no resolvable lens. Read back by the next incremental scan exactly like `tokenizer` above: a stored value that differs from the freshly-resolved lens (or a NULL against a resolved lens) invalidates the WHOLE node cache, because the lens decides per-node classification (which Provider claims a file, as which kind) and gates the provider-specific Extractors, so every cached `(provider, kind)` pairing is stale. Switching the lens through `sm config set activeProvider` or `POST /api/active-provider` already drops the entire `scan_*` zone; this column defends the same invariant at the CONSUMER, catching a lens changed out of band (a hand-edited or pulled `settings.json`), where no mutation site ran. |
| `schema_fingerprint` | TEXT | NULL | sha256 (hex) of the migration DDL the schema was built from, written at persist time. NULL on a DB created by a pre-fingerprint CLI; a NULL (or mismatching) value is read as schema drift (see §Schema drift). Internal DB metadata, NOT carried on the `ScanResult` wire shape. |

The `scope` column was removed pre-1.0 along with the `-g/--global` flag (see `cli-contract.md` §Scope is always project-local); every persisted scan is project-scoped so the column carried nothing worth round-tripping. Older DBs are not migrated; the drop is a greenfield change and a fresh `sm init` regenerates the schema.

No indexes (single row).

### `scan_extractor_runs`

Fine-grained cache breadcrumbs for the incremental scan path. One row per `(node_path, extractor_id)` recording the body hash the Extractor saw the last time it ran against that node. Replace-all on every `sm scan` so rows for uninstalled Extractors disappear automatically.

The orchestrator consults this table on every incremental scan (the `sm scan` default; `--changed` is the explicit alias): a node-level cache hit (body+frontmatter unchanged) upgrades to a full skip ONLY when every currently-registered Extractor (filtered by its `precondition`) has a row matching the prior body hash, sidecar-annotations hash, AND resolved-settings hash. A new Extractor registered between scans is detected by the absence of its row and runs over the cached node WITHOUT a full cache invalidation; without this table its emissions would go missing on the next incremental pass. The same machinery lets a future Action-issued probabilistic enrichment reuse paid LLM output across unchanged bodies.

| Column | Type | Constraint |
|---|---|---|
| `node_path` | TEXT | NOT NULL | FK semantically to `scan_nodes.path`; MAY be unenforced (the row is deleted in the same tx as the parent node when the file disappears). |
| `extractor_id` | TEXT | NOT NULL | Qualified id `<plugin_id>/<id>` per spec § A.6. |
| `body_hash_at_run` | TEXT | NOT NULL | The `node.body_hash` the Extractor processed; sha256, hex. |
| `sidecar_annotations_hash_at_run` | TEXT | NOT NULL | sha256 of the canonical-form `node.sidecar.annotations` block the Extractor saw on its run. Always populated; an absent sidecar or one without annotations canonicalises to `{}` so the hash stays stable across "no sidecar" → "empty annotations" transitions. Participates in the cache hit condition for every Extractor: a `.sm`-only edit invalidates the cached run, no opt-in flag required. The author-facing flag alternative was rejected (forgetting it yielded silent stale-data bugs); universal invalidation costs one re-run on sidecar edits (negligible: sidecars change rarely, Extractors are pure-CPU). |
| `settings_hash_at_run` | TEXT | NOT NULL DEFAULT '' | sha256 of the canonical-form resolved settings the Extractor saw on its run (the merged `ctx.settings` bag: committed keys, project-local secrets, env-var overrides; an extension without settings canonicalises to `{}`). Third leg of the cache hit condition, same universal-invalidation rationale as the sidecar hash: with the incremental scan as the default, a settings change (`sm plugins config`, the Settings UI, a secret's `envVar` appearing or changing) MUST re-run the pair on the next scan, or the graph silently serves outputs computed under superseded settings. |
| `ran_at` | INTEGER | NOT NULL | Unix milliseconds, wall-clock when the Extractor finished or was last carried forward via cache reuse. For diagnostics + future GC of stale rows. |

Primary key: `(node_path, extractor_id)`. Indexes: `ix_scan_extractor_runs_node`, `ix_scan_extractor_runs_extractor`.

**Source-attribution interaction.** `scan_links.sources_json` carries the *short* extractor id the author wrote (e.g. `'slash'`); this table keys on the *qualified* form (`'core/slash-command'`). When a cached link is reshaped on reuse the orchestrator strips short ids whose owning Extractor is no longer registered (a removed extractor must not stay attributed); links whose sole source is an uninstalled Extractor disappear; links whose sources include a missing-but-still-registered Extractor are dropped so it can re-emit fresh.

### `node_enrichments`

Universal enrichment layer (A.8). Stores `ctx.enrichNode(partial)` outputs separately from the author-supplied frontmatter on `scan_nodes.frontmatter_json`, which the Extractor pipeline NEVER mutates.

One row per `(node_path, extractor_id)` pair an Extractor enriched. Extractors are deterministic-only; rows are overwritten via PRIMARY KEY conflict on the next re-extract through the A.9 cache.

| Column | Type | Constraint |
|---|---|---|
| `node_path` | TEXT | NOT NULL | FK semantically to `scan_nodes.path`; replaced when a rename heuristic fires (mirrors the `state_*` FK migration). |
| `extractor_id` | TEXT | NOT NULL | Qualified id `<plugin_id>/<id>` per spec § A.6. |
| `body_hash_at_enrichment` | TEXT | NOT NULL | The `node.body_hash` the Extractor saw when it produced this enrichment. Always equal to the live body hash for Extractor writes; reserved for future Action-issued probabilistic enrichments where stale tracking matters. |
| `value_json` | TEXT | NOT NULL | JSON-serialised `Partial<Node>`, the cumulative merge of every `enrichNode(...)` call the Extractor made for this node within its `extract()` invocation. |
| `stale` | INTEGER | NOT NULL DEFAULT 0, CHECK in (0, 1) | Reserved. Always `0` in this revision (Extractors are deterministic; re-running is free). Flag and index kept for the future Action-prob enrichment revision where queued LLM jobs must preserve paid output across body changes. |
| `enriched_at` | INTEGER | NOT NULL | Unix milliseconds, when the Extractor produced this enrichment. Drives read-time merge order (`ASC` → last-write-wins per field) inside `mergeNodeWithEnrichments`. |
| `is_probabilistic` | INTEGER | NOT NULL DEFAULT 0, CHECK in (0, 1) | Reserved. Always `0` for Extractor writes (deterministic-only). For the future Action-prob revision where the writer's mode is denormalised onto the row so the stale-flag query stays single-table. |

Primary key: `(node_path, extractor_id)`. Indexes: `ix_node_enrichments_node`, `ix_node_enrichments_stale`. The `_stale` index is dormant in this revision (every row has `stale = 0`); preserved so the future Action-prob revision ships without a schema migration.

**Persistence flow** (per `sm scan`):

1. **Rename migration**, for every `RenameOp` from the rename heuristic, update `node_enrichments.node_path` from `op.from` to `op.to` so the audit trail tracks the file like `state_*` rows do.
2. **Drop-on-disappear**, delete every row whose `node_path` is no longer in the live node set.
3. **Upsert**, for every `(node_path, extractor_id)` pair the orchestrator emitted in this scan, upsert with `stale = 0`, `is_probabilistic = 0`, and the current `body_hash`. The PRIMARY KEY conflict refreshes `body_hash_at_enrichment` / `value_json` / `enriched_at` on every re-run.
4. **Stale flagging**, no-op in this revision (Extractors are deterministic-only; the sweep finds nothing to flag). Preserved so the future Action-prob revision slots in without reshaping the contract.

**Read-side `node.merged` view.** Analyzers / `sm check` / `sm export` consume `node.frontmatter` directly (deterministic CI-safe baseline). UI / future opt-in consumers call `mergeNodeWithEnrichments(node, enrichments)` which:

1. Filters `enrichments` to rows targeting this node AND not flagged stale.
2. Sorts by `enriched_at` ASC.
3. Spread-merges each `value` over the author frontmatter (last-write-wins per field).

Stale row visibility is opt-in via `mergeNodeWithEnrichments(node, enrichments, { includeStale: true })`, a no-op today (no rows are stale-flagged); preserved for the future Action-prob revision noted above.

**Refresh verbs** (see [`cli-contract.md` §Scan](./cli-contract.md#scan)):

- `sm enrich <node.path>` re-runs Extractors against a single node and upserts their enrichment rows. Deterministic-only, they always run for real and persist.
- `sm enrich --stale` batches the granular form across every node carrying at least one stale row; in this revision the stale set is always empty so the verb prints a "nothing to do" advisory and exits `0`.

### `scan_contributions`

View contribution system (Phase 3). Per-node typed payloads emitted by extractors via `ctx.emitContribution(id, payload)` (and by analyzers via `ctx.emitScopeContribution(id, payload)` for scope-level slots). One row per `(plugin_id, extension_id, node_path, contribution_id)` tuple.

| Column | Type | Constraint |
|---|---|---|
| `plugin_id` | TEXT | NOT NULL | Owning plugin namespace per spec § A.6. |
| `extension_id` | TEXT | NOT NULL | Extension id within the plugin. |
| `node_path` | TEXT | NOT NULL | FK semantically to `scan_nodes.path`; orphan-swept on persist when the parent node disappears. |
| `contribution_id` | TEXT | NOT NULL | Manifest Record key under `extension.ui[<contributionId>]` (the runtime catalog keeps the historical name `viewContributions`). |
| `slot` | TEXT | NOT NULL | Closed-enum-by-spec slot name; mirror of `view-slots.schema.json#/$defs/SlotName`. Kept open at the SQL layer (no CHECK) so catalog evolution needs no DDL migration; `sm plugins upgrade` handles renames at the manifest layer. |
| `payload_json` | TEXT | NOT NULL | JSON-serialised payload, already validated against the slot's payload schema (`view-slots.schema.json#/$defs/payloads/<slot>`) at emit time. Off-shape payloads emit `extension.error` and drop silently. |
| `emitted_at` | INTEGER | NOT NULL | Unix milliseconds. |

Primary key: `(plugin_id, extension_id, node_path, contribution_id)`. Indexes: `ix_scan_contributions_node_path` (inspector lazy-fetch + orphan sweep), `ix_scan_contributions_plugin_id` (catalog sweep + `purgeByPlugin`).

**Persistence, orphan + catalog + per-tuple sweep + upsert (NOT pure replace-all).** The watcher's cached pass leaves the buffer empty for cached nodes (the orchestrator skips `extract()` on a per-(node, extractor) cache hit, so no `emitContribution` fires), and a naive wipe-all would drop the prior valid rows on every watcher boot. The persist runs four passes inside the same tx as the rest of the scan zone:

1. **Orphan sweep**, drops every row whose `node_path` is NOT in the current live node set (`livePaths` derived from `result.nodes`). Disappeared nodes lose their contributions automatically.
2. **Catalog sweep**, drops every row whose qualified id `(pluginId, extensionId, contributionId)` is NOT in the registered runtime catalog (`registeredContributionKeys` collected via `collectRegisteredContributionKeys(composed)`). Uninstalled-on-disk plugins and removed contributions lose their rows on the next scan. Disabled plugins are normally purged eagerly by `sm plugins disable` (see `purgeByPlugin` below); this is the fallback for the rare "config flipped between scans without going through the CLI" case.
3. **Per-tuple sweep**, for every `(pluginId, extensionId, node_path)` tuple in `freshlyRunTuples` (extension actually ran against that node this scan: extractor cache miss, OR analyzer), drop any row carrying that triple whose `contribution_id` is NOT refreshed by the buffer. Catches the "extractor used to emit, now does not" case without touching cached-extractor rows. Tuple format: `<pluginId>/<extensionId>/<nodePath>`.
4. **Upsert**, `INSERT ... ON CONFLICT DO UPDATE SET payload_json = excluded.payload_json, slot = excluded.slot` for every row in the buffer. PK conflict refreshes `payload_json` + `slot` + `emitted_at`.

Cached nodes' rows survive untouched: neither orphaned (still in the live set) nor uninstalled (still in the catalog) nor in `freshlyRunTuples` (extractor short-circuited via cache) nor in the buffer (no re-emit). When the body next changes, the extractor re-runs, the tuple lands in the freshly-run set, and either the upsert refreshes the row or the per-tuple sweep drops it.

**Backwards-compat fallbacks.** `IPersistOptions.livePaths`, `IPersistOptions.registeredContributionKeys`, `IPersistOptions.freshlyRunTuples` are all optional, so older callers preserve the pre-fix behaviour. Absent / empty `livePaths` falls back to wipe-all (legacy behaviour); `registeredContributionKeys` skips the catalog sweep (rows for disabled plugins linger until next purge); `freshlyRunTuples` skips the per-tuple sweep (rows that should have been dropped because an extractor stopped emitting linger until the node body, the extractor registration, or the node existence changes again).

NOT analogous to `state_plugin_kvs` (which is plugin-managed). Belongs to the `scan_*` family; sweep semantics replace pure replace-all but the data is still scan-derived.

**Eager purge on disable.** `sm plugins disable <id>` calls `StoragePort.contributions.purgeByPlugin(pluginId, extensionId)` immediately after persisting the extension's `enabled = false` in the config layers. Every persisted toggle key is the qualified `<plugin>/<ext>` shape (the CLI's bundle macro form and the BFF's cascade endpoint expand bare plugin ids before persistence), so the purge always receives both segments. Avoids the "I disabled the extension but its chips still render until I re-scan" gap. Re-enabling (`sm plugins enable <id>`) does NOT restore the rows; the next scan re-emits them, same as a cold start. Contributions are scan-derived, so this is cheap; for plugin-managed state (`state_plugin_kvs`) the opposite policy holds, see `plugin-kv-api.md` § "disable does not drop data".

### `scan_link_scores`

Per-op confidence-attribution audit trail. One row per attributed `ctx.adjustConfidence(link, op)` call buffered by a `score`-phase analyzer during the scan (the built-in detectors `core/name-reserved`, `core/reference-broken` apply penalty deltas on top of the kernel's 1.0 baseline; third-party scorers add their own). Lets an operator answer "why is this link at `0.3`?" by listing the plugin / extension / op that moved it, with the FOLDED final value denormalised onto every row.

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `plugin_id` | TEXT | NOT NULL | Owning plugin namespace of the scorer (per spec § A.6). `core` for the built-in detectors (`name-reserved` / `reference-broken`). |
| `extension_id` | TEXT | NOT NULL | Scorer extension id within the plugin. |
| `source_path` | TEXT | NOT NULL | The link's `source` (originating node path). Part of the structural identity key, the same tuple `scan_links` dedups on. |
| `target` | TEXT | NOT NULL | The link's `target` (MAY be a missing node: broken refs get scored too). |
| `kind` | TEXT | NOT NULL | The link's `kind` (`invokes` / `references` / `mentions` / `points`). |
| `normalized_trigger` | TEXT | NULL | The link's `trigger.normalizedTrigger`; NULL for path-style links that carry no trigger. Completes the structural identity key. |
| `op_kind` | TEXT | NOT NULL | Confidence-algebra bucket: `set` / `delta` / `ceil` / `floor`. Kept open at the SQL layer (no CHECK) so the op catalog can evolve as a kernel + spec change without a DDL migration. |
| `op_value` | REAL | NOT NULL | The op's operand. |
| `result_confidence` | REAL | NOT NULL | Denormalised FOLDED final `link.confidence` after every op for this link applied. Equal across all rows for one link; mirrors `scan_links.confidence` for the same structural edge so the audit read needs no join. |
| `emitted_at` | INTEGER | NOT NULL | Unix milliseconds. |

No primary key (multiple ops MAY land on one link). Index: `ix_scan_link_scores_source_path` (per-node "why this link?" lookup).

**Persistence, plain replace-all per scan** (delete every row, then insert), the same posture as `scan_issues` / `scan_contribution_errors`, NOT the orphan/catalog/per-tuple sweep `scan_contributions` uses. A score adjustment is a transient scan finding re-derived in full on every analyzer pass, so no cached-node row to preserve. An empty buffer (scorers touched nothing) wipes the table, clearing stale rows from a prior scan.

### `scan_node_tags`

Tags. One row per `(node_path, tag)` pair, projected at persist time from `sidecar.annotations.tags`. Tags are a skill-map concept (no vendor carries `tags` in frontmatter), so the sidecar is the single source. Drives `sm list --tag <name>` and the UI's tag-faceted search; the `(tag)` index keeps "find all nodes with tag X" at `O(log n)`.

| Column | Type | Constraint |
|---|---|---|
| `node_path` | TEXT | NOT NULL | FK semantically to `scan_nodes.path`; orphan-swept on persist when the parent node disappears. |
| `tag` | TEXT | NOT NULL | Free-form; case-preserving. Empty strings rejected upstream by the schema's `minLength: 1` on each item. |

Primary key: `(node_path, tag)`. Indexes: `ix_scan_node_tags_tag` (search by tag), `ix_scan_node_tags_node_path` (per-node lookup, e.g. inspector projection).

**Persistence, replace-all per scan.** Every persisted scan rebuilds the table for the live node set: rows whose `node_path` is NOT in `livePaths` are dropped (orphan sweep, same as the contributions table); rows for nodes in the live set are wiped and re-inserted from the projected sidecar state. Cached nodes' tag rows project from the cached `node.sidecar.annotations.tags` (already in memory), so the rebuild is cheap regardless of cache hit / miss. Storage is small: a 50-node project with avg 3 tags/node is ~150 rows ≈ 7.5 KB.

The wire shape on `/api/nodes` joins this table to project `node.tags = string[]`. The kernel `Node` interface (TypeScript) does NOT carry `tags`; consumers walking the canonical source read `node.sidecar.annotations.tags` directly (consistent with the post-decision-#2 posture).

---

## Table catalog: zone `state_`

### `state_jobs`

Matching [`schemas/job.schema.json`](./schemas/job.schema.json). See [`job-lifecycle.md`](./job-lifecycle.md) for the state machine and transitions.

| Column | Type | Constraint |
|---|---|---|
| `id` | TEXT | PRIMARY KEY |
| `extension_id` | TEXT | NOT NULL |
| `extension_version` | TEXT | NOT NULL |
| `extension_kind` | TEXT | NOT NULL, CHECK in (`action`, `analyzer`) |
| `node_id` | TEXT | NOT NULL |
| `content_hash` | TEXT | NOT NULL |
| `nonce` | TEXT | NOT NULL |
| `priority` | INTEGER | NOT NULL DEFAULT 0 |
| `auto_fix` | INTEGER | NOT NULL DEFAULT 0 (per-job auto-fix opt-in frozen at submit, [`job-lifecycle.md`](./job-lifecycle.md) §Auto-fix chain (per-job)) |
| `finding_ids_json` | TEXT | NULL (JSON array of `state_findings` ids frozen at submit for a finding-subset FIXER job; NULL = whole-node targeting, [`job-lifecycle.md`](./job-lifecycle.md) §Findings injection for fixers · Finding-subset targeting) |
| `status` | TEXT | NOT NULL, CHECK in (`queued`, `running`, `completed`, `failed`, `cancelled`) |
| `failure_reason` | TEXT | NULL, CHECK in (`runner-error`, `report-invalid`, `timeout`, `abandoned`, `job-file-missing`, `user-failed`). NULL for a `cancelled` job (self-explanatory, no reason). |
| `runner` | TEXT | NULL, CHECK in (`agent`, `in-process`) |
| `ttl_seconds` | INTEGER | NULL (NULL = never expires; armed only by explicit operator sources, see `job-lifecycle.md` §TTL resolution) |
| `created_at` | INTEGER | NOT NULL |
| `claimed_at` | INTEGER | NULL |
| `finished_at` | INTEGER | NULL |
| `expires_at` | INTEGER | NULL |
| `submitted_by` | TEXT | NULL |

Indexes: `ix_state_jobs_status`, `ix_state_jobs_extension_node_hash` (unique partial index WHERE `status IN ('queued','running')` for duplicate detection).

The queue is kind-agnostic: `extension_id` names a probabilistic **Action** or a probabilistic **Analyzer** (qualified id, version frozen at submit). The columns were renamed from `action_id` / `action_version` when Analyzers joined the queue; `state_executions.extension_id` set the naming precedent. `extension_kind` freezes the RESOLVED kind at submit time (like the version): it is what `sm record` routes on, so a plugin shipping a probabilistic Action AND Analyzer under one extension id stays unambiguous end-to-end (the submit-side `<kind>:` prefix picks, the row remembers). A SKILL-ACTION job ([`skill-actions.md`](./skill-actions.md)) freezes `extension_kind = 'action'` with a `skill:<name>` `extension_id`: it behaves exactly like a probabilistic Action end to end, the id prefix carries the provenance (record-time report resolution routes on it), and the CHECK constraint needs no new member.

The rendered job content is NOT stored on this table. It lives in `state_job_contents` keyed by `content_hash` so multiple jobs with identical action + node + template pairs share one physical blob. See `state_job_contents` below for the storage shape and GC contract.

### `state_job_contents`

Content-addressed store for the rendered MD content of every queued or completed job. Decouples content from the lifecycle row in `state_jobs` so retries / `--force` reruns / cross-node fan-out emissions of the same prompt all reference one blob.

| Column | Type | Constraint |
|---|---|---|
| `content_hash` | TEXT | PRIMARY KEY |
| `content` | TEXT | NOT NULL |
| `created_at` | INTEGER | NOT NULL |

No indexes (PK covers lookup by hash; the table is keyed-by-hash exclusively).

**Insertion semantics**: `INSERT OR IGNORE INTO state_job_contents(content_hash, content, created_at) VALUES (?, ?, ?)`, an existing row for the same hash is a no-op (the prior insert already paid the storage cost).

**GC contract**: `sm jobs prune` MUST delete every row whose `content_hash` is no longer referenced by any `state_jobs` row, in the same transaction that prunes the job rows. Implementations MUST NOT delete `state_job_contents` rows on `sm jobs cancel` (a cancelled job's content is recoverable via `sm jobs submit --force` of the same content_hash and dedup is desirable).

`content_hash` is the same hash `state_jobs.content_hash` carries, computed at submit time as `sha256` over the NUL-joined (`0x00`) tuple `(extensionId, extensionVersion, node.path, bodyHash, frontmatterHash, promptTemplateHash)`. Two jobs with identical `content_hash` MUST render to identical content (the formula covers every rendering input, including `node.path`, which the render embeds via the `<user-content id>` attribute); the table relies on this to dedup.

FK enforcement: SQLite foreign keys are off by default and the kernel does not currently turn them on (per `dialect.ts`). The `state_jobs.content_hash → state_job_contents.content_hash` relationship is enforced procedurally by the storage adapter (insert content row before job row in the same transaction; never delete content while jobs reference it). A future foreign-key push may upgrade this to a true FK without breaking the contract.

### `state_executions`

Matching [`schemas/execution-record.schema.json`](./schemas/execution-record.schema.json).

| Column | Type | Constraint |
|---|---|---|
| `id` | TEXT | PRIMARY KEY |
| `kind` | TEXT | NOT NULL, CHECK in (`action`) |
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
| `model` | TEXT | NULL |
| `report_json` | TEXT | NULL |
| `job_id` | TEXT | NULL |

Indexes: `ix_state_executions_extension_id`, `ix_state_executions_started_at`, `ix_state_executions_job_id`.

The full report payload (the JSON the model returned, validated against the action's own `report.schema.json`, a sibling of the action directory by convention) is stored inline in `report_json`. No on-disk report file. `sm jobs show <id>` and `sm history --json` read the column directly.

`model` is the executing model's name as SELF-REPORTED by the recording agent via `sm record --model <name>` (unverifiable by design, exactly like the token counts; NULL when the agent does not declare one). It answers "which model produced this analysis, and when" together with the timestamps, and is denormalized onto `state_findings.model` / `state_summaries.model` at record time for join-free display.

### `state_summaries`

One row per `(node_id, summarizer_action_id)`. See [`schemas/summaries/`](./schemas/summaries/).

| Column | Type | Constraint |
|---|---|---|
| `node_id` | TEXT | NOT NULL |
| `kind` | TEXT | NOT NULL |
| `summarizer_action_id` | TEXT | NOT NULL |
| `summarizer_version` | TEXT | NOT NULL |
| `body_hash_at_generation` | TEXT | NOT NULL |
| `generated_at` | INTEGER | NOT NULL |
| `model` | TEXT | NULL |
| `summary_json` | TEXT | NOT NULL |

Primary key: `(node_id, summarizer_action_id)`. Indexes: `ix_state_summaries_generated_at`.

**Writer.** `sm record` populates this table: when it closes a `completed` job for a summarizer Action (its `report.schema.json` extends the canonical node-summary schema under [`schemas/summaries/`](./schemas/summaries/) via `$ref`, see [`job-lifecycle.md` §Record](./job-lifecycle.md#record-callback)), it upserts the validated report here (`INSERT ... ON CONFLICT(node_id, summarizer_action_id) DO UPDATE`) inside the same transaction as the `state_executions` insert + job transition. `summary_json` holds the validated report; `summarizer_action_id` / `summarizer_version` mirror the job's `extension_id` / `extension_version` (a summarizer is always an Action, so the summary-side column keeps the specific name); `kind` mirrors the target `scan_nodes.kind`; `model` mirrors the recording agent's self-reported `--model` (NULL when undeclared); and `body_hash_at_generation` captures the node's `body_hash` at record time. The write is skipped (no row) when the target node has disappeared from `scan_nodes` between submit and record.

**Stale rule.** `sm show <node>` renders any stored summary for the node and marks it `(stale)` when `body_hash_at_generation` differs from the node's current `scan_nodes.body_hash` (the body was edited and rescanned since the summary was generated). The row is never auto-deleted on staleness; a fresh `sm record` for the same `(node_id, summarizer_action_id)` overwrites it in place.

### `state_findings`

Probabilistic findings: the judgments recorded by finder Analyzers (`mode: 'probabilistic'`), plus the kernel-derived safety rows synthesized from any probabilistic report's `safety` block. Read by `sm findings` and the UI findings surfaces. See [`schemas/findings/report.schema.json`](./schemas/findings/report.schema.json) for the report envelope and [`job-lifecycle.md` §Record](./job-lifecycle.md#record-callback) for the write path.

| Column | Type | Constraint |
|---|---|---|
| `id` | INTEGER | PRIMARY KEY |
| `node_id` | TEXT | NOT NULL |
| `extension_id` | TEXT | NOT NULL |
| `extension_version` | TEXT | NOT NULL |
| `origin` | TEXT | NOT NULL, CHECK in (`extension`, `kernel`) |
| `type` | TEXT | NOT NULL |
| `severity` | TEXT | NOT NULL, CHECK in (`info`, `warn`, `error`) |
| `message` | TEXT | NOT NULL |
| `detail` | TEXT | NULL |
| `confidence` | REAL | NOT NULL |
| `model` | TEXT | NULL |
| `resolution` | TEXT | NULL, CHECK in (`fixed`, `human-decision`, `dismissed`) |
| `resolution_actor` | TEXT | NULL, CHECK in (`human`, `fixer`) |
| `resolution_note` | TEXT | NULL |
| `resolution_by` | TEXT | NULL |
| `resolution_at` | INTEGER | NULL |
| `body_hash_at_generation` | TEXT | NOT NULL |
| `generated_at` | INTEGER | NOT NULL |
| `job_id` | TEXT | NULL |

Indexes: `ix_state_findings_node_id`, `ix_state_findings_extension_id`, `ix_state_findings_generated_at`.

**Writer.** `sm record` populates this table when it closes a `completed` job, in the SAME transaction as the `state_executions` insert and the job transition, through two lanes:

- **Finder lane** (`origin = 'extension'`): when the job's extension is a probabilistic **Analyzer**, each entry of the validated report's `findings[]` array becomes one row, suppressions included. **The read-time suppression lens**: an active sidecar suppression on the node (`annotations.suppressions`, matched by the emitting `extension_id` and, when the suppression narrows, the finding `type`; see [`schemas/annotations.schema.json`](./schemas/annotations.schema.json)) never drops or deletes rows, it HIDES the matching class at read time (`sm findings` reports it as the `dismissed` bucket; the card counters skip it). Rationale: the LLM already judged the class either way, so a record-time drop saved nothing and left `sm findings undismiss` with nothing to show until the next run; with the lens, an un-dismiss restores the current judgment instantly. Read surfaces source the suppressions from the write-through `scan_nodes.annotations_json` mirror (the `.sm` sidecar is the source of truth; dismiss / undismiss refresh the column for the touched node, `sm scan` refreshes it wholesale), ONE query and zero per-node file reads. **Single-node self-heal**: a `.sm` edited or deleted OUTSIDE skill-map leaves the mirror stale until reconciled; besides the scan, every single-node suppression touch reconciles the mirror from the live file on the spot: a finder submit refreshes it unconditionally (matched or not) and an `sm findings undismiss` whose target entry is absent from the file refreshes it before its exit-5, so the view stops hiding rows the truth no longer silences without waiting for a scan. A finder submit over a node with a matching suppression AUTO-UNDISMISSES it (asking for a fresh judgment is asking to see it; the entry is removed through the gated sidecar channel when the standing consent allows, else kept with an ahead-of-spend stderr advisory warning the judgment will be recorded hidden, see [`job-lifecycle.md` §Submit](./job-lifecycle.md#submit)). `extension_id` / `extension_version` mirror the job's columns; per-row `confidence` is the finding's own value when present, else the report-level `confidence`; `model` mirrors the recording agent's self-reported `--model` (NULL when undeclared); `body_hash_at_generation` captures the node's `scan_nodes.body_hash` at record time; `job_id` records provenance.
- **Safety lane** (`origin = 'kernel'`): for EVERY probabilistic report (Action or Analyzer) whose `safety` block flags trouble, the kernel synthesizes rows with the reserved type slugs: `injection-detected` (severity `warn`) when `safety.injectionDetected = true`, `content-suspicious` (severity `warn`) / `content-malformed` (severity `warn`) when `safety.contentQuality` is not `clean`. `extension_id` is the REPORTING extension's id (the summarizer or finder whose run surfaced the flag); `confidence` is the report-level value; `message` carries the kernel-templated statement (wording implementation-defined, `safety.injectionDetails` folded into `detail` when present). Extensions MUST NOT emit the reserved slugs themselves (enforced by convention in the canonical envelope; implementations SHOULD reject them at record time as `report-invalid`). **Replace scope is the NODE, not the reporting extension** (unlike the finder lane, which supersedes per (node, extension)): a safety row states a fact about the node's CONTENT, not about the run that noticed it, and every probabilistic report carries a COMPLETE safety verdict on the body it read (`injectionDetected` plus `contentQuality`). Recording a completed report therefore REPLACES the node's whole safety lane. Scoping it per extension would keep one copy of the same fact per extension that ever ran (six finders over one trapped file recorded the same injection six times, live-verified 2026-07-25); node scope collapses that to one row per fact and keeps the "a clean report erases a prior trouble flag" rule uniform: the newest reader of THIS body is the current verdict. Implementations SHOULD surface the lane distinctly in a UI (the row carries an `extension_id` that did not author its judgment).

**Finding lifecycle state.** The `resolution` column is a lifecycle STATE the finding moves through (`NULL` = open, `human-decision`, `fixed`, `dismissed`), with `resolution_note` (the one-line reason, verbatim), `resolution_by` (the qualified id of the fixer extension involved, NULL for a purely human resolution), `resolution_at`, and, on `fixed`, `resolution_actor` (who made the decision, see below). Two writers set it:

- **`sm record`**, when a fixer Action (one declaring `precondition.analyzerIds`) closes a job: per entry of its report's `resolved[]`, the kernel matches the finding by `id` and stamps the declared state. Entries whose `id` no longer exists, or whose finding does not belong to the job's target node AND one of the fixer's `analyzerIds`, are SKIPPED silently (a benign race, or a fixer reaching outside its scope, which it can never do).
- **`sm findings resolve <id>`** (and the equivalent UI action), the operator marking a finding `fixed` themselves ("I already handled this"): sets `resolution = 'fixed'`, `resolution_actor = 'human'`, `resolution_by = NULL` (no fixer ran), `resolution_note` optional.
- **`sm findings dismiss <id>`** (and the tray's per-row X), the ROW-grain dismissal (2026-07-22, user decision after a per-row X silently silenced a whole six-finding class): sets `resolution = 'dismissed'`, `resolution_actor = 'human'`, `resolution_by = NULL`, `resolution_note` optional. A row state, NOT the durable class suppression: no sidecar write, no consent, and the state dies with the row when the finder re-judges the node (a re-found defect reappears fresh, the honest outcome). Hidden from the default view under the same `dismissed` bucket as class-suppressed rows (`dismissedExcluded` counts both). `sm findings reopen <id>` (and the revealed row's restore) clears ANY resolution back to open. The durable class suppression stays available as `sm findings dismiss <id> --class` / the tray's silence-type affordance.

The states:

- **`human-decision`** (a fixer proposed but the choice is the author's; renamed from the earlier `declined`, which read as a dead-end when it is the opposite: the most action-demanding state). The fixer's `note` is its PROPOSAL, not a refusal. Stays VISIBLE in the default view (it is the author's TODO); the excluded-count line names any `human-decision` row that also went stale so it is never lost (see [`cli-contract.md`](./cli-contract.md)). `resolution_actor` is NULL (undecided).
- **`fixed`**, resolved. HIDDEN from the default `sm findings` view (handled), but NOT deleted: the row persists as the record that a fix ran and stays re-checkable. `fixed` is honest, it means "resolved", NOT "verified gone"; re-running the finder over the current body confirms (a clean verdict deletes the row, a still-present defect reopens it). `resolution_actor` records WHO decided the fix, by one rule: **any user interaction makes it `human`; only a fully autonomous fix with zero user interaction is `fixer`.** So an unattended processing run that applies a clear-cut fix is `fixer`; an interactive processing run where the operator approved the edit, chose among the fixer's options, or a `sm findings resolve` marks it `human`, because the judgment was the operator's even when the agent's tools did the typing. `resolution_by` still records which fixer extension ran (NULL for a pure `sm findings resolve`).

**Replace semantics.** Recording a completed job for `(node_id, extension_id)` first DELETEs every existing row for that pair (both origins), then inserts the fresh rows, in the same transaction. An empty `findings[]` with a clean safety block therefore ERASES the finder's previous judgment for the node: a clean verdict, not a no-op. The write is skipped entirely (previous rows kept) when the target node has disappeared from `scan_nodes` between submit and record, same rule as `state_summaries`.

**Stale rule.** A row whose `body_hash_at_generation` differs from the node's current `scan_nodes.body_hash` is **stale**: the judged body no longer exists. `sm findings` shows stale rows INLINE marked `(stale)` (`--stale` narrows to only them; staleness is a per-row annotation, not a hidden bucket, user call 2026-07-20); `sm show` marks them `(stale)` inline. Rows are never auto-deleted on staleness; the legitimate erasers are: a fresh record for the pair (replace semantics above), `sm findings prune` (stale rows only, the hygiene verb), `sm findings clear` (wholesale, per node or project-wide, fresh rows and kernel safety rows included; a reset, not a suppression, so a finder re-run regenerates whatever still applies, see [`cli-contract.md`](./cli-contract.md)), the per-row `DELETE /api/nodes/:pathB64/findings/:id` route (one row, the inspector's delete X on a revealed dismissed / fixed row; same all-origins rationale as clear, and deleting the last row of a dismissed class also lifts its exact `annotations.suppressions` entry so the class does not come back hidden, see [`cli-contract.md`](./cli-contract.md)), and the schema-drift rebuild (which wipes every `state_*` table). `sm findings dismiss` deletes NOTHING (the read-time suppression lens above hides the class instead). `sm scan` never touches this table (the probabilistic layer persists across scans).

### `state_enrichments`

One row per `(node_id, provider_id)`; `provider_id` carries the enriching Action's qualified id (e.g. `github/enrichment`).

**Writer.** `sm enrich` populates this table through the enrichments write-through convention (the mirror of the summaries one): an enabled deterministic Action whose report schema extends a schema under [`schemas/enrichments/`](./schemas/enrichments/) has its validated report upserted here (`data_json`), with `verified` lifted from the report when present, `fetched_at` stamped, and `stale_after` computed from the action's declared refresh policy (null = only body-hash drift marks it stale). Execution is gated by the `allowNetworkActions` project policy when the Action declares `io: ['network']`.

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

Shared key-value store for plugins that declared `"storage": { "mode": "kv" }`. See [`plugin-kv-api.md`](./plugin-kv-api.md) for the accessor contract.

| Column | Type | Constraint |
|---|---|---|
| `plugin_id` | TEXT | NOT NULL |
| `node_id` | TEXT | NULL | Optional scoping by node. |
| `key` | TEXT | NOT NULL |
| `value_json` | TEXT | NOT NULL |
| `updated_at` | INTEGER | NOT NULL |

Primary key: `(plugin_id, node_id, key)` with `node_id` using a sentinel empty string when NULL to satisfy PK constraints on engines that reject NULL in PK columns. Indexes: `ix_state_plugin_kvs_plugin_id`.

### `state_node_favorites`

Per-node "favorite" flag set by the local user from the UI. One row per favorited node, absence of a row means "not favorited". Exists in zone `state_` because it is user-authored preference, not regenerable scan output: it must survive `sm scan` truncation and `sm db reset` (which drops only `scan_*`).

| Column | Type | Constraint |
|---|---|---|
| `node_path` | TEXT | PRIMARY KEY |
| `favorited_at` | INTEGER | NOT NULL | Unix milliseconds when the user marked the node. |

No indexes (PK covers lookup by path; the table is keyed-by-path exclusively).

`node_path` is FK-semantic to `scan_nodes.path`. Per `§ Rename detection` below, the rename heuristic MUST migrate rows here when a path is renamed (same protocol as `state_jobs` / `state_summaries` / `state_findings` / `state_enrichments` / `state_plugin_kvs`). A simple PK update suffices; no composite key, so collisions cannot occur (if the destination path already has a row, the migrating row is dropped to preserve the live one).

The BFF's `/api/nodes` route loads the full set of favorited paths once per request (`SELECT node_path FROM state_node_favorites`) and decorates each emitted `Node` with a derived `isFavorite` boolean by Set membership: no SQL JOIN against `scan_nodes`, zero per-scan persistence transactions.

### `state_activity_stats`

Runtime execution stats per node: the checkpoint of the BFF's in-memory accumulator ([`provider-activity.md`](./provider-activity.md) §Execution stats). One row per node the live activity ever touched (shell sightings count like any other start since 2026-08-30, see the shell bullet there; a row checkpointed before that may still carry `count` 0 next to a non-empty recent log). Written debounced by `sm serve` on every mutation, read once at boot to hydrate the accumulator, so counts survive a server restart. Machine-generated (§Storage rule in [`architecture.md`](./architecture.md)); cleared per node by `DELETE /api/activity/node/<pathB64>`, never by a scan.

| Column | Type | Constraint |
|---|---|---|
| `node_path` | TEXT | PRIMARY KEY |
| `count` | INTEGER | NOT NULL DEFAULT 0 | Counted executions. |
| `first_seen_at` | INTEGER | NOT NULL | Unix milliseconds of the first stat on this node (the summary's `since` floor). |
| `last_start_at` | INTEGER | NOT NULL DEFAULT 0 | Unix milliseconds of the last counted start. |
| `last_owner` | TEXT | NULL | Owner key of the last counted start. |
| `owners_json` | TEXT | NOT NULL DEFAULT '[]' | Distinct owner keys, a JSON array (bounded, saturating). |
| `recent_json` | TEXT | NOT NULL DEFAULT '[]' | The recent ring, a JSON array most recent first (bounded). |
| `tool_uses` | INTEGER | NOT NULL DEFAULT 0 | Spawn-summary aggregate. |
| `tokens` | INTEGER | NOT NULL DEFAULT 0 | Spawn-summary aggregate. |
| `summarized_runs` | INTEGER | NOT NULL DEFAULT 0 | Spawn-summary aggregate. |

No indexes (PK covers lookup by path). `node_path` is FK-semantic to `scan_nodes.path`: the rename heuristic MUST migrate rows here (§Rename detection); a destination collision keeps the destination row and is reported.

### `state_activity_pairs`

Per-pair spawn counters (the edge conversation-count labels), the persisted half of the accumulator's pair map. `parent` is the parent node path for agent parents or the session owner key for session parents, exactly the identity the summary's pair keys carry.

| Column | Type | Constraint |
|---|---|---|
| `parent` | TEXT | NOT NULL, part of PK |
| `child_node_path` | TEXT | NOT NULL, part of PK |
| `count` | INTEGER | NOT NULL DEFAULT 0 |
| `last_start_at` | INTEGER | NOT NULL DEFAULT 0 |

Primary key `(parent, child_node_path)`. Both columns are FK-semantic to `scan_nodes.path` when they name a node; the rename heuristic migrates either side (a collision keeps the destination row and is reported).

---

## Table catalog: zone `config_`

### `config_plugins` (REMOVED 2026-07-28)

Plugin import trust used to live here as a `(plugin_id, trusted, updated_at)` row. It moved OUT of the database entirely (audit C1) and the table is gone.

Two reasons, both structural:

- **The DB is the wrong home for an authorization.** Per [`architecture.md` §Storage rule](./architecture.md#storage-rule) the database is machine output, regenerable and disposable, and the schema-drift path deletes and rebuilds it, which pre-1.0 is roughly every minor. An operator's vetting decision evaporating on a version bump trained them to re-grant reflexively, and reflexive re-granting is the one habit an import gate cannot survive.
- **Being gitignored was never a boundary.** The old wording here claimed the store was "structurally LOCAL: the DB never travels in a commit". That describes the default behaviour; the ignore list lives in the repo author's own tree, so `git add -f` ships a pre-granted store and the victim executed the attacker's code on their first scan.

Trust now lives in the **scope lock** (`<cwd>/.skill-map/scope.lock.json`), where each record carries a grant derived from the `.skill-map/` directory's filesystem identity. Git does not transport that identity, so a record made on another machine cannot verify here regardless of how it arrived. See [`architecture.md` §Storage rule](./architecture.md#storage-rule) (machine-local authorization) and [`cli-contract.md`](./cli-contract.md) §Plugins.

### `config_preferences`

Key-value cache for the kernel's OWN durable preferences and bookkeeping, not a user-config surface. `sm config set` never writes here (it writes `.skill-map/settings.json` / `settings.local.json`, per [`architecture.md` §Config layering](./architecture.md#config-layering)), and neither does the UI's settings form. Kernel-managed rows are keyed with a `_kernel.` prefix; the only one in v1 is `_kernel.update-check`, the update-check probe cache (written by the `core/update-check` boot hook, read by `GET /api/update-status`). Unprefixed keys are reserved for future kernel-owned preferences.

| Column | Type | Constraint |
|---|---|---|
| `key` | TEXT | PRIMARY KEY |
| `value_json` | TEXT | NOT NULL |
| `updated_at` | INTEGER | NOT NULL |

### `config_schema_versions`

Migration ledger. One row per successfully applied migration.

| Column | Type | Constraint |
|---|---|---|
| `scope` | TEXT | NOT NULL, CHECK = `kernel` |
| `owner_id` | TEXT | NOT NULL | `kernel`. |
| `version` | INTEGER | NOT NULL |
| `description` | TEXT | NOT NULL |
| `applied_at` | INTEGER | NOT NULL |

Primary key: `(scope, owner_id, version)`. Only the kernel migrates, so both leading columns are `kernel` today; the pair is kept in the key so a second migration owner can join later without a PK change.

The kernel ALSO maintains `PRAGMA user_version` (or the engine equivalent) as a fast pre-check for kernel migrations. A mismatch between `user_version` and `config_schema_versions` is flagged by `sm doctor`.

---

## Migrations

- **Format**: `.sql` files. Up-only. Rollback is `sm db restore <backup>`.
- **Naming**: `NNN_snake_case.sql` where `NNN` is 3-digit sequential, zero-padded. Example: `001_initial.sql`, `042_add_provenance.sql`.
- **Location**: kernel migrations in `src/migrations/` (reference impl); plugin migrations in `<plugin-dir>/migrations/`.
- **Wrapping**: the kernel wraps each file in `BEGIN; ... ; COMMIT;`. Files contain DDL only.
- **Strict versioning**: no idempotency required. `CREATE TABLE IF NOT EXISTS` is DISCOURAGED in kernel migrations (permitted in plugin migrations, at the author's discretion).
- **Auto-apply**: on startup. A backup is written to `.skill-map/backups/skill-map-pre-migrate-v<N>.db` before applying. The `sm db migrate` / `sm db backup` verbs open the DB with auto-apply suppressed so the operator drives migrations manually.
- **Plugin migration order**: plugins are migrated after kernel migrations, in stable alphabetical order by plugin id. A failing plugin migration fails the `sm db migrate` invocation (exit 2) and applies none of that plugin's migrations; other plugins and the kernel are unaffected, and the plugin itself stays loadable with its extensions working, since the migration runs at `sm db migrate` time rather than at load time.

`sm db migrate` controls migration flow manually: `--dry-run`, `--status`, `--to <n>`, `--kernel-only`, `--plugin <id>`, `--no-backup`.

---

## Schema drift (pre-1.0)

The project DB is a derived cache: every `scan_*` row is regenerable, and the operator's authored data lives in `.sm` sidecars, not in the DB. While the kernel stays in `0.Y.Z` (see [`versioning.md` §Pre-1.0](./versioning.md#pre-10)) it does NOT ship incremental migrations to carry an existing DB across a schema change. Drift is detected on two independent axes; either trips a rebuild.

**Axis 1, version.** A write-side open compares `scan_meta.scanned_by_version` against the running CLI version:

- **Same `major.minor`** (patch differences ignored): compatible.
- **Any minor or major difference**: drifted.

**Axis 2, schema fingerprint.** Pre-1.0 the greenfield posture adds columns INLINE to `001_initial.sql` WITHOUT bumping a version (see [`versioning.md` §Pre-1.0](./versioning.md#pre-10)). A DB within the same `major.minor` but with an older inline schema would otherwise pass the version axis and then fail as a runtime "no such column" error. To close that gap, the implementation computes a **schema fingerprint** = sha256 over the concatenated migration DDL (`NNN_*.sql` files, in sorted order) and persists it to `scan_meta.schema_fingerprint` at persist time. A write-side open recomputes the fingerprint from the bundled migrations and compares:

- **Stored fingerprint equals the recomputed one**: compatible.
- **Stored fingerprint differs from the recomputed one**: drifted. Any inline edit to a migration file changes the fingerprint and trips this axis independently of the version axis.
- **Stored fingerprint is NULL** (a DB written by a pre-fingerprint CLI, or whose `schema_fingerprint` column does not exist): drifted. Forces a one-time rebuild on upgrade so the very column that detects drift gets provisioned.

An open reacts to drift in one of three ways, by open kind:

**Drift-owning write opens rebuild.** `sm scan`, `sm watch`, and `sm serve` (boot) own drift resolution. When **either axis** reports drift, the entire DB file (plus its `-wal` / `-shm` sidecars) is deleted and recreated from the current migrations; the scan then repopulates it. No backup is written (the cache is derived). `state_*` and `config_*` are wiped along with `scan_*`; pre-1.0 they are transient. `.sm` sidecars are never touched. The drift message names the reason (version skew vs schema fingerprint). The rebuild is confirmed interactively on a TTY (`sm scan`, and `sm serve` before it starts listening) unless `--yes` is passed; non-interactive callers (piped stdin, CI, the BFF scan route, the watcher) rebuild without prompting. The prompt defaults to Yes (`[Y/n]`): a bare Enter rebuilds, and only an explicit `n` / `no` declines, since the rebuild is safe (the cache is derived) and declining dead-ends the verb. Declining the prompt aborts (exit `2`) without deleting anything.

**Other mutating opens refuse.** Every other DB-mutating open, the ones that do NOT own drift (the mutating job verbs `sm jobs submit` / `claim` / `cancel` / `fail` / `prune`, `sm plugins enable/disable`, `sm config set`, `sm record`, and any future write verb), runs a write-side guard on the **schema-fingerprint axis** at open time. When the stored fingerprint has drifted (differs, is NULL, or the column is absent) the open refuses with a typed `DbSchemaDriftError` advisory instead of proceeding into the mutation, which would otherwise crash with a cryptic `CHECK constraint failed` / `no such column` runtime error against the older columns. On the CLI the advisory renders to stderr and the verb exits `2`; on a mutating `/api/*` request the BFF returns a clean `db-drift` error envelope (not a `500` stack). The advisory names schema drift as the reason and points at `sm scan` to rebuild: scan is a drift-OWNING verb (previous paragraph), so it deletes and recreates the drifted DB by itself, and prescribing a `sm db reset --hard` detour first would be a redundant second step for the same outcome. The guard is fingerprint-only: a pure version bump with no schema change keeps the fingerprint stable and never trips it (the same columns are safe to write). Maintenance opens that must run against a drifted DB regardless (`sm db backup`, a raw file copy taken BEFORE a reset) opt out of the guard.

A DB that was never scanned (no `scan_meta` row) is **not** drift on any of these paths: no recorded version, no recorded fingerprint, no signal. The open proceeds untouched (the next scan writes both fields). Reading the stored fingerprint is defensive: a missing `scan_meta` table and a missing `schema_fingerprint` column are both tolerated (column-absent maps to NULL, i.e. drift; row-absent maps to no-signal).

**Read-side opens advise.** Read verbs (`sm check`, `sm list`, `sm show`, `sm history`, `sm export`, `sm graph`, `sm orphans` (listing), the read-side job verbs `sm jobs list` / `show` / `status` / `preview`, and every `GET /api/*` route) do NOT rebuild and do NOT refuse on a fingerprint mismatch. They surface a prominent advisory (warn on an older DB or a fingerprint mismatch, refuse on a newer or different-major DB) so a read never silently discards the cache nor crashes cryptically on a missing column. The advisory points at `sm scan` (the drift-owning rebuild).

This is a pre-1.0 affordance. The first `1.0.0` replaces it with real up-only migrations (see §Migrations): drift detection by version / fingerprint becomes drift repair by migration, and `state_*` / `config_*` stop being disposable.

---

## Plugin storage

A plugin persists state by declaring `storage` in `plugin.json` (see [`schemas/plugins-registry.schema.json`](./schemas/plugins-registry.schema.json)).

| Mode | Manifest | Backing |
|---|---|---|
| **KV** | `"storage": { "mode": "kv" }` | Shared `state_plugin_kvs`, scoped by plugin id. See [`plugin-kv-api.md`](./plugin-kv-api.md). |

`kv` is the only mode: a plugin never owns tables in the project database, so there is no plugin DDL, no plugin migration ledger, and no per-plugin table namespace to police. A plugin whose data needs relational shape keeps it outside skill-map's database.

Note: plugins are user-placed code running in the kernel's own process. Row-level scoping on the KV accessor guards against accidents (a plugin reaching for another plugin's keys), not against hostile plugins, which can bypass any JS-level guard. Post-v1.0 evaluates sandboxing (worker threads, VM contexts) and/or signing.

---

## Backups

- `sm db backup [--out <path>]`, WAL checkpoint (SQLite; engine-equivalent for others) + file copy.
- Default backup location: `.skill-map/backups/<timestamp>.db`.
- Auto-backup before migrations: `.skill-map/backups/skill-map-pre-migrate-v<N>.db`.
- `sm db restore <path>` swaps the current DB with the supplied file. Interactive confirmation required unless `--force`.

The `.skill-map/backups/` directory is a per-machine runtime artifact and MUST NOT travel via the shared repo: it is listed in the scope ignore file ([`cli-contract.md` §Scope ignore file](./cli-contract.md)) alongside the other generated artifacts, so pre-migrate snapshots and `sm db backup` output stay local.

A backup is a copy of the whole DB file, so it carries every zone, `scan_*` included; there is no per-zone filtering. `scan_*` is regenerable, so the expected flow after a restore is to run `sm scan` and refresh it.

---

## Rename detection (automatic)

`scan_nodes.path` is the canonical node identifier in v0. Moving a file rewrites the primary key, which would orphan every `state_*` row referencing the old path (`state_executions.node_ids_json`, `state_jobs.node_id`, `state_summaries.node_id`, `state_findings.node_id`, `state_enrichments.node_id`, `state_plugin_kvs.node_id`, `state_node_favorites.node_path`).

Implementations MUST apply a rename heuristic at scan time **before** committing the new scan transaction:

1. Compute the set `deletedPaths` (rows present in the previous `scan_nodes` but absent from the new walk) and `newPaths` (rows present in the new walk but absent from the previous scan).
2. For each pair `(deletedPath, newPath)` where `newPath.bodyHash == deletedPath.bodyHash` → classify as **high-confidence rename**. The kernel MUST:
   - Update every `state_*` row whose `node_id` equals `deletedPath` to reference `newPath`.
   - Emit no issue. Log at `info` level.
3. Remaining pairs where `newPath.frontmatterHash == deletedPath.frontmatterHash` (body differs, frontmatter a perfect match) → classify as **medium-confidence rename**. The kernel MUST:
   - Apply the same FK migration.
   - Emit an issue with `analyzerId: auto-rename-medium` (severity `warn`) pointing to both paths. The issue's `data` MUST include `{ from: <old.path>, to: <new.path>, confidence: "medium" }` so `sm orphans undo-rename <new.path>` can read the prior path without user input.
4. Any `deletedPath` left without a match after steps 2–3 becomes an **orphan**: the kernel emits an issue with `analyzerId: orphan` (severity `info`) and keeps the `state_*` rows referencing the dead path until the user runs `sm orphans reconcile <dead.path> --to <new.path>` or accepts the orphan.
   - **Silenced exception**: the kernel skips the `orphan` issue when the `deletedPath` is currently filtered out of the scan by the active ignore-source (e.g. the user added a `.skillmapignore` entry between scans and the file still exists on disk). The intent is "hide from the graph", not "lost without a rename"; an `orphan` info would pollute `sm check` with noise the user asked for. The reference impl threads a `silenced(path): boolean` predicate from the orchestrator into the rename heuristic; callers that do not supply one preserve the previous "always emit" behaviour. The `state_*` rows are still kept; removing the ignore entry re-enters the path as a live node, transparent to history.

Matching is 1-to-1: once a `newPath` is claimed as the rename target of some `deletedPath`, no other deletion can match it in the same scan. Ambiguity (two deletions share a body hash with the same new path) → fall back to the orphan path for all candidates, with issue `auto-rename-ambiguous` listing every conflict. `auto-rename-ambiguous` issues MUST populate `data` with `{ to: <new.path>, candidates: [<old.path.a>, <old.path.b>, ...] }`; here `sm orphans undo-rename` requires the user to pass `--from <old.path>` to disambiguate.

Casing: `bodyHash` / `frontmatterHash` / `analyzerId` / `data` are the domain-object field names (per `node.schema.json` and `issue.schema.json`); the SQLite reference impl stores the same values in `body_hash` / `frontmatter_hash` / `analyzer_id` / `data_json` columns, the storage adapter bridges the two (see §Naming conventions above). The heuristic is specified against the domain types, not the columns.

The heuristic runs inside the scan transaction, so either all renames land or none do. `sm scan` is the only surface that triggers automatic rename detection. Two manual verbs exist for cases the heuristic missed or got wrong:

- `sm orphans reconcile <orphan.path> --to <new.path>`, forward direction. Attaches FKs of an orphan to a live node. Use when the heuristic could not match (semantic rename, body rewrite).
- `sm orphans undo-rename <new.path>`, reverse direction. Reads `issue.data.from` from the active `auto-rename-medium` (or `--from`-disambiguated `auto-rename-ambiguous`) issue on `<new.path>`, migrates `state_*` FKs back, and resolves the issue. The prior path becomes an `orphan`. Use when the heuristic matched two unrelated files sharing a frontmatter hash.

Both verbs operate on FK ownership only; neither edits files on disk.

---

## Integrity

`sm doctor` MUST check at least:

- DB file exists and is readable.
- `PRAGMA quick_check` (or equivalent) returns OK.
- Applied migration version matches code-bundled migrations.
- No `state_jobs` rows whose `content_hash` is missing from `state_job_contents` (corrupt state, the content row was deleted out from under a live job).
- No `state_job_contents` rows whose `content_hash` is referenced by zero `state_jobs` rows (GC stragglers `sm jobs prune` should have collected).
- No plugin in `load-error` or `incompatible-spec` status.

Failures are reported with suggested remediation (e.g., "run `sm db migrate`", "run `sm jobs prune`").

---

## See also

- [`architecture.md`](./architecture.md), `StoragePort` interface definition and dependency analyzers.
- [`plugin-kv-api.md`](./plugin-kv-api.md), the `ctx.store` accessor contract.
- [`job-lifecycle.md`](./job-lifecycle.md), atomic claim and TTL/reap semantics that drive `state_jobs`.
- [`cli-contract.md`](./cli-contract.md), `sm db` verb surface (reset, backup, restore, migrate).

---

## Stability

The **three-zone model** and the **naming conventions** are stable as of spec v1.0.0. Adding a fourth zone is a major bump.

The **table catalog** above is stable within a spec major version. Adding a column to a kernel table is a minor bump (consumers MUST ignore unknown columns). Adding a table is a minor bump. Removing or renaming a column is a major bump.

The plugin storage mode name (`kv`) is stable. Adding a second mode is a minor bump.
