# Storage Port Promotion — Item 11 from `cli-architect` audit (2026-05)

**Status**: planned, not started. Resume with the inventory + shape below.
**Decision**: option 3 — promote `StoragePort` to a real domain repository.
**Estimated effort**: 4-5h, split across 6 sequential commits.
**Scope**: `src/kernel/` + `src/cli/` (does not touch `spec/` / `ui/` / `testkit/`).

## Background

The audit (item 11, also tagged V2 / V3 / D1) flagged that `StoragePort` is decorative:

- The port models only `init` / `close`.
- All real persistence lives as **free functions** in `src/kernel/adapters/sqlite/*.ts` that take a `Kysely<IDatabase>` directly.
- 8+ CLI commands (`scan`, `list`, `show`, `check`, `orphans`, `refresh`, `jobs`, `history`, `db`, `export`, `graph`, `watch`) consume those free functions AND build inline Kysely queries — they know table names, column names, and SQL semantics.
- Net result: hexagonal architecture in name only; the CLI is tightly coupled to the SQLite schema.

The Architect decided **option 3** (promote to a real repository) over option 1 (delete the port and rename `kernel/adapters/sqlite/` → `kernel/persistence/sqlite/`) because the abstraction unlocks a future second adapter (HTTP server, remote, in-memory test harness) without rewriting every command.

## Inventory

### Free functions exported by `src/kernel/adapters/sqlite/*.ts` (consumed by CLI)

Captured from `grep -E "^export (function|async function|class|interface|type)"` on each file as of commit `bb7ff01`.

| File | Public functions |
|---|---|
| `scan-load.ts` | `loadScanResult`, `rowToNode`, `rowToLink`, `rowToIssue`, `loadExtractorRuns`, `loadNodeEnrichments` |
| `scan-persistence.ts` | `persistScanResult` |
| `history.ts` | `insertExecution`, `listExecutions`, `aggregateHistoryStats`, `findStrandedStateOrphans`, `migrateNodeFks` |
| `jobs.ts` | `pruneTerminalJobs`, `listOrphanJobFiles` |
| `plugins.ts` | `setPluginEnabled`, `getPluginEnabled`, `listPluginOverrides`, `deletePluginOverride`, `loadPluginOverrideMap` |
| `migrations.ts` | `defaultMigrationsDir`, `discoverMigrations`, `readLedger`, `planMigrations`, `applyMigrations`, `writeBackup` |
| `plugin-migrations.ts` | `resolvePluginMigrationsDir`, `discoverPluginMigrations`, `readPluginLedger`, `planPluginMigrations`, `applyPluginMigrations` |

**Total: ~30 public functions to absorb into the port.**

### Inline Kysely queries in `src/cli/` (must become port methods)

23 sites total — captured with `grep -rn "selectFrom|insertInto|deleteFrom|updateTable|\.transaction(" src/cli/`.

| Command | Lines | What it does |
|---|---|---|
| `list.ts` | 106-128, 162 | Filter `scan_nodes` with kinds/stabilities/has-issues + count issues per node |
| `scan.ts` | 480-482 | Count rows in `scan_nodes` / `scan_links` / `scan_issues` |
| `check.ts` | 147 | List all `scan_issues` |
| `orphans.ts` | 43, 168 | Find active issues by predicate; query `scan_nodes` |
| `orphans.ts` | 195-200, 333-345 | Two transactional blocks: delete + insert in `scan_issues` |
| `show.ts` | 69-93 | Query node + its outgoing/incoming links + its issues |
| `jobs.ts` | 206-216 | List `state_jobs` by status with limit |
| `refresh.ts` | 332-358 | Upsert `node_enrichments` inside a transaction |

## Proposed `StoragePort` shape

Namespaced by domain (NOT generic `port.query<T>`). Lives in `src/kernel/ports/storage.ts`. Single concrete adapter today: `SqliteStorageAdapter`.

```ts
import type { ScanResult, Node, Link, Issue, ExecutionRecord } from '../types.js';
import type {
  IExtractorRunRecord,
  IEnrichmentRecord,
  IPersistOptions,
} from '...';

export interface StoragePort {
  // --- lifecycle (current shape) ---
  init(): Promise<void>;
  close(): Promise<void>;

  // --- scan domain ---
  scans: {
    persist(result: ScanResult, opts?: IPersistOptions): Promise<void>;
    load(): Promise<ScanResult>;
    loadExtractorRuns(): Promise<IExtractorRunRecord[]>;
    loadNodeEnrichments(nodeId: string): Promise<IEnrichmentRecord[]>;
    countRows(): Promise<{ nodes: number; links: number; issues: number }>;
    /** Row-level filter for `sm list` — kinds, stabilities, has-issues. */
    findNodes(filter: INodeFilter): Promise<Node[]>;
    /** Bundled fetch for `sm show <path>` (node + links in/out + issues). */
    findNode(path: string): Promise<INodeBundle | null>;
  };

  // --- issues domain ---
  issues: {
    listAll(): Promise<Issue[]>;
    /** For `sm orphans` rules — predicate filter on the runtime Issue shape. */
    findActive(predicate: (i: Issue) => boolean): Promise<IIssueRow[]>;
    deleteById(id: string): Promise<void>;     // tx-only
    insert(issue: Issue): Promise<void>;        // tx-only
  };

  // --- enrichments domain ---
  enrichments: {
    upsertMany(records: IEnrichmentRecord[]): Promise<void>;  // tx-only in refresh
  };

  // --- history domain ---
  history: {
    insertExecution(record: ExecutionRecord): Promise<void>;
    list(filter: IListExecutionsFilter): Promise<ExecutionRecord[]>;
    aggregateStats(range: IHistoryStatsRange): Promise<IHistoryStats>;
    findStrandedStateOrphans(): Promise<IStrandedRow[]>;
    migrateNodeFks(from: string, to: string): Promise<IMigrateNodeFksReport>;
  };

  // --- jobs domain ---
  jobs: {
    pruneTerminal(opts: IPruneOptions): Promise<IPruneResult>;
    listOrphanFiles(): Promise<IOrphanFilesResult>;
    listByStatus(status: TJobStatus[], limit: number): Promise<IJobRow[]>;
  };

  // --- plugin config domain ---
  pluginConfig: {
    set(pluginId: string, enabled: boolean): Promise<void>;
    get(pluginId: string): Promise<boolean | null>;
    list(): Promise<IPluginConfigRow[]>;
    delete(pluginId: string): Promise<void>;
    loadOverrideMap(): Promise<Map<string, boolean>>;
  };

  // --- migrations (sm db verb) ---
  migrations: {
    discover(): IMigrationFile[];
    readLedger(): IMigrationRecord[];
    plan(target?: number): IMigrationPlan;
    apply(plan: IMigrationPlan, opts?: IApplyOptions): IApplyResult;
    writeBackup(targetVersion: number): string | null;
  };

  // --- plugin migrations (sm db verb, per-plugin) ---
  pluginMigrations: {
    discover(plugin: IDiscoveredPlugin): IPluginMigrationFile[];
    readLedger(pluginId: string): IPluginMigrationRecord[];
    plan(plugin: IDiscoveredPlugin, files: IPluginMigrationFile[]): IPluginMigrationPlan;
    apply(plan: IPluginMigrationPlan, opts: IPluginApplyOptions): IPluginApplyResult;
  };

  // --- transactions ---
  /**
   * Open a transaction for orphans.ts (delete+insert) and refresh.ts
   * (upsert enrichments). The callback receives a subset of the port
   * scoped to the transaction; commit/rollback follow the callback's
   * resolution / rejection.
   */
  transaction<T>(fn: (tx: ITransactionalStorage) => Promise<T>): Promise<T>;
}

/**
 * Subset of `StoragePort` available inside a transaction. Includes the
 * domains that actually batch writes — scans / issues / enrichments /
 * history. Lifecycle methods are NOT exposed.
 */
export interface ITransactionalStorage {
  scans: Pick<StoragePort['scans'], 'persist'>;
  issues: Pick<StoragePort['issues'], 'deleteById' | 'insert'>;
  enrichments: StoragePort['enrichments'];
  history: Pick<StoragePort['history'], 'insertExecution' | 'migrateNodeFks'>;
}
```

## Phased execution plan

Each phase is a green build + green tests + 1 commit. Order matters: Phase A is the load-bearing one (validates the namespacing approach + transaction API); B-F are mechanical repetition of the same pattern.

| Phase | Scope | Files affected | Cost | Risk |
|---|---|---|---|---|
| **A** | `scans` + `issues` + `enrichments` + `transaction` namespaces — the core scan pipeline | `kernel/ports/storage.ts` (rewrite), `kernel/adapters/sqlite/storage-adapter.ts` (extend), `cli/commands/{scan,list,show,check,orphans,refresh,export,graph,watch}.ts` | 1-1.5h | medium |
| **B** | `history` namespace | `kernel/adapters/sqlite/history.ts`, `cli/commands/history.ts`, `cli/commands/orphans.ts` (migrateNodeFks) | 30min | low |
| **C** | `jobs` namespace | `kernel/adapters/sqlite/jobs.ts`, `cli/commands/jobs.ts` | 30min | low |
| **D** | `pluginConfig` namespace | `kernel/adapters/sqlite/plugins.ts`, `cli/commands/plugins.ts`, `cli/util/plugin-runtime.ts`, `cli/commands/db.ts` (where it touches plugin overrides) | 30min | low |
| **E** | `migrations` + `pluginMigrations` namespaces (the `sm db` verb) | `kernel/adapters/sqlite/{migrations,plugin-migrations}.ts`, `cli/commands/db.ts` | 1h | medium (DatabaseSync vs Kysely interplay) |
| **F** | Cleanup: remove every `import type { IDatabase, Kysely } from ...` in CLI; delete unused free functions; final `import-x` lint check | all CLI command files | 30min | low |

**Total: ~4-5h across 6 commits.**

## Constraints from `AGENTS.md` to respect

- Pre-1.0 → every breaking change in the port shape ships as **minor** (never major).
- Each phase needs a `.changeset/*.md`. Suggested level: `minor` for A-E (port API expansion is a breaking contract change for kernel consumers); F is `patch` (cleanup).
- Naming buckets: the port itself uses no prefix (`StoragePort`). Internal types use `I*` (`INodeFilter`, `INodeBundle`, `IIssueRow`, etc.). Don't name namespaces with `I` prefix — they're not interfaces.
- ESM imports terminate in `.js`.
- Lint: `kernel/**` has `no-restricted-imports` blocking `cli/**` — the new port stays in `kernel/`, so this is fine. The CLI must stop importing `kernel/adapters/sqlite/*` for everything except `SqliteStorageAdapter` (the constructor / instantiation).

## Open questions to resolve at start of next session

1. **Where do the `INodeFilter` / `INodeBundle` / `IIssueRow` etc. types live?** Two options:
   - Inside the port file (`kernel/ports/storage.ts`) — keeps the port self-contained but bloats the file.
   - Side-by-side in `kernel/types/storage.ts` — separates concerns cleanly.

   Suggestion: side-by-side, exported from `kernel/index.ts` like other domain types.

2. **`sm db` verb**: the `migrations` and `pluginMigrations` namespaces use `DatabaseSync` (raw `node:sqlite`) directly, not Kysely. The current functions have signatures like `applyMigrations(db: DatabaseSync, ...)`. Two options:
   - The port methods take the `DatabaseSync` from the adapter internally (clean — caller doesn't see it).
   - Migrations are ONE special case where the port returns the raw handle (leaks abstraction but matches reality).

   Suggestion: encapsulate inside the port. The adapter knows it has a `DatabaseSync` underneath; callers only see plans/results.

3. **`rowToNode` / `rowToLink` / `rowToIssue`** are pure mappers (`Row → Domain`). They don't belong on the port (no DB call). Two options:
   - Keep them as free helpers in `kernel/adapters/sqlite/scan-load.ts`, but unexported — only the port uses them internally.
   - Move them to `kernel/util/row-mappers.ts` if any non-sqlite adapter ever needs to project rows to domain types.

   Suggestion: keep as adapter-internal helpers. They are sqlite-shape-specific anyway.

## Resuming this task

When picking it up:

1. Re-read this file end to end.
2. Confirm the shape with the Architect (re-validate: maybe his priorities shifted).
3. Start with Phase A. Implement the port interface first (`kernel/ports/storage.ts`), then extend `SqliteStorageAdapter` to implement it, then migrate the CLI commands one by one. Build + test + lint must stay green between each command migration; commit at the end of the phase, not in the middle.
4. After Phase A is committed, repeat for B-F in order. Each phase is independent of the next — you can stop after any phase if priorities change.

Final commit (after F) should also remove `kernel/adapters/sqlite/scan-load.ts`, `scan-persistence.ts`, `history.ts`, `jobs.ts`, `plugins.ts`, `migrations.ts`, `plugin-migrations.ts` from the public exports of `kernel/index.ts`. Their contents stay (they ARE the implementation) but become adapter-internal.
