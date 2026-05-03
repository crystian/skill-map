---
'@skill-map/cli': patch
---

Two small CLI improvements driven by tour findings:

- `sm export` no longer requires the `<query>` positional. Calling it with just `--format md` (or any format flag, or no flags at all) exports the whole graph — equivalent to the existing `sm export "" --format md`. The empty query already meant match-all in the parser; this just stops Clipanion from rejecting the bare invocation. Examples in `sm help export` updated to lead with the no-query shape.
- `parseJsonArray` in the SQLite scan loader now tolerates `null` and `undefined` columns, returning `[]` instead of crashing `JSON.parse("undefined")`. Triggered when reading from a stale-schema DB where a column added by a later migration is absent — the verb now degrades to "empty array for that field" rather than the cryptic SyntaxError that drowned the actionable message.
