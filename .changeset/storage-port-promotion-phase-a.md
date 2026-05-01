---
"@skill-map/cli": minor
---

Storage-port promotion — Phase A (`scans` / `issues` / `enrichments` / `transaction` namespaces).

Pre-refactor, `StoragePort` modeled only `init` / `close`. All real persistence lived as free functions in `kernel/adapters/sqlite/*.ts` that took `Kysely<IDatabase>` directly, and 8+ CLI commands consumed those free functions plus inline `selectFrom(...)` queries — hexagonal architecture in name only.

Phase A lands the core scan pipeline:

- **`kernel/types/storage.ts`** (new) — option bags + result shapes (`INodeFilter`, `INodeBundle`, `INodeCounts`, `IPersistOptions`, `IIssueRow`).
- **`kernel/ports/storage.ts`** — full namespaced shape declared (full surface, not Phase-A-only). `scans` / `issues` namespaces have method bodies; `transaction(fn)` exposes `ITransactionalStorage` with `scans.persist` / `issues.deleteById,insert` / `enrichments.upsertMany`.
- **`kernel/adapters/sqlite/storage-adapter.ts`** — implements the namespaces. `scans.persist` delegates to `persistScanResult`, `scans.load` to `loadScanResult`, `findNodes` reproduces `sm list`'s filter logic with a defensive `sortBy` whitelist, `findNode` returns the bundled node + outgoing/incoming links + filtered issues. `transaction(fn)` wraps `Kysely.transaction().execute(...)` and hands the callback a `buildTxSubset(trx)` projection.
- **9 CLI commands migrated**: `scan`, `list`, `show`, `check`, `orphans`, `refresh`, `export`, `graph`, `watch`. Every `selectFrom('scan_nodes' \| 'scan_issues' \| 'scan_links')`, every `loadScanResult` / `loadExtractorRuns` / `loadNodeEnrichments` / `persistScanResult` direct call, and every `rowToNode` / `rowToLink` / `rowToIssue` import is gone from these files. The two transactional blocks in `orphans.ts` (reconcile + undo-rename) still use `adapter.db.transaction()` directly because they call `migrateNodeFks` (Phase B port surface) — they migrate when Phase B lands.

Side effect: the CLI no longer needs to know `scan_*` table names or the json_each subquery shape. The free functions in `kernel/adapters/sqlite/scan-load.ts` and `scan-persistence.ts` stay exported for tests and the cross-phase migration; Phase F drops them from `kernel/index.ts`'s public surface.

Tests: 617/617 pass. `findNodes` carries a defensive sortBy whitelist that mirrors the CLI's own (`list.ts` validates upstream too — defense in depth).

Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0. Breaking for any caller that imported the kernel-side free functions, but no published consumer exists.

What's still pending:

- Phase B — `history` namespace (history.ts + orphans.ts migrateNodeFks).
- Phase C — `jobs` namespace.
- Phase D — `pluginConfig` namespace.
- Phase E — `migrations` + `pluginMigrations` (the `sm db` verb).
- Phase F — cleanup (drop unused free functions from `kernel/index.ts`, remove residual `import type { Kysely, IDatabase }` in CLI).
