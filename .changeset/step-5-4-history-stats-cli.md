---
"@skill-map/cli": patch
---

Step 5.4 — `sm history stats` CLI lands alongside `sm history` in
`src/cli/commands/history.ts`. The stub is removed from `stubs.ts`
and the real class registered in `cli/entry.ts`.

Surface (matches `spec/cli-contract.md` §History):

- `--since <ISO>` / `--until <ISO>` — window boundaries. Since defaults
  to `null` (all-time); until defaults to `now()`. Both validated.
- `--period day|week|month` — bucket granularity. Default `month`. Bucket
  start computed in UTC (`bucketStartMs` from 5.2): day = 00:00 of the
  date, week = Monday 00:00 UTC, month = day-1 00:00 UTC.
- `--top N` — caps the `topNodes` array. Default 10. Non-positive → exit 2.
- `--json` — emits a `HistoryStats` object conforming to
  `spec/schemas/history-stats.schema.json`. The output is **self-validated
  before emit** via `loadSchemaValidators().validate('history-stats', …)` —
  same pattern as `src/test/self-scan.test.ts` — so a runtime shape
  regression surfaces as exit 2 with a clear stderr message rather than
  drifting silently.
- `--quiet` — suppresses the `done in <…>` stderr line.

Top-level `elapsedMs` is included in the JSON object per the schema.
Stderr always carries `done in <formatted>` unless `--quiet`.

The per-failure-reason map ALWAYS contains all six enum values
(`runner-error`, `report-invalid`, `timeout`, `abandoned`,
`job-file-missing`, `user-cancelled`), zero-filled when a reason has
no occurrences — predictable shape for dashboards.

Tests: 6 new in `src/test/history-cli.test.ts` covering schema
self-validation, day-period bucketing, invalid `--period`, `--top`
cap, `range.since` shape (`null` vs ISO string), and the empty-DB
all-zero totals path.

`context/cli-reference.md` regenerated.
