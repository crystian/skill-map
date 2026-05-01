---
'@skill-map/cli': minor
---

refactor: cli-architect audit sweep — boundary hygiene, i18n discipline, enum hardening, IAction stub

Closes the findings from the `minions:cli-architect` review of `src/`. No spec changes, no behaviour change in command output bytes (every promoted renderer was rerun against its existing tests). One internal port-shape change (`StoragePort.jobs.listOrphanFiles → listReferencedFilePaths`) — `@skill-map/cli` is still `private: true`, but pre-1.0 minor anyway because the change is structural and the new `IAction` contract is part of the public extension surface.

**Boundary hygiene (C1, C2, H1)**

- Lifted every storage-port type from the SQLite adapter modules into `kernel/types/storage.ts`: `IPruneResult`, `IListExecutionsFilter`, `IHistoryStatsRange`, `THistoryStatsPeriod`, `IMigrateNodeFksReport`, `IPluginConfigRow`, `IApplyOptions/Result`, `IMigrationFile/Plan/Record`, `IPluginApplyOptions/Result`, `IPluginMigrationFile/Plan/Record`. The port and the SQLite adapter modules now both import from one source; a second adapter (Postgres, in-memory test harness) inherits no SQLite-specific types.
- `StoragePort` re-exports the lifted types so the CLI consumes the abstract contract end-to-end. `cli/commands/orphans.ts` and `cli/commands/history.ts` no longer reach into `kernel/adapters/sqlite/*` for type imports.
- `kernel/adapters/sqlite/jobs.ts` no longer touches the FS — the docstring was already promising "we do NOT touch the FS from the storage layer", but `listOrphanJobFiles` was importing `node:fs`. New helper `kernel/jobs/orphan-files.ts:findOrphanJobFiles(jobsDir, referenced)` performs the directory walk; the storage helper renames to `selectReferencedJobFilePaths(db)` and the port surface flips from `jobs.listOrphanFiles(jobsDir): IOrphanFilesResult` to `jobs.listReferencedFilePaths(): Promise<Set<string>>`. `sm job prune --orphan-files` orchestrates the two pieces in the CLI command.

**IAction extension contract + exhaustive switches (C3, H4)**

- New `kernel/extensions/action.ts:IAction` + `IActionPrecondition`, mirroring `spec/schemas/extensions/action.schema.json`. Manifest-only — runtime invocation (deterministic in-process call vs probabilistic runner dispatch) lands with the job subsystem (Decision #114); the contract carries the manifest fields so the AJV validator and `sm actions show` already have a typed shape to anchor against.
- `IBuiltIns` gains an `actions: IAction[]` bucket. `bucketBuiltIn` (`built-in-plugins/built-ins.ts`) and `bucketLoaded` (`cli/util/plugin-runtime.ts`) both grow exhaustive `default: never` arms — silent fall-through on a future kind addition turns into a compile error. `accumulateBuiltInScanExtensions` similarly explicit.
- `extensions/index.ts` docstring no longer claims "six kinds" while shipping five.

**Runtime enum hardening at the row→domain boundary (H5)**

- New `kernel/util/enum-parsers.ts` with type guards (`isStability`, `isLinkKind`, `isConfidence`, `isSeverity`, …) and parsers (`parseStability(s, ctx)`, `parseLinkKind(s, ctx)`, …). Parsers throw with a clear diagnostic naming the offending value, the allowed set, and the caller's row context.
- `kernel/adapters/sqlite/scan-load.ts:rowToNode/rowToLink/rowToIssue` now use the parsers instead of raw `as Stability/LinkKind/Confidence/Severity` casts. `Node.kind` stays open string per spec — the parsers cover only the closed-enum fields.

**i18n discipline sweep (H2, H3)**

CLI catalog additions (`cli/i18n/*.texts.ts`):

- `CHECK_TEXTS.issueRow` — `[severity] ruleId: message — nodeIds`.
- `SHOW_TEXTS.groupedLinkHead/Dup/Sources` — split the in/out link bullet so the `(×N)` and ` sources: …` segments stay greppable.
- `ORPHANS_TEXTS.activeIssuesHeader/activeIssueRow/noNodePlaceholder` — `renderOrphans` no longer composes English inline.
- `EXPORT_TEXTS.md*` — every line of `renderMarkdown` (title, query echo, counts, per-kind sections, link bullets, issue bullets) routes through `tx`.
- `HISTORY_TEXTS.statusWithReason` — `<status> (<failureReason>)` cell composition.

Kernel catalog (`kernel/i18n/storage.texts.ts`, new):

- `STORAGE_TEXTS.scanPersistInvalidScannedAt` — `kernel/adapters/sqlite/scan-persistence.ts`.
- `STORAGE_TEXTS.findNodesInvalidSortBy/Limit` — `kernel/adapters/sqlite/storage-adapter.ts`.
- `QUERY_TEXTS.exportQuery*` — `kernel/scan/query.ts` (every `ExportQueryError` thrown by `parseExportQuery`).

**Cleanup (H6, H7, M2, M3, L4, L5)**

- Dropped dead `FRONTMATTER_BY_KIND` map + `void` suppress in `built-in-plugins/rules/validate-all/index.ts` (unused per-kind frontmatter routing scaffolding).
- Dropped unused `NodeKind` import in `kernel/extensions/provider.ts` (referenced only in JSDoc text).
- Deduplicated `HOOK_TRIGGERS`: `kernel/adapters/plugin-loader.ts` now imports the single source of truth from `kernel/extensions/hook.ts` instead of redeclaring the eight-trigger list.
- Collapsed `TExtensionKind` and `ExtensionKind` to the canonical declaration in `kernel/registry.ts`. `kernel/adapters/schema-validators.ts` and `kernel/types/plugin.ts` re-import from there.
- Pruned `kernel/adapters/sqlite/index.ts` re-exports from ~22 schema-internal types to just `IDatabase` (the single type `src/test/storage.test.ts` consumes); CLI consumers go through the port.
- `cli/commands/scan.ts` consolidates `process.cwd()` calls behind a single `defaultRuntimeContext()` invocation per execution.
