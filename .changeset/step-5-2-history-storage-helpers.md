---
"@skill-map/cli": patch
---

Step 5.2 — Storage helpers for the history readers (`sm history`,
`sm history stats`) and for the rename heuristic / `sm orphans` verbs
landing in 5.3 — 5.6.

New module `src/kernel/adapters/sqlite/history.ts` with four entry
points, all accepting either a `Kysely<IDatabase>` or a
`Transaction<IDatabase>` so callers can compose them inside a larger
tx (the rename heuristic does this):

- `insertExecution(db, exec)` — write a `state_executions` row.
  Surfaces today through tests; consumed by `sm record` / `sm job run`
  at Step 9.
- `listExecutions(db, filter)` — read with optional filters: `nodePath`
  (JSON-array containment via `json_each`, mirroring the
  `sm list --issue` subquery in `cli/commands/list.ts`), `actionId`
  (exact match on `extension_id`), `statuses[]`, `sinceMs` /
  `untilMs` (since inclusive, until exclusive), `limit`. Sorted
  most-recent first.
- `aggregateHistoryStats(db, range, period, topN)` — totals,
  per-action token rollup (sorted desc by `tokensIn + tokensOut`),
  per-period bucketing via `bucketStartMs` (UTC `day` / `week` /
  `month`), top-N nodes by frequency (tie-break `lastExecutedAt`
  desc), and error rates: global, per-action, and per-failure-reason.
  The per-failure-reason map ALWAYS includes all six enum values
  (zero-filled), so dashboards see a predictable shape.
- `migrateNodeFks(trx, fromPath, toPath)` — repoint every `state_*`
  reference to a node from `fromPath` to `toPath`. Handles the three
  FK shapes the kernel uses today: simple column on `state_jobs`,
  JSON-array contents on `state_executions.node_ids_json`
  (pull-modify-update), and composite PKs on `state_summaries`,
  `state_enrichments`, `state_plugin_kvs` (delete + insert at the new
  PK). Composite-PK collisions are resolved conservatively: the
  destination row is preserved (it represents the live node's
  history), the migrating row is dropped, and the drop is reported
  back via `IMigrateNodeFksReport.collisions[]` so callers can surface
  a diagnostic. The empty-string sentinel for plugin-global keys is
  intentionally skipped.

Exports `bucketStartMs(dateMs, period)` for direct use by the
`sm history stats` CLI (5.4) and to keep bucketing testable in
isolation.

New domain types in `src/kernel/types.ts`: `ExecutionRecord`,
`ExecutionKind`, `ExecutionStatus`, `ExecutionFailureReason`,
`ExecutionRunner`, plus `HistoryStats` and its sub-shapes —
mirroring `spec/schemas/execution-record.schema.json` and
`spec/schemas/history-stats.schema.json` respectively.

Test count: 154 → 169 (+15 covering insert/list filter axes,
bucket boundaries for day/week/month, totals + per-action +
per-period + top-nodes + error-rates aggregation including the
all-six-keys failure-reason invariant, FK migration across the
three shapes, sentinel preservation, and conservative collision
resolution).
