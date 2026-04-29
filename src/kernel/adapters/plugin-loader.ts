/**
 * `PluginLoader` — default `PluginLoaderPort` implementation.
 *
 * Responsibilities (per spec §Plugin discovery + Step 1b acceptance):
 *
 * 1. Discover plugin directories under one or more search paths, each
 *    containing a `plugin.json` at its root.
 * 2. Parse + AJV-validate the manifest against
 *    `plugins-registry.schema.json#/$defs/PluginManifest`.
 * 3. Semver-check `manifest.specCompat` against the installed
 *    `@skill-map/spec` version.
 * 4. Dynamic-import every path listed in `manifest.extensions[]`, expect a
 *    default export matching the extension-kind schema, validate it, and
 *    collect the loaded extensions.
 * 5. Surface one of three failure modes when anything fails:
 *    `invalid-manifest` / `incompatible-spec` / `load-error`. The kernel
 *    keeps booting regardless — a bad plugin cannot take the process down.
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import semver from 'semver';

import type {
  IDiscoveredPlugin,
  ILoadedExtension,
  IPluginManifest,
  TPluginLoadStatus,
} from '../types/plugin.js';
import { PLUGIN_LOADER_TEXTS } from '../i18n/plugin-loader.texts.js';
import { tx } from '../util/tx.js';
import type { TExtensionKind } from './schema-validators.js';
import type { ISchemaValidators } from './schema-validators.js';

/**
 * Default per-extension dynamic-import timeout. Generous on purpose —
 * a plugin that legitimately takes >5s to import is misbehaving (it
 * should not have heavy work at module top level), but the extra
 * headroom avoids spurious timeouts on cold disk caches and slow CI
 * runners.
 */
export const DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS = 5000;

export interface IPluginLoaderOptions {
  /** Search paths to scan for plugin directories. Non-existent paths are skipped. */
  searchPaths: string[];
  /** Required — used to validate plugin.json and each extension manifest. */
  validators: ISchemaValidators;
  /** Installed @skill-map/spec version, used for specCompat check. */
  specVersion: string;
  /**
   * When supplied, the loader calls this with every parsed plugin id
   * AFTER manifest + specCompat validation succeed. A return value of
   * `false` short-circuits the load: the plugin is reported with
   * `status: 'disabled'` and its extensions are NOT imported. Defaults
   * to "always enabled" when omitted (no DB / config integration —
   * useful for tests that assert raw discovery behaviour).
   */
  resolveEnabled?: (pluginId: string) => boolean;
  /**
   * Per-extension dynamic-import timeout in milliseconds. A plugin whose
   * top-level work (imports, side effects) exceeds this is reported as
   * `load-error` with a message naming the timeout, instead of hanging
   * the host CLI command (`sm scan`, `sm plugins list`, `sm watch`).
   * Defaults to `DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS` (5s). Tests pass a
   * smaller value to exercise the timeout path quickly.
   *
   * Note: there is no AbortSignal on `import()` in Node 24 — when the
   * timer wins, the import is abandoned (the dangling promise resolves
   * later and is GC'd) but its side effects, if any, still run. The
   * timeout protects the orchestrator from hanging, not the host
   * process from a misbehaving plugin's runtime cost.
   */
  loadTimeoutMs?: number;
}

export class PluginLoader {
  readonly #options: IPluginLoaderOptions;
  readonly #loadTimeoutMs: number;

  constructor(options: IPluginLoaderOptions) {
    this.#options = options;
    this.#loadTimeoutMs = options.loadTimeoutMs ?? DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS;
  }

  /**
   * Discover every plugin directory across the configured search paths.
   * Each direct child directory containing a `plugin.json` is considered a
   * plugin root. Non-plugin directories are silently skipped.
   */
  discoverPaths(): string[] {
    const out: string[] = [];
    for (const root of this.#options.searchPaths) {
      if (!existsSync(root)) continue;
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = join(root, entry.name);
        if (existsSync(join(candidate, 'plugin.json'))) {
          out.push(resolve(candidate));
        }
      }
    }
    return out;
  }

  /** Full pass — discover every plugin and attempt to load it. */
  async discoverAndLoadAll(): Promise<IDiscoveredPlugin[]> {
    const paths = this.discoverPaths();
    const out: IDiscoveredPlugin[] = [];
    for (const path of paths) {
      out.push(await this.loadOne(path));
    }
    return out;
  }

  /**
   * Load a single plugin from its directory. Never throws — a failure is
   * reported via the returned status.
   */
  async loadOne(pluginPath: string): Promise<IDiscoveredPlugin> {
    const manifestPath = join(pluginPath, 'plugin.json');

    // --- manifest parse + shape validation --------------------------------
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      return fail(
        pluginPath,
        pathId(pluginPath),
        'invalid-manifest',
        tx(PLUGIN_LOADER_TEXTS.invalidManifestJsonParse, {
          manifestPath,
          errDescription: describe(err),
        }),
      );
    }

    const manifestResult = this.#options.validators.validatePluginManifest<IPluginManifest>(raw);
    if (!manifestResult.ok) {
      return fail(
        pluginPath,
        pathId(pluginPath),
        'invalid-manifest',
        tx(PLUGIN_LOADER_TEXTS.invalidManifestAjv, {
          manifestPath,
          errors: manifestResult.errors,
        }),
      );
    }
    const manifest = manifestResult.data;

    // --- spec compat ------------------------------------------------------
    if (!semver.validRange(manifest.specCompat)) {
      return {
        ...fail(
          pluginPath,
          manifest.id,
          'invalid-manifest',
          tx(PLUGIN_LOADER_TEXTS.invalidSpecCompat, { specCompat: manifest.specCompat }),
        ),
        manifest,
      };
    }
    if (!semver.satisfies(this.#options.specVersion, manifest.specCompat, { includePrerelease: true })) {
      return {
        path: pluginPath,
        id: manifest.id,
        status: 'incompatible-spec',
        manifest,
        reason: tx(PLUGIN_LOADER_TEXTS.incompatibleSpec, {
          installedSpecVersion: this.#options.specVersion,
          specCompat: manifest.specCompat,
        }),
      };
    }

    // --- enabled resolution ----------------------------------------------
    // Only check after manifest + specCompat pass: a `disabled` status
    // implies "we know this plugin enough to surface it; we just chose
    // not to run it". An invalid or incompatible plugin gets its own
    // status and never reaches this branch.
    if (this.#options.resolveEnabled && !this.#options.resolveEnabled(manifest.id)) {
      return {
        path: pluginPath,
        id: manifest.id,
        status: 'disabled',
        manifest,
        reason: PLUGIN_LOADER_TEXTS.disabledByConfig,
      };
    }

    // --- extension imports + kind validation ------------------------------
    const loaded: ILoadedExtension[] = [];
    for (const relEntry of manifest.extensions) {
      const abs = resolve(pluginPath, relEntry);
      if (!existsSync(abs)) {
        return {
          ...fail(
            pluginPath,
            manifest.id,
            'load-error',
            tx(PLUGIN_LOADER_TEXTS.loadErrorFileNotFound, { relEntry, abs }),
          ),
          manifest,
        };
      }

      let mod: unknown;
      try {
        mod = await importWithTimeout(pathToFileURL(abs).href, this.#loadTimeoutMs);
      } catch (err) {
        return {
          ...fail(
            pluginPath,
            manifest.id,
            'load-error',
            tx(PLUGIN_LOADER_TEXTS.loadErrorImportFailed, {
              relEntry,
              errDescription: describe(err),
            }),
          ),
          manifest,
        };
      }

      const exported = extractDefault(mod);
      if (!isRecord(exported) || typeof exported['kind'] !== 'string') {
        return {
          ...fail(
            pluginPath,
            manifest.id,
            'load-error',
            tx(PLUGIN_LOADER_TEXTS.loadErrorMissingKind, {
              relEntry,
              knownKindsList: KNOWN_KINDS_LIST,
            }),
          ),
          manifest,
        };
      }

      const kind = exported['kind'] as TExtensionKind;
      if (!KNOWN_KINDS.has(kind)) {
        return {
          ...fail(
            pluginPath,
            manifest.id,
            'load-error',
            tx(PLUGIN_LOADER_TEXTS.loadErrorUnknownKind, {
              relEntry,
              kindReceived: String(exported['kind']),
              knownKindsList: KNOWN_KINDS_LIST,
            }),
          ),
          manifest,
        };
      }

      // The runtime export carries both manifest fields (id, kind,
      // version, kind-specific metadata) AND runtime methods (detect /
      // evaluate / render / audit / walk / parse / run). The
      // extension-kind schemas are strict (`unevaluatedProperties: false`)
      // because they describe the *manifest* shape — functions are not
      // representable in JSON Schema and would always fail the strict
      // check. Strip them before validation; the runtime methods are
      // covered by the TypeScript `IDetector` / `IRenderer` / ... interfaces
      // at the call site (the orchestrator invokes `.detect()`,
      // `.render()`, etc. and crashes loudly if absent).
      const manifestView = stripFunctions(exported);
      const extValidator = this.#options.validators.validatorForExtension(kind);
      if (!extValidator(manifestView)) {
        const errors = (extValidator.errors ?? [])
          .map((e) => `${e.instancePath || '(root)'} ${e.message ?? e.keyword}`)
          .join('; ');
        return {
          ...fail(
            pluginPath,
            manifest.id,
            'load-error',
            tx(PLUGIN_LOADER_TEXTS.loadErrorManifestInvalid, { relEntry, kind, errors }),
          ),
          manifest,
        };
      }

      loaded.push({
        kind,
        id: exported['id'] as string,
        version: exported['version'] as string,
        entryPath: abs,
        module: mod,
      });
    }

    return {
      path: pluginPath,
      id: manifest.id,
      status: 'loaded',
      manifest,
      extensions: loaded,
    };
  }
}

// --- helpers ---------------------------------------------------------------

const KNOWN_KINDS = new Set<TExtensionKind>(['adapter', 'detector', 'rule', 'action', 'audit', 'renderer']);
const KNOWN_KINDS_LIST = [...KNOWN_KINDS].join(' / ');

/**
 * Race the dynamic import against a timer. When the timer wins we throw
 * a clear timeout error — the caller turns it into a `load-error` row
 * naming the offending entry. The dangling import promise lingers in
 * Node's loader and resolves later (the result is GC'd unreferenced);
 * there is no public `import()` cancellation API in Node 24, so this
 * is the best we can do without spawning a worker thread.
 */
async function importWithTimeout(href: string, timeoutMs: number): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(tx(PLUGIN_LOADER_TEXTS.importExceededTimeout, { timeoutMs })));
    }, timeoutMs);
  });
  try {
    return await Promise.race([import(href), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fail(
  path: string,
  id: string,
  status: TPluginLoadStatus,
  reason: string,
): IDiscoveredPlugin {
  return { path, id, status, reason };
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return 'unknown error';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function extractDefault(mod: unknown): unknown {
  if (!isRecord(mod)) return mod;
  return 'default' in mod ? mod['default'] : mod;
}

/**
 * Drop function-typed properties so the resulting object is JSON-Schema-
 * validatable. Used on the runtime export before AJV gets it: an
 * extension's `detect` / `render` / etc. method is part of its TypeScript
 * contract, not its declarative manifest, and JSON Schema's
 * `unevaluatedProperties: false` posture would otherwise reject the
 * whole export. Cheap shallow copy — manifests don't nest deep.
 */
function stripFunctions(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'function') continue;
    out[k] = v;
  }
  return out;
}

/** Fall-back plugin id derived from directory name when the manifest is unreadable. */
function pathId(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] ?? p;
}

/**
 * Locate the installed `@skill-map/spec` version at runtime. Handy default
 * for `IPluginLoaderOptions.specVersion` when the caller just wants the
 * real installed version without plumbing it through.
 */
export function installedSpecVersion(): string {
  const require = createRequire(import.meta.url);
  // Spec exports index.json but not package.json; we use the former to
  // locate the package root and then read package.json off disk directly.
  const indexPath = require.resolve('@skill-map/spec/index.json');
  const pkgPath = resolve(indexPath, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
}
