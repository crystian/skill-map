---
"@skill-map/cli": minor
---

Storage-port promotion — Phase E (`migrations` / `pluginMigrations` namespaces) + Phase F (cleanup).

**Phase E** ports the kernel + per-plugin migration runners through the port:

- **Port**: `port.migrations.{discover, plan, apply, writeBackup}` and `port.pluginMigrations.{resolveDir, discover, plan, apply}`. The free functions in `kernel/adapters/sqlite/{migrations,plugin-migrations}.ts` stay as-is (synchronous, raw `DatabaseSync`-based, identical body); the namespace methods wrap them.
- **Adapter**: a small `withRawDb(path, fn)` helper opens / closes a short-lived `DatabaseSync` per port-method call. The verb's per-method invocations are infrequent (one `discover` + zero-to-three `plan` + zero-to-one `apply` + zero-to-N `pluginMigrations.{plan,apply}`), so the open/close overhead is negligible. The adapter's Kysely connection is unused by the migrations namespace; the migrations runner has its own raw lifecycle by design.
- **CLI migrated**: `cli/commands/db.ts:DbMigrateCommand.execute` no longer opens its own `new DatabaseSync(path)` — it builds a `SqliteStorageAdapter({ databasePath: path, autoMigrate: false })` and calls `adapter.migrations.discover() / plan() / apply()` plus `adapter.pluginMigrations.plan() / apply()`. `runPluginMigrations` takes the adapter instead of a raw db handle. The CLI no longer imports any free function from the migrations modules.

**Phase F** finishes the cleanup:

- The CLI surface no longer contains a single `selectFrom` / `insertInto` / `deleteFrom` / `updateTable` call against any `scan_*` / `state_*` / `config_*` table inside command files (verified via grep). The only remaining non-port `DatabaseSync` opens in CLI are the two administrative SQL paths in `db.ts` — `sm db backup` (PRAGMA wal_checkpoint + copy file) and `sm db reset` (drop tables for a clean slate). Both are intentionally raw — they do schema-management on the file rather than queries against application state.
- `cli/commands/init.ts` migrated the residual `persistScanResult(adapter.db, ...)` to `adapter.scans.persist(result, { renameOps, extractorRuns, enrichments })`.
- `kernel/index.ts` re-exports `ITransactionalStorage` plus the new domain types from `kernel/types/storage.ts` (`IIssueRow`, `INodeBundle`, `INodeCounts`, `INodeFilter`, `IPersistOptions`) so external consumers reach them through the canonical entry point.
- The free functions in `kernel/adapters/sqlite/*.ts` stay exported. Tests still construct `SqliteStorageAdapter` and (post-init) call `persistScanResult(adapter.db, ...)` directly in some places; that survives the refactor — they're testing the adapter implementation, not the port. The plan's "drop the adapter free functions from `kernel/index.ts` public surface" is moot here because they were already not re-exported through `kernel/index.ts`.

End-state: every CLI command that touches persistence does it through `port.<namespace>.<method>` or `port.transaction(tx => tx.<namespace>.<method>)`. Adding a second adapter (HTTP server, in-memory test harness) is now a matter of implementing the same `StoragePort` interface — no command surgery needed.

617/617 tests pass; npm run validate exit 0. Pre-1.0 minor bump for E (port surface expansion); F is bundled because the cleanup is the natural conclusion of the same refactor.
