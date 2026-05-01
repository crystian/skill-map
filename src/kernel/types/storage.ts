/**
 * Storage-port domain types — option bags and result shapes the
 * `StoragePort` namespaces consume / return. Live next to the port
 * (`kernel/ports/storage.ts`) so adapters and CLI consumers share a
 * single source of truth without depending on the SQLite adapter's
 * internal types.
 *
 * Naming bucket: category 4 (internal shapes) per `AGENTS.md` § Type
 * naming convention. Every name carries the `I*` prefix.
 */

import type {
  ExecutionStatus,
  Issue,
  Link,
  Node,
} from '../types.js';

/**
 * Row-level filter for `port.scans.findNodes(...)` (driven by
 * `sm list`'s flags). All fields are optional — an empty filter
 * returns every node sorted by `path` asc.
 */
export interface INodeFilter {
  /** Restrict to a single node kind. Open string (matches `Node.kind`). */
  kind?: string;
  /**
   * When `true`, keep only nodes whose path is referenced by at least
   * one `scan_issues.nodeIds` array.
   */
  hasIssues?: boolean;
  /**
   * Sort column. The adapter validates against its own whitelist and
   * rejects anything else with an Error (the CLI's own usage-error
   * exit is the right place to surface a bad `--sort-by`; the port
   * defends in depth).
   */
  sortBy?: string;
  /** `'asc'` or `'desc'`. Defaults to the adapter's per-column convention. */
  sortDirection?: 'asc' | 'desc';
  /** Cap the result. Positive integer; absent → no limit. */
  limit?: number;
}

/**
 * Bundled fetch for `port.scans.findNode(path)` — one node and
 * everything `sm show <path>` displays alongside it. Every field is
 * computed from `scan_*` zone reads only; per-domain data (history,
 * jobs, plugin enrichments) ships through other namespaces.
 */
export interface INodeBundle {
  node: Node;
  linksOut: Link[];
  linksIn: Link[];
  issues: Issue[];
}

/**
 * Output of `port.scans.countRows()`. Used by `sm scan` to decide
 * whether the persist would wipe a populated DB (the "refusing to
 * wipe" guard) and by `sm db status` for the human summary.
 */
export interface INodeCounts {
  nodes: number;
  links: number;
  issues: number;
}

/**
 * Lightweight option bag for `port.scans.persist`. Mirrors the trailing
 * arguments of the legacy `persistScanResult(db, result, renameOps,
 * extractorRuns, enrichments)` free function so the adapter
 * implementation is a one-line delegation today; the named-bag shape
 * tomorrow lets new optional inputs land without breaking callers.
 */
export interface IPersistOptions {
  renameOps?: import('../orchestrator.js').RenameOp[];
  extractorRuns?: import('../orchestrator.js').IExtractorRunRecord[];
  enrichments?: import('../orchestrator.js').IEnrichmentRecord[];
}

/**
 * Issue row as the storage layer sees it — paired with its DB-assigned
 * id so `port.issues.deleteById(id)` can target it inside a
 * transaction. The runtime `Issue` shape (per `issue.schema.json`) does
 * not carry `id` because the spec models issues as ephemeral findings
 * scoped to a scan; the DB does need the synthetic id to update / delete
 * a single row.
 */
export interface IIssueRow {
  id: number;
  issue: Issue;
}

// --- jobs namespace --------------------------------------------------------

/** Output of `port.jobs.pruneTerminal` / `listTerminalCandidates`. */
export interface IPruneResult {
  /** How many `state_jobs` rows were deleted (or would be, in dry-run). */
  deletedCount: number;
  /** Job-file paths from the affected rows; the CLI unlinks these from disk. `null` `filePath` rows contribute nothing here. */
  filePaths: string[];
}

// --- history namespace -----------------------------------------------------

/** Filter shape for `port.history.list`. All fields optional. */
export interface IListExecutionsFilter {
  /** Restrict to executions whose `nodeIds` array contains this path. */
  nodePath?: string;
  /** Exact match on `extension_id`. */
  actionId?: string;
  /** Subset of {`completed`,`failed`,`cancelled`}. */
  statuses?: ExecutionStatus[];
  /** Lower bound (inclusive) on `started_at`. Unix ms. */
  sinceMs?: number;
  /** Upper bound (exclusive) on `started_at`. Unix ms. */
  untilMs?: number;
  /** Cap result count. No default. */
  limit?: number;
}

/** Window shape for `port.history.aggregateStats`. */
export interface IHistoryStatsRange {
  /** Inclusive lower bound. `null` = all-time. */
  sinceMs: number | null;
  /** Exclusive upper bound. */
  untilMs: number;
}

/** Period bucket granularity for `port.history.aggregateStats`. */
export type THistoryStatsPeriod = 'day' | 'week' | 'month';

/**
 * Output of `port.transaction(tx => tx.history.migrateNodeFks(from, to))`.
 * Lists how many rows in each `state_*` table were repointed plus any
 * composite-PK collisions that forced a drop instead of an update.
 */
export interface IMigrateNodeFksReport {
  jobs: number;
  executions: number;
  summaries: number;
  enrichments: number;
  pluginKvs: number;
  /**
   * Composite-PK collisions encountered when migrating
   * `state_summaries` / `state_enrichments` / `state_plugin_kvs` because
   * a row already existed at the destination PK. The pre-existing rows
   * are preserved — the migrating rows are dropped (deleted from
   * `fromPath` without a corresponding INSERT). One entry per dropped
   * row, with the affected PK fields included for diagnostic output.
   */
  collisions: Array<{
    table: 'state_summaries' | 'state_enrichments' | 'state_plugin_kvs';
    fromPath: string;
    toPath: string;
    keys: Record<string, string>;
  }>;
}

// --- pluginConfig namespace -----------------------------------------------

/** A single `config_plugins` override row as the kernel sees it. */
export interface IPluginConfigRow {
  pluginId: string;
  enabled: boolean;
  configJson: string | null;
  updatedAt: number;
}

// --- migrations namespace --------------------------------------------------

/** Discovered kernel migration file (one of `NNN_snake_case.sql`). */
export interface IMigrationFile {
  version: number;
  description: string;
  filePath: string;
}

/** A row from the `config_schema_versions` ledger for the kernel scope. */
export interface IMigrationRecord {
  scope: string;
  ownerId: string;
  version: number;
  description: string;
  appliedAt: number;
}

/** `port.migrations.plan` output: applied vs pending. */
export interface IMigrationPlan {
  applied: IMigrationRecord[];
  pending: IMigrationFile[];
}

/** Apply-time options for `port.migrations.apply`. */
export interface IApplyOptions {
  backup?: boolean;
  dryRun?: boolean;
  to?: number;
}

/** Result of `port.migrations.apply`. */
export interface IApplyResult {
  applied: IMigrationFile[];
  backupPath: string | null;
}

// --- pluginMigrations namespace -------------------------------------------

/** Discovered plugin migration file. Same `NNN_snake_case.sql` convention. */
export interface IPluginMigrationFile {
  version: number;
  description: string;
  filePath: string;
}

/** A row from the `config_schema_versions` ledger for a single plugin. */
export interface IPluginMigrationRecord {
  version: number;
  description: string;
  appliedAt: number;
}

/** `port.pluginMigrations.plan` output for a single plugin. */
export interface IPluginMigrationPlan {
  pluginId: string;
  applied: IPluginMigrationRecord[];
  pending: IPluginMigrationFile[];
}

/** Apply-time options for `port.pluginMigrations.apply`. */
export interface IPluginApplyOptions {
  /** No actual writes; surfaces what would run. Default false. */
  dryRun?: boolean;
}

/** Result of `port.pluginMigrations.apply`. */
export interface IPluginApplyResult {
  pluginId: string;
  applied: IPluginMigrationFile[];
  /** Catalog intrusions caught by Layer 3 (post-apply sweep). Empty when clean. */
  intrusions: string[];
}
