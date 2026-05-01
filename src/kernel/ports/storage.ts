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
import type {
  IHistoryStatsRange,
  IListExecutionsFilter,
  IMigrateNodeFksReport,
  THistoryStatsPeriod,
} from '../adapters/sqlite/history.js';
import type {
  IIssueRow,
  INodeBundle,
  INodeCounts,
  INodeFilter,
  IPersistOptions,
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
  IIssueRow,
  INodeBundle,
  INodeCounts,
  INodeFilter,
  IPersistOptions,
} from '../types/storage.js';
