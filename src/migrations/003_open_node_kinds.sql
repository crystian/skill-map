-- Phase D of the open-node-kinds refactor (see
-- docs/refactors/open-node-kinds.md).
--
-- Drop the closed-enum CHECK constraints on `scan_nodes.kind` and
-- `state_summaries.kind` so external Providers (Cursor, Obsidian, …)
-- can persist their own kinds. The TS side and the JSON Schema both
-- accept any non-empty string already (Phases A + B + C); this
-- migration aligns the live SQL.
--
-- SQLite has no `ALTER TABLE DROP CONSTRAINT`, so each table needs
-- the recreate dance: create the new table without the CHECK, copy
-- every row, drop the old, rename the new, recreate every index.
-- The migration runner already wraps the whole file in a single
-- BEGIN / COMMIT, so the recreate is atomic from the caller's view.
--
-- Foreign keys: the closed-enum CHECK was the only constraint
-- removed. Other tables that reference `scan_nodes.path` (links,
-- issues, state_*) do so by string equality without a DDL FOREIGN
-- KEY clause — the recreate does not need PRAGMA foreign_keys
-- gymnastics because there's no DDL FK to break.
--
-- Other CHECK on `scan_nodes` (`stability` whitelist) is preserved
-- verbatim. State_summaries has no other CHECK on this table.

-- --- scan_nodes ------------------------------------------------------------

CREATE TABLE scan_nodes_new (
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
  CONSTRAINT ck_scan_nodes_stability CHECK (stability IS NULL OR stability IN ('experimental','stable','deprecated'))
);

INSERT INTO scan_nodes_new (
  path, kind, provider, title, description, stability, version, author,
  frontmatter_json, body_hash, frontmatter_hash,
  bytes_frontmatter, bytes_body, bytes_total,
  tokens_frontmatter, tokens_body, tokens_total,
  links_out_count, links_in_count, external_refs_count, scanned_at
)
SELECT
  path, kind, provider, title, description, stability, version, author,
  frontmatter_json, body_hash, frontmatter_hash,
  bytes_frontmatter, bytes_body, bytes_total,
  tokens_frontmatter, tokens_body, tokens_total,
  links_out_count, links_in_count, external_refs_count, scanned_at
FROM scan_nodes;

DROP TABLE scan_nodes;
ALTER TABLE scan_nodes_new RENAME TO scan_nodes;

CREATE INDEX ix_scan_nodes_kind ON scan_nodes(kind);
CREATE INDEX ix_scan_nodes_provider ON scan_nodes(provider);
CREATE INDEX ix_scan_nodes_body_hash ON scan_nodes(body_hash);

-- --- state_summaries -------------------------------------------------------

CREATE TABLE state_summaries_new (
  node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  summarizer_action_id TEXT NOT NULL,
  summarizer_version TEXT NOT NULL,
  body_hash_at_generation TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  PRIMARY KEY (node_id, summarizer_action_id)
);

INSERT INTO state_summaries_new (
  node_id, kind, summarizer_action_id, summarizer_version,
  body_hash_at_generation, generated_at, summary_json
)
SELECT
  node_id, kind, summarizer_action_id, summarizer_version,
  body_hash_at_generation, generated_at, summary_json
FROM state_summaries;

DROP TABLE state_summaries;
ALTER TABLE state_summaries_new RENAME TO state_summaries;

CREATE INDEX ix_state_summaries_generated_at ON state_summaries(generated_at);
