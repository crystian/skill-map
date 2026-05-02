---
'@skill-map/cli': patch
---

refactor: cli-architect audit follow-up — i18n discipline, runtime-context sweep, ExitCode literal cleanup

Internal hygiene only. No spec changes, no public CLI surface change, no behavioural change to output bytes — every promoted renderer was audited against its existing tests and the regenerated `context/cli-reference.md` is byte-identical to the pre-sweep version under matching CLI / spec versions (the diff in this commit is the legitimate version drift, not an i18n regression).

**M1 — i18n discipline in `cli/commands/help.ts`**

Promoted every hardcoded English string in `renderMarkdown` / `renderVerbBlock` / `renderVerbFlags` / `renderVerbExamples` / `renderSingle` to `cli/i18n/help.texts.ts`. 14 new keys: `mdReferenceTitle`, `mdGeneratedNotice`, `mdCliVersionLine`, `mdSpecVersionLine`, `mdHeaderGlobalFlags`, `mdGlobalFlagBullet`, `mdCategoryHeading`, `mdVerbHeading`, `mdLabelFlags`, `mdLabelExamples`, `mdFlagBullet` (+ `mdFlagBulletRequiredFragment` / `mdFlagBulletDescriptionFragment` for the optional trailing slots), `mdExampleBullet`, `humanVerbHeader`, `humanLabelFlags`, `humanFlagRow` (+ `humanFlagRowRequiredFragment`). Markdown structural pieces (code-fence backticks, table pipes) stay inline — they are syntax, not user-facing prose.

**M2 — `refresh.ts` "read failed for &lt;path&gt;: &lt;err&gt;" sub-detail catalogued**

`#runDetExtractorsAcrossNodes` was composing the inner error string via TS template inside the `tx(REFRESH_TEXTS.refreshFailed, …)` call. Lifted the inner copy to `REFRESH_TEXTS.readFailedDetail` (`'read failed for {{path}}: {{message}}'`) and the call site now nests a `tx(…)` for the detail inside the outer `refreshFailed`. Same output bytes, but every translatable substring is now in the catalog.

**M3 — `defaultRuntimeContext()` sweep across `cli/commands/`**

Replaced direct `process.cwd()` / `homedir()` reads with `defaultRuntimeContext()` in: `init.ts` (and the `runFirstScan` helper now takes `homedir` as a parameter), `jobs.ts`, `refresh.ts`, `scan-compare.ts`, `config.ts` (`ConfigSetCommand` / `ConfigResetCommand`), `plugins.ts` (`resolveSearchPaths`, `resolveDbPath`, `buildResolver`, `loadAll`, `expandHome`, `collectExplorationDirWarnings`, `TogglePluginsBase`), and `cli/util/plugin-runtime.ts` (`resolveSearchPaths`, `dbPathForScope`). The `cli/**` layer is allowed to call Node globals, but funnelling them through one helper keeps the future "drive the CLI from a non-process host" path clean and matches the pattern already established in earlier audit sweeps.

**M3 deferred — `cli/util/db-path.ts` carries a TODO**

`resolveDbPath` (and its `IDbLocationOptions` shape) still reads `homedir()` and `process.cwd()` directly. Promoted to a `TODO(cli-architect M3)` block in the file's docstring rather than rewritten inline because flipping the signature touches 18 call sites across 11 commands for a helper that lives in `cli/util/` (not in `kernel/**`, where the no-Node-globals invariant actually bites). The comment names the exact follow-up: extend `IDbLocationOptions` from `IRuntimeContext`, drop the imports, thread `...defaultRuntimeContext()` at every call site.

**L1 / L2 — `ExitCode.Error` literal cleanup**

Replaced three remaining `2` integer literals with `ExitCode.Error`: `db.ts:623,655` (plugin-migration failure paths) and `config.ts:202` (config-load failure path). Aligns with the H1 sweep from the prior audit pass that migrated 123 sites.

**Validation**

`npm run lint` clean, `npm run typecheck -w src` clean, `npm test -w src` 693/693 pass, `npm run validate` clean, `npm run cli:check` clean (the `context/cli-reference.md` regen in this commit reflects normal CLI / spec version drift since the file was last regenerated; the i18n sweep verified byte-identical render at HEAD's pre-sweep version values).
