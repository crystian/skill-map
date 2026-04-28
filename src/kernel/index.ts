/**
 * Kernel entry point. `createKernel()` returns a shell with an empty registry
 * and no bound ports. Driving adapters (CLI, Server, Skill) are expected to
 * wire adapters before invoking use cases.
 */

import { Registry } from './registry.js';

export interface Kernel {
  registry: Registry;
}

export function createKernel(): Kernel {
  return { registry: new Registry() };
}

export { Registry, EXTENSION_KINDS, DuplicateExtensionError } from './registry.js';
export type { Extension, ExtensionKind } from './registry.js';
export type * from './types.js';
export { runScan, runScanWithRenames, detectRenamesAndOrphans } from './orchestrator.js';
export type { RunScanOptions, RenameOp } from './orchestrator.js';
export { InMemoryProgressEmitter } from './adapters/in-memory-progress.js';
export { createChokidarWatcher } from './scan/watcher.js';
export { computeScanDelta, isEmptyDelta } from './scan/delta.js';
export type { IScanDelta, INodeChange, TNodeChangeReason } from './scan/delta.js';
export { parseExportQuery, applyExportQuery, ExportQueryError } from './scan/query.js';
export type { IExportQuery, IExportSubset } from './scan/query.js';
export type {
  IFsWatcher,
  IWatchBatch,
  IWatchEvent,
  ICreateFsWatcherOptions,
  TWatchEventKind,
} from './scan/watcher.js';
export type * from './ports/index.js';
