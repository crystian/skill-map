---
"@skill-map/cli": patch
---

Step 5.10 — Two polish fixes for the `sm history` CLI surfaces, both
surfaced during end-to-end walkthrough.

**Fix 1 — `sm history` (human) table columns no longer collapse**:
the previous `formatRow` padded every non-ID column to a flat 11
chars. The STARTED column writes a 20-char ISO-8601 timestamp
(`2026-04-26T14:00:00Z`), which exceeds the 11-char width — `padEnd`
silently no-ops when content is longer than the target width, so the
timestamp ran into the next ACTION cell with zero whitespace
between (`...T14:00:00Zsummarize`). Replaced with a per-column
`COL_WIDTHS` array sized so the longest expected content fits with
≥2 trailing spaces:

| Column   | Width | Rationale                       |
|----------|-------|---------------------------------|
| ID       | 28    | truncate to 26 + 2 padding      |
| STARTED  | 22    | 20-char ISO + 2 padding         |
| ACTION   | 26    | truncate to 24 + 2 padding      |
| STATUS   | 12    | longest enum (`completed`) + 3  |
| DURATION | 10    | longest format (`1m 42s`) + 3   |
| TOKENS   | 14    | typical `12345/6789` + buffer   |
| NODES    | 6     | small int + buffer              |

**Fix 2 — `sm history stats --json` `elapsedMs` accuracy**: the field
was captured at `stats` construction time, BEFORE
`loadSchemaValidators()` (which loads + AJV-compiles 29 schemas from
disk on every CLI invocation, ~100 ms cold). Result: the JSON
reported `elapsedMs: 10` while stderr showed `done in 111ms` —
divergence of ~10× that misled anyone trying to correlate the two
numbers. Fixed by re-stamping `stats.elapsedMs = elapsed.ms()` AFTER
the validator load but BEFORE serialise. Schema validation is
order-independent for `elapsedMs` (any non-negative integer
satisfies the schema), so re-stamping post-validate is safe. The
~10 ms remaining gap (serialise + write) is below user-perception
threshold.

The validator load itself is still uncached — addressing that is a
deeper refactor (module-level cache or pre-compiled validators) and
out of scope for this polish pass.

Test: 1 new in `src/test/history-cli.test.ts` — "table columns do
not collapse" — asserts the rendered output contains an ISO
timestamp followed by ≥2 spaces before the action id. Catches the
pre-5.10 regression directly.

Test count: 206 → 207.
