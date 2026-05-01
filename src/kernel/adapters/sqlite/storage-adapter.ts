/**
 * `SqliteStorageAdapter` — default `StoragePort` implementation. Opens a
 * `node:sqlite` database behind the bespoke Kysely dialect, configures
 * the mandatory PRAGMAs (WAL, foreign keys), runs pending kernel
 * migrations, and exposes the namespaced port surface plus the typed
 * Kysely instance.
 *
 * **Storage-port-promotion (Phase A).** The adapter implements the
 * port's `scans` / `issues` / `enrichments` / `transaction`
 * namespaces. The remaining namespaces (history / jobs / pluginConfig
 * / migrations / pluginMigrations) ship as the matching phases land;
 * the port interface advertises them now and adapters fail to compile
 * when their share is incomplete on their end.
 *
 * **camelCase ↔ snake_case bridging.** This adapter installs Kysely's
 * `CamelCasePlugin`, so the typed schema (`schema.ts`) speaks
 * camelCase (`linksOutCount`, `bodyHash`) while the on-disk SQL is
 * snake_case (`links_out_count`, `body_hash`). The plugin rewrites
 * identifiers automatically for every fluent query —
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
  IIssueRow,
  INodeBundle,
  INodeCounts,
  INodeFilter,
  IPersistOptions,
} from '../../types/storage.js';
import type { Issue, Node, ScanResult } from '../../types.js';
import { NodeSqliteDialect } from './dialect.js';
import {
  aggregateHistoryStats,
  listExecutions,
  migrateNodeFks,
} from './history.js';
import type {
  IHistoryStatsRange,
  IListExecutionsFilter,
  THistoryStatsPeriod,
} from './history.js';
import { listOrphanJobFiles, pruneTerminalJobs } from './jobs.js';
import {
  applyMigrations,
  discoverMigrations,
  planMigrations,
  writeBackup,
} from './migrations.js';
import {
  applyPluginMigrations,
  discoverPluginMigrations,
  planPluginMigrations,
  resolvePluginMigrationsDir,
} from './plugin-migrations.js';
import {
  deletePluginOverride,
  getPluginEnabled,
  listPluginOverrides,
  loadPluginOverrideMap,
  setPluginEnabled,
} from './plugins.js';
import {
  loadExtractorRuns,
  loadNodeEnrichments,
  loadScanResult,
  rowToIssue,
  rowToLink,
  rowToNode,
} from './scan-load.js';
import { persistScanResult } from './scan-persistence.js';
import type { IDatabase } from './schema.js';

export interface ISqliteStorageAdapterOptions {
  /**
   * Absolute or relative path to the DB file. Parent directory is created
   * if missing. `:memory:` is supported for tests (no directory created).
   */
  databasePath: string;

  /**
   * When true (default), pending kernel migrations are applied on `init()`.
   * Set false to open the DB without touching schema — used by
   * `sm db migrate --dry-run` and by a future `autoMigrate: false` config.
   */
  autoMigrate?: boolean;

  /**
   * When true (default), auto-migration writes a pre-migration backup.
   * Set false to skip — used by `sm db migrate --no-backup`.
   */
  autoBackup?: boolean;
}

/**
 * Whitelist of `INodeFilter.sortBy` columns. The port rejects unknown
 * values with an error so a typo does not silently sort by `path`. The
 * CLI also validates upstream (`sm list --sort-by`); this is the
 * defensive second gate.
 */
const SORT_BY_COLUMNS: ReadonlySet<string> = new Set([
  'path',
  'kind',
  'bytes_total',
  'bytesTotal',
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
  bytesTotal: 'desc',
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
  issues!: StoragePort['issues'];
  history!: StoragePort['history'];
  jobs!: StoragePort['jobs'];
  pluginConfig!: StoragePort['pluginConfig'];
  migrations!: StoragePort['migrations'];
  pluginMigrations!: StoragePort['pluginMigrations'];

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
          // WAL journaling: concurrent readers + a single writer. Matches
          // spec/db-schema.md and survives hard crashes better than the
          // rollback journal. `:memory:` doesn't support WAL — skip it.
          if (path !== ':memory:') {
            db.exec('PRAGMA journal_mode = WAL');
          }
          db.exec('PRAGMA foreign_keys = ON');
          db.exec('PRAGMA synchronous = NORMAL');
        },
      }),
      plugins: [new CamelCasePlugin()],
    });

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
   * **Pre-Phase F:** kept exported so existing CLI commands and tests
   * that reach into raw Kysely can keep building. Once Phase F lands,
   * this getter becomes adapter-internal and the only consumers are
   * the namespace bodies on this class.
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
      loadExtractorRuns: () => loadExtractorRuns(this.db),
      loadNodeEnrichments: () => loadNodeEnrichments(this.db),
      countRows: () => countRows(this.db),
      findNodes: (filter) => findNodes(this.db, filter),
      findNode: (path) => findNode(this.db, path),
    };

    this.issues = {
      listAll: () => listAllIssues(this.db),
      findActive: (predicate) => findActiveIssues(this.db, predicate),
    };

    this.history = {
      list: (filter: IListExecutionsFilter) => listExecutions(this.db, filter),
      aggregateStats: (
        range: IHistoryStatsRange,
        period: THistoryStatsPeriod,
        topN: number,
      ) => aggregateHistoryStats(this.db, range, period, topN),
    };

    this.jobs = {
      pruneTerminal: (status, cutoffMs) =>
        pruneTerminalJobs(this.db, status, cutoffMs),
      listTerminalCandidates: (status, cutoffMs) =>
        listTerminalCandidates(this.db, status, cutoffMs),
      listOrphanFiles: (jobsDir) => listOrphanJobFiles(this.db, jobsDir),
    };

    this.pluginConfig = {
      set: (pluginId, enabled) => setPluginEnabled(this.db, pluginId, enabled),
      get: (pluginId) => getPluginEnabled(this.db, pluginId),
      list: () => listPluginOverrides(this.db),
      delete: (pluginId) => deletePluginOverride(this.db, pluginId),
      loadOverrideMap: () => loadPluginOverrideMap(this.db),
    };

    const path = this.#options.databasePath;

    this.migrations = {
      discover: () => discoverMigrations(),
      plan: (files) => withRawDb(path, (raw) => planMigrations(raw, files)),
      apply: (options, files) =>
        withRawDb(path, (raw) => {
          raw.exec('PRAGMA foreign_keys = ON');
          return applyMigrations(raw, path, options, files);
        }),
      writeBackup: (targetVersion) => writeBackup(path, targetVersion),
    };

    this.pluginMigrations = {
      resolveDir: (plugin) => resolvePluginMigrationsDir(plugin),
      discover: (plugin) => discoverPluginMigrations(plugin),
      plan: (plugin, files) =>
        withRawDb(path, (raw) => planPluginMigrations(raw, plugin, files)),
      apply: (plugin, options, files) =>
        withRawDb(path, (raw) => {
          raw.exec('PRAGMA foreign_keys = ON');
          return applyPluginMigrations(raw, plugin, options, files);
        }),
    };
  }
}

/**
 * Non-transactional `scans.persist` — opens its own transaction
 * underneath because `persistScanResult` already handles the
 * orchestration. The transactional variant lives inside
 * `buildTxSubset`.
 */
async function persistScansThroughNonTx(
  db: Kysely<IDatabase>,
  result: ScanResult,
  opts?: IPersistOptions,
): Promise<void> {
  await persistScanResult(
    db,
    result,
    opts?.renameOps ?? [],
    opts?.extractorRuns ?? [],
    opts?.enrichments ?? [],
  );
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
 * the resolved column / direction or throws — the throw is the gate.
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
        `findNodes: invalid sortBy "${filter.sortBy}". Allowed: ${[...SORT_BY_COLUMNS].join(', ')}.`,
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
        `findNodes: invalid limit ${filter.limit}; expected positive integer.`,
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
  // current `sm show` handler.
  const [outRows, inRows, issueRows] = await Promise.all([
    db.selectFrom('scan_links').selectAll().where('sourcePath', '=', path).execute(),
    db.selectFrom('scan_links').selectAll().where('targetPath', '=', path).execute(),
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

function buildTxSubset(trx: Transaction<IDatabase>): ITransactionalStorage {
  return {
    scans: {
      persist: (result, opts) =>
        persistScanResult(
          trx,
          result,
          opts?.renameOps ?? [],
          opts?.extractorRuns ?? [],
          opts?.enrichments ?? [],
        ).then(() => undefined),
    },
    issues: {
      deleteById: async (id) => {
        await trx.deleteFrom('scan_issues').where('id', '=', id).execute();
      },
      insert: async (issue) => {
        await trx
          .insertInto('scan_issues')
          .values({
            ruleId: issue.ruleId,
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
    },
    history: {
      migrateNodeFks: (from: string, to: string) =>
        migrateNodeFks(trx, from, to),
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
 * Read-only `state_jobs` filter mirroring the SELECT side of
 * `pruneTerminalJobs` — `sm job prune --dry-run` consumes this so the
 * preview names exactly the rows the live mode would delete.
 */
async function listTerminalCandidates(
  db: Kysely<IDatabase>,
  status: 'completed' | 'failed',
  cutoffMs: number,
): Promise<{ deletedCount: number; filePaths: string[] }> {
  const rows = await db
    .selectFrom('state_jobs')
    .select(['id', 'filePath'])
    .where('status', '=', status)
    .where('finishedAt', 'is not', null)
    .where('finishedAt', '<', cutoffMs)
    .execute();
  return {
    deletedCount: rows.length,
    filePaths: rows
      .map((r) => r.filePath)
      .filter((p): p is string => p !== null),
  };
}

/**
 * Open a raw `node:sqlite` handle for migration runs, invoke `fn`,
 * and close it. Each port-method call gets its own handle (the
 * verb's per-method calls are infrequent, so the open/close
 * overhead is negligible). The synchronous `fn` matches the
 * underlying free functions, which run BEGIN/COMMIT on the raw
 * handle directly per `migrations.ts` / `plugin-migrations.ts`.
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
