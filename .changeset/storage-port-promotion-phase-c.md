---
"@skill-map/cli": minor
---

Storage-port promotion — Phase C (`jobs` namespace).

- **Port**: `port.jobs.pruneTerminal(status, cutoffMs)`, `port.jobs.listTerminalCandidates(status, cutoffMs)` (the dry-run preview surface), `port.jobs.listOrphanFiles(jobsDir)`.
- **Adapter**: `SqliteStorageAdapter.jobs` delegates to `pruneTerminalJobs` / `listOrphanJobFiles`. The dry-run candidate enumeration moves into the adapter as `listTerminalCandidates(...)` (mirrors the SELECT side of `pruneTerminalJobs` without the DELETE), so the CLI no longer hand-rolls the same query.
- **CLI migrated**: `cli/commands/jobs.ts` — `pruneTerminalJobs(adapter.db, ...)` → `adapter.jobs.pruneTerminal(...)`; `listOrphanJobFiles(adapter.db, jobsDir)` → `adapter.jobs.listOrphanFiles(jobsDir)`; the inline `selectFrom('state_jobs')` dry-run preview collapses into `adapter.jobs.listTerminalCandidates(...)`. `pruneOrPreview` is now a one-line ternary.

617/617 tests pass; npm run validate exit 0. Pre-1.0 minor bump.
