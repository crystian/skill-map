/**
 * `SqliteStorageAdapter` — default `StoragePort` implementation. Opens a
 * `node:sqlite` database behind the bespoke Kysely dialect, configures the
 * mandatory PRAGMAs (WAL, foreign keys), and exposes the typed Kysely
 * instance for downstream repositories.
 *
 * Migration application happens in a separate runner. This adapter is
 * purely the connection layer; `init()` opens and PRAGMAs, `close()`
 * flushes and disconnects.
 *
 * **camelCase ↔ snake_case bridging.** This adapter installs Kysely's
 * `CamelCasePlugin`, so the typed schema (`schema.ts`) speaks camelCase
 * (`linksOutCount`, `bodyHash`) while the on-disk SQL is snake_case
 * (`links_out_count`, `body_hash`). The plugin rewrites identifiers
 * automatically for every fluent query — `db.selectFrom('scan_nodes')
 * .where('linksOutCount', '>', 0)` resolves to `WHERE links_out_count
 * > 0` at execution time.
 *
 * **Trap to avoid:** `sql.raw` / `sql\`...\`` template literals are NOT
 * processed by the plugin. If a future caller writes
 * `sql\`SELECT linksOutCount FROM scan_nodes\``, the query will fail at
 * runtime against a snake_case-only database. Always use snake_case
 * inside raw SQL fragments (matching the migrations in
 * `src/migrations/`), or stick to the typed fluent API.
 */

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { CamelCasePlugin, Kysely } from 'kysely';

import type { StoragePort } from '../../ports/storage.js';
import { NodeSqliteDialect } from './dialect.js';
import { applyMigrations, discoverMigrations } from './migrations.js';
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
