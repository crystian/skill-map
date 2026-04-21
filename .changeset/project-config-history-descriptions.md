---
"@skill-map/spec": minor
---

Clean up `history.*` in `spec/schemas/project-config.schema.json`.

**Breaking (pre-1.0 minor per `versioning.md` §Pre-1.0):**

- **Remove** `history.retentionDays`. The field promised execution-record GC, but `ROADMAP.md` §Step 6 and the job-retention section make it explicit that `state_executions` is append-only in `v0.1` and that the kernel does not use this key. Declaring a config key whose behaviour is "silently ignored" is worse than not declaring it — consumers would wire it in and never see an effect. The field will be re-introduced in a later minor bump when the GC path actually lands, with a concrete default and enforcement semantics.

**Editorial:**

- `history.share.description` mentioned `./.skill-map/history.json` — an artefact of the pre-SQLite architecture. The actual DB is `./.skill-map/skill-map.db` (see `db-schema.md` §Scope and location). Description corrected; field itself unchanged.

Classification: minor per §Pre-1.0 (`0.Y.Z` may contain breaking changes in a minor bump). Integrity block regenerated via `npm run spec:index`. Companion prose in `ROADMAP.md §Notable config keys` updated in the same change.

**Migration for consumers**: any `.skill-map.json` that set `history.retentionDays` will now fail schema validation (`additionalProperties: false` on `history`). Remove the key; no kernel behaviour changes because nothing was consuming it.
