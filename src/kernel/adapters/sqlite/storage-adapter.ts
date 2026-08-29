/**
 * `SqliteStorageAdapter`, default `StoragePort` implementation. Opens a
 * `node:sqlite` database behind the bespoke Kysely dialect, configures
 * the mandatory PRAGMAs (busy_timeout, WAL, foreign keys), runs pending kernel
 * migrations, and exposes the namespaced port surface plus the typed
 * Kysely instance.
 *
 * **Storage-port-promotion (Phase A).** The adapter exposes the
 * non-transactional namespaces (`scans`, `issues`, `history`, `jobs`,
 * `migrations`) as direct properties. The
 * `enrichments` MUTATION surfaces are transactional-only by design, they
 * live exclusively on the `ITransactionalStorage` subset returned by
 * `port.transaction(...)` (`upsertMany` shares the refresh persist
 * transaction; `upsertState` commits atomically with its
 * `state_executions` sibling), so writers are forced to share a
 * transaction. The top-level `enrichments` namespace is the read-only
 * `state_enrichments` projection. Adapters fail to compile when their
 * share is incomplete on their end.
 *
 * **camelCase ↔ snake_case bridging.** This adapter installs Kysely's
 * `CamelCasePlugin`, so the typed schema (`schema.ts`) speaks
 * camelCase (`linksOutCount`, `bodyHash`) while the on-disk SQL is
 * snake_case (`links_out_count`, `body_hash`). The plugin rewrites
 * identifiers automatically for every fluent query,
 * `db.selectFrom('scan_nodes').where('linksOutCount', '>', 0)`
 * resolves to `WHERE links_out_count > 0` at execution time.
 *
 * **Trap to avoid:** `sql.raw` / `sql\`...\`` template literals are NOT
 * processed by the plugin. If a future caller writes
 * `sql\`SELECT linksOutCount FROM scan_nodes\``, the query will fail
 * at runtime against a snake_case-only database. Always use
 * snake_case inside raw SQL fragments (matching the migrations in
 * `src/migrations/`), or stick to the typed fluent API.
 */

import { mkdirSync } from 'node:fs';

import { chmodOwnerOnlyBestEffort } from '../../util/atomic-write.js';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { CamelCasePlugin, Kysely, sql } from 'kysely';
import type { Transaction } from 'kysely';

import type {
  IEnrichmentRecord,
  IExtractorRunRecord,
} from '../../orchestrator.js';
import type {
  ITransactionalStorage,
  StoragePort,
} from '../../ports/storage.js';
import type {
  IIssueListFilter,
  IIssueListResult,
  IIssueRow,
  INodeBundle,
  INodeCounts,
  INodeFilter,
  IPersistOptions,
  IPruneResult,
} from '../../types/storage.js';
import type { Issue, Node, ScanResult } from '../../types.js';
import {
  deleteActivityForNode,
  loadActivityCheckpoint,
  upsertActivityPairRows,
  upsertActivityStatsRows,
} from './activity-stats.js';
import { STORAGE_TEXTS } from '../../i18n/storage.texts.js';
import { tx } from '../../util/tx.js';
import { NodeSqliteDialect } from './dialect.js';
import {
  aggregateHistoryStats,
  deleteExecutionsForNode,
  insertExecution,
  listExecutions,
  listNodesWithRuns,
  migrateNodeFks,
} from './history.js';
import type {
  IHistoryStatsRange,
  IListExecutionsFilter,
  THistoryStatsPeriod,
} from './history.js';
import {
  cancelAllActive,
  cancelJob,
  claimNext,
  countJobsByStatus,
  failAllActive,
  failJob,
  findActiveDuplicate,
  getJob,
  getJobContent,
  jobsIntegrityCounts,
  listJobs,
  pruneTerminalJobs,
  reapExpired,
  recordJobTerminal,
  submitFixerJob,
  submitJob,
} from './jobs.js';
import {
  applyMigrations,
  discoverMigrations,
  planMigrations,
  runQuickCheck,
  writeBackup,
} from './migrations.js';
import {
  loadBranch,
  loadEffectiveMaxRenderNodes,
  loadExtractorRuns,
  loadIssueCountsByPath,
  loadDistinctNodeProviders,
  loadLiteNodes,
  loadNodeEnrichments,
  loadScanMeta,
  loadScanResult,
  rowToIssue,
  rowToLink,
  rowToNode,
} from './scan-load.js';
import { persistScanResult, updateNodeAnnotations } from './scan-persistence.js';
import { matchesAnalyzerFilter } from '../../util/analyzer-filter.js';
import {
  listStaleStateEnrichments,
  listStateEnrichmentsForNode,
  upsertStateEnrichment,
} from './enrichments.js';
import { deleteSummaries, listSummariesForNode } from './summaries.js';
import {
  countAllFindings,
  countUnresolvedFindingsByPath,
  countStaleFindings,
  deleteAllFindings,
  deleteFindingById,
  deleteStaleFindings,
  getFindingById,
  listFindings,
  resolveFindingByHuman,
  dismissFindingByHuman,
  reopenFinding,
  suppressionsByPath,
} from './findings.js';
import {
  listAllContributionErrors,
  loadContributionsForNode,
  loadContributionsForPaths,
  loadContributionLookup,
  purgeContributionsByPlugin,
} from './contributions.js';
import {
  findNodesByTag,
  loadTagsForNode,
  loadTagsForPaths,
} from './tags.js';
import {
  deletePluginKv,
  getPluginKv,
  listPluginKvs,
  purgePluginKvs,
  setPluginKv,
} from './plugin-kvs.js';
import {
  loadUpdateCheckCache,
  saveUpdateCheckCache,
} from '../../storage/update-check.js';
import type { IDatabase } from './schema.js';

export interface ISqliteStorageAdapterOptions {
  /**
   * Absolute or relative path to the DB file. Parent directory is created
   * if missing. `:memory:` is supported for tests (no directory created).
   */
  databasePath: string;

  /**
   * When true (default), pending kernel migrations are applied on `init()`.
   * Set false to open the DB without touching schema, used by
   * `sm db migrate --dry-run` and by a future `autoMigrate: false` config.
   */
  autoMigrate?: boolean;

  /**
   * When true (default), auto-migration writes a pre-migration backup.
   * Set false to skip, used by `sm db migrate --no-backup`.
   */
  autoBackup?: boolean;
}

/**
 * Whitelist of `INodeFilter.sortBy` columns. The port rejects unknown
 * values with an error so a typo does not silently sort by `path`. The
 * CLI also validates upstream (`sm list --sort-by`); this is the
 * defensive second gate.
 */
/**
 * Apply the mandatory connection PRAGMAs, in order. `busy_timeout` FIRST so
 * even the WAL journal-mode switch waits for a held write lock instead of
 * failing with SQLITE_BUSY; then WAL (skipped for `:memory:`, unsupported),
 * foreign-key enforcement, and NORMAL synchronous. Exported so a test can
 * assert the values on a raw connection: PRAGMA reads do NOT round-trip
 * through the Kysely dialect (it runs them via `exec`, which yields no rows).
 */
export function configureConnectionPragmas(
  db: { exec(sql: string): void },
  opts: { wal: boolean },
): void {
  // Wait (up to 5s) for a held write lock instead of failing immediately with
  // "database is locked". Covers legitimate concurrent access: a second
  // `sm serve`, a `sm scan` while the watcher is live, or an editor-triggered
  // rescan. Contending transactions are short, so the real wait is
  // milliseconds; the ceiling only bounds pathological stalls.
  db.exec('PRAGMA busy_timeout = 5000');
  // WAL journaling: concurrent readers + a single writer. Matches
  // spec/db-schema.md and survives hard crashes better than the rollback
  // journal. `:memory:` doesn't support WAL, skip it.
  if (opts.wal) db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = NORMAL');
}

const SORT_BY_COLUMNS: ReadonlySet<string> = new Set([
  'path',
  'kind',
  'tokens_total',
  'tokensTotal',
  'links_out_count',
  'linksOutCount',
  'links_in_count',
  'linksInCount',
  'external_refs_count',
  'externalRefsCount',
]);

const SORT_BY_DEFAULT_DIRECTION: Record<string, 'asc' | 'desc'> = {
  path: 'asc',
  kind: 'asc',
  tokensTotal: 'desc',
  linksOutCount: 'desc',
  linksInCount: 'desc',
  externalRefsCount: 'desc',
};

export class SqliteStorageAdapter implements StoragePort {
  #db: Kysely<IDatabase> | null = null;
  readonly #options: ISqliteStorageAdapterOptions;

  // The namespace objects below are lazily-initialised property bags
  // bound to `this` so `port.scans.persist(...)` works without the
  // caller having to chain through a method. They are constructed in
  // `init()` because they need the `Kysely<IDatabase>` instance.
  scans!: StoragePort['scans'];
  contributions!: StoragePort['contributions'];
  tags!: StoragePort['tags'];
  issues!: StoragePort['issues'];
  enrichments!: StoragePort['enrichments'];
  history!: StoragePort['history'];
  jobs!: StoragePort['jobs'];
  summaries!: StoragePort['summaries'];
  findings!: StoragePort['findings'];
  favorites!: StoragePort['favorites'];
  activity!: StoragePort['activity'];
  pluginKvs!: StoragePort['pluginKvs'];
  preferences!: StoragePort['preferences'];
  migrations!: StoragePort['migrations'];

  constructor(options: ISqliteStorageAdapterOptions) {
    this.#options = options;
  }

  async init(): Promise<void> {
    if (this.#db) return;

    const path = this.#options.databasePath;
    if (path !== ':memory:') {
      const absolute = resolve(path);
      mkdirSync(dirname(absolute), { recursive: true });
    }

    if (this.#options.autoMigrate !== false) {
      // Run migrations on a short-lived raw connection so we don't have to
      // coordinate with Kysely's single-connection lifecycle. The file-level
      // DB is the same either way.
      const files = discoverMigrations();
      if (files.length > 0) {
        const raw = new DatabaseSync(path);
        try {
          // Wait for a held write lock instead of failing immediately
          // (another process may hold the DB); see the connection PRAGMAs below.
          raw.exec('PRAGMA busy_timeout = 5000');
          raw.exec('PRAGMA foreign_keys = ON');
          applyMigrations(
            raw,
            path,
            { backup: this.#options.autoBackup !== false },
            files,
          );
        } finally {
          raw.close();
        }
      }
    }

    this.#db = new Kysely<IDatabase>({
      dialect: new NodeSqliteDialect({
        databasePath: path,
        onCreateConnection: (db) => {
          configureConnectionPragmas(db, { wal: path !== ':memory:' });
        },
      }),
      plugins: [new CamelCasePlugin()],
    });

    // The DB carries scanned content (bodies ride the rendered job
    // contents), so it gets the same owner-only treatment as the
    // settings files and `.sm` sidecars. `DatabaseSync` creates the file
    // with `0o666 & ~umask`, i.e. world-readable under the common 022.
    if (path !== ':memory:') chmodOwnerOnlyBestEffort(resolve(path));

    this.#bindNamespaces();
  }

  async close(): Promise<void> {
    if (!this.#db) return;
    await this.#db.destroy();
    this.#db = null;
  }

  /**
   * Access the underlying Kysely instance.
   *
   * Test-only escape hatch (per context/kernel.md §Kernel boundaries, tests
   * are the documented exception). CLI commands MUST consume the
   * adapter through the namespaced port surfaces (`port.<namespace>.*`
   * or `port.transaction(...)`); reaching for this getter from a
   * command file is a layering violation.
   */
  get db(): Kysely<IDatabase> {
    if (!this.#db) throw new Error('SqliteStorageAdapter: init() not called');
    return this.#db;
  }

  async transaction<T>(fn: (tx: ITransactionalStorage) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => fn(buildTxSubset(trx)));
  }

  // --- internal: bind namespace property bags ----------------------------

  #bindNamespaces(): void {
    this.scans = {
      persist: (result, opts) => persistScansThroughNonTx(this.db, result, opts),
      load: () => loadScanResult(this.db),
      loadMeta: async () => loadScanMeta(this.db, await countRows(this.db)),
      loadExtractorRuns: () => loadExtractorRuns(this.db),
      loadNodeEnrichments: () => loadNodeEnrichments(this.db),
      countRows: () => countRows(this.db),
      findNodes: (filter) => findNodes(this.db, filter),
      findNode: (path) => findNode(this.db, path),
      listLiteNodes: () => loadLiteNodes(this.db),
      distinctNodeProviders: () => loadDistinctNodeProviders(this.db),
      issueCountsByPath: () => loadIssueCountsByPath(this.db),
      effectiveMaxRenderNodes: () => loadEffectiveMaxRenderNodes(this.db),
      loadBranch: (scope, limit) => loadBranch(this.db, scope, limit),
      refreshAnnotations: (path, annotations) =>
        updateNodeAnnotations(this.db, path, annotations),
    };

    this.contributions = {
      listForNode: (nodePath) => loadContributionsForNode(this.db, nodePath),
      listForPaths: (paths) => loadContributionsForPaths(this.db, paths),
      lookup: (pluginId, contributionId, nodePath, extensionId) =>
        loadContributionLookup(this.db, pluginId, contributionId, nodePath, extensionId),
      purgeByPlugin: (pluginId, extensionId) =>
        purgeContributionsByPlugin(this.db, pluginId, extensionId),
      listAllErrors: () => listAllContributionErrors(this.db),
    };

    this.tags = {
      listForNode: (nodePath) => loadTagsForNode(this.db, nodePath),
      listForPaths: (paths) => loadTagsForPaths(this.db, paths),
      findNodes: (tag) => findNodesByTag(this.db, tag),
    };

    this.issues = {
      listAll: () => listAllIssues(this.db),
      list: (filter) => listIssues(this.db, filter),
      findActive: (predicate) => findActiveIssues(this.db, predicate),
      deleteForSuppression: (nodePath, analyzer, value) =>
        deleteIssuesForSuppression(this.db, nodePath, analyzer, value),
    };

    this.enrichments = {
      listStateForNode: (nodeId) => listStateEnrichmentsForNode(this.db, nodeId),
      listStaleStateCandidates: (nowMs) => listStaleStateEnrichments(this.db, nowMs),
    };

    this.history = {
      list: (filter: IListExecutionsFilter) => listExecutions(this.db, filter),
      nodesWithRuns: () => listNodesWithRuns(this.db),
      insertExecution: (record) => insertExecution(this.db, record),
      deleteForNode: (nodePath) => deleteExecutionsForNode(this.db, nodePath),
      aggregateStats: (
        range: IHistoryStatsRange,
        period: THistoryStatsPeriod,
        topN: number,
      ) => aggregateHistoryStats(this.db, range, period, topN),
    };

    this.jobs = {
      submit: (row, content) => submitJob(this.db, row, content),
      submitFixer: (row, content) => submitFixerJob(this.db, row, content),
      findActiveDuplicate: (extensionId, extensionVersion, nodeId, contentHash) =>
        findActiveDuplicate(this.db, extensionId, extensionVersion, nodeId, contentHash),
      list: (filter) => listJobs(this.db, filter),
      get: (id) => getJob(this.db, id),
      getContent: (contentHash) => getJobContent(this.db, contentHash),
      claim: (runner, nowMs, filter) => claimNext(this.db, runner, nowMs, filter),
      cancel: (id, nowMs) => cancelJob(this.db, id, nowMs),
      cancelAllActive: (nowMs) => cancelAllActive(this.db, nowMs),
      fail: (id, nowMs) => failJob(this.db, id, nowMs),
      failAllActive: (nowMs) => failAllActive(this.db, nowMs),
      countByStatus: () => countJobsByStatus(this.db),
      integrityCounts: () => jobsIntegrityCounts(this.db),
      reapExpired: (nowMs) => reapExpired(this.db, nowMs),
      pruneTerminal: (status, cutoffMs) =>
        pruneTerminalJobs(this.db, status, cutoffMs),
      listTerminalCandidates: (status, cutoffMs) =>
        listTerminalCandidates(this.db, status, cutoffMs),
      recordTerminal: (execution, summary, findings, resolutions) =>
        recordJobTerminal(this.db, execution, summary, findings, resolutions),
    };

    this.summaries = {
      forNode: (nodeId) => listSummariesForNode(this.db, nodeId),
      remove: (nodeId, summarizerActionId) => deleteSummaries(this.db, nodeId, summarizerActionId),
    };

    this.findings = {
      list: (filter) => listFindings(this.db, filter),
      countUnresolvedByPath: (paths) => countUnresolvedFindingsByPath(this.db, paths),
      countStale: () => countStaleFindings(this.db),
      pruneStale: () => deleteStaleFindings(this.db),
      resolveByHuman: (id, note, nowMs) => resolveFindingByHuman(this.db, id, note, nowMs),
      dismissByHuman: (id, note, nowMs) => dismissFindingByHuman(this.db, id, note, nowMs),
      reopen: (id, nowMs) => reopenFinding(this.db, id, nowMs),
      get: (id) => getFindingById(this.db, id),
      suppressionsByPath: (paths) => suppressionsByPath(this.db, paths),
      countClearable: (nodeId) => countAllFindings(this.db, nodeId),
      clear: (nodeId) => deleteAllFindings(this.db, nodeId),
      removeById: (id) => deleteFindingById(this.db, id),
    };

    this.favorites = {
      set: (path) => setFavorite(this.db, path),
      unset: (path) => unsetFavorite(this.db, path),
      listPaths: () => listFavoritePaths(this.db),
    };

    this.activity = {
      loadAll: () => loadActivityCheckpoint(this.db),
      upsertNodes: (rows) => upsertActivityStatsRows(this.db, rows),
      upsertPairs: (rows) => upsertActivityPairRows(this.db, rows),
      deleteNode: (nodePath) => deleteActivityForNode(this.db, nodePath),
    };

    this.pluginKvs = {
      get: (scope) => getPluginKv(this.db, scope),
      set: (row) => setPluginKv(this.db, row),
      delete: (scope) => deletePluginKv(this.db, scope),
      list: (query) => listPluginKvs(this.db, query),
      purgeByPlugin: (pluginId) => purgePluginKvs(this.db, pluginId),
    };

    this.preferences = {
      loadUpdateCheckCache: () => loadUpdateCheckCache(this.db),
      saveUpdateCheckCache: (cache) => saveUpdateCheckCache(this.db, cache),
    };

;

    const path = this.#options.databasePath;

    this.migrations = {
      discover: () => discoverMigrations(),
      plan: (files) => withRawDb(path, (raw) => planMigrations(raw, files)),
      apply: (options, files) =>
        withRawDb(path, (raw) => {
          raw.exec('PRAGMA foreign_keys = ON');
          return applyMigrations(raw, path, options, files);
        }),
      writeBackup: (destPath) => writeBackup(path, destPath),
      currentSchemaVersion: () =>
        withRawDb(path, (raw) => {
          const row = raw.prepare('PRAGMA user_version').get() as
            | { user_version?: number }
            | undefined;
          const v = row?.user_version;
          return typeof v === 'number' && Number.isFinite(v) ? v : null;
        }),
      quickCheck: () => withRawDb(path, (raw) => runQuickCheck(raw)),
    };
  }
}

/**
 * Non-transactional `scans.persist`, opens its own transaction
 * underneath because `persistScanResult` already handles the
 * orchestration. The transactional variant lives inside
 * `buildTxSubset`.
 */
async function persistScansThroughNonTx(
  db: Kysely<IDatabase>,
  result: ScanResult,
  opts?: IPersistOptions,
): Promise<void> {
  const defaults = applyPersistDefaults(opts);
  await persistScanResult(db, result, defaults);
}

/**
 * Resolve every optional side-bag on `IPersistOptions` to its empty
 * default. Shared by the non-tx persist and the tx-subset persist so
 * the defaults live in one place, both call sites used to trip the
 * complexity cap with the inline `?? []` / `?? new Set()` shape.
 *
 * Implementation note: object-spread merge instead of per-field `??`
 * keeps the cyclomatic count at 1. Each call constructs fresh
 * `[]` / `new Set()` instances so a consumer that mutates the
 * accumulator can't leak state into a later persist.
 */
function applyPersistDefaults(opts?: IPersistOptions): {
  renameOps: NonNullable<IPersistOptions['renameOps']>;
  extractorRuns: NonNullable<IPersistOptions['extractorRuns']>;
  enrichments: NonNullable<IPersistOptions['enrichments']>;
  contributions: NonNullable<IPersistOptions['contributions']>;
  registeredContributionKeys: NonNullable<IPersistOptions['registeredContributionKeys']>;
  freshlyRunTuples: NonNullable<IPersistOptions['freshlyRunTuples']>;
  contributionErrors: NonNullable<IPersistOptions['contributionErrors']>;
  linkScores: NonNullable<IPersistOptions['linkScores']>;
} {
  return {
    renameOps: [],
    extractorRuns: [],
    enrichments: [],
    contributions: [],
    registeredContributionKeys: new Set(),
    freshlyRunTuples: new Set(),
    contributionErrors: [],
    linkScores: [],
    ...opts,
  };
}

async function countRows(db: Kysely<IDatabase>): Promise<INodeCounts> {
  const [nodes, links, issues] = await Promise.all([
    db
      .selectFrom('scan_nodes')
      .select(({ fn }) => fn.countAll<number>().as('c'))
      .executeTakeFirst(),
    db
      .selectFrom('scan_links')
      .select(({ fn }) => fn.countAll<number>().as('c'))
      .executeTakeFirst(),
    db
      .selectFrom('scan_issues')
      .select(({ fn }) => fn.countAll<number>().as('c'))
      .executeTakeFirst(),
  ]);
  return {
    nodes: Number(nodes?.c ?? 0),
    links: Number(links?.c ?? 0),
    issues: Number(issues?.c ?? 0),
  };
}

/**
 * Validate a filter's `sortBy` + `limit` upstream of the query
 * builder so the main `findNodes` body stays a thin pipeline. Returns
 * the resolved column / direction or throws, the throw is the gate.
 */
function resolveSortAndLimit(filter: INodeFilter): {
  sortBy: string;
  direction: 'asc' | 'desc';
  limit: number | undefined;
} {
  let sortBy = 'path';
  let direction: 'asc' | 'desc' = 'asc';
  if (filter.sortBy !== undefined) {
    if (!SORT_BY_COLUMNS.has(filter.sortBy)) {
      throw new Error(
        tx(STORAGE_TEXTS.findNodesInvalidSortBy, {
          sortBy: filter.sortBy,
          allowed: [...SORT_BY_COLUMNS].join(', '),
        }),
      );
    }
    sortBy = filter.sortBy;
    direction =
      filter.sortDirection ?? SORT_BY_DEFAULT_DIRECTION[filter.sortBy] ?? 'asc';
  }
  let limit: number | undefined;
  if (filter.limit !== undefined) {
    if (!Number.isInteger(filter.limit) || filter.limit <= 0) {
      throw new Error(
        tx(STORAGE_TEXTS.findNodesInvalidLimit, { value: filter.limit }),
      );
    }
    limit = filter.limit;
  }
  return { sortBy, direction, limit };
}

async function findNodes(
  db: Kysely<IDatabase>,
  filter: INodeFilter,
): Promise<Node[]> {
  const { sortBy, direction, limit } = resolveSortAndLimit(filter);

  let query = db.selectFrom('scan_nodes').selectAll();

  if (filter.kind !== undefined) {
    // `kind` is open string post-`open-node-kinds` refactor; the cast
    // through `never` survives because Kysely's typed column accepts
    // any string literal regardless of TS narrowing.
    query = query.where('kind', '=', filter.kind as never);
  }
  if (filter.hasIssues === true) {
    // Subquery: keep only nodes whose path is referenced by any
    // `scan_issues.nodeIds` array. node:sqlite ships JSON1 enabled,
    // so json_each is available everywhere we run.
    query = query.where(({ exists, selectFrom, ref }) =>
      exists(
        selectFrom(
          sql<{ value: string }>`json_each(scan_issues.node_ids_json)`.as('je'),
        )
          .innerJoin('scan_issues', (j) => j.onTrue())
          .select(sql<number>`1`.as('one'))
          .whereRef(sql.ref('je.value'), '=', ref('scan_nodes.path')),
      ),
    );
  }

  query = query.orderBy(sortBy as never, direction);
  if (limit !== undefined) query = query.limit(limit);

  const rows = await query.execute();
  return rows.map(rowToNode);
}

async function findNode(
  db: Kysely<IDatabase>,
  path: string,
): Promise<INodeBundle | null> {
  const nodeRow = await db
    .selectFrom('scan_nodes')
    .selectAll()
    .where('path', '=', path)
    .executeTakeFirst();
  if (!nodeRow) return null;

  // Outgoing / incoming / issues fan-out in parallel. Same shape as the
  // current `sm show` handler. Incoming matches on EITHER `target_path`
  // (path-style emit) OR `resolved_target` (trigger-style emit the
  // post-walk lift resolved by name), so an `@real-agent` mention from
  // a sibling agent surfaces alongside the `[link](./real-agent.md)`
  // markdown reference both pointing at this node.
  const [outRows, inRows, issueRows] = await Promise.all([
    db.selectFrom('scan_links').selectAll().where('sourcePath', '=', path).execute(),
    db
      .selectFrom('scan_links')
      .selectAll()
      .where((eb) =>
        eb.or([eb('targetPath', '=', path), eb('resolvedTarget', '=', path)]),
      )
      .execute(),
    db.selectFrom('scan_issues').selectAll().execute(),
  ]);

  return {
    node: rowToNode(nodeRow),
    linksOut: outRows.map(rowToLink),
    linksIn: inRows.map(rowToLink),
    issues: issueRows.map(rowToIssue).filter((i) => i.nodeIds.includes(path)),
  };
}

async function listAllIssues(db: Kysely<IDatabase>): Promise<Issue[]> {
  const rows = await db.selectFrom('scan_issues').selectAll().execute();
  return rows.map(rowToIssue);
}

/**
 * Paginated, filtered read of `scan_issues`. Audit L6: the BFF route
 * `/api/issues` used to call `listAll()` and apply every filter in JS,
 * which loads the entire table into memory per request. This pushes
 * the three filters (severity, analyzerId, node) and pagination into
 * SQL so the route is O(page size + matching count), not O(table).
 *
 * Filter translation:
 *
 *   - `severities`, `WHERE severity IN (?, ?, ...)` via Kysely's
 *     parameterised `'in'` operator (never string-interpolated, every
 *     value is bound).
 *   - `analyzerIds`, each entry becomes `analyzerId = ? OR analyzerId
 *     LIKE '%/' || ?` (mirrors `matchesAnalyzerFilter`'s suffix-match
 *     semantics: a short id like `schema-violation` matches the qualified
 *     `core/schema-violation` because the suffix after `/` is identical).
 *     The per-entry pair is ORed across the entry list with an outer
 *     `OR`.
 *   - `nodePath`, correlated `EXISTS (SELECT 1 FROM
 *     json_each(scan_issues.node_ids_json) WHERE value = ?)`. Same
 *     JSON1 idiom as `state_executions.node_ids_json` in
 *     `history.ts:listExecutions`.
 *
 * Two queries fire: a `count(*)` for `total` (full filter match) and a
 * `selectAll()` with `offset` / `limit` for the page slice. Order is
 * `id` ASC so paging is stable across requests (insertion order).
 */
async function listIssues(
  db: Kysely<IDatabase>,
  filter: IIssueListFilter,
): Promise<IIssueListResult> {
  const baseQuery = applyIssueFilters(
    db.selectFrom('scan_issues'),
    filter,
  );

  // Total = full match count, BEFORE pagination. The SPA wires this
  // into its page-count UI; the audit fix requires that the page slice
  // and the total stay coherent across `analyzerId` filters (the prior
  // route loaded the full table, then JS-filtered, so the total
  // matched the filter exactly. Pushing filters into SQL preserves
  // that contract).
  const countRow = await baseQuery
    .select(({ fn }) => fn.countAll<number>().as('c'))
    .executeTakeFirst();
  const total = Number(countRow?.c ?? 0);

  const rows = await applyIssueFilters(
    db.selectFrom('scan_issues'),
    filter,
  )
    .selectAll()
    .orderBy('id', 'asc')
    .offset(filter.offset)
    .limit(filter.limit)
    .execute();

  return { items: rows.map(rowToIssue), total };
}

/**
 * Compose the optional `WHERE` clauses shared by the count query and
 * the page-slice query in `listIssues`. Kept as a free function so
 * both queries stay byte-for-byte identical in their filter shape, a
 * drift here would surface as `total` disagreeing with the page slice
 * for the same request.
 */
function applyIssueFilters<Q extends import('kysely').SelectQueryBuilder<IDatabase, 'scan_issues', object>>(
  query: Q,
  filter: IIssueListFilter,
): Q {
  let q = query;
  if (filter.severities && filter.severities.length > 0) {
    // Kysely's parameterised `'in'` operator emits `?, ?, ...` bindings.
    // Cast through `never[]` because the column's typed union
    // (`Severity = 'error' | 'warn' | 'info'`) is narrower than the
    // open `string[]` shape the port accepts (the port deliberately
    // accepts unknown tokens so a hostile URL query yields a
    // zero-match SQL, not a kernel validation error). The runtime
    // behaviour is identical: SQLite binds the strings as-is and
    // returns zero rows for unrecognised severities.
    q = q.where('severity', 'in', [...filter.severities] as never[]) as Q;
  }
  if (filter.analyzerIds && filter.analyzerIds.length > 0) {
    const tokens = filter.analyzerIds;
    q = q.where(({ eb, or }) =>
      or(
        tokens.flatMap((token) => {
          const conds = [
            eb('analyzerId', '=', token),
            // `'%/' || ?` keeps the LIKE pattern's `%` literal in the
            // template and binds `token` separately, no interpolation of
            // user input into the SQL string.
            eb('analyzerId', 'like', `%/${token}`),
          ];
          // The persisted analyzerId is SHORT (issue.schema.json forbids
          // `/`). A qualified token (`core/foo`) must still match the
          // stored short id (`foo`), so also compare the token's
          // suffix-after-`/`. Mirrors `matchesAnalyzerFilter` (the CLI /
          // shared-util path) so REST and CLI honor qualified ids alike.
          const slash = token.indexOf('/');
          if (slash >= 0) conds.push(eb('analyzerId', '=', token.slice(slash + 1)));
          return conds;
        }),
      ),
    ) as Q;
  }
  if (filter.nodePath !== undefined && filter.nodePath !== null) {
    const target = filter.nodePath;
    q = q.where(({ exists, selectFrom }) =>
      exists(
        selectFrom(
          sql<{ value: string }>`json_each(scan_issues.node_ids_json)`.as('je'),
        )
          .select(sql<number>`1`.as('one'))
          .where(sql.ref('je.value'), '=', target),
      ),
    ) as Q;
  }
  if (filter.nodePaths !== undefined) {
    q = applyNodePathsFilter(q, filter.nodePaths);
  }
  return q;
}

/**
 * Multi-node intersection branch for `applyIssueFilters`. Extracted so
 * the parent stays under the per-function complexity budget; the
 * empty-array branch (contradictory predicate to match zero rows)
 * lives here next to the populated `EXISTS ... IN (...)` shape it
 * mirrors.
 */
function applyNodePathsFilter<Q extends import('kysely').SelectQueryBuilder<IDatabase, 'scan_issues', object>>(
  query: Q,
  nodePaths: readonly string[],
): Q {
  if (nodePaths.length === 0) {
    // Explicit empty array means "match nothing", a caller asking for
    // the intersection of an empty set ALWAYS yields zero rows. Bind
    // a contradictory predicate so the page slice + total agree.
    return query.where(sql<number>`0`, '=', 1) as Q;
  }
  const targets = [...nodePaths];
  return query.where(({ exists, selectFrom }) =>
    exists(
      selectFrom(
        sql<{ value: string }>`json_each(scan_issues.node_ids_json)`.as('je'),
      )
        .select(sql<number>`1`.as('one'))
        .where(sql.ref('je.value'), 'in', targets as never[]),
    ),
  ) as Q;
}

async function findActiveIssues(
  db: Kysely<IDatabase>,
  predicate: (issue: Issue) => boolean,
): Promise<IIssueRow[]> {
  const rows = await db.selectFrom('scan_issues').selectAll().execute();
  const out: IIssueRow[] = [];
  for (const row of rows) {
    const issue = rowToIssue(row);
    if (predicate(issue)) out.push({ id: row.id, issue });
  }
  return out;
}

/**
 * `port.issues.deleteForSuppression(...)`: drop the rows an operator's
 * fresh issue suppression covers. Same load-then-filter posture as
 * `findActiveIssues` (the table is one scan's worth of rows): the
 * analyzer matches via `matchesAnalyzerFilter` (stored id is SHORT,
 * the entry may be qualified), the value strict against `data.target`,
 * the node by `nodeIds` membership. Returns the deleted count so the
 * dismiss surfaces can report it.
 */
async function deleteIssuesForSuppression(
  db: Kysely<IDatabase>,
  nodePath: string,
  analyzer: string,
  value: string,
): Promise<number> {
  const rows = await db.selectFrom('scan_issues').selectAll().execute();
  const ids: number[] = [];
  for (const row of rows) {
    if (!matchesAnalyzerFilter(row.analyzerId, [analyzer])) continue;
    const issue = rowToIssue(row);
    if (issue.data?.['target'] !== value) continue;
    if (!issue.nodeIds.includes(nodePath)) continue;
    ids.push(row.id);
  }
  if (ids.length === 0) return 0;
  await db.deleteFrom('scan_issues').where('id', 'in', ids).execute();
  return ids.length;
}

function buildTxSubset(trx: Transaction<IDatabase>): ITransactionalStorage {
  return {
    scans: {
      persist: (result, opts) => {
        const d = applyPersistDefaults(opts);
        return persistScanResult(trx, result, d).then(() => undefined);
      },
    },
    issues: {
      deleteById: async (id) => {
        await trx.deleteFrom('scan_issues').where('id', '=', id).execute();
      },
      insert: async (issue) => {
        await trx
          .insertInto('scan_issues')
          .values({
            analyzerId: issue.analyzerId,
            severity: issue.severity,
            nodeIdsJson: JSON.stringify(issue.nodeIds),
            linkIndicesJson:
              issue.linkIndices !== undefined ? JSON.stringify(issue.linkIndices) : null,
            message: issue.message,
            detail: issue.detail ?? null,
            fixJson: issue.fix !== undefined ? JSON.stringify(issue.fix) : null,
            dataJson: issue.data !== undefined ? JSON.stringify(issue.data) : null,
          })
          .execute();
      },
    },
    enrichments: {
      upsertMany: async (records: IEnrichmentRecord[]) => {
        await upsertEnrichments(trx, records);
      },
      upsertState: (row) => upsertStateEnrichment(trx, row),
    },
    history: {
      migrateNodeFks: (from: string, to: string) =>
        migrateNodeFks(trx, from, to),
      insertExecution: (record) => insertExecution(trx, record),
    },
  };
}

/**
 * Upsert every fresh `IEnrichmentRecord` into `node_enrichments`.
 * Composite PK is `(nodePath, extractorId)`; conflict resolution is
 * "replace" so a fresh extractor run overwrites the prior
 * `valueJson` / `bodyHashAtEnrichment` / `enrichedAt` fields. Every
 * row lands with `stale = 0` (the caller just refreshed it).
 */
async function upsertEnrichments(
  trx: Transaction<IDatabase>,
  records: IEnrichmentRecord[],
): Promise<void> {
  for (const r of records) {
    const valueJson = JSON.stringify(r.value ?? {});
    const isProbabilistic = r.isProbabilistic ? 1 : 0;
    await trx
      .insertInto('node_enrichments')
      .values({
        nodePath: r.nodePath,
        extractorId: r.extractorId,
        bodyHashAtEnrichment: r.bodyHashAtEnrichment,
        valueJson,
        stale: 0,
        enrichedAt: r.enrichedAt,
        isProbabilistic,
      })
      .onConflict((oc) =>
        oc.columns(['nodePath', 'extractorId']).doUpdateSet({
          bodyHashAtEnrichment: r.bodyHashAtEnrichment,
          valueJson,
          stale: 0,
          enrichedAt: r.enrichedAt,
          isProbabilistic,
        }),
      )
      .execute();
  }
}

/**
 * Read-only `state_jobs` count mirroring the DELETE side of
 * `pruneTerminalJobs`, `sm jobs prune --dry-run` consumes this so the
 * preview reports exactly how many rows the live mode would delete.
 *
 * `prunedContents` is reported as `0` in the preview: the orphaned
 * `state_job_contents` sweep only becomes computable AFTER the terminal
 * jobs are actually gone, and predicting it across the two independent
 * per-status passes is not worth the SQL complexity for a dry-run.
 * The live path (`pruneTerminalJobs`) returns the real collected count.
 */
async function listTerminalCandidates(
  db: Kysely<IDatabase>,
  status: 'completed' | 'failed' | 'cancelled',
  cutoffMs: number,
): Promise<IPruneResult> {
  const rows = await db
    .selectFrom('state_jobs')
    .select('id')
    .where('status', '=', status)
    .where('finishedAt', 'is not', null)
    .where('finishedAt', '<', cutoffMs)
    .execute();
  return { deletedCount: rows.length, prunedContents: 0 };
}

async function setFavorite(db: Kysely<IDatabase>, path: string): Promise<void> {
  await db
    .insertInto('state_node_favorites')
    .values({ nodePath: path, favoritedAt: Date.now() })
    .onConflict((oc) =>
      oc.column('nodePath').doUpdateSet({ favoritedAt: Date.now() }),
    )
    .execute();
}

async function unsetFavorite(db: Kysely<IDatabase>, path: string): Promise<void> {
  await db.deleteFrom('state_node_favorites').where('nodePath', '=', path).execute();
}

async function listFavoritePaths(db: Kysely<IDatabase>): Promise<Set<string>> {
  const rows = await db.selectFrom('state_node_favorites').select(['nodePath']).execute();
  return new Set(rows.map((r) => r.nodePath));
}

/**
 * Open a raw `node:sqlite` handle for migration runs, invoke `fn`,
 * and close it. Each port-method call gets its own handle (the
 * verb's per-method calls are infrequent, so the open/close
 * overhead is negligible). The synchronous `fn` matches the
 * underlying free functions, which run BEGIN/COMMIT on the raw
 * handle directly per `migrations.ts`.
 */
function withRawDb<T>(path: string, fn: (raw: DatabaseSync) => T): T {
  const raw = new DatabaseSync(path);
  try {
    return fn(raw);
  } finally {
    raw.close();
  }
}

// `IExtractorRunRecord` re-exported for adapter consumers that don't
// want to chain through `kernel/orchestrator`. The port itself returns
// the same type from `loadExtractorRuns` (per the storage namespace).
export type { IExtractorRunRecord };
