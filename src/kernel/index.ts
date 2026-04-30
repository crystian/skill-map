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

// Pre-1.0 export surface — every name is enumerated explicitly so a
// rename / addition in any of the underlying modules requires an
// explicit edit here. The previous `export type *` wildcards from
// `./types.js` and `./ports/index.js` re-published every internal type
// implicitly; pre-1.0 that's quiet drift, post-1.0 it would silently
// turn refactors into major bumps. Group order: registry, domain
// types, orchestrator, watcher / delta / query, ports, extension
// kinds.

export { Registry, EXTENSION_KINDS, DuplicateExtensionError, qualifiedExtensionId } from './registry.js';
export type { Extension, ExtensionKind } from './registry.js';

// --- domain types (./types.ts) -----------------------------------------
export type {
  // unions
  NodeKind,
  LinkKind,
  Confidence,
  Severity,
  Stability,
  TExecutionMode,
  ExecutionKind,
  ExecutionStatus,
  ExecutionFailureReason,
  ExecutionRunner,
  // value objects
  TripleSplit,
  LinkTrigger,
  LinkLocation,
  // graph
  Node,
  Link,
  IssueFix,
  Issue,
  ScanStats,
  ScanScannedBy,
  ScanResult,
  // history surface
  ExecutionRecord,
  HistoryStatsTotals,
  HistoryStatsTokensPerAction,
  HistoryStatsExecutionsPerPeriod,
  HistoryStatsTopNode,
  HistoryStatsPerActionRate,
  HistoryStatsErrorRates,
  HistoryStats,
} from './types.js';

// --- orchestrator (./orchestrator.ts) ---------------------------------
export {
  runScan,
  runScanWithRenames,
  detectRenamesAndOrphans,
  mergeNodeWithEnrichments,
} from './orchestrator.js';
export type {
  RunScanOptions,
  RenameOp,
  IExtractorRunRecord,
  IEnrichmentRecord,
  IPersistedEnrichment,
} from './orchestrator.js';

// --- adapters (./adapters/...) -----------------------------------------
export { InMemoryProgressEmitter } from './adapters/in-memory-progress.js';

// --- scan utilities (./scan/...) ---------------------------------------
export { createChokidarWatcher } from './scan/watcher.js';
export type {
  IFsWatcher,
  IWatchBatch,
  IWatchEvent,
  ICreateFsWatcherOptions,
  TWatchEventKind,
} from './scan/watcher.js';
export { computeScanDelta, isEmptyDelta } from './scan/delta.js';
export type { IScanDelta, INodeChange, TNodeChangeReason } from './scan/delta.js';
export { parseExportQuery, applyExportQuery, ExportQueryError } from './scan/query.js';
export type { IExportQuery, IExportSubset } from './scan/query.js';

// --- ports (./ports/...) -----------------------------------------------
export type { StoragePort } from './ports/storage.js';
export type { FilesystemPort, NodeStat, WalkOptions } from './ports/filesystem.js';
export type {
  PluginLoaderPort,
  PluginManifest,
  PluginStorage,
  LoadedExtension,
} from './ports/plugin-loader.js';
export type { RunnerPort, RunOptions, RunResult } from './ports/runner.js';
export type {
  ProgressEmitterPort,
  ProgressEvent,
  ProgressListener,
} from './ports/progress-emitter.js';

// --- extension kinds (./extensions/...) --------------------------------
export type {
  IProvider,
  IRawNode,
  IExtractor,
  IExtractorContext,
  IExtractorCallbacks,
  IRule,
  IRuleContext,
  IFormatter,
  IFormatterContext,
  IHook,
  IHookContext,
  THookTrigger,
  THookFilter,
  IExtensionBase,
} from './extensions/index.js';
export { HOOK_TRIGGERS } from './extensions/index.js';
