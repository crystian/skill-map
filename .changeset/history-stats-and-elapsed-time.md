---
"@skill-map/spec": minor
---

Add `sm history stats` schema and normative elapsed-time reporting.

- **New schema** `spec/schemas/history-stats.schema.json`. Shape for `sm history stats --json`: `range` (configurable via `--since` / `--until`), `totals`, `tokensPerAction[]`, `executionsPerPeriod[]` (granularity via `--period day|week|month`, default `month`), `topNodes[]` (length via `--top N`, default 10), `errorRates` (global + per-action + per failure reason — all failure-reason enum values always present with `0` when unseen for predictable dashboards), and top-level `elapsedMs`. Duration stats in `tokensPerAction[]`: `durationMsMean` + `durationMsMedian` for MVP; percentiles deferred to a later minor bump.
- **cli-contract.md §Elapsed time** (new normative section). Every verb that does non-trivial work MUST report its own wall-clock:
  - **Pretty (stderr)**: last line `done in <formatted>` where `<formatted>` ∈ `{ <N>ms | <N.N>s | <M>m <S>s }`. Suppressed by `--quiet`.
  - **JSON stdout**: top-level `elapsedMs` when the shape is an object; schemas whose shape is an array or ndjson don't carry it (stderr is the sole carrier).
  - **Exempt** verbs (sub-millisecond, informational): `sm --version`, `sm --help`, `sm version`, `sm help`, `sm config get`, `sm config list`, `sm config show`.
  - Measurement spans from after arg-parsing to before terminal write.
- **cli-contract.md** `sm history stats` entry: flags enumerated (`--since`, `--until`, `--period`, `--top`) and schema referenced.
- **Coverage matrix**: row `29` for `history-stats.schema.json` (blocked by Step 4); artifact row `L` for the elapsed-time reporting invariant (blocked by Step 3).

Classification: minor per §Pre-1.0. The elapsed-time contract introduces a SHOULD-emit line that didn't exist before — no existing consumer breaks, and the line goes to stderr where it doesn't clash with stdout JSON.
