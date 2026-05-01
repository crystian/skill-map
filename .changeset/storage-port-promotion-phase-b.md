---
"@skill-map/cli": minor
---

Storage-port promotion — Phase B (`history` namespace).

- **Port surface**: `port.history.list(filter)`, `port.history.aggregateStats(range, period, top)` for the read paths; `tx.history.migrateNodeFks(from, to)` (transactional) for the FK-repointing primitive.
- **Adapter**: `SqliteStorageAdapter.history` delegates to the existing `listExecutions` / `aggregateHistoryStats` / `migrateNodeFks` free functions in `kernel/adapters/sqlite/history.ts`. Bodies stay; the namespace is a thin façade.
- **CLI migrated**: `cli/commands/history.ts` — `aggregateHistoryStats(adapter.db, ...)` → `adapter.history.aggregateStats(...)`; `listExecutions(adapter.db, ...)` → `adapter.history.list(...)`. `cli/commands/orphans.ts` — both transactional blocks (reconcile + undo-rename) move to `adapter.transaction(tx => tx.history.migrateNodeFks(...))` plus `tx.issues.deleteById` / `tx.issues.insert`. The `runWithOptionalRollback` helper now takes the adapter and a port-subset callback (instead of `Kysely<IDatabase>`); the `--dry-run` rollback-via-sentinel pattern is identical.

Side effect: the last `adapter.db.transaction()` direct call in CLI is gone. `orphans.ts` no longer imports `migrateNodeFks` directly, no longer touches `Kysely` / `IDatabase`. The free function `migrateNodeFks` stays exported (used by `scan-persistence.ts`); Phase F drops it from `kernel/index.ts`'s public surface if no caller reaches over.

617/617 tests pass; npm run validate exit 0. Pre-1.0 minor bump.
