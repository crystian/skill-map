---
'@skill-map/spec': minor
---

Step 10 prep — job artifacts move into the database (B2: content-addressed storage)

Removes the on-disk `.skill-map/jobs/<id>.md` and `.skill-map/reports/<id>.json` artifacts from the spec. Rendered job content and report payloads now live in the kernel database; the filesystem is no longer a normative layer of the job lifecycle. Pre-1.0 minor breaking per `versioning.md` § Pre-1.0.

**Why**: every other piece of operational state (`state_summaries`, `state_enrichments`, `state_plugin_kvs`, `node_enrichments`) already lives in the DB. Jobs and reports were the only outliers — and being outliers cost real complexity (orphan-file detection, partial backups, two-source-of-truth GC). With B2 (content-addressed dedup keyed on the existing `content_hash`), retries / `--force` / cross-node fan-out reuse a single content blob, so DB-only does not blow up storage on heavy users.

**Schema changes**

- New table `state_job_contents` (`content_hash` PK, `content` TEXT, `created_at`). Content-addressed: multiple `state_jobs` rows MAY reference the same row.
- `state_jobs.file_path` removed. The rendered content is fetched via `state_job_contents.content_hash` join.
- `state_executions.report_path` → `state_executions.report_json` (TEXT, parsed-JSON-on-read per the `_json` naming convention).

**Schema-typed contract changes**

- `Job.filePath` removed.
- `ExecutionRecord.reportPath` → `ExecutionRecord.report` (object/null — the parsed JSON payload).
- `Job.failureReason` and `ExecutionRecord.failureReason` enums: `job-file-missing` → `content-missing` (defensive failure-mode label for DB corruption where a job row outlives its content row; the runtime invariant should keep this state unreachable).
- `history-stats.schema.json` `perFailureReason` mirrors the rename.

**CLI surface changes**

- `sm job preview <id>` now prints the rendered content from `state_job_contents` (no file). Same output, different source.
- `sm job claim --json` is the contracted Skill-agent handover: returns `{id, nonce, content}` so the agent can call `sm record` afterwards with the nonce in hand. The plain-stdout form (id only) is preserved for legacy scripts.
- `sm record --report <path-or-dash>` accepts a file path OR `-` (stdin); the kernel reads the payload and stores it inline in `report_json`. The on-disk report file becomes operationally ephemeral — implementations SHOULD remove it after the kernel acknowledges the callback (courtesy GC, not normative).
- `sm job prune --orphan-files` removed. Replaced by automatic `state_job_contents` GC inside `sm job prune`: deletes terminal jobs past retention, then collects orphan content rows in the same transaction.
- `sm doctor` checks change accordingly: drops the "orphan job files / orphan DB rows pointing at missing files" pair; adds two DB-internal checks (`state_jobs` rows whose `content_hash` is missing from `state_job_contents`; `state_job_contents` rows referenced by zero `state_jobs` rows).

**Event stream changes**

- `job.spawning.data.jobFilePath` → `job.spawning.data.contentHash` (references the content row instead of a file path).
- `job.callback.received.data.reportPath` and `job.completed.data.reportPath` → `executionId` (references the `state_executions` row that holds the inline report payload). Reports are intentionally NOT inlined in events — consumers query the row when they need the body.

**Architecture changes**

- `RunnerPort.run(jobFilePath, options)` → `run(jobContent, options)` returning `{report, ...}` instead of `{reportPath, ...}`. Path-based reporting is no longer part of the port contract. Runners that need an actual file (the canonical case being `claude -p` reading stdin from a path) materialize a temp file inside `run()` and remove it after spawn — temp files are operational, not normative.

**Atomicity edge cases consolidated**

`spec/job-lifecycle.md` §Atomicity edge cases drops the four file-related rows. Two new DB-internal cases take their place: `state_jobs` row outliving its `state_job_contents` row (failure: `content-missing`); `state_job_contents` row with no live job references (GC straggler — `sm job prune` collects).

**Files touched**

- `spec/db-schema.md` — new `state_job_contents` section, `state_jobs.file_path` removed, `state_executions.report_path` → `report_json`, integrity section rewritten.
- `spec/job-lifecycle.md` — §Submit step 8 rewritten (DB store), §Atomic claim documents `--json` shape, §Atomicity edge cases consolidated, §Record callback rewritten for `--report` path-or-stdin semantics, §Retention extended to cover `state_job_contents` GC, failure-reason rename.
- `spec/cli-contract.md` — `sm job preview` / `sm job claim` / `sm job prune` rows updated, `sm job prune --orphan-files` row removed, `sm record` block rewritten with `<path-or-dash>`, `sm doctor` integrity bullets updated.
- `spec/prompt-preamble.md` — §How the kernel applies step 5 rewritten (DB store, no file).
- `spec/architecture.md` — §`RunnerPort` operations + reference impls updated for content-string + parsed-report shape.
- `spec/job-events.md` — `job.spawning` / `job.callback.received` / `job.completed` payloads changed.
- `spec/conformance/README.md` + `coverage.md` — `preamble-bitwise-match` references updated to `sm job preview` stdout.
- `spec/schemas/job.schema.json` — `filePath` property removed, failure-reason enum rename.
- `spec/schemas/execution-record.schema.json` — `reportPath` → `report` (object/null), failure-reason enum rename.
- `spec/schemas/history-stats.schema.json` — `perFailureReason` enum rename.
- `spec/index.json` regenerated (40 files hashed); `npm run spec:check` green.

**Migration for consumers**

- Any consumer reading `state_jobs.file_path` or `state_executions.report_path` reads from the renamed columns / DB-only paths instead.
- Any tooling that watched `.skill-map/jobs/*.md` or `.skill-map/reports/*.json` needs to query the DB or call the relevant `sm` verb.
- `--orphan-files` flag callers must drop the flag; `sm job prune` already does the equivalent automatically.
- Skill agents drain via `sm job claim --json` (id + nonce + content together) instead of `sm job claim` + reading a file.

**Out of scope**

The reference impl side of this (migration that adds `state_job_contents` + drops `state_jobs.file_path`; storage-adapter helpers; runtime piping in `ClaudeCliRunner` for the temp-file dance) lands in follow-up changesets under `@skill-map/cli`. The spec change above is self-contained: shipping it alone changes nothing at runtime, but unblocks the implementation phases.
