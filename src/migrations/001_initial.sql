-- Kernel initial migration. Provisions the kernel tables per
-- spec/db-schema.md. Up-only. Wrapped in BEGIN / COMMIT by the runner.

-- --- Scan zone -------------------------------------------------------------

CREATE TABLE scan_nodes (
  path TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  title TEXT,
  description TEXT,
  -- `stability` is sourced from sidecar `annotations.stability`. NULL when
  -- no sidecar accompanies the node or the field is omitted.
  stability TEXT,
  -- `version` is a monotonic counter sourced from sidecar
  -- `annotations.version` (Decision #125). Pre-9.6.2 it was a semver
  -- string from `frontmatter.metadata.version`; this is greenfield —
  -- no auto-conversion path.
  version INTEGER,
  frontmatter_json TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  frontmatter_hash TEXT NOT NULL,
  bytes_frontmatter INTEGER NOT NULL,
  bytes_body INTEGER NOT NULL,
  bytes_total INTEGER NOT NULL,
  tokens_frontmatter INTEGER,
  tokens_body INTEGER,
  tokens_total INTEGER,
  links_out_count INTEGER NOT NULL DEFAULT 0,
  links_in_count INTEGER NOT NULL DEFAULT 0,
  external_refs_count INTEGER NOT NULL DEFAULT 0,
  -- JSON array of `IExternalRef` objects (every http(s) URL the body
  -- references, in extractor-order, deduped by normalised URL). NULL /
  -- unset when the body has no external URLs. The denormalised
  -- `external_refs_count` rides alongside and MUST equal the array
  -- length when both are present. Populated by
  -- `recomputeExternalRefsCount`, surfaced via `/api/nodes` so the
  -- inspector can list every external URL without a second round-trip.
  external_refs_json TEXT,
  scanned_at INTEGER NOT NULL,
  -- File modification time (`mtime`) in Unix ms, captured at scan time
  -- from the walker's `lstat`. NULL for virtual / derived nodes (no
  -- backing file). Drives the UI "last modified" sortable column; never
  -- participates in `body_hash` / `frontmatter_hash`.
  modified_at_ms INTEGER,
  -- Virtual / derived node identity (`Node.virtual` + `Node.derivedFrom`).
  --   - `virtual` — 1 for a synthetic node with no backing file (e.g.
  --     `mcp://<server>` materialised by `core/mcp-tools` from a skill's
  --     `tools:` frontmatter). 0 for a file-backed node.
  --   - `derived_from_json` — JSON array of the source node paths a virtual
  --     node was derived from. Drives cache-hit carry-forward + invalidation
  --     across incremental scans (a DB-loaded prior must know a node is
  --     virtual and which sources feed it). NULL for non-virtual nodes.
  virtual INTEGER NOT NULL DEFAULT 0,
  derived_from_json TEXT,
  -- Sidecar denormalisation (Step 9.6.2 — Decision #3, option (a)):
  --   - `sidecar_present` — 1 when a co-located `.sm` file accompanies
  --     this node, 0 otherwise.
  --   - `sidecar_status` — fresh / stale-body / stale-frontmatter /
  --     stale-both. NULL when no sidecar is present.
  --   - `annotations_json` — JSON-encoded `annotations:` block from the
  --     parsed sidecar (typed surface declared by
  --     `spec/schemas/annotations.schema.json`). NULL when no sidecar
  --     or the block is empty.
  --   - `sidecar_root_json` — JSON-encoded full parsed YAML root of the
  --     `.sm` file (every reserved block + plugin `<plugin-id>:`
  --     namespaces). NULL when no sidecar accompanies the node, or
  --     when parsing/validation failed (R15). Duplicates the
  --     `annotations:` sub-block by design — pre-R15 readers of
  --     `annotations_json` keep working unchanged.
  sidecar_present INTEGER NOT NULL DEFAULT 0,
  sidecar_status TEXT,
  annotations_json TEXT,
  sidecar_root_json TEXT,
  -- `kind` is open-by-design (Provider-declared string; the built-in
  -- Claude Provider emits `skill` / `agent` / `command` / `hook` /
  -- `note`, but external Providers may declare their own — see
  -- `node.schema.json#/properties/kind` and `db-schema.md` § scan_nodes).
  -- A CHECK whitelist would close what the spec keeps open.
  CONSTRAINT ck_scan_nodes_stability CHECK (stability IS NULL OR stability IN ('experimental','stable','deprecated'))
);
CREATE INDEX ix_scan_nodes_kind ON scan_nodes(kind);
CREATE INDEX ix_scan_nodes_provider ON scan_nodes(provider);
CREATE INDEX ix_scan_nodes_body_hash ON scan_nodes(body_hash);
CREATE INDEX ix_scan_nodes_sidecar_status ON scan_nodes(sidecar_status);

CREATE TABLE scan_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_path TEXT NOT NULL,
  target_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  confidence REAL NOT NULL,
  sources_json TEXT NOT NULL,
  original_trigger TEXT,
  normalized_trigger TEXT,
  location_line INTEGER,
  location_column INTEGER,
  location_offset INTEGER,
  -- JSON array of `LinkOccurrence` objects (every syntactic site in
  -- the source body that contributed to this edge). NULL when the
  -- link has no body-level evidence (frontmatter / sidecar-derived).
  -- Populated by extractors at emit time, accumulated by
  -- `dedupeLinks` across extractor merges. Read by
  -- `core/redundant-target-reference` and surfaced via `/api/links`
  -- so the UI can list per-row sites.
  occurrences_json TEXT,
  -- Node path the link resolved to per the post-walk lift transform.
  -- NULL when the link is unresolved (broken). Equal to `target_path`
  -- for path-style links; differs for trigger-style links (`@foo`,
  -- `/cmd`) where `target_path` keeps the authored trigger and
  -- `resolved_target` carries the resolved node path. The BFF's
  -- `?to=<path>` filter matches on EITHER column so an `@real-agent`
  -- mention surfaces in the incoming list of
  -- `.claude/agents/real-agent.md`.
  resolved_target TEXT,
  raw TEXT,
  CONSTRAINT ck_scan_links_kind CHECK (kind IN ('invokes','references','mentions','points')),
  CONSTRAINT ck_scan_links_confidence CHECK (confidence >= 0.0 AND confidence <= 1.0)
);
CREATE INDEX ix_scan_links_source_path ON scan_links(source_path);
CREATE INDEX ix_scan_links_target_path ON scan_links(target_path);
CREATE INDEX ix_scan_links_normalized_trigger ON scan_links(normalized_trigger);
CREATE INDEX ix_scan_links_resolved_target ON scan_links(resolved_target);

CREATE TABLE scan_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analyzer_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  node_ids_json TEXT NOT NULL,
  link_indices_json TEXT,
  message TEXT NOT NULL,
  detail TEXT,
  fix_json TEXT,
  data_json TEXT,
  CONSTRAINT ck_scan_issues_severity CHECK (severity IN ('error','warn','info'))
);
CREATE INDEX ix_scan_issues_analyzer_id ON scan_issues(analyzer_id);
CREATE INDEX ix_scan_issues_severity ON scan_issues(severity);

-- --- State zone ------------------------------------------------------------

CREATE TABLE state_jobs (
  id TEXT PRIMARY KEY,
  extension_id TEXT NOT NULL,
  extension_version TEXT NOT NULL,
  -- Extension kind RESOLVED at submit time and frozen (like the
  -- version): `sm record` routes on it (analyzer report -> findings
  -- write-through; action report -> summaries/enrichments conventions),
  -- so a plugin shipping a probabilistic Action AND Analyzer under one
  -- extension id stays unambiguous end-to-end (the submit-side `<kind>:`
  -- prefix picks, the row remembers). See spec/db-schema.md §state_jobs.
  extension_kind TEXT NOT NULL,
  -- Per-job auto-fix opt-in, frozen at submit like extension_kind
  -- (0 = off, the default; 1 = chain this finder's fixers on completion).
  -- SQLite has no boolean: stored 0/1, bridged to a runtime boolean in
  -- rowToJob. Meaningful only on a finder (extension_kind = 'analyzer');
  -- `sm record` chains via the shared inverse-Modelo-B resolver AFTER the
  -- record transaction commits, independently of the opt-in global
  -- core/auto-fix hook (see spec/job-lifecycle.md §Auto-fix chain (per-job)).
  auto_fix INTEGER NOT NULL DEFAULT 0,
  -- Finding-subset targeting for fixer jobs (JSON int array; NULL = whole node).
  finding_ids_json TEXT,
  node_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  failure_reason TEXT,
  runner TEXT,
  -- OPTIONAL TTL (Decision #139): NULL = the job never expires (the
  -- default; interactive drains may hold a claim for hours). Armed only
  -- from explicit operator sources at submit (--ttl flag with 0-disarm,
  -- jobs.perExtensionTtl, jobs.ttlSeconds); the reaper skips NULL and
  -- `sm doctor`'s jobs-overdue check advises instead.
  ttl_seconds INTEGER,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  finished_at INTEGER,
  expires_at INTEGER,
  submitted_by TEXT,
  -- The rendered job content is NOT stored on this row. It lives in
  -- `state_job_contents` keyed by `content_hash` (see the table below);
  -- there is no on-disk `.skill-map/jobs/*.md` artifact. `job-file-missing`
  -- in the failure-reason CHECK is a legacy enum name preserved across the
  -- disk-to-DB shift; it now means "the referenced `state_job_contents`
  -- row is missing" (DB-corruption-only), not a missing file.
  --
  -- Three terminal states: `completed`, `failed`, `cancelled`. `cancelled`
  -- (via `sm job cancel`) is a distinct state, NOT a `failed` sub-reason,
  -- and carries NO failure_reason. `user-failed` marks a job the operator
  -- forced to `failed` via `sm job fail` (symmetric to cancel).
  CONSTRAINT ck_state_jobs_extension_kind CHECK (extension_kind IN ('action','analyzer')),
  CONSTRAINT ck_state_jobs_status CHECK (status IN ('queued','running','completed','failed','cancelled')),
  CONSTRAINT ck_state_jobs_failure_reason CHECK (failure_reason IS NULL OR failure_reason IN ('runner-error','report-invalid','timeout','abandoned','job-file-missing','user-failed')),
  CONSTRAINT ck_state_jobs_runner CHECK (runner IS NULL OR runner IN ('agent','in-process'))
);
CREATE INDEX ix_state_jobs_status ON state_jobs(status);
-- Unique partial index for duplicate-job detection: at most one
-- queued/running job per (extension_id, node_id, content_hash). The queue
-- is kind-agnostic: `extension_id` names a probabilistic Action OR a
-- probabilistic Analyzer (see spec/db-schema.md §state_jobs).
CREATE UNIQUE INDEX ix_state_jobs_extension_node_hash
  ON state_jobs(extension_id, node_id, content_hash)
  WHERE status IN ('queued','running');

-- Content-addressed store for the rendered MD content of every queued /
-- completed job. Decouples content from the lifecycle row in `state_jobs`
-- so retries / `--force` reruns / cross-node fan-out emissions of the same
-- prompt all reference one blob (see spec/db-schema.md §state_job_contents).
--
-- Insertion is `INSERT OR IGNORE ... (content_hash, content, created_at)`,
-- an existing row for the same hash is a no-op. The PK covers lookup by
-- hash, no secondary index. GC contract: `sm job prune` deletes every row
-- whose `content_hash` is referenced by zero `state_jobs` rows, in the
-- same transaction that prunes terminal jobs.
CREATE TABLE state_job_contents (
  content_hash TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE state_executions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  extension_version TEXT NOT NULL,
  node_ids_json TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT,
  status TEXT NOT NULL,
  failure_reason TEXT,
  exit_code INTEGER,
  runner TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  duration_ms INTEGER,
  tokens_in INTEGER,
  tokens_out INTEGER,
  -- Executing model's name as SELF-REPORTED by the recording agent via
  -- `sm record --model <name>` (unverifiable by design, like the token
  -- counts; NULL when undeclared). Denormalized onto
  -- `state_findings.model` / `state_summaries.model` at record time for
  -- join-free display (spec/db-schema.md §state_executions).
  model TEXT,
  report_json TEXT,
  job_id TEXT,
  CONSTRAINT ck_state_executions_kind CHECK (kind IN ('action')),
  CONSTRAINT ck_state_executions_status CHECK (status IN ('completed','failed','cancelled'))
);
CREATE INDEX ix_state_executions_extension_id ON state_executions(extension_id);
CREATE INDEX ix_state_executions_started_at ON state_executions(started_at);
CREATE INDEX ix_state_executions_job_id ON state_executions(job_id);

CREATE TABLE state_summaries (
  node_id TEXT NOT NULL,
  -- `kind` is open-by-design (mirrors `scan_nodes.kind` — see the
  -- comment there for the spec rationale).
  kind TEXT NOT NULL,
  summarizer_action_id TEXT NOT NULL,
  summarizer_version TEXT NOT NULL,
  body_hash_at_generation TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  -- Recording agent's self-reported `--model` (NULL when undeclared),
  -- denormalized from the same record's execution row.
  model TEXT,
  summary_json TEXT NOT NULL,
  PRIMARY KEY (node_id, summarizer_action_id)
);
CREATE INDEX ix_state_summaries_generated_at ON state_summaries(generated_at);

-- Probabilistic findings: the judgments recorded by finder Analyzers
-- (`mode: 'probabilistic'`) plus the kernel-derived safety rows synthesized
-- from any probabilistic report's `safety` block (see spec/db-schema.md
-- §state_findings).
--
--   - `origin` discriminates the two lanes: `extension` rows come from the
--     validated report's `findings[]` array (finder Analyzers only);
--     `kernel` rows are synthesized under the reserved type slugs
--     (`injection-detected` / `content-suspicious` / `content-malformed`).
--   - Replace semantics: recording a completed job for
--     (node_id, extension_id) DELETEs every existing row for that pair
--     (both origins) then inserts the fresh rows, in the same transaction
--     as the `state_executions` insert + job transition. An empty
--     `findings[]` with a clean safety block ERASES the prior judgment.
--   - Stale rule: a row whose `body_hash_at_generation` differs from the
--     node's live `scan_nodes.body_hash` is stale (computed at read time
--     via JOIN, never persisted); rows are never auto-deleted on staleness
--     and `sm scan` never touches this table.
--   - `node_id` is FK-semantic to `scan_nodes.path`; the rename heuristic
--     (`migrateNodeFks` in src/kernel/adapters/sqlite/history.ts) migrates
--     rows here, same protocol as the other state_* tables.
--   - Fixer resolution STATE + decision actor: the `resolution*` columns
--     record the lifecycle state a finding moved into and who decided it.
--     TWO writers (see spec/db-schema.md §state_findings "Finding lifecycle
--     state"): `sm record` closing a FIXER's job (a probabilistic Action
--     declaring `precondition.analyzerIds`) stamps per entry of its report's
--     `resolved[]`, scoped to the job's node and the fixer's own analyzerIds;
--     and `sm findings resolve <id>` stamps a purely human resolution.
--     `fixed` = resolved (hidden from the default `sm findings` view, NOT
--     deleted, re-checkable by re-running the finder); `human-decision` = a
--     fixer proposed but the choice is the author's, so it stays the author's
--     visible TODO in `resolution_note` (renamed from the earlier `declined`,
--     which read as a dead-end when it is the most action-demanding state).
--     Neither is "verified": only the finder re-judging the current body
--     deletes or reopens a `fixed` row. `resolution_actor` records WHO
--     decided a `fixed` row by one rule: ANY user interaction makes it
--     `human`, only a fully autonomous fix with zero user interaction is
--     `fixer`; NULL for `human-decision` (undecided).
CREATE TABLE state_findings (
  id INTEGER PRIMARY KEY,
  node_id TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  extension_version TEXT NOT NULL,
  origin TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  detail TEXT,
  confidence REAL NOT NULL,
  -- Recording agent's self-reported `--model` (NULL when undeclared),
  -- denormalized from the same record's execution row.
  model TEXT,
  -- The lifecycle state a finding moved into (NULL = open):
  -- `fixed` = resolved (hidden from the default view, re-checkable),
  -- `human-decision` = a fixer proposed but the choice is the author's, so
  -- the `resolution_note` (its PROPOSAL) stays the visible TODO.
  resolution TEXT,
  -- WHO decided a `fixed` finding: `human` (any user interaction was
  -- involved) or `fixer` (a fully autonomous fix, zero user interaction).
  -- NULL for `human-decision` (undecided) and open rows.
  resolution_actor TEXT,
  resolution_note TEXT,
  -- The fixer's qualified extension id (NULL for a purely human resolution
  -- via `sm findings resolve`) + the stamp time.
  resolution_by TEXT,
  resolution_at INTEGER,
  body_hash_at_generation TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  job_id TEXT,
  CONSTRAINT ck_state_findings_origin CHECK (origin IN ('extension','kernel')),
  CONSTRAINT ck_state_findings_severity CHECK (severity IN ('info','warn','error')),
  CONSTRAINT ck_state_findings_resolution CHECK (resolution IS NULL OR resolution IN ('fixed','human-decision','dismissed')),
  CONSTRAINT ck_state_findings_resolution_actor CHECK (resolution_actor IS NULL OR resolution_actor IN ('human','fixer'))
);
CREATE INDEX ix_state_findings_node_id ON state_findings(node_id);
CREATE INDEX ix_state_findings_extension_id ON state_findings(extension_id);
CREATE INDEX ix_state_findings_generated_at ON state_findings(generated_at);

CREATE TABLE state_enrichments (
  node_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  verified INTEGER,
  fetched_at INTEGER NOT NULL,
  stale_after INTEGER,
  PRIMARY KEY (node_id, provider_id),
  CONSTRAINT ck_state_enrichments_verified CHECK (verified IS NULL OR verified IN (0,1))
);
CREATE INDEX ix_state_enrichments_stale_after ON state_enrichments(stale_after);

CREATE TABLE state_plugin_kvs (
  plugin_id TEXT NOT NULL,
  node_id TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, node_id, key)
);
CREATE INDEX ix_state_plugin_kvs_plugin_id ON state_plugin_kvs(plugin_id);

-- Per-node "favorite" flag persisted per user (single-user local DB).
-- Zone `state_` because favorites are user-authored preference and must
-- survive `sm scan` truncation and `sm db reset` (which drops only
-- `scan_*`). Absence of a row means "not favorited".
--
-- `node_path` is FK-semantic to `scan_nodes.path`. The rename heuristic
-- (`migrateNodeFks` in src/kernel/adapters/sqlite/history.ts) MUST migrate
-- rows here when a path is renamed, same protocol as the other state_*
-- tables. Simple PK update — no composite key, no collision shape.
--
-- The BFF's `/api/nodes` route loads the full set of paths once per
-- request (typical favorite count is small) and decorates the in-memory
-- node list with a derived `isFavorite` boolean by Set membership. No
-- SQL JOIN against `scan_nodes` is required.

CREATE TABLE state_node_favorites (
  node_path TEXT PRIMARY KEY,
  favorited_at INTEGER NOT NULL
);

-- Runtime activity-stats checkpoint (spec/db-schema.md §state_activity_stats):
-- the persisted half of the BFF's in-memory execution-stats accumulator
-- (spec/provider-activity.md §Execution stats). Written debounced by
-- `sm serve`, read once at boot, cleared per node by the Activity
-- clear-all. `owners_json` / `recent_json` are JSON arrays the
-- accumulator owns (bounded there, opaque here).
CREATE TABLE state_activity_stats (
  node_path TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL,
  last_start_at INTEGER NOT NULL DEFAULT 0,
  last_owner TEXT,
  owners_json TEXT NOT NULL DEFAULT '[]',
  recent_json TEXT NOT NULL DEFAULT '[]',
  tool_uses INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  summarized_runs INTEGER NOT NULL DEFAULT 0
);

-- Per-pair spawn counters (the edge conversation-count labels), the
-- persisted half of the accumulator's pair map. `parent` is the parent
-- node path (agent parents) or the session owner key (session parents).
CREATE TABLE state_activity_pairs (
  parent TEXT NOT NULL,
  child_node_path TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  last_start_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (parent, child_node_path)
);

-- --- Config zone -----------------------------------------------------------

CREATE TABLE config_preferences (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE config_schema_versions (
  scope TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  description TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (scope, owner_id, version),
  CONSTRAINT ck_config_schema_versions_scope CHECK (scope = 'kernel')
);

-- --- Scan meta envelope ----------------------------------------------------
-- Persists scan-result metadata so `loadScanResult` returns real values for
-- `roots`, `scannedAt`, `scannedBy`, `providers`, and the non-derivable
-- `stats` fields (filesWalked / filesSkipped / durationMs) instead of a
-- synthetic envelope. Single-row table (CHECK id = 1); replaced atomically
-- with the rest of the scan_* zone on every `sm scan` via
-- `persistScanResult`.
--
-- Per `spec/cli-contract.md` §Scope is always project-local, the
-- `scope` column was removed; every scan resolves against
-- `<cwd>/.skill-map/` and the on-the-wire `ScanResult` no longer
-- carries a `scope` field.

CREATE TABLE scan_meta (
  id INTEGER PRIMARY KEY,
  roots_json TEXT NOT NULL,
  scanned_at INTEGER NOT NULL,
  scanned_by_name TEXT NOT NULL,
  scanned_by_version TEXT NOT NULL,
  scanned_by_spec_version TEXT NOT NULL,
  providers_json TEXT NOT NULL,
  stats_files_walked INTEGER NOT NULL,
  stats_files_skipped INTEGER NOT NULL,
  stats_duration_ms INTEGER NOT NULL,
  -- Scan-ceiling vs render-cap envelope (see spec/cli-contract.md §Scan).
  -- Two independent knobs:
  --   - `scan_ceiling` is the effective WALK-INTAKE ceiling that produced
  --     this scan (`scan.maxScan` setting, default 50000, or the
  --     `--max-scan <N>` override). The walker walks, parses, analyzes, and
  --     reference-validates the full corpus up to this number, so references
  --     resolve across the whole project regardless of how many nodes the
  --     map renders.
  --   - `scan_truncated` is 1 when the walker reached `scan_ceiling` and
  --     dropped files (in stable provider-walker order), 0 otherwise. The UI
  --     raises a persistent banner pointing at the `.skillmapignore` editor.
  --   - `max_render_nodes` is the effective MAP RENDER cap (`scan.maxNodes`
  --     setting, default 256, or the `--max-nodes <N>` override). Pure
  --     metadata: it does NOT bound the walk, only the graph projection the
  --     UI draws onto the canvas.
  scan_ceiling INTEGER NOT NULL,
  scan_truncated INTEGER NOT NULL DEFAULT 0,
  max_render_nodes INTEGER NOT NULL,
  -- File-size skip envelope (see spec/cli-contract.md §Scan, `scan.maxFileSizeBytes`
  -- setting, default 1 MiB). `files_oversized` is the count of files the walker
  -- skipped before reading because they exceeded the limit (= `stats.filesOversized`);
  -- `oversized_files_json` is the JSON array of `{ path, bytes }` entries the CLI /
  -- serve terminal warns on and the UI banner lists. NULL when no file was skipped.
  files_oversized INTEGER NOT NULL DEFAULT 0,
  oversized_files_json TEXT,
  -- Resolved offline tokenizer (encoder) that produced this scan's per-node
  -- token counts (see project-config.schema.json §tokenizer, closed enum
  -- `cl100k_base` / `o200k_base`). Recorded so the next incremental scan can
  -- compare the persisted encoder against the resolved one and force a token
  -- recompute when they differ (changing the tokenizer invalidates prior
  -- counts). NULL on a pre-feature DB / never-tokenized scan; a NULL prior is
  -- treated as "different encoder" so the next scan recomputes.
  tokenizer TEXT,
  -- Active provider LENS that produced this scan (`activeProvider` from the
  -- resolved config, the id of the gated provider whose grammar the scan was
  -- authored under). Recorded for the same reason as `tokenizer` above: the
  -- lens decides classification (kind + provider per node) and gates the
  -- provider-specific extractors, so a cached node produced under a different
  -- lens is stale. Switching the lens through `sm config set activeProvider`
  -- or the BFF route drops the whole `scan_*` zone, but that defends the
  -- invariant only at the mutation sites; comparing this column at scan entry
  -- defends it at the consumer, catching a lens that changed out of band (a
  -- hand-edited or pulled `settings.json`). NULL on a pre-feature DB / a scan
  -- with no resolvable lens; a NULL prior against a resolved lens is treated
  -- as "different lens" so the next scan re-classifies.
  active_provider TEXT,
  -- Schema-drift fingerprint (see spec/db-schema.md §Schema drift (pre-1.0)).
  -- sha256 (hex) of the concatenated migration DDL the schema was built from,
  -- written at persist time. NULL on a DB created by a pre-fingerprint CLI; a
  -- NULL or mismatching value is read as schema drift on the next write-side
  -- open so an inline `001_initial.sql` column add (no version bump,
  -- greenfield posture) forces a one-time cache rebuild instead of surfacing
  -- later as a "no such column" query error.
  schema_fingerprint TEXT,
  -- Whole-result fingerprint: sha256 over the canonical persisted content of
  -- the last scan (nodes, links, issues, extractor runs sans ran_at,
  -- contributions, link scores, tags, meta content sans timestamps). When the
  -- next persist computes the same value and carries no out-of-band inputs
  -- (renames, enrichments, freshly-run extractor tuples), the replace-all
  -- write is skipped and only this row refreshes. NULL on a pre-feature DB
  -- and on synthetic writes that bypass the fingerprint path.
  result_fingerprint TEXT,
  CONSTRAINT ck_scan_meta_singleton CHECK (id = 1)
);

-- --- Fine-grained scan cache ----------------------------------------------
-- Phase 4 / A.9 — per-(node, extractor) cache breadcrumbs. Lets the
-- orchestrator skip rerunning extractors against an unchanged body when the
-- same extractor already ran against that body_hash, and — critically —
-- detect when a NEW extractor was registered between scans (no row yet for
-- that pair) so the new extractor runs over the cached node without
-- requiring a full cache invalidation. Replace-all on every persist:
-- obsolete rows (extractor uninstalled since the last scan) disappear
-- automatically and cannot mask a stale cache hit.
--
-- `sidecar_annotations_hash_at_run` participates in the cache key
-- alongside `body_hash_at_run`. Without it the cache silently reused
-- prior contributions after a `.sm`-only edit (`core/stability`,
-- `core/annotations`, any other sidecar-reading extractor). The column
-- is NOT NULL — every emitter writes the SHA-256 of the canonical-form
-- `node.sidecar.annotations` (`'{}'` when the sidecar is absent or
-- carries no annotations). The cache decision consults the hash
-- unconditionally; an author-facing opt-in flag was rejected because
-- forgetting it produces silent stale-data bugs and the cost of
-- universal invalidation (one extractor re-run on `.sm` edits) is
-- negligible.

CREATE TABLE scan_extractor_runs (
  node_path TEXT NOT NULL,
  extractor_id TEXT NOT NULL,
  body_hash_at_run TEXT NOT NULL,
  sidecar_annotations_hash_at_run TEXT NOT NULL,
  -- SHA-256 of the extractor's canonical-form resolved settings at run
  -- time (committed keys + project-local secrets + env overrides). Third
  -- leg of the cache key: a settings change re-runs the pair on the next
  -- scan, so the incremental default never serves outputs computed under
  -- superseded settings.
  settings_hash_at_run TEXT NOT NULL DEFAULT '',
  ran_at INTEGER NOT NULL,
  PRIMARY KEY (node_path, extractor_id)
);
CREATE INDEX ix_scan_extractor_runs_node ON scan_extractor_runs(node_path);
CREATE INDEX ix_scan_extractor_runs_extractor ON scan_extractor_runs(extractor_id);

-- --- Universal enrichment layer --------------------------------------------
-- Phase 4 / A.8 — stores `ctx.enrichNode(partial)` outputs separately from
-- the author-supplied frontmatter (which remains immutable from Extractors).
-- Extractors are deterministic-only; rows regenerate via the A.9 fine-grained
-- cache and simply overwrite the prior row via PRIMARY KEY conflict on the
-- next scan. The `stale` and `is_probabilistic` columns are persisted but
-- inert in this revision (always 0); they are reserved for the future
-- Action-issued probabilistic enrichment revision (queued LLM jobs that
-- must preserve paid output across body changes).
--
-- Read-side `node.merged` view (helper `mergeNodeWithEnrichments`):
-- author frontmatter + non-stale enrichments ordered by enriched_at ASC,
-- last-write-wins per field. Analyzers / `sm check` / `sm export` consume the
-- author frontmatter by default (CI-safe deterministic baseline);
-- enrichment consumption is opt-in.

CREATE TABLE node_enrichments (
  node_path TEXT NOT NULL,
  extractor_id TEXT NOT NULL,
  body_hash_at_enrichment TEXT NOT NULL,
  value_json TEXT NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0,
  enriched_at INTEGER NOT NULL,
  is_probabilistic INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (node_path, extractor_id),
  CONSTRAINT ck_node_enrichments_stale CHECK (stale IN (0, 1)),
  CONSTRAINT ck_node_enrichments_is_probabilistic CHECK (is_probabilistic IN (0, 1))
);
CREATE INDEX ix_node_enrichments_node ON node_enrichments(node_path);
CREATE INDEX ix_node_enrichments_stale ON node_enrichments(stale);

-- --- View contribution layer ----------------------------------------------
-- Phase 3 / View contribution system. Per-node typed data emitted by
-- extractors via `ctx.emitContribution(id, payload)` (and analyzers via
-- `ctx.emitScopeContribution(id, payload)` for scope-level slots).
-- Belongs to the `scan_*` family — cleared on every scan and repopulated
-- by emissions; NOT analogous to the plugin-private `state_plugin_kvs`
-- (which the plugin manages).
--
-- See `spec/architecture.md` § View contribution system → Persistence
-- and `ROADMAP.md` § UI contribution system → Persistence for the
-- normative contract. The kernel publishes the closed catalog of
-- slots at `spec/schemas/view-slots.schema.json#/$defs/SlotName`;
-- payloads are AJV-validated at emit time against the per-slot
-- schemas in `$defs/payloads/<slot>` before reaching this table.
--
-- PK on `(plugin_id, extension_id, node_path, contribution_id)` so
-- re-emission of the same contribution for the same node REPLACES the
-- prior row. The qualified id mirrors the kernel's
-- `<pluginId>/<extensionId>/<contributionId>` identity.
--
-- Index on `node_path` for the inspector lazy-fetch path
-- (`GET /api/contributions/:pluginId/:contributionId?path=...`) and for
-- the rename heuristic (when a `.md` is renamed, the kernel migrates
-- `node_path` here alongside `scan_links` etc.). Without the index,
-- those reads scan the whole table; with it, they hit a B-tree.

CREATE TABLE scan_contributions (
  plugin_id TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  node_path TEXT NOT NULL,
  contribution_id TEXT NOT NULL,
  -- Closed enum surfaced for fast filtering / debugging — the value
  -- mirrors `view-slots.schema.json#/$defs/SlotName`. Kept open at
  -- the SQL layer (no CHECK) by design: catalog evolution ships as
  -- a kernel + spec change with `sm plugins upgrade` migration; a
  -- hard CHECK here would force a DDL migration on every catalog
  -- rename and conflict with the upgrade verb's autonomy.
  slot TEXT NOT NULL,
  -- JSON-serialized payload, already validated against the slot's
  -- payload schema at emit time. Kept opaque at the SQL layer;
  -- readers (BFF, analyzers) parse on demand.
  payload_json TEXT NOT NULL,
  emitted_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, extension_id, node_path, contribution_id)
);

CREATE INDEX ix_scan_contributions_node_path ON scan_contributions(node_path);
CREATE INDEX ix_scan_contributions_plugin_id ON scan_contributions(plugin_id);

-- scan_contribution_errors: per-scan record of view contributions the
-- orchestrator REJECTED at emit time (the "off-shape visible" follow-up).
-- Each row is one `ctx.emitContribution(...)` call that did NOT survive
-- validation, with the same diagnostic the ephemeral `extension.error`
-- event (kind `contribution-rejected`) already carried. Two rejection
-- shapes land here:
--   1. `undeclared-contribution-ref` — the extension passed a `ref` that
--      is not one of its declared `viewContributions` objects (a spread
--      copy / inline literal). `contribution_id` and `slot` are NULL.
--   2. AJV failure — the payload failed the slot's payload schema. `reason`
--      carries the AJV error string; `contribution_id` and `slot` name the
--      target contribution / slot.
--
-- Belongs to the `scan_*` family. Plain REPLACE-ALL per scan (delete all,
-- then insert), the same posture as `scan_issues` — NOT the orphan/catalog/
-- per-tuple sweep `scan_contributions` uses. A rejected emission is a
-- transient scan finding, not durable state: every scan re-derives the
-- full set, so there is no cached-node row to preserve and no compound PK
-- (the nullable `contribution_id` / `slot` columns rule a compound PK out
-- anyway). Indexes on `plugin_id` (the `sm plugins doctor` group-by) and
-- `node_path` (the rename heuristic + per-node lookups).
CREATE TABLE scan_contribution_errors (
  plugin_id TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  node_path TEXT NOT NULL,
  reason TEXT NOT NULL,
  message TEXT NOT NULL,
  -- NULL for the `undeclared-contribution-ref` shape (the orchestrator
  -- never resolved a contribution id / slot for the rejected ref).
  contribution_id TEXT,
  slot TEXT,
  emitted_at INTEGER NOT NULL
);
CREATE INDEX ix_scan_contribution_errors_plugin_id ON scan_contribution_errors(plugin_id);
CREATE INDEX ix_scan_contribution_errors_node_path ON scan_contribution_errors(node_path);

-- scan_link_scores: per-op confidence-attribution audit trail. One row
-- per attributed `ctx.adjustConfidence(link, op)` call buffered by a
-- `score`-phase analyzer during the scan (the kernel's own built-in
-- `core/name-reserved` / `core/reference-broken` detectors dogfood the
-- API, applying penalty deltas on top of the kernel's 1.0 baseline). Lets
-- an operator answer "why is this link at 0.3?" by listing the plugin /
-- extension / op that moved it, with the FOLDED final value denormalised
-- onto every row (`result_confidence` mirrors `scan_links.confidence`).
--
-- The link is identified by its structural identity fields
-- (`source_path`, `target`, `kind`, `normalized_trigger`), the same key
-- `scan_links` dedups on; `normalized_trigger` is NULL for path-style
-- links that carry no trigger. `op_kind` is the algebra bucket
-- (`set` / `delta` / `ceil` / `floor`) and `op_value` its operand.
--
-- Belongs to the `scan_*` family. Plain REPLACE-ALL per scan (delete
-- all, then insert), the same posture as `scan_issues` and
-- `scan_contribution_errors` — NOT the sweep model `scan_contributions`
-- uses. A score adjustment is a transient scan finding re-derived in
-- full on every analyzer pass, so there is no cached-node row to
-- preserve and no compound PK (multiple ops can land on one link). Index
-- on `source_path` for the per-node "why this link?" lookup + the rename
-- heuristic-adjacent reads.
CREATE TABLE scan_link_scores (
  plugin_id TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  target TEXT NOT NULL,
  kind TEXT NOT NULL,
  -- NULL for path-style links that carry no trigger (the structural
  -- identity key mirrors `scan_links`'s dedup tuple).
  normalized_trigger TEXT,
  -- Confidence-algebra bucket: `set` / `delta` / `ceil` / `floor`. Kept
  -- open at the SQL layer (no CHECK) so the op catalog can evolve as a
  -- kernel + spec change without a DDL migration.
  op_kind TEXT NOT NULL,
  op_value REAL NOT NULL,
  -- Denormalised FOLDED final `link.confidence` after every op for this
  -- link was applied. Equal across all rows for one link; carried per
  -- row so the audit read needs no join back to `scan_links`.
  result_confidence REAL NOT NULL,
  emitted_at INTEGER NOT NULL
);
CREATE INDEX ix_scan_link_scores_source_path ON scan_link_scores(source_path);

-- scan_node_tags: tag system. One row per (node_path, tag) pair.
-- Projected at persist time from `sidecar.annotations.tags`. Tags are
-- a skill-map concept (no vendor carries `tags` in frontmatter), so the
-- sidecar is the single source. Drives `sm list --tag` and the UI's
-- tag-faceted search; the (tag) index keeps lookups O(log n).
CREATE TABLE scan_node_tags (
  node_path TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (node_path, tag)
);
CREATE INDEX ix_scan_node_tags_tag ON scan_node_tags(tag);
CREATE INDEX ix_scan_node_tags_node_path ON scan_node_tags(node_path);
