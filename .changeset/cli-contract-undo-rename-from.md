---
"@skill-map/spec": patch
---

Clarify `sm orphans undo-rename` signature in `spec/cli-contract.md §Browse` by surfacing the `[--from <old.path>]` flag in the command cell itself.

The flag was already documented prose-only in `spec/db-schema.md §Rename heuristic` ("`auto-rename-ambiguous` issues ... `sm orphans undo-rename` requires the user to pass `--from <old.path>` to disambiguate") but was absent from the signature in the `cli-contract.md` table. A reader consulting only the CLI contract would miss the flag and assume the command took `<new.path>` alone.

The row now:

- Shows `[--from <old.path>] [--force]` in the signature.
- Explicitly distinguishes the `auto-rename-medium` case (omit `--from`, previous path read from `issue.data_json`) from `auto-rename-ambiguous` (REQUIRES `--from` to pick from `data_json.candidates`).
- Adds an exit-`5` condition for `--from` referencing a path not in `candidates`.

No behavioural change — the flag was already normative and implementations were already expected to support it. Classification: patch (clarifying drift between two spec prose docs, not a new capability).
