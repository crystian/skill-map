---
"@skill-map/spec": patch
---

Editorial pass: remove "MVP" terminology from four prose documents.

The project shipped two competing readings of "MVP" — sometimes "`v0.5.0`", sometimes "the whole product through `v1.0`". That drift produced contradictions in companion docs (e.g. the summarizer pattern: was `v0.8.0` or `v0.5.0` supposed to ship them?). To close the ambiguity once, `ROADMAP.md` and `AGENTS.md` standardised on explicit versioned releases and `post-v1.0` in the same audit window. This change brings the four spec prose touches that still said "MVP" into the same vocabulary.

- **`cli-contract.md` §Jobs**: `sm job run --all` description `(MVP: sequential)` → `(sequential through v1.0; in-runner parallelism deferred)`.
- **`job-events.md` §Event catalog**: `(post-MVP)` parallel-run note → `(deferred to post-v1.0)`.
- **`job-lifecycle.md` §Concurrency**: `MVP (v0.x): one job at a time.` → `Through v1.0 (spec v0.x): one job at a time.`
- **`plugin-kv-api.md` §Backup and retention**: `sm plugins forget <id> (post-MVP)` → `sm plugins forget <id> (deferred to post-v1.0)`.

Classification: patch. Editorial only — no schema, exit code, verb signature, or MUST/SHOULD statement changes meaning. All four replacements preserve the technical content; only the label changes from project-scoped ("MVP") to version-scoped (`v1.0`), which is the convention the rest of the spec already uses. Integrity block regenerated.
