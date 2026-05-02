/**
 * Kernel-thin runner for `sm scan`. Owns the wiring chain — plugin
 * runtime, config + ignore filter, prior-snapshot load, single
 * `withSqlite` open for persist, dry-run / non-persist branch — and
 * surfaces a discriminated `IScanRunResult` the caller renders.
 *
 * Pulled out of `cli/commands/scan.ts:run()` so the orchestrator
 * shrinks to flag parsing → runner invocation → render → exit code,
 * mirroring what `runWatchLoop` does for the watch verb.
 */

import { createKernel, runScan, runScanWithRenames } from '../../kernel/index.js';
import type {
  IEnrichmentRecord,
  IExtractorRunRecord,
  RenameOp,
  ScanResult,
} from '../../kernel/index.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { listBuiltIns } from '../../built-in-plugins/built-ins.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import { loadConfig } from '../../kernel/config/loader.js';
import { buildIgnoreFilter, readIgnoreFileText } from '../../kernel/scan/ignore.js';
import { tx } from '../../kernel/util/tx.js';
import { SCAN_TEXTS } from '../i18n/scan.texts.js';
import { createCliProgressEmitter } from './cli-progress-emitter.js';
import { defaultProjectDbPath } from './db-path.js';
import { formatErrorMessage } from './error-reporter.js';
import { defaultRuntimeContext, type IRuntimeContext } from './runtime-context.js';
import {
  composeScanExtensions,
  emptyPluginRuntime,
  filterBuiltInManifests,
  loadPluginRuntime,
} from './plugin-runtime.js';
import { tryWithSqlite, withSqlite } from './with-sqlite.js';

export interface IScanRunOpts {
  roots: string[];
  noBuiltIns: boolean;
  noPlugins: boolean;
  noTokens: boolean;
  dryRun: boolean;
  changed: boolean;
  allowEmpty: boolean;
  strict: boolean;
  /** Streams used for plugin-warnings / progress / "changed but no prior" advisory. */
  stderr: NodeJS.WritableStream;
  /** Optional injected runtime context for tests (defaults to `defaultRuntimeContext()`). */
  ctx?: IRuntimeContext;
}

/**
 * Outcome of a scan invocation. The success kind carries the strict
 * flag so the caller knows whether to self-validate the result before
 * emitting `--json` (only `strict` runs do).
 */
export type IScanRunResult =
  | {
      kind: 'ok';
      result: ScanResult;
      renameOps: RenameOp[];
      persistedTo: string | null;
      dbPath: string;
      strict: boolean;
    }
  | { kind: 'config-error'; message: string }
  | { kind: 'scan-error'; message: string }
  | { kind: 'guard-trip'; existing: number };

/**
 * Drive the full `sm scan` pipeline against the given options bag.
 * Returns one of `IScanRunResult` — the caller renders human / JSON
 * output and maps the kind to an `ExitCode`.
 */
export async function runScanForCommand(opts: IScanRunOpts): Promise<IScanRunResult> {
  const ctx = opts.ctx ?? defaultRuntimeContext();
  const dbPath = defaultProjectDbPath(ctx);

  const kernel = createKernel();
  const pluginRuntime = await preparePluginRuntime(opts);
  const extensions = registerExtensions(kernel, pluginRuntime, opts);

  let cfg;
  try {
    cfg = loadConfig({ scope: 'project', strict: opts.strict, ...ctx }).effective;
  } catch (err) {
    return { kind: 'config-error', message: formatErrorMessage(err) };
  }
  const ignoreFilter = buildScanIgnoreFilter(cfg, ctx.cwd);
  const strict = opts.strict || cfg.scan.strict === true;

  const loadPrior = makePriorLoader(opts.noBuiltIns, strict);
  const runScanWith = makeScanRunner(kernel, opts, ignoreFilter, strict, extensions);

  const willPersist = !opts.noBuiltIns && !opts.dryRun;
  return willPersist
    ? runPersistPath(opts, dbPath, strict, loadPrior, runScanWith)
    : runEphemeralPath(opts, dbPath, strict, loadPrior, runScanWith);
}

/**
 * Discovery + warnings emission. `--no-plugins` short-circuits to an
 * empty bundle (no DB / config reads, no FS walk under
 * `.skill-map/plugins/`).
 */
async function preparePluginRuntime(opts: IScanRunOpts) {
  const pluginRuntime = opts.noPlugins
    ? emptyPluginRuntime()
    : await loadPluginRuntime({ scope: 'project' });
  for (const warn of pluginRuntime.warnings) opts.stderr.write(`${warn}\n`);
  return pluginRuntime;
}

/**
 * Register manifests on the kernel registry and return the composed
 * extension set the runner threads into `runScanWithRenames`.
 * Granularity filter: a user-disabled built-in is silenced from the
 * registry too so introspection (`sm help`, `sm plugins list`) does
 * not advertise it as active.
 */
function registerExtensions(
  kernel: ReturnType<typeof createKernel>,
  pluginRuntime: Awaited<ReturnType<typeof preparePluginRuntime>>,
  opts: IScanRunOpts,
): ReturnType<typeof composeScanExtensions> {
  const extensions = composeScanExtensions({
    noBuiltIns: opts.noBuiltIns,
    pluginRuntime,
  });
  if (!opts.noBuiltIns) {
    const enabledBuiltIns = filterBuiltInManifests(listBuiltIns(), pluginRuntime.resolveEnabled);
    for (const manifest of enabledBuiltIns) kernel.registry.register(manifest);
  }
  for (const manifest of pluginRuntime.manifests) kernel.registry.register(manifest);
  return extensions;
}

/** Compose the scan-time ignore filter from config + `.skill-mapignore`. */
function buildScanIgnoreFilter(
  cfg: ReturnType<typeof loadConfig>['effective'],
  cwd: string,
): ReturnType<typeof buildIgnoreFilter> {
  const ignoreFileText = readIgnoreFileText(cwd);
  const ignoreFilterOpts: Parameters<typeof buildIgnoreFilter>[0] = {};
  if (cfg.ignore.length > 0) ignoreFilterOpts.configIgnore = cfg.ignore;
  if (ignoreFileText !== undefined) ignoreFilterOpts.ignoreFileText = ignoreFileText;
  return buildIgnoreFilter(ignoreFilterOpts);
}

/**
 * Build the per-scope prior loader. Hydrates the DB-resident prior
 * `ScanResult`; under `--strict` validates it against
 * `scan-result.schema.json` so a corrupt-on-disk prior never reaches
 * the rename heuristic.
 */
function makePriorLoader(
  noBuiltIns: boolean,
  strict: boolean,
): (adapter: StoragePort) => Promise<ScanResult | null> {
  return async (adapter) => {
    if (noBuiltIns) return null;
    const loaded = await adapter.scans.load();
    if (loaded.nodes.length === 0) return null;
    if (strict) {
      const validators = loadSchemaValidators();
      const result = validators.validate('scan-result', loaded);
      if (!result.ok) {
        throw new Error(tx(SCAN_TEXTS.priorSchemaValidationFailed, { errors: result.errors }));
      }
    }
    return loaded;
  };
}

/**
 * Build the closure that invokes `runScanWithRenames` with the wired
 * options (extensions, ignore filter, prior, optional Phase-4
 * extractor cache). Used by both the persist and ephemeral branches.
 */
function makeScanRunner(
  kernel: ReturnType<typeof createKernel>,
  opts: IScanRunOpts,
  ignoreFilter: ReturnType<typeof buildIgnoreFilter>,
  strict: boolean,
  extensions: ReturnType<typeof composeScanExtensions>,
) {
  return async (
    prior: ScanResult | null,
    priorExtractorRuns?: Map<string, Map<string, string>>,
  ): Promise<{
    result: ScanResult;
    renameOps: RenameOp[];
    extractorRuns: IExtractorRunRecord[];
    enrichments: IEnrichmentRecord[];
  }> => {
    if (opts.changed && prior === null) {
      opts.stderr.write(SCAN_TEXTS.changedNoPriorWarning);
    }
    const runOptions: Parameters<typeof runScan>[1] = {
      roots: opts.roots,
      // Hardcoded `'project'`: spec § Global flags lists `-g/--global`
      // as universal, but the per-verb § Scan table does not list it
      // and the semantics of "scan global" are undefined. The
      // ScanCommand surface accepts `-g` (inherited from SmCommand)
      // but ignores it here. Wire to `opts.scope` once spec defines
      // the contract.
      scope: 'project',
      tokenize: !opts.noTokens,
      ignoreFilter,
      strict,
      emitter: createCliProgressEmitter(opts.stderr),
    };
    if (extensions) runOptions.extensions = extensions;
    if (prior) {
      runOptions.priorSnapshot = prior;
      runOptions.enableCache = opts.changed;
    }
    if (priorExtractorRuns) runOptions.priorExtractorRuns = priorExtractorRuns;
    return runScanWithRenames(kernel, runOptions);
  };
}

/**
 * Persist branch — single `withSqlite` open: read prior, scan, guard,
 * persist. The guard refuses to wipe a populated DB with a zero-result
 * scan unless `--allow-empty` is set.
 */
async function runPersistPath(
  opts: IScanRunOpts,
  dbPath: string,
  strict: boolean,
  loadPrior: (adapter: StoragePort) => Promise<ScanResult | null>,
  runScanWith: (
    prior: ScanResult | null,
    priorExtractorRuns?: Map<string, Map<string, string>>,
  ) => Promise<{
    result: ScanResult;
    renameOps: RenameOp[];
    extractorRuns: IExtractorRunRecord[];
    enrichments: IEnrichmentRecord[];
  }>,
): Promise<IScanRunResult> {
  type IPersistOutcome =
    | {
        kind: 'ok';
        result: ScanResult;
        renameOps: RenameOp[];
        extractorRuns: IExtractorRunRecord[];
        enrichments: IEnrichmentRecord[];
      }
    | { kind: 'scan-error'; message: string }
    | { kind: 'guard'; existing: number };

  let outcome: IPersistOutcome;
  try {
    outcome = await withSqlite({ databasePath: dbPath }, async (adapter) => {
      const prior = await loadPrior(adapter);
      const priorExtractorRuns =
        opts.changed && prior ? await adapter.scans.loadExtractorRuns() : undefined;
      let scanned;
      try {
        scanned = await runScanWith(prior, priorExtractorRuns);
      } catch (err) {
        return { kind: 'scan-error', message: formatErrorMessage(err) } as IPersistOutcome;
      }
      if (scanned.result.stats.nodesCount === 0 && !opts.allowEmpty) {
        const counts = await adapter.scans.countRows();
        const existing = counts.nodes + counts.links + counts.issues;
        if (existing > 0) return { kind: 'guard', existing };
      }
      await adapter.scans.persist(scanned.result, {
        renameOps: scanned.renameOps,
        extractorRuns: scanned.extractorRuns,
        enrichments: scanned.enrichments,
      });
      return { kind: 'ok', ...scanned };
    });
  } catch (err) {
    return { kind: 'scan-error', message: formatErrorMessage(err) };
  }
  if (outcome.kind === 'scan-error') return outcome;
  if (outcome.kind === 'guard') return { kind: 'guard-trip', existing: outcome.existing };
  return {
    kind: 'ok',
    result: outcome.result,
    renameOps: outcome.renameOps,
    persistedTo: dbPath,
    dbPath,
    strict,
  };
}

/**
 * Non-persist branch — ephemeral read-only open for the prior, scan in
 * memory. We do NOT auto-create the DB here; a `--dry-run` over a
 * missing scope must not provision one.
 */
async function runEphemeralPath(
  opts: IScanRunOpts,
  dbPath: string,
  strict: boolean,
  loadPrior: (adapter: StoragePort) => Promise<ScanResult | null>,
  runScanWith: (
    prior: ScanResult | null,
  ) => Promise<{
    result: ScanResult;
    renameOps: RenameOp[];
    extractorRuns: IExtractorRunRecord[];
    enrichments: IEnrichmentRecord[];
  }>,
): Promise<IScanRunResult> {
  let prior: ScanResult | null;
  try {
    prior = opts.noBuiltIns
      ? null
      : await tryWithSqlite({ databasePath: dbPath, autoBackup: false }, loadPrior);
  } catch (err) {
    return { kind: 'scan-error', message: formatErrorMessage(err) };
  }
  try {
    const scanned = await runScanWith(prior);
    return {
      kind: 'ok',
      result: scanned.result,
      renameOps: scanned.renameOps,
      persistedTo: null,
      dbPath,
      strict,
    };
  } catch (err) {
    return { kind: 'scan-error', message: formatErrorMessage(err) };
  }
}
