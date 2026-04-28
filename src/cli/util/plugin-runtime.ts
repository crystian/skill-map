/**
 * Plugin runtime loader — single source of truth for any read-side verb
 * that needs plugin extensions on the wire (`sm scan`, `sm graph`, future
 * `sm audit run`).
 *
 * Step 9.1: this is the path that turns "discovered" plugins into
 * "executing" plugins. Until now `PluginLoader` was only invoked by the
 * `sm plugins` introspection verbs; the analysis pipeline ran on built-ins
 * exclusively. This helper closes that gap.
 *
 * Behaviour:
 *
 *   - Discover + load every plugin under the project + user search paths
 *     (or `--plugin-dir <path>` override).
 *   - Layer the enabled-resolver: settings.json baseline + DB override
 *     (config_plugins). Disabled plugins are surfaced but not run.
 *   - Bucket loaded extensions by kind into the same `IBuiltIns` shape
 *     the orchestrator already consumes. Caller merges with built-ins.
 *   - Convert failure modes into stderr-ready diagnostic strings. The
 *     kernel keeps booting on bad plugins — they never abort the verb.
 *
 * Returns the `Extension[]` manifest rows alongside the runtime instances
 * so the Registry can register them for `sm help` / `sm plugins list`
 * introspection without re-reading the manifests.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type {
  IAdapter,
  IAudit,
  IDetector,
  IRenderer,
  IRule,
} from '../../kernel/extensions/index.js';
import type { Extension } from '../../kernel/registry.js';
import { builtIns } from '../../extensions/built-ins.js';
import {
  PluginLoader,
  installedSpecVersion,
  type IPluginLoaderOptions,
} from '../../kernel/adapters/plugin-loader.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import { loadPluginOverrideMap } from '../../kernel/adapters/sqlite/plugins.js';
import { loadConfig } from '../../kernel/config/loader.js';
import { makeEnabledResolver } from '../../kernel/config/plugin-resolver.js';
import type {
  IDiscoveredPlugin,
  ILoadedExtension,
} from '../../kernel/types/plugin.js';

const PLUGINS_DIR = '.skill-map/plugins';
const DB_FILENAME = 'skill-map.db';

export interface ILoadPluginRuntimeOptions {
  /** Resolution scope. `'global'` reads `~/.skill-map/...` only. */
  scope: 'project' | 'global';
  /** Explicit override; bypasses the project + user search paths. Tests use this. */
  pluginDir?: string;
}

export interface IPluginRuntimeBundle {
  /** Bucketed runtime extensions keyed by kind, ready to merge with `builtIns()`. */
  extensions: {
    adapters: IAdapter[];
    detectors: IDetector[];
    rules: IRule[];
    renderers: IRenderer[];
    audits: IAudit[];
  };
  /** Manifest rows for the Registry. One per loaded plugin extension. */
  manifests: Extension[];
  /**
   * Stderr-ready warning lines, one per failed / incompatible plugin.
   * Already prefixed with the plugin id and status. Caller writes them
   * verbatim before doing real work. `disabled` plugins are NOT in here
   * (it's the user's intent, not a problem).
   */
  warnings: string[];
  /** Raw discovery output, for callers (`sm plugins doctor`) that need it. */
  discovered: IDiscoveredPlugin[];
}

/**
 * Discover and load every plugin reachable from the chosen scope, with
 * the layered enabled-resolver applied.
 *
 * Never throws — a bad search path or a corrupt DB row degrades to a
 * warning and an empty (or partial) bundle. The verb that calls this
 * keeps running on whatever loaded successfully.
 */
export async function loadPluginRuntime(
  opts: ILoadPluginRuntimeOptions,
): Promise<IPluginRuntimeBundle> {
  const searchPaths = resolveSearchPaths(opts);
  const validators = loadSchemaValidators();

  let resolveEnabled: ((id: string) => boolean) | undefined;
  try {
    resolveEnabled = await buildEnabledResolver(opts.scope);
  } catch {
    // Config / DB read failure here is non-fatal — fall through with
    // the loader's default ("every plugin enabled"). The actual scan
    // pipeline still runs; the user gets `sm plugins doctor` as the
    // dedicated diagnostic surface.
  }

  const loaderOpts: IPluginLoaderOptions = {
    searchPaths,
    validators,
    specVersion: installedSpecVersion(),
  };
  if (resolveEnabled) loaderOpts.resolveEnabled = resolveEnabled;
  const loader = new PluginLoader(loaderOpts);
  const discovered = await loader.discoverAndLoadAll();

  const bundle: IPluginRuntimeBundle = {
    extensions: { adapters: [], detectors: [], rules: [], renderers: [], audits: [] },
    manifests: [],
    warnings: [],
    discovered,
  };

  for (const plugin of discovered) {
    if (plugin.status === 'loaded') {
      bucketLoaded(plugin.extensions ?? [], bundle);
      continue;
    }
    if (plugin.status === 'disabled') continue;
    bundle.warnings.push(formatWarning(plugin));
  }

  return bundle;
}

/**
 * Empty bundle, the right answer for `--no-plugins` paths and any caller
 * that wants the same shape without a discovery pass. Cheaper than
 * calling `loadPluginRuntime` against an empty search path.
 */
export function emptyPluginRuntime(): IPluginRuntimeBundle {
  return {
    extensions: { adapters: [], detectors: [], rules: [], renderers: [], audits: [] },
    manifests: [],
    warnings: [],
    discovered: [],
  };
}

/**
 * Compose the `IScanExtensions` shape the orchestrator consumes. Built-ins
 * load conditionally (gated by `--no-built-ins`); plugin extensions always
 * fold in, even under `--no-built-ins` — the user wants a stripped-down
 * pipeline of "just my plugins" in that combo. To get a fully empty
 * pipeline (kernel-empty-boot) the caller passes both `--no-built-ins`
 * AND `--no-plugins`.
 *
 * Returns `undefined` when both halves are empty so the orchestrator
 * follows its zero-extension code path.
 */
export function composeScanExtensions(opts: {
  noBuiltIns: boolean;
  pluginRuntime: IPluginRuntimeBundle;
}): { adapters: IAdapter[]; detectors: IDetector[]; rules: IRule[] } | undefined {
  // Local import to avoid a circular dep — built-ins.ts already pulls
  // from kernel/extensions, and we only need it on the merge path.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const adapters: IAdapter[] = [];
  const detectors: IDetector[] = [];
  const rules: IRule[] = [];

  if (!opts.noBuiltIns) {
    const set = builtIns();
    adapters.push(...set.adapters);
    detectors.push(...set.detectors);
    rules.push(...set.rules);
  }
  adapters.push(...opts.pluginRuntime.extensions.adapters);
  detectors.push(...opts.pluginRuntime.extensions.detectors);
  rules.push(...opts.pluginRuntime.extensions.rules);

  if (adapters.length === 0 && detectors.length === 0 && rules.length === 0) {
    return undefined;
  }
  return { adapters, detectors, rules };
}

/**
 * Same idea as `composeScanExtensions` but for renderers (consumed by
 * `sm graph`). Built-ins layer first, plugin renderers after — first
 * registration wins on a `format` collision, which keeps the kernel's
 * defaults predictable when a plugin claims an existing format.
 */
export function composeRenderers(opts: {
  noBuiltIns?: boolean;
  pluginRuntime: IPluginRuntimeBundle;
}): IRenderer[] {
  const noBuiltIns = opts.noBuiltIns ?? false;
  const out: IRenderer[] = [];
  if (!noBuiltIns) out.push(...builtIns().renderers);
  out.push(...opts.pluginRuntime.extensions.renderers);
  return out;
}

/** Project + user search paths, or the explicit override. */
function resolveSearchPaths(opts: ILoadPluginRuntimeOptions): string[] {
  if (opts.pluginDir) return [resolve(opts.pluginDir)];
  const project = resolve(process.cwd(), PLUGINS_DIR);
  const user = join(homedir(), PLUGINS_DIR);
  return opts.scope === 'global' ? [user] : [project, user];
}

function dbPathForScope(scope: 'project' | 'global'): string {
  return scope === 'global'
    ? join(homedir(), '.skill-map', DB_FILENAME)
    : resolve(process.cwd(), '.skill-map', DB_FILENAME);
}

/**
 * Build the layered settings.json + DB enabled-resolver. Mirrors the
 * shape of `buildResolver` in `src/cli/commands/plugins.ts` (Step 6.6)
 * to keep the resolution policy in lock-step. Any divergence between
 * `sm plugins list` and the runtime would be a confusing UX regression.
 */
async function buildEnabledResolver(
  scope: 'project' | 'global',
): Promise<(id: string) => boolean> {
  const { effective: cfg } = loadConfig({ scope });
  const dbPath = dbPathForScope(scope);
  let dbOverrides = new Map<string, boolean>();
  if (existsSync(dbPath)) {
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    try {
      await adapter.init();
      dbOverrides = await loadPluginOverrideMap(adapter.db);
    } finally {
      await adapter.close();
    }
  }
  return makeEnabledResolver(cfg, dbOverrides);
}

/**
 * Drop a plugin's loaded extensions into the per-kind buckets. The
 * `module` field carries the imported namespace; the runtime instance
 * is its `default` export (or the namespace itself if no default —
 * matches the loader's `extractDefault` heuristic).
 */
function bucketLoaded(loaded: ILoadedExtension[], bundle: IPluginRuntimeBundle): void {
  for (const ext of loaded) {
    const instance = extractDefault(ext.module);
    if (!isExtensionInstance(instance)) continue;
    switch (ext.kind) {
      case 'adapter':
        bundle.extensions.adapters.push(instance as IAdapter);
        break;
      case 'detector':
        bundle.extensions.detectors.push(instance as IDetector);
        break;
      case 'rule':
        bundle.extensions.rules.push(instance as IRule);
        break;
      case 'renderer':
        bundle.extensions.renderers.push(instance as IRenderer);
        break;
      case 'audit':
        bundle.extensions.audits.push(instance as IAudit);
        break;
      case 'action':
        // Actions are runtime-only via the job subsystem (Step 10);
        // they don't participate in the deterministic scan pipeline,
        // so we don't bucket them here. Their manifests still surface
        // through the Registry below for `sm actions list`.
        break;
    }
    bundle.manifests.push({
      id: ext.id,
      kind: ext.kind,
      version: ext.version,
      ...(ext.entryPath ? { entry: ext.entryPath } : {}),
    });
  }
}

function extractDefault(mod: unknown): unknown {
  if (mod === null || typeof mod !== 'object' || Array.isArray(mod)) return mod;
  const rec = mod as Record<string, unknown>;
  return 'default' in rec ? rec['default'] : rec;
}

function isExtensionInstance(v: unknown): v is { id: string; kind: string; version: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>)['id'] === 'string' &&
    typeof (v as Record<string, unknown>)['kind'] === 'string' &&
    typeof (v as Record<string, unknown>)['version'] === 'string'
  );
}

/**
 * Render a single-line, scannable diagnostic for a non-loaded plugin.
 * Format: `plugin <id>: <status> — <reason>`. The status name doubles
 * as the failure category so a user can grep `incompatible-spec` /
 * `invalid-manifest` / `load-error` and see the full context.
 */
function formatWarning(plugin: IDiscoveredPlugin): string {
  const reason = plugin.reason ?? '(no reason recorded)';
  return `plugin ${plugin.id}: ${plugin.status} — ${reason}`;
}
