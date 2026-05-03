---
'@skill-map/cli': patch
---

Two UX improvements to the CLI error surface, addressing tester friction:

- `sm export --format md` (and any verb with required positionals) now reports `missing required positional argument(s) <query>` with the positional name extracted from Clipanion's USAGE hint, instead of the bare "Not enough positional arguments" that left users guessing what was missing. The redundant Clipanion usage line is stripped — `sm help <verb>` is the single point of truth.

- `sm config get scan.tokenizr` now suggests the closest valid key (`Did you mean 'scan.tokenize'?`) for typos within 3 edits. Powered by a bounded Levenshtein walk over every leaf in the merged config tree, so suggestions stay aligned with what `sm config list` would print. Cap is intentionally tight to avoid noise; far-off keys (e.g. `scan.includes` when the real path is `roots`) get the bare unknown-key error and no suggestion.

Both diagnostics share a new `src/cli/util/edit-distance.ts` helper extracted from the existing `parse-error.ts` Levenshtein implementation.
