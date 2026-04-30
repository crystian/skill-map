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
import { listBuiltIns } from '../../extensions/built-ins.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { persistScanResult } from '../../kernel/adapters/sqlite/scan-persistence.js';
import { loadExtractorRuns, loadScanResult } from '../../kernel/adapters/sqlite/scan-load.js';
import { loadConfig } from '../../kernel/config/loader.js';
import { buildIgnoreFilter, readIgnoreFileText } from '../../kernel/scan/ignore.js';
import { tx } from '../../kernel/util/tx.js';
import { WATCH_TEXTS } from '../i18n/watch.texts.js';
import { createCliProgressEmitter } from '../util/cli-progress-emitter.js';
import { ExitCode } from '../util/exit-codes.js';
import {
  composeScanExtensions,
  emptyPluginRuntime,
  filterBuiltInManifests,
  loadPluginRuntime,
} from '../util/plugin-runtime.js';
import { tryWithSqlite, withSqlite } from '../util/with-sqlite.js';

const DEFAULT_PROJECT_DB = '.skill-map/skill-map.db';

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
}

/**
 * Shared implementation behind `sm watch` and `sm scan --watch`.
 * Returns the final process exit code.
 */
export async function runWatchLoop(opts: IRunWatchOptions): Promise<number> {
  const { context } = opts;
  const cwd = process.cwd();

  let cfg;
  try {
    cfg = loadConfig({ scope: 'project', strict: opts.strict }).effective;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    context.stderr.write(tx(WATCH_TEXTS.configLoadFailure, { message }));
    return ExitCode.Error;
  }

  const ignoreFileText = readIgnoreFileText(cwd);
  const ignoreFilterOpts: Parameters<typeof buildIgnoreFilter>[0] = {};
  if (cfg.ignore.length > 0) ignoreFilterOpts.configIgnore = cfg.ignore;
  if (ignoreFileText !== undefined) ignoreFilterOpts.ignoreFileText = ignoreFileText;
  const ignoreFilter = buildIgnoreFilter(ignoreFilterOpts);

  const strict = opts.strict || cfg.scan.strict === true;
  const debounceMs = cfg.scan.watch.debounceMs;
  const dbPath = resolve(cwd, DEFAULT_PROJECT_DB);

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
        const loaded = await loadScanResult(reader.db);
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
        const extractorRuns = await loadExtractorRuns(reader.db);
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

    let result: ScanResult;
    let renameOps: RenameOp[];
    let extractorRuns: IExtractorRunRecord[];
    let enrichments: IEnrichmentRecord[];
    try {
      const ran = await runScanWithRenames(kernel, runOptions);
      result = ran.result;
      renameOps = ran.renameOps;
      extractorRuns = ran.extractorRuns;
      enrichments = ran.enrichments;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      context.stderr.write(tx(WATCH_TEXTS.scanFailed, { message }));
      return;
    }

    await withSqlite({ databasePath: dbPath }, (writer) =>
      persistScanResult(writer.db, result, renameOps, extractorRuns, enrichments),
    );

    if (opts.json) {
      context.stdout.write(JSON.stringify(result) + '\n');
    } else {
      context.stdout.write(
        `scanned ${result.stats.nodesCount} nodes / ${result.stats.linksCount} links / ` +
          `${result.stats.issuesCount} issues in ${result.stats.durationMs}ms\n`,
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
    const message = err instanceof Error ? err.message : String(err);
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

  const watcher = createChokidarWatcher({
    roots: opts.roots,
    cwd,
    debounceMs,
    ignoreFilter,
    onBatch: async () => {
      if (stopRequested) return;
      batchCount++;
      try {
        await runOnePass();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        context.stderr.write(tx(WATCH_TEXTS.batchFailed, { message }));
      }
      if (opts.maxBatches !== undefined && batchCount >= opts.maxBatches) {
        stopRequested = true;
        stopResolve?.();
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
  if (!opts.json) {
    context.stderr.write(WATCH_TEXTS.ready);
  }

  await stopped;
  process.removeListener('SIGINT', onSignal);
  process.removeListener('SIGTERM', onSignal);
  await watcher.close();

  if (!opts.json) {
    context.stderr.write(tx(WATCH_TEXTS.stopped, { batchCount }));
  }
  return ExitCode.Ok;
}

export class WatchCommand extends Command {
  static override paths = [['watch']];

  static override usage = Command.Usage({
    category: 'Scan',
    description: 'Watch roots and run an incremental scan after each debounced batch of filesystem events.',
    details: `
      Long-running version of 'sm scan --changed'. Subscribes to the
      given roots via chokidar, applies the same ignore chain
      (.skill-mapignore + config.ignore + bundled defaults), and
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
  json = Option.Boolean('--json', false, {
    description: 'Emit one ScanResult document per batch as ndjson on stdout.',
  });
  noTokens = Option.Boolean('--no-tokens', false, {
    description: 'Skip per-node token counts (cl100k_base BPE).',
  });
  strict = Option.Boolean('--strict', false, {
    description: 'Promote frontmatter-validation findings from warn to error inside each batch. Does not change the watcher exit code.',
  });
  noPlugins = Option.Boolean('--no-plugins', false, {
    description: 'Skip drop-in plugin discovery for the watcher session.',
  });

  async execute(): Promise<number> {
    const roots = this.roots.length > 0 ? this.roots : ['.'];
    return runWatchLoop({
      roots,
      json: this.json,
      noTokens: this.noTokens,
      strict: this.strict,
      noPlugins: this.noPlugins,
      context: this.context,
    });
  }
}
