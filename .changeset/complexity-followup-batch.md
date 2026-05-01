---
"@skill-map/cli": patch
---

Continue the complexity sweep:
- `refresh.ts:execute` and `scan-compare.ts:execute` — justified `eslint-disable-next-line complexity` with comments. The remaining cyclomatic count comes from CLI ergonomics (multiple try/catch + flag combinatorics) and the inner work already lives in extracted helpers.
- `kernel/adapters/sqlite/history.ts:aggregateHistoryStats` (18) — extracted `accumulateExecutionRow` for the per-row folding (totals, per-failure-reason, per-action, per-period, per-node). Helper stays at 15 due to the natural multi-accumulator nature of the operation; main function now below threshold.
