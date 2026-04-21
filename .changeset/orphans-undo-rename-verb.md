---
"@skill-map/spec": minor
---

New CLI verb `sm orphans undo-rename <new.path> [--force]` to reverse a medium-confidence auto-rename.

The scan's rename heuristic (added in the previous spec release) migrates `state_*` FKs automatically when a deleted path and a newly-seen path share the same `frontmatter_hash` ("medium" confidence, body differs) and emits an `auto-rename-medium` issue for the user to verify. Until now the spec said "revert via `sm orphans reconcile --to <old.path>`", but `sm orphans reconcile` is defined for the forward direction (orphan path → live node) and awkward for the reverse case where both paths exist.

This release closes the gap with a dedicated reverse verb:

- **`cli-contract.md` §Browse**: new row `sm orphans undo-rename <new.path> [--force]`. Requires an active `auto-rename-medium` or `auto-rename-ambiguous` issue targeting `<new.path>`. Reads the prior path from `issue.data_json.from`, migrates `state_*` FKs back, resolves the issue. Exit `5` if no matching active issue.
- **`db-schema.md` §Rename detection**: issue payload now normative.
  - `auto-rename-medium.data_json` MUST include `{ from, to, confidence: "medium" }`.
  - `auto-rename-ambiguous.data_json` MUST include `{ to, candidates: [from_a, from_b, ...] }`. `sm orphans undo-rename` requires `--from <old.path>` to pick one.
- **Destructive verb**: prompts for confirmation unless `--force`. After undo, the prior path becomes an `orphan` (file no longer exists), emitting the normal `orphan` issue on next scan.

Rationale: dedicated name makes intent clear (forward = reconcile, reverse = undo-rename), failure is early (no active issue → immediate exit 5 with a helpful message), and the user does not re-type paths the kernel already knows.

Classification: minor per `cli-contract.md` §Stability ("adding a verb is a minor bump"). No existing behavior changes; `sm orphans reconcile` semantics are unaffected.
