/**
 * `sm watch [roots...]` — long-running incremental scan loop.
 *
 * Flow:
 *
 *   1. Load config + ignore filter once (same composition as `sm scan`).
 *   2. Run an initial incremental scan + persist, so the DB matches the
 *      current filesystem before the watcher fires anything.
 *   3. Subscribe via `createChokidarWatcher` with `scan.watch.debounceMs`
 *      from config.
 *   4. On each debounced batch, re-run the same scan+persist pipeline
 *      and print one summary line (or one ScanResult ndjson record under
 *      `--json`).
 *   5. SIGINT / SIGTERM closes the watcher and exits 0. Operational
 *      errors during initial setup exit 2; per-batch errors are logged
 *      and the loop keeps running (a transient FS error must not kill
 *      a long-running watcher).
 *
 * `sm scan --watch` is an alias: `ScanCommand` detects the flag and
 * delegates here so we keep one implementation. The two surfaces share
 * the exit-code rule too — clean watcher shutdown is always 0,
 * regardless of per-batch issue severities.
 */

import { resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import {
  createChokidarWatcher,
  createKernel,
  runScanWithRenames,
} from '../../kernel/index.js';
import type {
  IEnrichmentRecord,
  IExtractorRunRecord,
  RenameOp,
  ScanResult,
} from '../../kernel/index.js';
import { listBuiltIns } from '../../built-in-plugins/built-ins.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { loadConfig } from '../../kernel/config/loader.js';
import { buildIgnoreFilter, readIgnoreFileText, type IIgnoreFilter } from '../../kernel/scan/ignore.js';
import { tx } from '../../kernel/util/tx.js';
import { WATCH_TEXTS } from '../i18n/watch.texts.js';
import { createCliProgressEmitter } from '../util/cli-progress-emitter.js';
import { defaultProjectDbPath } from '../util/db-path.js';
import { ExitCode } from '../util/exit-codes.js';
import { formatErrorMessage } from '../util/error-reporter.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import {
  composeScanExtensions,
  emptyPluginRuntime,
  filterBuiltInManifests,
  loadPluginRuntime,
} from '../util/plugin-runtime.js';
import { SmCommand } from '../util/sm-command.js';
import { tryWithSqlite, withSqlite } from '../util/with-sqlite.js';

export interface IRunWatchOptions {
  roots: string[];
  json: boolean;
  noTokens: boolean;
  strict: boolean;
  /** Skip plugin discovery entirely. Step 9.1. */
  noPlugins?: boolean;
  context: {
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
  };
  /** Test hook: when set, the watcher closes after this many batches. */
  maxBatches?: number;
  /**
   * Circuit breaker — after N consecutive batch failures the watcher
   * shuts down with exit 2. Defaults to 5. A successful batch resets
   * the counter. Set to 0 to disable the breaker (the historical
   * behaviour: log and continue forever).
   */
  maxConsecutiveFailures?: number;
}

const DEFAULT_MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Shared implementation behind `sm watch` and `sm scan --watch`.
 * Returns the final process exit code.
 */
// Long-running watch loop: config + plugin runtime + initial scan +
// debounced batch handler + signal handlers. Branching is intrinsic to
// the loop's lifecycle (first-scan vs follow-up scan, JSON vs human
// render, error recovery). The handler bodies use injected helpers.
// eslint-disable-next-line complexity
export async function runWatchLoop(opts: IRunWatchOptions): Promise<number> {
  const { context } = opts;
  const runtimeCtx = defaultRuntimeContext();
  const { cwd } = runtimeCtx;

  const loadEffectiveConfig = (): ReturnType<typeof loadConfig>['effective'] =>
    loadConfig({ scope: 'project', strict: opts.strict, ...runtimeCtx }).effective;

  const buildCurrentIgnoreFilter = (cfgIn: ReturnType<typeof loadEffectiveConfig>): IIgnoreFilter => {
    const text = readIgnoreFileText(cwd);
    const filterOpts: Parameters<typeof buildIgnoreFilter>[0] = {};
    if (cfgIn.ignore.length > 0) filterOpts.configIgnore = cfgIn.ignore;
    if (text !== undefined) filterOpts.ignoreFileText = text;
    return buildIgnoreFilter(filterOpts);
  };

  // Both `cfg`, `ignoreFilter` and `strict` are mutable so the meta-file
  // watcher (added below) can swap them after a `.skillmapignore` /
  // `.skill-map/settings.json` edit. Three downstream readers pick up
  // the new values automatically:
  //   1. The primary chokidar `ignored` predicate (via the getter passed
  //      to `createChokidarWatcher`) — re-evaluated per FS event, so new
  //      patterns take effect on the very next event.
  //   2. `runOnePass` reads `ignoreFilter` and `strict` from this scope
  //      on every batch — so the next scan after a meta-file edit picks
  //      up the new ignore patterns and strict-mode change.
  //   3. The meta-file watcher itself triggers a fresh batch right after
  //      a rebuild, so the DB reflects the change without waiting for an
  //      unrelated FS event to nudge the watcher.
  // `debounceMs` is captured by value at boot — changing
  // `scan.watch.debounceMs` requires restarting the watcher.
  let cfg: ReturnType<typeof loadEffectiveConfig>;
  try {
    cfg = loadEffectiveConfig();
  } catch (err) {
    const message = formatErrorMessage(err);
    context.stderr.write(tx(WATCH_TEXTS.configLoadFailure, { message }));
    return ExitCode.Error;
  }

  let ignoreFilter = buildCurrentIgnoreFilter(cfg);
  let strict = opts.strict || cfg.scan.strict === true;
  const debounceMs = cfg.scan.watch.debounceMs;
  const dbPath = defaultProjectDbPath(runtimeCtx);

  // Plugin discovery once at startup. Per-batch reuse avoids re-scanning
  // the plugins directory on every FS event; a hot reload of plugin code
  // requires restarting the watcher (Step 9.1; reload-on-change can be
  // a future polish if it shows up in real workflows).
  const pluginRuntime = opts.noPlugins
    ? emptyPluginRuntime()
    : await loadPluginRuntime({ scope: 'project' });
  for (const warn of pluginRuntime.warnings) {
    context.stderr.write(`${warn}\n`);
  }

  // One scan pass with cache reuse + persist + render. Branching is
  // intrinsic to the watcher's per-batch lifecycle.
  // eslint-disable-next-line complexity
  const runOnePass = async (): Promise<void> => {
    const kernel = createKernel();
    const enabledBuiltIns = filterBuiltInManifests(listBuiltIns(), pluginRuntime.resolveEnabled);
    for (const manifest of enabledBuiltIns) kernel.registry.register(manifest);
    for (const manifest of pluginRuntime.manifests) kernel.registry.register(manifest);

    // Read prior snapshot AND prior `scan_extractor_runs` in a single
    // ephemeral open. Both feed the orchestrator's incremental path —
    // splitting them into two opens would re-run migration discovery
    // for nothing.
    const priorState = await tryWithSqlite(
      { databasePath: dbPath, autoBackup: false },
      async (reader) => {
        const loaded = await reader.scans.load();
        if (loaded.nodes.length === 0) return null;
        // H6 — under `--strict`, validate the prior against
        // `scan-result.schema.json` before handing it to the
        // orchestrator. The watcher's outer try/catch (initial scan)
        // and per-batch try/catch surface the throw with their usual
        // `sm watch: ... failed — ...` framing.
        if (strict) {
          const validators = loadSchemaValidators();
          const result = validators.validate('scan-result', loaded);
          if (!result.ok) {
            throw new Error(tx(WATCH_TEXTS.priorSchemaValidationFailed, { errors: result.errors }));
          }
        }
        const extractorRuns = await reader.scans.loadExtractorRuns();
        return { snapshot: loaded, extractorRuns };
      },
    );
    const priorSnapshot = priorState?.snapshot ?? null;
    const priorExtractorRuns = priorState?.extractorRuns;

    const composed = composeScanExtensions({ noBuiltIns: false, pluginRuntime });
    const runOptions: Parameters<typeof runScanWithRenames>[1] = {
      roots: opts.roots,
      scope: 'project',
      tokenize: !opts.noTokens,
      ignoreFilter,
      strict,
      emitter: createCliProgressEmitter(context.stderr),
    };
    if (composed) runOptions.extensions = composed;
    if (priorSnapshot) {
      runOptions.priorSnapshot = priorSnapshot;
      // The watcher always wants cache reuse — re-walking unchanged
      // files on every batch defeats the point of debouncing.
      runOptions.enableCache = true;
    }
    if (priorExtractorRuns) runOptions.priorExtractorRuns = priorExtractorRuns;

    // Errors propagate to the caller (initial-scan path or per-batch
    // handler) so the breaker can count them. Swallowing here would
    // hide a permanent failure under the per-batch "batch failed" line
    // forever.
    const ran = await runScanWithRenames(kernel, runOptions);
    const { result, renameOps, extractorRuns, enrichments } = ran;

    await withSqlite({ databasePath: dbPath }, (writer) =>
      writer.scans.persist(result, { renameOps, extractorRuns, enrichments }),
    );

    if (opts.json) {
      context.stdout.write(JSON.stringify(result) + '\n');
    } else {
      context.stdout.write(
        tx(WATCH_TEXTS.scannedSummary, {
          nodes: result.stats.nodesCount,
          links: result.stats.linksCount,
          issues: result.stats.issuesCount,
          durationMs: result.stats.durationMs,
        }),
      );
    }
  };

  // 1. Initial scan so the DB matches current FS before we subscribe.
  if (!opts.json) {
    context.stderr.write(tx(WATCH_TEXTS.starting, { rootsCount: opts.roots.length, debounceMs }));
  }
  try {
    await runOnePass();
  } catch (err) {
    const message = formatErrorMessage(err);
    context.stderr.write(tx(WATCH_TEXTS.initialScanFailed, { message }));
    return ExitCode.Error;
  }

  // 2. Subscribe.
  let batchCount = 0;
  let stopRequested = false;
  let stopResolve: (() => void) | null = null;
  const stopped = new Promise<void>((r) => {
    stopResolve = r;
  });

  // Circuit breaker — N consecutive batch failures trigger a graceful
  // shutdown with exit 2. A successful batch resets the counter; a
  // value of 0 disables the breaker (log-and-continue forever).
  const breakerLimit = opts.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;
  let consecutiveFailures = 0;
  let exitCode: number = ExitCode.Ok;

  const handleBatch = async (): Promise<'continue' | 'stop'> => {
    if (stopRequested) return 'stop';
    batchCount++;
    try {
      await runOnePass();
      consecutiveFailures = 0;
    } catch (err) {
      const message = formatErrorMessage(err);
      context.stderr.write(tx(WATCH_TEXTS.batchFailed, { message }));
      consecutiveFailures += 1;
      if (breakerLimit > 0 && consecutiveFailures >= breakerLimit) {
        context.stderr.write(
          tx(WATCH_TEXTS.breakerTripped, { count: consecutiveFailures, message }),
        );
        exitCode = ExitCode.Error;
        return 'stop';
      }
    }
    if (opts.maxBatches !== undefined && batchCount >= opts.maxBatches) return 'stop';
    return 'continue';
  };

  const watcher = createChokidarWatcher({
    roots: opts.roots,
    cwd,
    debounceMs,
    // Pass a getter, NOT the filter directly: the meta-file watcher
    // below mutates `ignoreFilter` after a `.skillmapignore` /
    // `.skill-map/settings.json` edit, and chokidar's `ignored`
    // predicate must read the current value on every event.
    ignoreFilter: (): IIgnoreFilter => ignoreFilter,
    onBatch: async () => {
      const next = await handleBatch();
      if (next === 'stop') {
        stopRequested = true;
        stopResolve?.();
      }
    },
    onError: (err) => {
      context.stderr.write(tx(WATCH_TEXTS.watcherError, { message: err.message }));
    },
  });

  // Secondary watcher for the project's ignore meta-files. These sit
  // outside the primary watcher's filter (default `.skill-map/**` would
  // hide settings.json), so they get their own chokidar instance with
  // no filter. On change, rebuild the primary filter + re-read config
  // and dispatch a batch so the DB reflects the new patterns without a
  // restart. Failures here are soft — the primary watcher stays up.
  const metaWatcher = createChokidarWatcher({
    roots: [
      resolve(cwd, '.skillmapignore'),
      resolve(cwd, '.skill-map', 'settings.json'),
    ],
    cwd,
    debounceMs,
    onBatch: async () => {
      if (stopRequested) return;
      try {
        cfg = loadEffectiveConfig();
        ignoreFilter = buildCurrentIgnoreFilter(cfg);
        strict = opts.strict || cfg.scan.strict === true;
        await handleBatch();
      } catch (err) {
        const message = formatErrorMessage(err);
        context.stderr.write(tx(WATCH_TEXTS.batchFailed, { message }));
      }
    },
    onError: (err) => {
      context.stderr.write(tx(WATCH_TEXTS.watcherError, { message: err.message }));
    },
  });

  // 3. Wire SIGINT / SIGTERM. Storing the handlers so we can clear them
  // on close — important for tests that spin a watcher up and down
  // multiple times in the same process.
  const onSignal = (): void => {
    if (stopRequested) return;
    stopRequested = true;
    stopResolve?.();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  await watcher.ready;
  await metaWatcher.ready;
  if (!opts.json) {
    context.stderr.write(WATCH_TEXTS.ready);
  }

  await stopped;
  process.removeListener('SIGINT', onSignal);
  process.removeListener('SIGTERM', onSignal);
  await metaWatcher.close();
  await watcher.close();

  if (!opts.json) {
    context.stderr.write(tx(WATCH_TEXTS.stopped, { batchCount }));
  }
  return exitCode;
}

export class WatchCommand extends SmCommand {
  static override paths = [['watch']];

  static override usage = Command.Usage({
    category: 'Scan',
    description: 'Watch roots and run an incremental scan after each debounced batch of filesystem events.',
    details: `
      Long-running version of 'sm scan --changed'. Subscribes to the
      given roots via chokidar, applies the same ignore chain
      (.skillmapignore + config.ignore + bundled defaults), and
      triggers an incremental scan after each debounced batch.

      Default debounce is 300ms; configure via 'scan.watch.debounceMs'
      in .skill-map/settings.json. SIGINT / SIGTERM stop the watcher
      cleanly and exit 0.

      Under --json, every batch emits one ScanResult as ndjson on
      stdout. Without --json, every batch prints one summary line.

      'sm scan --watch' is an alias and shares the same flag surface.
    `,
    examples: [
      ['Watch the current directory', '$0 watch'],
      ['Watch multiple roots', '$0 watch ./docs ./skills'],
      ['Stream ScanResult per batch as ndjson', '$0 watch --json'],
    ],
  });

  roots = Option.Rest({ name: 'roots' });
  noTokens = Option.Boolean('--no-tokens', false, {
    description: 'Skip per-node token counts (cl100k_base BPE).',
  });
  strict = Option.Boolean('--strict', false, {
    description: 'Promote frontmatter-validation findings from warn to error inside each batch. Does not change the watcher exit code.',
  });
  noPlugins = Option.Boolean('--no-plugins', false, {
    description: 'Skip drop-in plugin discovery for the watcher session.',
  });
  maxConsecutiveFailures = Option.String('--max-consecutive-failures', {
    required: false,
    description:
      'Shut down with exit 2 after N consecutive batch failures (default 5; 0 disables the breaker).',
  });

  // Long-running verb — the watcher prints its own "stopped" line on
  // SIGINT / SIGTERM. Adding `done in <…>` after that would be noise.
  protected override emitElapsed = false;

  protected async run(): Promise<number> {
    const roots = this.roots.length > 0 ? this.roots : ['.'];
    const breaker = parseBreakerLimit(this.maxConsecutiveFailures, this.context.stderr);
    if (breaker === null) return ExitCode.Error;
    const watchOpts: IRunWatchOptions = {
      roots,
      json: this.json,
      noTokens: this.noTokens,
      strict: this.strict,
      noPlugins: this.noPlugins,
      context: this.context,
    };
    if (breaker !== undefined) watchOpts.maxConsecutiveFailures = breaker;
    return runWatchLoop(watchOpts);
  }
}

/**
 * Parse the raw `--max-consecutive-failures <n>` flag value. Returns
 * `undefined` when the flag is absent (caller falls through to the
 * default), `null` when the value is invalid (caller exits 2), or the
 * parsed non-negative integer otherwise.
 */
function parseBreakerLimit(
  raw: string | undefined,
  stderr: NodeJS.WritableStream,
): number | undefined | null {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== trimmed) {
    stderr.write(`sm watch: --max-consecutive-failures must be a non-negative integer (got ${raw})\n`);
    return null;
  }
  return parsed;
}
