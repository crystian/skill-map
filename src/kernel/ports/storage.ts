/**
 * `StoragePort` — the kernel's persistence boundary. Driving adapters
 * (CLI, future server, in-memory test harness) consume this surface
 * exclusively; nothing in `cli/**` should reach into the SQLite
 * adapter's internal helpers (free functions on
 * `kernel/adapters/sqlite/*`) directly. Phase F of the
 * storage-port-promotion refactor finishes that hardening; A-E grow
 * the port enough that the CLI has somewhere to land.
 *
 * The port is namespaced by domain (`scans`, `issues`, `enrichments`,
 * etc.) — explicitly NOT a generic `port.query<T>(sql)`. Each
 * namespace's methods name an operation the kernel cares about; the
 * adapter translates to its persistence engine's idioms.
 *
 * Phase A lands the **scans / issues / enrichments / transaction**
 * namespaces — the core scan pipeline. The remaining namespaces
 * (history / jobs / pluginConfig / migrations / pluginMigrations)
 * arrive in subsequent phases. The port shape declared here is the
 * Phase A subset; later phases extend it without reshaping what
 * lands today.
 */

import type {
  ExecutionRecord,
  HistoryStats,
  Issue,
  Node,
  ScanResult,
} from '../types.js';
import type {
  IEnrichmentRecord,
  IExtractorRunRecord,
  IPersistedEnrichment,
} from '../orchestrator.js';
import type { IDiscoveredPlugin } from './plugin-loader.js';
import type {
  IApplyOptions,
  IApplyResult,
  IHistoryStatsRange,
  IIssueRow,
  IListExecutionsFilter,
  IMigrateNodeFksReport,
  IMigrationFile,
  IMigrationPlan,
  INodeBundle,
  INodeCounts,
  INodeFilter,
  IPersistOptions,
  IPluginApplyOptions,
  IPluginApplyResult,
  IPluginConfigRow,
  IPluginMigrationFile,
  IPluginMigrationPlan,
  IPruneResult,
  THistoryStatsPeriod,
} from '../types/storage.js';

/**
 * Subset of `StoragePort` exposed inside a `transaction(fn)` callback.
 * Lifecycle methods are intentionally omitted — a transaction that
 * tries to `init()` the adapter mid-flight is a category error.
 *
 * Every callable in the subset MUST run on the same underlying
 * transaction handle the adapter opened for the callback. Adapters
 * are responsible for that wiring; consumers only see the namespace
 * surfaces.
 */
export interface ITransactionalStorage {
  scans: {
    persist(result: ScanResult, opts?: IPersistOptions): Promise<void>;
  };
  issues: {
    deleteById(id: number): Promise<void>;
    insert(issue: Issue): Promise<void>;
  };
  enrichments: {
    /**
     * Upsert a batch of fresh enrichment records produced by an
     * extractor pass. Composite PK is `(nodePath, extractorId)`;
     * conflict → replace. Every row lands with `stale = 0` (the
     * caller just refreshed it; ROADMAP §B.10 — staleness is
     * computed downstream when the body hash changes again).
     */
    upsertMany(records: IEnrichmentRecord[]): Promise<void>;
  };
  history: {
    /**
     * Repoint every `state_*` reference from `fromPath` to `toPath`.
     * Atomic across the four state tables; the report flags any
     * composite-PK collisions so callers can diagnose them.
     * `sm orphans reconcile` / `undo-rename` and the scan-time
     * rename heuristic are the canonical consumers.
     */
    migrateNodeFks(from: string, to: string): Promise<IMigrateNodeFksReport>;
  };
  // jobs / pluginConfig namespaces land in Phases C-D.
}

export interface StoragePort {
  // --- lifecycle ---------------------------------------------------------
  init(): Promise<void>;
  close(): Promise<void>;

  // --- scans namespace ---------------------------------------------------
  scans: {
    /**
     * Persist a fresh `ScanResult` (replace-all on the scan zone).
     * Called by `sm scan` after the orchestrator returns. The renames /
     * extractor-runs / enrichments side bags ride along inside the
     * same transaction — the call is atomic from the caller's view.
     */
    persist(result: ScanResult, opts?: IPersistOptions): Promise<void>;
    /**
     * Hydrate the persisted `ScanResult`. Returns the snapshot the
     * scan zone holds today (including external-Provider kinds —
     * `node.kind` is open string per `node.schema.json`).
     */
    load(): Promise<ScanResult>;
    /**
     * Spec § A.9 — fine-grained extractor-runs cache breadcrumbs.
     * Returns `Map<nodePath, Map<qualifiedExtractorId, bodyHashAtRun>>`.
     */
    loadExtractorRuns(): Promise<Map<string, Map<string, string>>>;
    /** Universal enrichment layer — every persisted `(node, extractor)` pair. */
    loadNodeEnrichments(): Promise<IPersistedEnrichment[]>;
    /**
     * Row counts for `scan_nodes` / `scan_links` / `scan_issues`.
     * Used by `sm scan`'s "refusing to wipe a populated DB" guard.
     */
    countRows(): Promise<INodeCounts>;
    /** Row-level filter for `sm list`. Open `kind` (matches `Node.kind`). */
    findNodes(filter: INodeFilter): Promise<Node[]>;
    /**
     * Bundled fetch for `sm show <path>`. Returns `null` if the node
     * is not in the persisted scan.
     */
    findNode(path: string): Promise<INodeBundle | null>;
  };

  // --- issues namespace --------------------------------------------------
  issues: {
    /** Every issue from the latest scan, in insertion order. */
    listAll(): Promise<Issue[]>;
    /**
     * Issue rows whose runtime `Issue` shape passes `predicate`.
     * `port.issues.findActive((i) => i.ruleId === 'orphan')` is the
     * canonical use; `sm orphans` consumes this. The returned shape
     * carries the DB-assigned `id` so a follow-up
     * `transaction(tx => tx.issues.deleteById(row.id))` can target
     * a specific row.
     */
    findActive(predicate: (issue: Issue) => boolean): Promise<IIssueRow[]>;
  };

  // The `enrichments` namespace is intentionally transactional-only
  // at Phase A. The mutation surface (`upsertMany`) is exposed inside
  // `transaction(fn)` only — `sm refresh`'s upsert path is the
  // canonical caller and it always wraps in a tx. A non-transactional
  // read shape lands when a non-refresh consumer surfaces; the
  // contract starts minimal on purpose.

  // --- pluginConfig namespace -------------------------------------------
  pluginConfig: {
    /**
     * Upsert the per-plugin enabled override into `config_plugins`.
     * Caller is `sm plugins enable / disable`.
     */
    set(pluginId: string, enabled: boolean): Promise<void>;
    /** Read a single override; `undefined` when no row exists. */
    get(pluginId: string): Promise<boolean | undefined>;
    /** Every override row, sorted by `pluginId` for stable rendering. */
    list(): Promise<IPluginConfigRow[]>;
    /** Drop a single override row (no-op when absent). */
    delete(pluginId: string): Promise<void>;
    /**
     * Load every override into a map for quick lookup by id. Used by
     * `loadPluginRuntime` to layer the DB overrides over the
     * `settings.json` defaults at scan boot.
     */
    loadOverrideMap(): Promise<Map<string, boolean>>;
  };

  // --- jobs namespace ----------------------------------------------------
  jobs: {
    /**
     * Delete `state_jobs` rows in terminal `status` whose `finishedAt`
     * is older than `cutoffMs` (Unix ms). Returns the deleted count
     * plus every non-null `filePath` from the deleted rows so the
     * caller can unlink the on-disk MD files. Caller computes
     * `cutoffMs` from the configured retention.
     */
    pruneTerminal(
      status: 'completed' | 'failed',
      cutoffMs: number,
    ): Promise<IPruneResult>;
    /**
     * Same SELECT side as `pruneTerminal` but without the DELETE.
     * Powers `sm job prune --dry-run` previews so the dry-run output
     * names exactly the rows the live mode would delete.
     */
    listTerminalCandidates(
      status: 'completed' | 'failed',
      cutoffMs: number,
    ): Promise<IPruneResult>;
    /**
     * Read every `state_jobs.filePath` currently set, normalized through
     * `path.resolve()`. The CLI's `sm job prune --orphan-files` flow
     * pairs this set with `kernel/jobs/orphan-files.ts:findOrphanJobFiles`
     * (which walks the directory) to compute the MD files on disk that
     * no row references — keeps the storage layer FS-free.
     */
    listReferencedFilePaths(): Promise<Set<string>>;
  };

  // --- history namespace -------------------------------------------------
  history: {
    /** List `state_executions` rows (paginated by filter). */
    list(filter: IListExecutionsFilter): Promise<ExecutionRecord[]>;
    /**
     * Aggregate counters / period buckets / top-nodes / error rates
     * over `state_executions`. Body matches the spec
     * `history-stats.schema.json` shape minus `range`/`elapsedMs`
     * (the verb fills those in around the call).
     */
    aggregateStats(
      range: IHistoryStatsRange,
      period: THistoryStatsPeriod,
      topN: number,
    ): Promise<
      Omit<HistoryStats, 'elapsedMs' | 'range'> & {
        rangeMs: { sinceMs: number | null; untilMs: number };
      }
    >;
  };

  // --- migrations namespace (sm db verb) --------------------------------
  migrations: {
    /** Enumerate kernel migration files bundled with this build. */
    discover(): IMigrationFile[];
    /**
     * Compute the apply / pending plan against the current `config_
     * schema_versions` ledger. Read-only; safe under `--dry-run`.
     */
    plan(files?: IMigrationFile[]): IMigrationPlan;
    /**
     * Apply pending migrations in order. Each runs inside its own
     * `BEGIN/COMMIT` (per `kernel/adapters/sqlite/migrations.ts`); a
     * partial failure rolls back to the prior state. Returns the
     * applied list + backup path (when `backup: true`).
     */
    apply(options?: IApplyOptions, files?: IMigrationFile[]): IApplyResult;
    /** WAL-checkpoint + file copy of the DB to `backups/`; returns the path. */
    writeBackup(targetVersion: number): string | null;
    /**
     * Read `PRAGMA user_version` from the underlying DB. The migrations
     * runner keeps that pragma in sync with the latest applied kernel
     * migration, so this is the canonical "current schema version"
     * read for `sm version --json`'s `dbSchema` field. Returns `null`
     * on engine quirks (non-numeric / null pragma).
     */
    currentSchemaVersion(): number | null;
  };

  // --- pluginMigrations namespace (sm db verb, per-plugin) --------------
  pluginMigrations: {
    /** Path to the plugin's `migrations/` directory, or `null` when absent. */
    resolveDir(plugin: IDiscoveredPlugin): string | null;
    /** Discover the plugin's migration files. */
    discover(plugin: IDiscoveredPlugin): IPluginMigrationFile[];
    /**
     * Plan against `config_schema_versions` for the plugin's
     * `(scope='plugin', ownerId=plugin.id)`.
     */
    plan(
      plugin: IDiscoveredPlugin,
      files?: IPluginMigrationFile[],
    ): IPluginMigrationPlan;
    /** Apply pending plugin migrations. Same per-file BEGIN/COMMIT pattern. */
    apply(
      plugin: IDiscoveredPlugin,
      options?: IPluginApplyOptions,
      files?: IPluginMigrationFile[],
    ): IPluginApplyResult;
  };

  // --- transactions ------------------------------------------------------
  /**
   * Open a transaction. The callback receives a transactional subset
   * of the port; the adapter commits on resolution and rolls back on
   * rejection. `sm orphans reconcile / undo-rename` and `sm refresh`
   * are the canonical consumers.
   */
  transaction<T>(fn: (tx: ITransactionalStorage) => Promise<T>): Promise<T>;
}

export type {
  IApplyOptions,
  IApplyResult,
  IHistoryStatsRange,
  IIssueRow,
  IListExecutionsFilter,
  IMigrateNodeFksReport,
  IMigrationFile,
  IMigrationPlan,
  IMigrationRecord,
  INodeBundle,
  INodeCounts,
  INodeFilter,
  IPersistOptions,
  IPluginApplyOptions,
  IPluginApplyResult,
  IPluginConfigRow,
  IPluginMigrationFile,
  IPluginMigrationPlan,
  IPluginMigrationRecord,
  IPruneResult,
  THistoryStatsPeriod,
} from '../types/storage.js';
