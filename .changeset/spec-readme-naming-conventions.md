---
"@skill-map/spec": patch
---

Promote the casing rule from implicit (stated only in `CHANGELOG.md` §Conventions locked and in individual schema descriptions) to explicit, with a new **Naming conventions** section in `spec/README.md`. Two rules, both normative:

- **Filesystem artefacts in kebab-case**: every file, directory, enum value, and `issue.ruleId` value. Values stay URL/filename/log-key safe without escaping.
- **JSON content in camelCase**: every key in schemas, frontmatter, configs, manifests, job records, reports, event payloads, API responses. The SQL layer (`snake_case`) is the sole exception, bridged by the storage adapter.

Companion alignment in `spec/db-schema.md` §Rename detection: the prose mixed column names (`body_hash`, `frontmatter_hash`, `rule_id`, `data_json`) with domain-object references. The heuristic is specified against the domain types (`bodyHash`, `frontmatterHash`, `ruleId`, `data`) as defined in `node.schema.json` / `issue.schema.json`; the SQLite columns are the storage shape, not the contract. Added a one-line casing note that points back to §Naming conventions so the bridge is explicit.

Classification: patch. The rule itself is unchanged — it was already enforced by every shipped schema and repeated in `CHANGELOG.md`. The additions are purely documentary so new implementers find the rule without digging through the changelog, and so the rename-detection prose stops looking like it references SQLite-specific identifiers when it means domain-object fields.
