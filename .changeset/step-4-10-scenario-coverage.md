---
"@skill-map/cli": patch
---

Step 4.10 — scenario coverage. Pure regression-test growth, no behavior
changes, no new dependencies, no migrations, no spec edits. Backfills
the scenarios surfaced by the manual end-to-end validation in
`.tmp/sandbox/` that the existing test suite did not codify:

- Hash discrimination: body-only edits leave `frontmatter_hash` and
  `bytes_frontmatter` byte-equal; frontmatter-only edits leave
  `body_hash` and `bytes_body` byte-equal. Locks in that the two
  SHA-256 streams are independent.
- `external_refs_count` lifecycle across body edits: 0 → 2 → 2 (dedup) →
  1 (malformed URL silently dropped), and `scan_links.target_path`
  never carries an `http(s)` value at any step.
- Replace-all ID rotation: synthetic `scan_links.id` /
  `scan_issues.id` are not promised to round-trip across re-scans;
  the natural keys (source/kind/target/normalized-trigger and
  ruleId/nodeIds) do. Documents the contract via assertion.
- Deletion-driven dynamic broken-ref re-evaluation, full-scan path:
  companion to the existing incremental-path test. Confirms rules
  always re-run over the merged graph even on the all-fresh path.
- Trigger-collision interaction with `--changed`: editing one
  advertiser keeps the collision firing (cached node still claims
  the trigger); deleting one advertiser clears it.
- `sm scan --no-tokens` at the CLI handler level (the existing test
  exercised the orchestrator only): default → `tokens_total`
  populated; `--no-tokens` → null; default again → repopulated.
- `sm scan --changed --no-built-ins` rejection: exit 2 with an
  explanatory stderr, no DB I/O.

Test count delta: 133 → 143.
