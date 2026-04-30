/**
 * Plugin runtime loader — single source of truth for any read-side verb
 * that needs plugin extensions on the wire (`sm scan`, `sm graph`).
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

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type {
  IProvider,
  IExtractor,
  IFormatter,
  IRule,
} from '../../kernel/extensions/index.js';
import type { Extension } from '../../kernel/registry.js';
import {
  builtInBundles,
  type IBuiltInBundle,
  type TBuiltInExtension,
} from '../../extensions/built-ins.js';
import {
  PluginLoader,
  installedSpecVersion,
  type IPluginLoaderOptions,
} from '../../kernel/adapters/plugin-loader.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { loadPluginOverrideMap } from '../../kernel/adapters/sqlite/plugins.js';
import { loadConfig } from '../../kernel/config/loader.js';
import { makeEnabledResolver } from '../../kernel/config/plugin-resolver.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import type {
  IDiscoveredPlugin,
  ILoadedExtension,
} from '../../kernel/types/plugin.js';
import { tryWithSqlite } from './with-sqlite.js';

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
    providers: IProvider[];
    extractors: IExtractor[];
    rules: IRule[];
    formatters: IFormatter[];
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
  /**
   * Resolver used to layer `config_plugins` (DB) over `settings.json`.
   * Surfaced so call sites that compose built-ins (`composeScanExtensions`,
   * `composeFormatters`) can apply the same precedence to the
   * `core/<ext-id>` keys without rebuilding the resolver. Returns `true`
   * for any id that has no explicit override (the default-enabled
   * fall-back). Always populated — `emptyPluginRuntime()` returns a
   * resolver that says everything is enabled.
   */
  resolveEnabled: (id: string) => boolean;
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
    extensions: { providers: [], extractors: [], rules: [], formatters: [] },
    manifests: [],
    warnings: [],
    discovered,
    resolveEnabled: resolveEnabled ?? defaultResolveEnabled,
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
    extensions: { providers: [], extractors: [], rules: [], formatters: [] },
    manifests: [],
    warnings: [],
    discovered: [],
    resolveEnabled: defaultResolveEnabled,
  };
}

/** Default-enabled fall-back: every id is enabled when no overrides exist. */
function defaultResolveEnabled(_id: string): boolean {
  return true;
}

/**
 * Granularity-aware filter for built-in bundles. Honours the spec
 * promise that "no extension is privileged" — every built-in is
 * removable via `config_plugins` / `settings.json`.
 *
 * Resolution rules (mirror `kernel/config/plugin-resolver.ts`):
 *
 *   - bundle granularity (`claude`): the user toggles the namespace
 *     once; the lookup key is `<bundle.id>` — every extension in the
 *     bundle follows. A user-set DB / settings entry under
 *     `<bundle.id>/<ext.id>` is silently ignored (the granularity says
 *     "this bundle is one knob"); the validation that catches that as
 *     a CLI input error happens upstream in `sm plugins enable/disable`.
 *   - extension granularity (`core`): the lookup key is the qualified
 *     id `<bundle.id>/<ext.id>`. Each extension is independently
 *     toggle-able.
 *
 * Defaults to `true` for any id without an explicit override.
 */
export function isBuiltInExtensionEnabled(
  bundle: IBuiltInBundle,
  ext: TBuiltInExtension,
  resolveEnabled: (id: string) => boolean,
): boolean {
  if (bundle.granularity === 'bundle') {
    return resolveEnabled(bundle.id);
  }
  return resolveEnabled(qualifiedExtensionId(bundle.id, ext.id));
}

/**
 * Compose the `IScanExtensions` shape the orchestrator consumes. Built-ins
 * load conditionally (gated by `--no-built-ins`); plugin extensions always
 * fold in, even under `--no-built-ins` — the user wants a stripped-down
 * pipeline of "just my plugins" in that combo. To get a fully empty
 * pipeline (kernel-empty-boot) the caller passes both `--no-built-ins`
 * AND `--no-plugins`.
 *
 * Built-ins are also gated by `pluginRuntime.resolveEnabled`: a user that
 * disables `claude` (bundle granularity) drops the four Claude
 * extensions; a user that disables `core/superseded` (extension
 * granularity) drops only that rule. `--no-built-ins` is the macro
 * override that wins when both layers say "skip".
 *
 * Returns `undefined` when both halves are empty so the orchestrator
 * follows its zero-extension code path.
 */
export function composeScanExtensions(opts: {
  noBuiltIns: boolean;
  pluginRuntime: IPluginRuntimeBundle;
}): { providers: IProvider[]; extractors: IExtractor[]; rules: IRule[] } | undefined {
  const providers: IProvider[] = [];
  const extractors: IExtractor[] = [];
  const rules: IRule[] = [];

  if (!opts.noBuiltIns) {
    for (const bundle of builtInBundles) {
      for (const ext of bundle.extensions) {
        if (!isBuiltInExtensionEnabled(bundle, ext, opts.pluginRuntime.resolveEnabled)) continue;
        switch (ext.kind) {
          case 'provider':
            providers.push(ext);
            break;
          case 'extractor':
            extractors.push(ext);
            break;
          case 'rule':
            rules.push(ext);
            break;
          // formatters are not consumed by scan; skipped silently.
          default:
            break;
        }
      }
    }
  }
  providers.push(...opts.pluginRuntime.extensions.providers);
  extractors.push(...opts.pluginRuntime.extensions.extractors);
  rules.push(...opts.pluginRuntime.extensions.rules);

  if (providers.length === 0 && extractors.length === 0 && rules.length === 0) {
    return undefined;
  }
  return { providers, extractors, rules };
}

/**
 * Same idea as `composeScanExtensions` but for formatters (consumed by
 * `sm graph`). Built-ins layer first, plugin formatters after — first
 * registration wins on a `formatId` collision, which keeps the kernel's
 * defaults predictable when a plugin claims an existing format. Built-in
 * formatters respect the same granularity filter as scan-side built-ins.
 */
export function composeFormatters(opts: {
  noBuiltIns?: boolean;
  pluginRuntime: IPluginRuntimeBundle;
}): IFormatter[] {
  const noBuiltIns = opts.noBuiltIns ?? false;
  const out: IFormatter[] = [];
  if (!noBuiltIns) {
    for (const bundle of builtInBundles) {
      for (const ext of bundle.extensions) {
        if (ext.kind !== 'formatter') continue;
        if (!isBuiltInExtensionEnabled(bundle, ext, opts.pluginRuntime.resolveEnabled)) continue;
        out.push(ext);
      }
    }
  }
  out.push(...opts.pluginRuntime.extensions.formatters);
  return out;
}

/**
 * Granularity-aware filter for built-in registry rows. Used by call
 * sites (scan / scan-compare / watch) that register built-in manifests
 * via `listBuiltIns()` BEFORE the orchestrator runs — without this
 * filter a user-disabled built-in would appear in `sm help` /
 * `sm plugins list` as if it were live, contradicting the granularity
 * model.
 */
export function filterBuiltInManifests(
  manifests: Extension[],
  resolveEnabled: (id: string) => boolean,
): Extension[] {
  // Build a per-bundle index so the filter respects whichever granularity
  // each built-in row's owning bundle declared. The index is rebuilt
  // every call (cheap — two bundles, eleven extensions).
  const bundleByPluginId = new Map<string, IBuiltInBundle>();
  for (const bundle of builtInBundles) bundleByPluginId.set(bundle.id, bundle);

  return manifests.filter((m) => {
    const bundle = bundleByPluginId.get(m.pluginId);
    if (!bundle) return true; // not a built-in row — leave it alone.
    if (bundle.granularity === 'bundle') return resolveEnabled(bundle.id);
    return resolveEnabled(qualifiedExtensionId(bundle.id, m.id));
  });
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
  const dbOverrides =
    (await tryWithSqlite(
      { databasePath: dbPath, autoBackup: false },
      (adapter) => loadPluginOverrideMap(adapter.db),
    )) ?? new Map<string, boolean>();
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
    // Spec § A.6 — inject the qualified namespace into the runtime
    // instance so the orchestrator and any consumer that reads
    // `extension.pluginId` (e.g. `sm plugins list`, registry lookups)
    // gets the same value the loader resolved from `plugin.json#/id`.
    // The instance is a fresh object the kernel owns; mutating it in
    // place is safe (the `module` namespace export is frozen by Node,
    // but the default export object is not).
    (instance as Record<string, unknown>)['pluginId'] = ext.pluginId;
    switch (ext.kind) {
      case 'provider':
        bundle.extensions.providers.push(instance as IProvider);
        break;
      case 'extractor':
        bundle.extensions.extractors.push(instance as IExtractor);
        break;
      case 'rule':
        bundle.extensions.rules.push(instance as IRule);
        break;
      case 'formatter':
        bundle.extensions.formatters.push(instance as IFormatter);
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
      pluginId: ext.pluginId,
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
