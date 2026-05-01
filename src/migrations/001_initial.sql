-- Kernel initial migration. Provisions the 11 kernel tables per
-- spec/db-schema.md. Up-only. Wrapped in BEGIN / COMMIT by the runner.

-- --- Scan zone -------------------------------------------------------------

CREATE TABLE scan_nodes (
  path TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  title TEXT,
  description TEXT,
  stability TEXT,
  version TEXT,
  author TEXT,
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
  scanned_at INTEGER NOT NULL,
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

CREATE TABLE scan_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_path TEXT NOT NULL,
  target_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  original_trigger TEXT,
  normalized_trigger TEXT,
  location_line INTEGER,
  location_column INTEGER,
  location_offset INTEGER,
  raw TEXT,
  CONSTRAINT ck_scan_links_kind CHECK (kind IN ('invokes','references','mentions','supersedes')),
  CONSTRAINT ck_scan_links_confidence CHECK (confidence IN ('high','medium','low'))
);
CREATE INDEX ix_scan_links_source_path ON scan_links(source_path);
CREATE INDEX ix_scan_links_target_path ON scan_links(target_path);
CREATE INDEX ix_scan_links_normalized_trigger ON scan_links(normalized_trigger);

CREATE TABLE scan_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  node_ids_json TEXT NOT NULL,
  link_indices_json TEXT,
  message TEXT NOT NULL,
  detail TEXT,
  fix_json TEXT,
  data_json TEXT,
  CONSTRAINT ck_scan_issues_severity CHECK (severity IN ('error','warn','info'))
);
CREATE INDEX ix_scan_issues_rule_id ON scan_issues(rule_id);
CREATE INDEX ix_scan_issues_severity ON scan_issues(severity);

-- --- State zone ------------------------------------------------------------

CREATE TABLE state_jobs (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  action_version TEXT NOT NULL,
  node_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  failure_reason TEXT,
  runner TEXT,
  ttl_seconds INTEGER NOT NULL,
  file_path TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  finished_at INTEGER,
  expires_at INTEGER,
  submitted_by TEXT,
  CONSTRAINT ck_state_jobs_status CHECK (status IN ('queued','running','completed','failed')),
  CONSTRAINT ck_state_jobs_failure_reason CHECK (failure_reason IS NULL OR failure_reason IN ('runner-error','report-invalid','timeout','abandoned','job-file-missing','user-cancelled')),
  CONSTRAINT ck_state_jobs_runner CHECK (runner IS NULL OR runner IN ('cli','skill','in-process'))
);
CREATE INDEX ix_state_jobs_status ON state_jobs(status);
-- Unique partial index for duplicate-job detection: at most one
-- queued/running job per (action_id, node_id, content_hash).
CREATE UNIQUE INDEX ix_state_jobs_action_node_hash
  ON state_jobs(action_id, node_id, content_hash)
  WHERE status IN ('queued','running');

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
  report_path TEXT,
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
  summary_json TEXT NOT NULL,
  PRIMARY KEY (node_id, summarizer_action_id)
);
CREATE INDEX ix_state_summaries_generated_at ON state_summaries(generated_at);

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

-- --- Config zone -----------------------------------------------------------

CREATE TABLE config_plugins (
  plugin_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT,
  updated_at INTEGER NOT NULL,
  CONSTRAINT ck_config_plugins_enabled CHECK (enabled IN (0,1))
);

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
  CONSTRAINT ck_config_schema_versions_scope CHECK (scope IN ('kernel','plugin'))
);

-- --- Scan meta envelope ----------------------------------------------------
-- Persists scan-result metadata so `loadScanResult` returns real values for
-- `scope`, `roots`, `scannedAt`, `scannedBy`, `providers`, and the non-derivable
-- `stats` fields (filesWalked / filesSkipped / durationMs) instead of a
-- synthetic envelope. Single-row table (CHECK id = 1); replaced atomically
-- with the rest of the scan_* zone on every `sm scan` via
-- `persistScanResult`. Originally landed at Step 5.1 as migration 002 and
-- folded back into the initial migration pre-1.0 (no released DBs to migrate
-- forward).

CREATE TABLE scan_meta (
  id INTEGER PRIMARY KEY,
  scope TEXT NOT NULL,
  roots_json TEXT NOT NULL,
  scanned_at INTEGER NOT NULL,
  scanned_by_name TEXT NOT NULL,
  scanned_by_version TEXT NOT NULL,
  scanned_by_spec_version TEXT NOT NULL,
  providers_json TEXT NOT NULL,
  stats_files_walked INTEGER NOT NULL,
  stats_files_skipped INTEGER NOT NULL,
  stats_duration_ms INTEGER NOT NULL,
  CONSTRAINT ck_scan_meta_singleton CHECK (id = 1),
  CONSTRAINT ck_scan_meta_scope CHECK (scope IN ('project','global'))
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

CREATE TABLE scan_extractor_runs (
  node_path TEXT NOT NULL,
  extractor_id TEXT NOT NULL,
  body_hash_at_run TEXT NOT NULL,
  ran_at INTEGER NOT NULL,
  PRIMARY KEY (node_path, extractor_id)
);
CREATE INDEX ix_scan_extractor_runs_node ON scan_extractor_runs(node_path);
CREATE INDEX ix_scan_extractor_runs_extractor ON scan_extractor_runs(extractor_id);

-- --- Universal enrichment layer --------------------------------------------
-- Phase 4 / A.8 — stores `ctx.enrichNode(partial)` outputs separately from
-- the author-supplied frontmatter (which remains immutable from Extractors).
-- Layer separation is universal: deterministic and probabilistic Extractors
-- both write here. Only probabilistic enrichments need stale tracking
-- (`is_probabilistic = 1`); when a node body changes between scans, those
-- rows are flagged `stale = 1` (NOT deleted, preserving the LLM cost).
-- Deterministic enrichments regenerate via the A.9 fine-grained cache and
-- simply pisar the prior row via PRIMARY KEY conflict on the next scan.
--
-- Read-side `node.merged` view (helper `mergeNodeWithEnrichments`):
-- author frontmatter + non-stale enrichments ordered by enriched_at ASC,
-- last-write-wins per field. Rules / `sm check` / `sm export` consume the
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
