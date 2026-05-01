/**
 * `withSqlite` — open a `SqliteStorageAdapter`, hand it to the callback,
 * and guarantee `close()` even if the callback throws or returns early.
 *
 * Standardises the open/use/close idiom every read-side CLI command was
 * open-coding. Eliminates four classes of bugs the inline boilerplate
 * tended to produce:
 *
 *   1. Forgotten `await adapter.close()` in an early-return branch
 *      (resource leak; on Linux WSL the WAL file lingers).
 *   2. Drift between `autoBackup: false` (read-side verbs) and the
 *      default `autoBackup: true` — easy to flip the wrong way when
 *      copying boilerplate across commands.
 *   3. Double-close on the error path (`jobs.ts` had two `await
 *      adapter.close()` calls, one in the catch + one in the finally).
 *      Idempotent today, but a wart.
 *   4. Forgetting to wrap the body in try/finally at all (the rare
 *      error path leaves the DB open until process exit).
 *
 * The callback receives the adapter — not `adapter.db` — because a
 * minority of call sites pass the adapter itself to repository
 * helpers. The common case (`adapter.db.selectFrom(...)`) reads the
 * same.
 *
 * Migration policy reminder:
 *   - Read-side verbs (`check`, `list`, `show`, `export`, `graph`,
 *     `history`, `orphans` list, `plugins list/doctor`, scan prior
 *     load) SHOULD pass `{ autoBackup: false }` so a transient schema
 *     upgrade doesn't write an unsolicited backup.
 *   - Write-side verbs (scan persist, init seed, watch writer,
 *     orphans reconcile / undo-rename) leave defaults on so first-run
 *     schema upgrades are guarded by an automatic backup.
 */

import { existsSync } from 'node:fs';

import { createSqliteStorage } from '../../kernel/adapters/sqlite/index.js';
import type { ISqliteStorageAdapterOptions } from '../../kernel/adapters/sqlite/index.js';
import type { StoragePort } from '../../kernel/ports/storage.js';

export async function withSqlite<T>(
  options: ISqliteStorageAdapterOptions,
  fn: (adapter: StoragePort) => Promise<T>,
): Promise<T> {
  const adapter = createSqliteStorage(options);
  await adapter.init();
  try {
    return await fn(adapter);
  } finally {
    await adapter.close();
  }
}

/**
 * Open the DB only when it already exists on disk; return `null`
 * otherwise. Wraps the very common `if (existsSync(dbPath)) { withSqlite
 * ... }` chain that every read-side command was open-coding.
 *
 * The bare-`existsSync` + `withSqlite` pair was both noisy and a subtle
 * footgun: `withSqlite` opens the adapter unconditionally, and the
 * adapter's `init()` runs `mkdirSync(dirname(absolute), { recursive:
 * true })` before opening the file. That is benign for write-side verbs
 * (they intend to create the scope) but wrong for "read-only-if-present"
 * lookups, which would silently provision `.skill-map/` directories on
 * misuse. `tryWithSqlite` keeps the no-op semantics by short-circuiting
 * before the adapter is constructed.
 *
 * `:memory:` is treated as "exists" — useful for tests that want the
 * read path to run against a fresh in-memory DB instead of skipping.
 */
export async function tryWithSqlite<T>(
  options: ISqliteStorageAdapterOptions,
  fn: (adapter: StoragePort) => Promise<T>,
): Promise<T | null> {
  if (options.databasePath !== ':memory:' && !existsSync(options.databasePath)) {
    return null;
  }
  return withSqlite(options, fn);
}
