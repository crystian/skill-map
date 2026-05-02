---
'@skill-map/cli': minor
---

refactor: cli-architect follow-up — finish kernel i18n migration, dedupe DB-path helpers, normalize conformance type names, switch `sm db` / `sm init` to async fs

Bundles a series of cli-architect audit findings (H1, H2, M1–M7, L1, L3). The `minor` bump is required by **M1** — the public type names exported from `src/conformance/index.ts` get an `I*` prefix to align with the kernel's category-4 naming convention; per AGENTS.md pre-1.0 rule, breaking changes ship as a minor while the workspace stays in `0.Y.Z`.

**H1 — kernel i18n leak in config loader + migrations**

Two new catalogs land under `src/kernel/i18n/`:

- `config-loader.texts.ts` — every warning the layered config loader pushes into `ILoadedConfig.warnings` (or throws under `--strict`) now flows through `tx(CONFIG_LOADER_TEXTS.<key>, vars)`.
- `migrations.texts.ts` — every `Error.message` thrown by `kernel/adapters/sqlite/migrations.ts` (duplicate version, invalid version range, per-file apply failure) goes through `tx(MIGRATIONS_TEXTS.<key>, vars)`.

These messages surface to the user via `cli/commands/config.ts` (warnings dumped to stderr) and `cli/commands/db.ts` (migration failures rendered with the `{{reason}}` template). They were the last hardcoded-English strings in the kernel surface.

**H2 — hardcoded `.skill-map/skill-map.db` (and friends) duplicated across six call sites**

`cli/util/db-path.ts` now exports a single `DEFAULT_DB_REL = '.skill-map/skill-map.db'` plus four typed companion helpers:

- `defaultProjectDbPath(ctx)` → `<cwd>/.skill-map/skill-map.db`
- `defaultProjectJobsDir(ctx)` → `<cwd>/.skill-map/jobs`
- `defaultProjectPluginsDir(ctx)` → `<cwd>/.skill-map/plugins`
- `defaultUserPluginsDir(ctx)` → `<homedir>/.skill-map/plugins`

Migrated call sites: `cli/commands/scan.ts`, `cli/commands/refresh.ts`, `cli/commands/watch.ts`, `cli/commands/jobs.ts`, `cli/commands/plugins.ts`, `cli/util/plugin-runtime.ts`. The convention now lives in exactly one file.

**M1 — conformance public types adopt the `I*` prefix (BREAKING)**

`src/conformance/index.ts` exports get the kernel-style `I*` prefix:

- `AssertionResult` → `IAssertionResult`
- `RunCaseResult` → `IRunCaseResult`
- `RunCaseOptions` → `IRunCaseOptions`
- `Assertion` (private) → `IAssertion` (now exported)
- `AssertionContext` (private) → `IAssertionContext`
- `ConformanceCase` (private) → `IConformanceCase`

Consumers inside the repo (`cli/commands/conformance.ts`, `test/conformance*.test.ts`) reference `runConformanceCase` only — none of them import the type names — so the rename is type-only inside the workspace; the breaking impact is for downstream tooling that imports the conformance module directly.

**M2 — conformance reason strings**

New `src/conformance/i18n/runner.texts.ts` catalog. Every `reason` string the runner returns (assertion failures, JSONPath dispatch errors, containment violations, the `assertSpecRoot` throw) now flows through `tx(CONFORMANCE_RUNNER_TEXTS.<key>, vars)`.

**M3 — registry errors**

New `src/kernel/i18n/registry.texts.ts` catalog. The `DuplicateExtensionError` constructor, the unknown-kind throw, and the missing-`pluginId` throw all use the catalog now.

**M4 — `sm help --format json` flag description**

The `--help` global flag's English description in `cli/commands/help.ts` was hardcoded. Moved to `HELP_TEXTS.globalFlagHelpDescription`.

**M5 — `resolveDbPath` is the canonical entrypoint everywhere**

Subsumed by H2: the previously-direct `resolve(ctx.cwd, DEFAULT_PROJECT_DB)` constructions in `scan.ts`, `refresh.ts`, `watch.ts` now call `defaultProjectDbPath(ctx)` (a thin wrapper over `resolveDbPath`). `init.ts` keeps its inline path because it owns `--global` semantics that resolve through `SKILL_MAP_DIR` directly.

**M6 — async fs in `sm db` and `sm init`**

`cli/commands/db.ts` and `cli/commands/init.ts` switched from `fs`'s sync API (`copyFileSync`, `mkdirSync`, `existsSync`, `rmSync`, `statSync`, `readFileSync`, `writeFileSync`) to `fs/promises`. `existsSync` checks became a small `pathExists()` helper that wraps `stat()` and only swallows `ENOENT`. `DatabaseSync` and `spawnSync('sqlite3')` stay as they were (sync-only by design).

**M7 — `sm scan compare-with` now forwards layered-loader warnings**

Mirrors what `cli/commands/config.ts` already did for `sm config show / get / set`: the `ILoadedConfig.warnings` array is iterated to stderr instead of being silently dropped. Without `--strict`, a malformed `settings.json` now produces the same diagnostic line under compare-with that it produces under every other read-side verb.

**L1 — collapsed duplicate DB-path constants**

`DEFAULT_PROJECT_DB` and `DEFAULT_GLOBAL_DB` resolved to the same string. Replaced by the single `DEFAULT_DB_REL`.

**L3 — dropped the unused `LOGGER_FLAG_NAME` export**

`cli/util/logger.ts` exported both `LOGGER_ENV_VAR` (used by `entry.ts`) and `LOGGER_FLAG_NAME` (no consumers anywhere). Dropped the latter; the internal `FLAG_NAME` constant stays because `extractLogLevelFlag` still uses it.

**Validation**

`npm run validate` clean (lint across workspaces). `npm test -w src` 693/693 pass.
