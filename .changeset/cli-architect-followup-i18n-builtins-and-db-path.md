---
'@skill-map/cli': patch
---

refactor: cli-architect audit follow-up — i18n discipline in built-in plugins, scan-compare delta, plugin-runtime warnings, and `IDbLocationOptions` runtime-context unification

Internal hygiene only. No spec changes, no public CLI surface change, no behavioural change to output bytes — every promoted renderer keeps producing the same text it produced before, only the mechanism (`tx(*_TEXTS.*)`) changed. `cli/util/db-path.ts` is CLI-internal (not exported via `src/index.ts` or `src/kernel/index.ts`), so the helper signature change is a no-op for downstream consumers.

**F1 — `scan-compare` delta render lifted to the catalog**

`cli/commands/scan-compare.ts` (lines 217-263) was rendering the human delta with hardcoded English strings (`'Delta vs ...'`, `'## nodes'`, `'## links'`, `'## issues'`, `+`/`-`/`~` row prefixes). The previous i18n sweep had missed it. 11 new keys land in `cli/i18n/scan.texts.ts` (`compareDeltaSummary`, `compareDeltaNoDifferences`, plus header / row catalog entries for nodes / links / issues) and the renderer routes through `tx()` end-to-end.

**F2 — `built-in-plugins/` joins the `tx()` discipline**

Every `Issue.message` produced by a built-in rule and every line emitted by the ASCII formatter were inline English templates. `Issue.message` strings persist in `scan_issues.message` and surface through `sm check` / `sm show` / `sm export` — they are user-facing exactly like CLI stdout, so the same i18n rule applies. New directory `src/built-in-plugins/i18n/` ships six catalogs (`broken-ref.texts.ts`, `superseded.texts.ts`, `trigger-collision.texts.ts`, `validate-all.texts.ts`, `link-conflict.texts.ts`, `ascii.texts.ts`) and each built-in migrates to `tx(*_TEXTS.*)`. AGENTS.md gains a bullet under "i18n strategy" extending the rule to `built-in-plugins/`.

**F3 — `IDbLocationOptions` extends `IRuntimeContext` (closes TODO M3)**

The TODO left in the previous audit pass (`cli/util/db-path.ts`) is now closed. `IDbLocationOptions` extends `IRuntimeContext`, so `cwd` and `homedir` are mandatory; the helper no longer reads `process.cwd()` / `homedir()` directly. The local duplicate `resolveDbPath` in `cli/commands/plugins.ts` is dropped and that file imports the canonical helper. 21 call sites across 11 commands (`export`, `list`, `show`, `history`, `orphans`, `check`, `graph`, `db`, `version`, `plugins`, plus the related util) thread `{ ...defaultRuntimeContext() }` at the call edge.

**F4 — `plugin-runtime.formatWarning` catalogued**

`cli/util/plugin-runtime.ts:formatWarning` was composing `'plugin <id>: <status> — <reason>'` inline. New catalog `cli/i18n/plugin-runtime.texts.ts` ships `PLUGIN_RUNTIME_TEXTS.warningRow` + `warningReasonMissing`; `formatWarning` now routes through `tx()`.

**F5 — `export.ts` deferred-format reason catalogued**

The raw English `reason` string `'lands at Step 12 with the mermaid formatter'` interpolated by `cli/commands/export.ts` moves to `EXPORT_TEXTS.formatDeferredReasonMermaid`.

**F6 — orphan JSDoc cleanup in `init.ts`**

A JSDoc block documenting `ensureGitignoreEntries` had drifted on top of `previewGitignoreEntries` after a previous refactor. Moved back to its rightful function.

**F7 — `confirm.ts` yes-pattern catalogued**

`cli/util/confirm.ts` hardcoded `/^y(es)?$/i`. The regex source moves to `UTIL_TEXTS.confirmYesPatternSource` and the helper compiles it with the `i` flag. Trivial today but pre-wires the day a non-English locale lands (`^(y(es)?|s(í|i)?)$`).

**F10 — `storage-adapter.ts` header docstring rewording**

The header of `kernel/adapters/sqlite/storage-adapter.ts` claimed `enrichments` was a top-level property of the adapter class. It is not — `enrichments` lives on `ITransactionalStorage` (handed out via `port.transaction(...)`). Reworded to match.

**Validation**

`npm run -w src build` clean, `npm run lint` clean, `npm test -w src` 693/693 pass, `tsc --noEmit` clean.
