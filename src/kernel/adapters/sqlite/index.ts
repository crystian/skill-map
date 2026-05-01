import type { StoragePort } from '../../ports/storage.js';
import { SqliteStorageAdapter } from './storage-adapter.js';
import type { ISqliteStorageAdapterOptions } from './storage-adapter.js';

export { NodeSqliteDialect } from './dialect.js';
export type { INodeSqliteDialectConfig } from './dialect.js';
export { SqliteStorageAdapter };
export type { ISqliteStorageAdapterOptions };

/**
 * Factory — preferred entry point for production callers (CLI). Returns
 * the `StoragePort` shape so the consumer is pinned to the abstract
 * contract, not the concrete `SqliteStorageAdapter`. Tests that need to
 * access adapter internals continue to use `new SqliteStorageAdapter(...)`
 * directly per the `*-architect` agent's documented exception.
 */
export function createSqliteStorage(options: ISqliteStorageAdapterOptions): StoragePort {
  return new SqliteStorageAdapter(options);
}

/**
 * Adapter-internal Kysely schema types. Re-exported here only for
 * test scaffolding that asserts against raw rows / pragma values
 * (`src/test/storage.test.ts`). CLI consumers MUST go through the
 * `StoragePort` shape — reaching for these is a boundary leak. Tests
 * keep the explicit exception per `AGENTS.md` § Kernel boundaries.
 *
 * Per-table interfaces and the column unions ship from `./schema.ts`
 * directly; test files that need more than `IDatabase` import them
 * from the schema module.
 */
export type { IDatabase } from './schema.js';
