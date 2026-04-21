---
"@skill-map/spec": minor
---

**Breaking**: rename `dispatch-lifecycle.md` → `job-lifecycle.md`.

ROADMAP decision #30 renamed the domain term "dispatch" to "job" (tables `state_jobs`, artifact "job file"). The spec prose filename had lagged behind; this change closes that gap.

All internal references updated: `architecture.md`, `cli-contract.md`, `db-schema.md`, `prompt-preamble.md`, `versioning.md`, `schemas/job.schema.json`, `README.md`, and `package.json` `files` list. `index.json` regenerated.

**Migration**: any external consumer that links to `spec/dispatch-lifecycle.md` (by URL or filename) MUST update to `spec/job-lifecycle.md`. The canonical URL becomes `https://skill-map.dev/spec/v0/job-lifecycle.md`.

Classification: breaking change on a normative prose doc. Per `versioning.md` §Pre-1.0, minor bumps MAY contain breaking changes while the spec is `0.Y.Z`.
