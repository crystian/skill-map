---
'@skill-map/spec': patch
'@skill-map/cli': patch
---

Doc-only fix to remove a misleading reading of "built-in kinds" in the Node schema and one test, plus a small batch of internal CLI refactors and tightened null checks. No external surface change.

Spec / docs:

- `spec/schemas/node.schema.json` — the top-level `description` previously read "built-in kinds today are skill, agent, command, hook, note", which suggested those kinds were a kernel-level concept. They are not — the kernel treats `kind` as an open string, and the five names are emitted by the **built-in Claude Provider**. Re-worded to attribute the catalog to the Claude Provider, matching the wording already used on the `kind` field, in `spec/README.md`, in `src/kernel/types.ts`, and in `src/kernel/adapters/sqlite/schema.ts`.
- `src/test/extractor-applicable-kinds.test.ts` — three comments tightened from "built-in kind" to "built-in Claude Provider kind" for consistency.

Internal CLI refactors (no behaviour change):

- `src/cli/commands/config.ts` — extracted an `isPlainObject` predicate (replaces the duplicated `!!v && typeof v === 'object' && !Array.isArray(v)` check inside `enumerateConfigPaths`) and a `safeGetAtPath` helper that wraps `getAtPath` + `ForbiddenSegmentError` handling so each read verb's `run()` no longer repeats the try/catch + instanceof shape.
- `src/cli/commands/db.ts` — pulled the SQL number serialiser into `formatSqlNumber` (NaN / ±Infinity collapse to NULL) so `formatSqlValue` reads as a flat dispatcher.
- `src/cli/util/parse-error.ts` — moved the verb-scoped error formatting (incl. the missing-positionals special case) into a `formatVerbScopedError` helper so the top-level dispatcher in `formatParseError` stays flat. Removed the now-stale "dispatcher pattern" eslint-disable comment.
- `src/kernel/adapters/sqlite/scan-load.ts` — tightened `parseJsonObject` / `parseJsonArray` null checks from `s == null` to `s === null || s === undefined` to remove the implicit-coercion pattern flagged by lint.

No contract change (no field/type/required edits). `spec/index.json` regenerated.
