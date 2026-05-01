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

export type {
  IDatabase,
  IScanNodesTable,
  IScanLinksTable,
  IScanIssuesTable,
  IStateJobsTable,
  IStateExecutionsTable,
  IStateSummariesTable,
  IStateEnrichmentsTable,
  IStatePluginKvsTable,
  IConfigPluginsTable,
  IConfigPreferencesTable,
  IConfigSchemaVersionsTable,
  TNodeKind,
  TStability,
  TLinkKind,
  TConfidence,
  TIssueSeverity,
  TJobStatus,
  TJobFailureReason,
  TJobRunner,
  TExecutionKind,
  TExecutionStatus,
  TSchemaVersionScope,
} from './schema.js';
