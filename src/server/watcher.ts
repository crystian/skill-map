/**
 * `WatcherService` — chokidar-fed scan loop that broadcasts kernel events
 * over `/ws`. The BFF parallel of `src/cli/commands/watch.ts:runWatchLoop`.
 *
 * Per Decision #121: each debounced batch runs `runScanWithRenames` +
 * `persistScanResult`. A read-only watcher was rejected — a server with
 * stale DB while a sibling `sm` writes is a footgun (clients see
 * divergent state, two pipelines diverge silently).
 *
 * Why not extract a shared module with the CLI's `runWatchLoop` yet:
 * the call sites are too thin to abstract. The CLI variant prints
 * progress to stderr; this variant fans events out to WS clients via
 * the broadcaster. The duplication is ~30 lines — worth keeping until
 * a third caller materializes (a future test harness watcher would be
 * the trigger).
 *
 * Event flow per batch:
 *
 *   1. Build a fresh `ProgressEmitterPort` whose `emit()` calls
 *      `broadcaster.broadcast(envelope)` (the kernel's emitter shape
 *      already matches `IWsEventEnvelope` — `type` / `timestamp` /
 *      optional `data`). Threading the emitter into `runScanWithRenames`
 *      is enough to fan out `scan.started` / `scan.progress` /
 *      `scan.completed` / `extractor.completed` / `rule.completed`
 *      without any additional event construction in the BFF.
 *   2. Run `runScanWithRenames` against the assembled options bag.
 *   3. Persist via `withSqlite(...).scans.persist(...)` — same writer
 *      shape `sm watch` uses.
 *   4. On batch failure: log to stderr (sanitized). Do NOT emit a
 *      `scan.failed` event at 14.4.a (out of spec at this stage; flag
 *      as TODO). The watcher loop continues — a transient FS error
 *      must not kill the broadcaster.
 *
 * On the chokidar instance's own error (rare — bad watch root, EMFILE):
 * log + broadcast a `watcher.error` advisory event. The watcher stays
 * open per `IFsWatcher`'s contract.
 */

import { resolve } from 'node:path';

import {
  createChokidarWatcher,
  createKernel,
  runScanWithRenames,
} from '../kernel/index.js';
import type { ScanResult } from '../kernel/index.js';
import { listBuiltIns } from '../built-in-plugins/built-ins.js';
import { loadConfig } from '../kernel/config/loader.js';
import { buildIgnoreFilter, readIgnoreFileText, type IIgnoreFilter } from '../kernel/scan/ignore.js';
import type { ProgressEmitterPort } from '../kernel/ports/progress-emitter.js';
import { log } from '../kernel/util/logger.js';
import { sanitizeForTerminal } from '../kernel/util/safe-text.js';
import { tx } from '../kernel/util/tx.js';
import {
  composeScanExtensions,
  emptyPluginRuntime,
  filterBuiltInManifests,
  loadPluginRuntime,
} from '../cli/util/plugin-runtime.js';
import type { IRuntimeContext } from '../cli/util/runtime-context.js';
import { tryWithSqlite, withSqlite } from '../cli/util/with-sqlite.js';
import { formatErrorMessage } from '../cli/util/error-reporter.js';

import type { WsBroadcaster } from './broadcaster.js';
import { buildWatcherErrorEvent, buildWatcherStartedEvent } from './events.js';
import { SERVER_TEXTS } from './i18n/server.texts.js';
import type { IServerOptions } from './options.js';

export interface ICreateWatcherServiceOpts {
  options: IServerOptions;
  runtimeContext: IRuntimeContext;
  broadcaster: WsBroadcaster;
  /** Optional override for the chokidar debounce window (ms). Falls back to `scan.watch.debounceMs` from config. */
  debounceMsOverride?: number | undefined;
}

export interface IWatcherServiceHandle {
  /**
   * Boot the watcher: load config + plugin runtime, subscribe via
   * `createChokidarWatcher`, broadcast a `watcher.started` advisory
   * once chokidar's initial walk completes. Resolves once the watcher
   * is live.
   *
   * Failures during boot (config load, plugin runtime, chokidar bind)
   * propagate to the caller so `createServer` can surface them as a
   * boot-time error. After `start()` resolves, all subsequent failures
   * are per-batch and logged (never thrown — the broadcaster stays up).
   */
  start(): Promise<void>;
  /**
   * Gracefully tear down the watcher: stop accepting new batches, drain
   * the in-flight batch (if any), close chokidar handles. Idempotent —
   * a second call resolves immediately.
   */
  stop(): Promise<void>;
}

const WATCH_ROOT = '.';

/**
 * Construct a watcher service. Pure factory — every dependency comes
 * through the options bag. The caller (`createServer`) wires the
 * broadcaster and runtime context at composition time.
 *
 * Mirrors the CLI's `loadPluginRuntime({ scope: 'project' })` semantics:
 * plugins are loaded ONCE at watcher boot and reused across every
 * batch. Hot-reload of plugin code requires restarting the server
 * (same trade-off as `sm watch`; see Step 9.1 §note).
 */
export function createWatcherService(opts: ICreateWatcherServiceOpts): IWatcherServiceHandle {
  let chokidarHandle: { close: () => Promise<void> } | null = null;
  let metaHandle: { close: () => Promise<void> } | null = null;
  let stopped = false;

  const start = async (): Promise<void> => {
    const cwd = opts.runtimeContext.cwd;

    const loadEffectiveConfig = (): ReturnType<typeof loadConfig>['effective'] =>
      loadConfig({
        scope: opts.options.scope,
        cwd,
        homedir: opts.runtimeContext.homedir,
      }).effective;

    const buildCurrentIgnoreFilter = (cfgIn: ReturnType<typeof loadEffectiveConfig>): IIgnoreFilter => {
      const ignoreFileText = readIgnoreFileText(cwd);
      const filterOpts: Parameters<typeof buildIgnoreFilter>[0] = {};
      if (cfgIn.ignore.length > 0) filterOpts.configIgnore = cfgIn.ignore;
      if (ignoreFileText !== undefined) filterOpts.ignoreFileText = ignoreFileText;
      return buildIgnoreFilter(filterOpts);
    };

    // Both `cfg` and `ignoreFilter` are mutable so the meta-file watcher
    // can swap them after a `.skill-mapignore` or `.skill-map/settings.json`
    // edit. Three downstream readers pick up the new values automatically:
    //   1. The primary chokidar `ignored` predicate (via the getter passed
    //      to the kernel watcher) — re-evaluated per chokidar event, so
    //      new patterns take effect on the very next FS event.
    //   2. `runOneBatch` reads `ignoreFilter` and `cfg` from this scope on
    //      every batch — so the next scan after a meta-file edit picks up
    //      the new tokenize/strict/ignore settings.
    //   3. The meta-file watcher itself triggers a fresh batch right after
    //      a rebuild, so the DB and the SPA reflect the change without
    //      waiting for an unrelated FS event to nudge the watcher.
    let cfg = loadEffectiveConfig();
    let ignoreFilter = buildCurrentIgnoreFilter(cfg);

    const debounceMs = opts.debounceMsOverride ?? cfg.scan.watch.debounceMs;

    // Plugin runtime — loaded once at boot, reused across every batch.
    // The watcher owns its own runtime (the routes' fresh-scan path
    // loads its own; deduplicating would couple two unrelated
    // lifecycles).
    const pluginRuntime = opts.options.noPlugins
      ? emptyPluginRuntime()
      : await loadPluginRuntime({ scope: opts.options.scope });
    for (const warn of pluginRuntime.warnings) {
      log.warn(sanitizeForTerminal(warn));
    }

    // Single-batch handler. Closure captures the `pluginRuntime` so
    // every batch reuses the same loaded plugins. The body is split
    // into small helpers (registerExtensions / loadPriorState /
    // assembleRunOptions / persistOutcome) so the cyclomatic complexity
    // of the closure stays under the project budget without disabling
    // the rule.
    const runOneBatch = async (): Promise<void> => {
      const kernel = createKernel();
      registerKernelExtensions(kernel, pluginRuntime, opts.options.noBuiltIns);
      const emitter = buildBroadcasterEmitter(opts.broadcaster);
      const priorState = await loadPriorState(opts.options.dbPath);
      const composed = composeScanExtensions({
        noBuiltIns: opts.options.noBuiltIns,
        pluginRuntime,
      });
      const runOptions = assembleRunOptions({
        scope: opts.options.scope,
        tokenize: cfg.scan.tokenize !== false,
        strict: cfg.scan.strict === true,
        ignoreFilter,
        emitter,
        composed,
        priorState,
      });
      const ran = await runScanWithRenames(kernel, runOptions);
      await persistOutcome(opts.options.dbPath, ran);
    };

    chokidarHandle = createChokidarWatcher({
      roots: [WATCH_ROOT],
      cwd: opts.runtimeContext.cwd,
      debounceMs,
      // Pass a getter, NOT the filter directly: the meta-file watcher
      // below mutates `ignoreFilter` after a `.skill-mapignore` /
      // `.skill-map/settings.json` edit, and chokidar's `ignored`
      // predicate must read the current value on every event. See
      // `kernel/scan/watcher.ts` for the supported shapes.
      ignoreFilter: (): IIgnoreFilter => ignoreFilter,
      onBatch: async () => {
        if (stopped) return;
        try {
          await runOneBatch();
        } catch (err) {
          // TODO(14.4.b / 14.5): emit `scan.failed` event once the
          // shape is locked in spec/job-events.md. For 14.4.a we log
          // and continue — a transient FS error must NOT kill the
          // broadcaster.
          const message = formatErrorMessage(err);
          log.warn(
            tx(SERVER_TEXTS.watcherBatchFailed, {
              message: sanitizeForTerminal(message),
            }),
          );
        }
      },
      onError: (err) => {
        // chokidar instance error — log + broadcast advisory. The
        // watcher itself stays open per `IFsWatcher`'s contract.
        const message = err.message;
        log.warn(
          tx(SERVER_TEXTS.watcherError, {
            message: sanitizeForTerminal(message),
          }),
        );
        opts.broadcaster.broadcast(buildWatcherErrorEvent({ message }));
      },
    });

    // Wait for chokidar's initial directory walk to complete before
    // emitting `watcher.started`. Without the wait, the SPA can mark
    // the connection as "armed" before chokidar is actually emitting
    // events.
    if ('ready' in chokidarHandle && chokidarHandle.ready instanceof Promise) {
      await chokidarHandle.ready;
    }

    // Secondary watcher for the project's ignore meta-files. These are
    // outside the primary watcher's filter (the default `.skill-map/**`
    // ignore would otherwise hide settings.json), so they get their own
    // chokidar instance with no filter at all. On change, rebuild the
    // primary filter + re-read config + run a fresh batch so the SPA
    // sees an updated `scan.completed` envelope without a server restart.
    metaHandle = createChokidarWatcher({
      roots: [
        resolve(cwd, '.skill-mapignore'),
        resolve(cwd, '.skill-map', 'settings.json'),
      ],
      cwd,
      debounceMs,
      // No `ignoreFilter` — these specific paths must always be observed,
      // regardless of any user pattern.
      onBatch: async () => {
        if (stopped) return;
        try {
          cfg = loadEffectiveConfig();
          ignoreFilter = buildCurrentIgnoreFilter(cfg);
          // Trigger a batch with the freshly built filter. `runOneBatch`
          // reads `ignoreFilter` + `cfg` from this scope dynamically, so
          // the new patterns drive the scan.
          await runOneBatch();
        } catch (err) {
          const message = formatErrorMessage(err);
          log.warn(
            tx(SERVER_TEXTS.watcherBatchFailed, {
              message: sanitizeForTerminal(message),
            }),
          );
        }
      },
      onError: (err) => {
        // Soft-fail: the primary watcher stays up. Editing a meta-file
        // simply won't trigger a rebuild until the situation recovers.
        const message = err.message;
        log.warn(
          tx(SERVER_TEXTS.watcherError, {
            message: sanitizeForTerminal(message),
          }),
        );
      },
    });
    if ('ready' in metaHandle && metaHandle.ready instanceof Promise) {
      await metaHandle.ready;
    }

    // Initial scan-and-persist on boot. Without this, the server would
    // serve whatever was in the DB from the previous run (potentially
    // stale — files renamed / deleted while the server was down would
    // still appear as nodes), and the watcher would only react to new
    // changes. Running one batch eagerly guarantees the UI reflects
    // the current filesystem from the very first connection.
    await runInitialBatch({ isStopped: () => stopped, runOneBatch });

    opts.broadcaster.broadcast(
      buildWatcherStartedEvent({ roots: [WATCH_ROOT], debounceMs }),
    );
    log.info(
      tx(SERVER_TEXTS.watcherReady, {
        roots: WATCH_ROOT,
        debounceMs: String(debounceMs),
      }),
    );
  };

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    const closeQuietly = async (
      handle: { close: () => Promise<void> } | null,
      label: string,
    ): Promise<void> => {
      if (!handle) return;
      try {
        await handle.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(
          tx(SERVER_TEXTS.watcherCloseFailed, {
            message: sanitizeForTerminal(`${label}: ${message}`),
          }),
        );
      }
    };
    await closeQuietly(metaHandle, 'meta-watcher');
    metaHandle = null;
    await closeQuietly(chokidarHandle, 'primary');
    chokidarHandle = null;
  };

  return { start, stop };
}

// -----------------------------------------------------------------------------
// Per-batch helpers — extracted from `runOneBatch` so the closure stays
// under the project's cyclomatic-complexity budget without an
// eslint-disable hatch.
// -----------------------------------------------------------------------------

interface IPriorState {
  snapshot: ScanResult;
  extractorRuns: Map<string, Map<string, string>>;
}

interface IAssembleRunOptionsArgs {
  scope: 'project' | 'global';
  tokenize: boolean;
  strict: boolean;
  ignoreFilter: ReturnType<typeof buildIgnoreFilter>;
  emitter: ProgressEmitterPort;
  composed: ReturnType<typeof composeScanExtensions>;
  priorState: IPriorState | null;
}

function registerKernelExtensions(
  kernel: ReturnType<typeof createKernel>,
  pluginRuntime: Awaited<ReturnType<typeof loadPluginRuntime>>,
  noBuiltIns: boolean,
): void {
  if (!noBuiltIns) {
    const enabledBuiltIns = filterBuiltInManifests(
      listBuiltIns(),
      pluginRuntime.resolveEnabled,
    );
    for (const manifest of enabledBuiltIns) kernel.registry.register(manifest);
  }
  for (const manifest of pluginRuntime.manifests) kernel.registry.register(manifest);
}

/**
 * Bridge the kernel's `ProgressEmitterPort` to the broadcaster. Every
 * event the orchestrator emits during a batch (scan.started,
 * scan.progress, extractor.completed, rule.completed, scan.completed,
 * extension.error) flows verbatim to every connected `/ws` client.
 *
 * The orchestrator never calls `subscribe()` — it only emits — so the
 * subscribe/unsubscribe slot is a no-op pair.
 */
function buildBroadcasterEmitter(broadcaster: WsBroadcaster): ProgressEmitterPort {
  return {
    emit(event): void {
      broadcaster.broadcast(event);
    },
    subscribe(): () => void {
      return () => {
        // intentionally empty
      };
    },
  };
}

/**
 * Read prior snapshot so the orchestrator's incremental path / rename
 * heuristic has the same context as `sm watch`. A missing DB / empty
 * DB returns `null` and the batch runs as a full scan.
 */
async function loadPriorState(dbPath: string): Promise<IPriorState | null> {
  return tryWithSqlite({ databasePath: dbPath, autoBackup: false }, async (reader) => {
    const loaded = await reader.scans.load();
    if (loaded.nodes.length === 0) return null;
    const extractorRuns = await reader.scans.loadExtractorRuns();
    return { snapshot: loaded, extractorRuns };
  });
}

/**
 * Pure column-mapping fold over the per-batch wiring inputs — every
 * field is set once and there is no control flow beyond the per-field
 * conditional assignment. Per AGENTS.md §Linting category 5.
 */
function assembleRunOptions(args: IAssembleRunOptionsArgs): Parameters<typeof runScanWithRenames>[1] {
  const runOptions: Parameters<typeof runScanWithRenames>[1] = {
    roots: [WATCH_ROOT],
    scope: args.scope,
    tokenize: args.tokenize,
    ignoreFilter: args.ignoreFilter,
    strict: args.strict,
    emitter: args.emitter,
  };
  if (args.composed) runOptions.extensions = args.composed;
  if (args.priorState) {
    runOptions.priorSnapshot = args.priorState.snapshot;
    runOptions.enableCache = true;
    runOptions.priorExtractorRuns = args.priorState.extractorRuns;
  }
  return runOptions;
}

async function persistOutcome(
  dbPath: string,
  ran: Awaited<ReturnType<typeof runScanWithRenames>>,
): Promise<void> {
  const { result, renameOps, extractorRuns, enrichments } = ran;
  await withSqlite({ databasePath: dbPath }, (writer) =>
    writer.scans.persist(result, { renameOps, extractorRuns, enrichments }),
  );
}

/**
 * One-shot batch fired right after chokidar's `ready` resolves so the
 * UI reflects current filesystem state from the very first connection
 * (instead of whatever stale snapshot the previous run persisted).
 * Mirrors the swallow-and-log shape of `onBatch` so a transient FS
 * error here cannot abort `start()` or kill the broadcaster.
 */
async function runInitialBatch(deps: {
  isStopped: () => boolean;
  runOneBatch: () => Promise<void>;
}): Promise<void> {
  if (deps.isStopped()) return;
  try {
    await deps.runOneBatch();
  } catch (err) {
    const message = formatErrorMessage(err);
    log.warn(
      tx(SERVER_TEXTS.watcherBatchFailed, {
        message: sanitizeForTerminal(message),
      }),
    );
  }
}
