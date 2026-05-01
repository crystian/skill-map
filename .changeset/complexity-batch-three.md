---
"@skill-map/cli": patch
---

Continue the complexity sweep — 5 more functions reduced or disabled with rationale:
- `splitStatements` — char-by-char SQL state machine; justified inline disable.
- `plugins.ts:execute` (PluginsListCommand) — extracted `renderBuiltInBundleRow` and `renderPluginRow` per-row helpers.
- `collectApplicableKindWarnings` — extracted `appendUnknownKindWarnings`.
- `collectKnownKinds` and `collectExplorationDirWarnings` — extracted shared `forEachProviderInstance` iterator (built-ins + user-plugin Providers in one place).
- `accumulateExecutionRow` — justified inline disable (5-accumulator fold; per-accumulator helpers wouldn't make the algorithm clearer).
- `validateAndStrip` — extracted `applyValidationError` per-error helper.
