/**
 * Custom Kysely `Dialect` for Node 24's built-in `node:sqlite` module.
 *
 * Kysely ships a `SqliteDialect` that wraps `better-sqlite3` (native dep,
 * forbidden by Decision #7 — runtime is Node 24+ with zero native deps).
 * We therefore reuse Kysely's SQLite `Adapter`, `Introspector`, and
 * `QueryCompiler` (pure-JS, dialect-shape-only) and plug a bespoke
 * `Driver` that translates Kysely's `CompiledQuery` into `node:sqlite`
 * prepared statements.
 *
 * Minimal by design: a single connection, serialised via an async mutex
 * (SQLite writers are effectively serial anyway) and `BEGIN / COMMIT /
 * ROLLBACK` transactions driven through the same prepared-statement path.
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type Kysely,
  type QueryResult,
  type TransactionSettings,
} from 'kysely';

export interface INodeSqliteDialectConfig {
  /**
   * Absolute path to the database file, or `:memory:` for an in-memory DB.
   * Created with write access; parent directory must exist.
   */
  databasePath: string;

  /**
   * Called once after the underlying `DatabaseSync` is opened — use to
   * configure PRAGMAs (journal_mode, foreign_keys, etc.). Runs synchronously.
   */
  onCreateConnection?: (db: DatabaseSync) => void;
}

export class NodeSqliteDialect implements Dialect {
  readonly #config: INodeSqliteDialectConfig;

  constructor(config: INodeSqliteDialectConfig) {
    this.#config = config;
  }

  createAdapter(): SqliteAdapter {
    return new SqliteAdapter();
  }

  createDriver(): Driver {
    return new NodeSqliteDriver(this.#config);
  }

  createIntrospector(db: Kysely<unknown>): SqliteIntrospector {
    return new SqliteIntrospector(db);
  }

  createQueryCompiler(): SqliteQueryCompiler {
    return new SqliteQueryCompiler();
  }
}

class NodeSqliteDriver implements Driver {
  readonly #config: INodeSqliteDialectConfig;
  #db: DatabaseSync | null = null;
  #connection: NodeSqliteConnection | null = null;
  #mutex = new AsyncMutex();

  constructor(config: INodeSqliteDialectConfig) {
    this.#config = config;
  }

  async init(): Promise<void> {
    this.#db = new DatabaseSync(this.#config.databasePath);
    this.#config.onCreateConnection?.(this.#db);
    this.#connection = new NodeSqliteConnection(this.#db);
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    if (!this.#connection) throw new Error('node-sqlite driver not initialised');
    await this.#mutex.lock();
    return this.#connection;
  }

  async releaseConnection(): Promise<void> {
    this.#mutex.unlock();
  }

  async beginTransaction(conn: DatabaseConnection, _settings: TransactionSettings): Promise<void> {
    await (conn as NodeSqliteConnection).exec('BEGIN');
  }

  async commitTransaction(conn: DatabaseConnection): Promise<void> {
    await (conn as NodeSqliteConnection).exec('COMMIT');
  }

  async rollbackTransaction(conn: DatabaseConnection): Promise<void> {
    await (conn as NodeSqliteConnection).exec('ROLLBACK');
  }

  async destroy(): Promise<void> {
    this.#db?.close();
    this.#db = null;
    this.#connection = null;
  }
}

class NodeSqliteConnection implements DatabaseConnection {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  exec(sql: string): void {
    this.#db.exec(sql);
  }

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const stmt: StatementSync = this.#db.prepare(query.sql);
    const params = query.parameters as unknown[];

    const head = query.sql.trim().slice(0, 6).toUpperCase();
    const isSelect = head.startsWith('SELECT') || head.startsWith('WITH');

    if (isSelect) {
      const rows = stmt.all(...(params as never[])) as R[];
      return { rows };
    }

    const info = stmt.run(...(params as never[]));
    const numAffectedRows = info.changes !== undefined ? BigInt(info.changes) : undefined;
    const insertId =
      info.lastInsertRowid === undefined
        ? undefined
        : typeof info.lastInsertRowid === 'bigint'
          ? info.lastInsertRowid
          : BigInt(info.lastInsertRowid);
    return {
      rows: [],
      ...(numAffectedRows !== undefined ? { numAffectedRows } : {}),
      ...(insertId !== undefined ? { insertId } : {}),
    };
  }

  async *streamQuery<R>(query: CompiledQuery): AsyncIterableIterator<QueryResult<R>> {
    // node:sqlite does not expose a cursor API. Buffer then yield once —
    // acceptable for our scale (kernel tables are small) and consistent
    // with Kysely's contract for streamless backends.
    const result = await this.executeQuery<R>(query);
    yield result;
  }
}

/**
 * Bare-bones async mutex. node:sqlite is single-threaded; SQLite writers
 * serialise anyway, so this guards Kysely's request/release lifecycle
 * without a real connection pool.
 */
class AsyncMutex {
  #locked = false;
  #waiters: Array<() => void> = [];

  async lock(): Promise<void> {
    if (!this.#locked) {
      this.#locked = true;
      return;
    }
    await new Promise<void>((resolve) => this.#waiters.push(resolve));
    this.#locked = true;
  }

  unlock(): void {
    this.#locked = false;
    const next = this.#waiters.shift();
    if (next) next();
  }
}
