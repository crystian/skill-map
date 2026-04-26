---
"@skill-map/cli": patch
---

Step 4.11 — three layers of defense against accidental DB wipes when
`sm scan` receives invalid or empty inputs:

- `runScan` validates every root path exists as a directory before
  walking, throwing on the first failure (was: silently yielded zero
  files via the claude adapter swallowing `ENOENT` in `readdir`).
- `sm scan` surfaces the validation error with exit code 2 and a clear
  stderr message naming the bad path.
- `sm scan` refuses to overwrite a populated DB with a zero-result scan
  unless `--allow-empty` is passed. Prevents the typo-trap reported in
  the e2e validation: `sm scan -- --dry-run` (where clipanion's `--`
  made `--dry-run` a positional root that did not exist) silently
  cleared the user's data. The new flag is opt-in by design — the
  natural case of "empty repo on first scan" is preserved (DB starts
  empty, scan returns 0 rows, persist proceeds without prompting).

Test count delta: 143 → 151.
