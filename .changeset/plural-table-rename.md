---
"@skill-map/spec": minor
---

**Breaking**: rename two state-zone tables to comply with the normative plural rule in `db-schema.md §Naming conventions`.

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
