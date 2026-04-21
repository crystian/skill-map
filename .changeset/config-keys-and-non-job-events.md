---
"@skill-map/spec": minor
---

Close two gaps surfaced in the audit pass: config keys that `ROADMAP.md` promised but `project-config.schema.json` did not declare, and WebSocket event families that `ROADMAP.md §UI` mentioned ("scan updates + issue changes") but `job-events.md` did not cover.

**`project-config.schema.json` — new optional fields, all non-breaking:**

- `autoMigrate: boolean` (default `true`) — auto-apply pending kernel + plugin migrations at startup after auto-backup. `false` → startup fails fast if migrations are pending.
- `tokenizer: string` (default `cl100k_base`) — name of the offline tokenizer; stored alongside counts so consumers know which encoder produced them.
- `scan.maxFileSizeBytes: integer` (default `1048576`) — files larger are skipped with an `info` log.
- `jobs.ttlSeconds: integer` (default `3600`) — global fallback TTL when an action manifest omits `expectedDurationSeconds` (typically `mode: local` actions where the field is advisory).
- `jobs.perActionPriority: { <actionId>: integer }` — per-action priority overrides. Frozen on `state_jobs.priority` at submit time; overrides action manifest `defaultPriority`; overridden by CLI `--priority`. Ratifies decision #40a in the schema.
- `jobs.retention: { completed, failed }` — GC policy for `state_jobs` rows. Defaults: `completed = 2592000` (30 days), `failed = null` (never auto-prune; keep for post-mortem). `sm job prune` reads these; no implicit pruning during normal verbs.

**`job-events.md` — new `Non-job events` section, Stability: experimental across v0.x:**

- `scan.*`: `scan.started`, `scan.progress` (throttled ≥250 ms), `scan.completed`.
- `issue.*`: `issue.added`, `issue.resolved` — emitted after `scan.completed` when the new scan's issue set differs from the previous one. Diff key: `(ruleId, nodeIds sorted, message)`.
- Synthetic run ids follow the existing `r-<mode>-YYYYMMDD-HHMMSS-XXXX` pattern (`r-scan-...`, `r-check-...`) alongside `r-ext-...` for external Skill claims.

These families ship at Step 12 of the reference impl alongside the WebSocket broadcaster. Marking them experimental keeps the shape mutable until real UI consumers exercise the stream; promotion to `stable` is a later minor bump.

Classification: minor per §Pre-1.0. All additions are optional fields in a permissive config schema and new event types outside the stable job family — zero impact on existing implementations. Matching `ROADMAP.md` §Notable config keys and §Progress events updates land in the same change.
