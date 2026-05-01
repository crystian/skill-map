---
'@skill-map/cli': patch
---

refactor: i18n discipline sweep across CLI renderers + storage-port-promotion follow-up

Internal tightening only. No spec changes, no public CLI surface change, no behavioural change to output bytes — every promoted renderer was audited against its existing tests (notably the `sm job prune` colon alignment and `renderStats` join semantics).

**Storage port follow-up (Phase F leftovers)**

- `StoragePort.migrations` gains `currentSchemaVersion(): number | null`, implemented in `SqliteStorageAdapter` via `withRawDb` + `PRAGMA user_version`. `cli/commands/version.ts` now resolves the DB schema version through the port + `tryWithSqlite` instead of importing `node:sqlite` directly. The `existsSync` short-circuit (no provisioning for an informational read) is preserved by `tryWithSqlite`.
- Cleaned up Phase D/F residue: dropped `void sql;` + the unused `sql` import in `kernel/adapters/sqlite/plugins.ts`; dropped the empty residual import from `cli/commands/plugins.ts`; dropped the unused `existsSync` import in `cli/commands/scan.ts`; dropped `void join;` + the unused `join` import in `cli/commands/jobs.ts`. Refreshed the `db` getter docstring on `SqliteStorageAdapter` (was tagged "Pre-Phase F" — Phase F is DONE; rewrote it as the documented test-only escape hatch).

**i18n discipline sweep**

Promoted hardcoded English strings inside CLI command renderers to their `*_TEXTS` catalogs, per the AGENTS.md i18n strategy ("every CLI command sources its strings from a sibling `cli/i18n/<verb>.texts.ts` via `tx(*_TEXTS.<key>)`"):

- `sm db migrate` apply / dry-run output (`Nothing to apply`, `Would apply N`, `Already up to date`, `Applied N`, `Applied N · backup: …`) → `DB_TEXTS`.
- `sm history` validation errors (`--limit` / `--period` / `--top`), the internal schema-validation error, render-table headers, and the entire `renderStats` block (window, totals, error rate, top actions/nodes, failures by reason) → `HISTORY_TEXTS`.
- `sm job prune` pretty output (tag, retention rows, orphan-files row, verbs, `formatPolicy('never')`) → `JOBS_TEXTS`. Colon alignment for `failed:    policy …` preserved verbatim.
- `sm list` render-table column headers → `LIST_TEXTS`.
- `sm orphans undo-rename` no longer concatenates English directly into `scan_issues.message`; routed through `tx(ORPHANS_TEXTS.undoRenameOrphanMessage, …)` (with a docstring noting the ideal layering would be kernel-side).
- `sm plugins` list / show renderers (`renderBuiltInBundleRow`, `renderPluginRow`, `renderBuiltInDetail`, `renderPluginDetail`, `renderExtensionsList`) → `PLUGINS_TEXTS`.
- `sm show` human renderer (`renderHuman`, `renderNodeHeader`, `renderIssuesSection`, `renderLinksSection` — section headers, `(none)` placeholder, optional-field rows, weight/tokens/external refs lines, issue rows) → `SHOW_TEXTS`.
- New `cli/i18n/util.texts.ts` (`UTIL_TEXTS`) for cross-cutting strings: `db-path` `dbNotFound`, `elapsed` `done in <…>`, `confirm` `[y/N]` suffix.
