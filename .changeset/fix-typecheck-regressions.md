---
"@skill-map/cli": patch
---

Fix `tsc --noEmit` regressions surfaced by CI after the Step 6
follow-up commits (`7d4b143`, `4669267`). The commits validated
through `tsup` (which does not enforce `noUncheckedIndexedAccess` /
`exactOptionalPropertyTypes`) but tripped CI's stricter `npm run
typecheck` step. Eight TS errors across six files; runtime behaviour
unchanged.

**Type fixes**:

- `src/cli/commands/config.ts` — `setAtPath` / `deleteAtPath` /
  `pruneEmptyAncestors` indexed `segments[i]` directly under
  `noUncheckedIndexedAccess`. Added an early-return guard for
  empty paths and non-null assertions on segment access.
- `src/cli/commands/init.ts` — `GITIGNORE_ENTRIES as const` narrowed
  `length` to `2`, making the pluralization branch (`=== 1`) a TS
  "no-overlap" error. Dropped `as const` and typed it as
  `readonly string[]`.
- `src/cli/commands/plugins.ts` — `TogglePluginsBase` extends
  Clipanion's `Command` but never implemented the abstract
  `execute()`. Marked the class `abstract` so only its concrete
  subclasses (`PluginsEnableCommand` / `PluginsDisableCommand`)
  need to implement it.
- `src/kernel/config/loader.ts` — direct cast between
  `IEffectiveConfig` and `Record<string, unknown>` is no longer
  accepted; routed through `unknown` at both `deepMerge` call
  sites.
- `src/kernel/scan/ignore.ts` — under `exactOptionalPropertyTypes`,
  `IBuildIgnoreFilterOptions` did not accept `undefined` even
  though the runtime tolerated it. Widened the three optional
  fields to `T | undefined` so callers can forward
  `readIgnoreFileText()` (which returns `string | undefined`)
  without a guard.
- `src/test/config-loader.test.ts` — `match(warnings[0], …)`
  failed under `noUncheckedIndexedAccess`; added non-null
  assertions (the lines above already verify `length === 1`).

**Prevention** — encadenar typecheck antes del test runner:

- `src/package.json` — `test` and `test:ci` now run
  `tsc --noEmit && node --import tsx --test ...`. Local `npm test`
  picks up strict-mode regressions immediately instead of waiting
  for CI.

Test count unchanged: 312 of 312 pass.
