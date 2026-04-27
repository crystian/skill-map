---
'@skill-map/cli': minor
---

Step 7.3 — `sm job prune` retention GC

Lands the real implementation behind the existing stub. Closes Step 7.

**Behaviour**:

- Default: applies the configured retention policy. For each terminal
  status (`completed` / `failed`) with a non-null
  `jobs.retention.<status>` value, deletes `state_jobs` rows whose
  `finished_at < Date.now() - policySeconds * 1000` and unlinks each
  row's MD file in `.skill-map/jobs/`. Default `completed` policy is
  30 days (2592000s); default `failed` is `null` (never auto-prune,
  preserving failure history for analysis).
- `--orphan-files`: ALSO scans `.skill-map/jobs/` for MD files whose
  absolute path is not referenced by any `state_jobs.file_path` and
  unlinks them. Runs AFTER retention so freshly-pruned files don't
  double-count. Useful when the DB was wiped or a runner crashed
  mid-render.
- `--dry-run` / `-n`: reports what would be pruned without touching
  the DB or the FS. Output shape is identical to live mode (`dryRun:
  true` distinguishes them under `--json`).
- `--json`: emits a structured document on stdout — `{ dryRun,
  retention: { completed: { policySeconds, deleted, files }, failed:
  {...} }, orphanFiles: { scanned, deleted } | { scanned: false } }`.

**Implementation**:

- New module `src/kernel/adapters/sqlite/jobs.ts`: `pruneTerminalJobs`
  (DB-only — returns count + filePaths so the CLI does the unlink) and
  `listOrphanJobFiles` (FS scan + DB cross-reference).
- New command file `src/cli/commands/jobs.ts`: `JobPruneCommand`.
- `src/cli/commands/stubs.ts` no longer exports `JobPruneCommand`; the
  stub registration was removed from `STUB_COMMANDS`.
- `src/cli/entry.ts` registers `JobPruneCommand` from the new file.

**Spec invariants honoured**:

- `state_executions` is NOT touched (per `spec/db-schema.md` §Persistence
  zones — append-only through v1.0).
- Pruning runs only on explicit invocation; no implicit GC during
  normal verb execution (per `spec/job-lifecycle.md` §Retention and
  GC).
- DB-missing → exit 2 with a clear message ("run `sm init` first").
- File-unlink failures (already missing, permission denied) are
  swallowed silently — a stale file path doesn't fail the verb;
  the DB row is already gone.

**Tests**: 327 → 341 (+14 covering helpers + CLI: empty DB, retention
cutoff, dry-run, orphan-files mode, json shape, default policies).

**Roadmap**: closes Step 7. All four frentes listed when 7 opened
(trigger normalization, chokidar, conflict resolution, sm job prune)
are now landed. Trigger normalization stayed implicit-already-done
(cabled at Steps 3–4). Step 8 (Diff + export) is next.
