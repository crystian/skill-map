---
"@skill-map/spec": minor
---

Normative `priority` for jobs.

The `state_jobs.priority` column (INTEGER, default `0`) existed in the schema and was used by the atomic-claim SQL (`ORDER BY priority DESC, createdAt ASC`), but no surface let the user set it. This release closes the gap:

- **`cli-contract.md` §Jobs**: new flag `sm job submit ... --priority <n>`. Integer; higher runs first; default `0`; negatives permitted (deprioritize).
- **`job-lifecycle.md` §Submit**: new step 6 resolving priority with precedence `action manifest defaultPriority → user config jobs.perActionPriority.<actionId> → flag`. The resolved value is frozen on submit and immutable for the life of the job. Ties in the claim order break by `createdAt ASC`.
- Configuration key `jobs.perActionPriority.<actionId>`: optional per-action integer override.
- Action manifest `defaultPriority`: optional integer; defaults to `0` when omitted.

Classification: minor per `cli-contract.md` §Stability ("adding a flag is a minor bump"). No existing consumer breaks: jobs submitted before this release default to `0`, which is the identity element of the ordering. The claim SQL already read `priority`, so the wire protocol is unchanged.
