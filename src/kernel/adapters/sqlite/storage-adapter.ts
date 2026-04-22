/**
 * `SqliteStorageAdapter` — default `StoragePort` implementation. Opens a
 * `node:sqlite` database behind the bespoke Kysely dialect, configures the
 * mandatory PRAGMAs (WAL, foreign keys), and exposes the typed Kysely
 * instance for downstream repositories.
 *
 * Migration application happens in a separate runner (next commit). This
 * adapter is purely the connection layer; `init()` opens and PRAGMAs,
 * `close()` flushes and disconnects.
 */

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { CamelCasePlugin, Kysely } from 'kysely';

import type { StoragePort } from '../../ports/storage.js';
import { NodeSqliteDialect } from './dialect.js';
import type { IDatabase } from './schema.js';

export interface ISqliteStorageAdapterOptions {
  /**
   * Absolute or relative path to the DB file. Parent directory is created
   * if missing. `:memory:` is supported for tests (no directory created).
   */
  databasePath: string;
}

export class SqliteStorageAdapter implements StoragePort {
  #db: Kysely<IDatabase> | null = null;
  readonly #options: ISqliteStorageAdapterOptions;

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
  }

  async close(): Promise<void> {
    if (!this.#db) return;
    await this.#db.destroy();
    this.#db = null;
  }

  /**
   * Access the underlying Kysely instance. Throws if `init()` has not run.
   * Repositories should take `Kysely<IDatabase>` directly rather than
   * holding a reference to the adapter.
   */
  get db(): Kysely<IDatabase> {
    if (!this.#db) throw new Error('SqliteStorageAdapter: init() not called');
    return this.#db;
  }
}
