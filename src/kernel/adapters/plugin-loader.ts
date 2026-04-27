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
import type { TExtensionKind } from './schema-validators.js';
import type { ISchemaValidators } from './schema-validators.js';

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
}

export class PluginLoader {
  readonly #options: IPluginLoaderOptions;

  constructor(options: IPluginLoaderOptions) {
    this.#options = options;
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
      return fail(pluginPath, pathId(pluginPath), 'invalid-manifest', describe(err));
    }

    const manifestResult = this.#options.validators.validatePluginManifest<IPluginManifest>(raw);
    if (!manifestResult.ok) {
      return fail(pluginPath, pathId(pluginPath), 'invalid-manifest', manifestResult.errors);
    }
    const manifest = manifestResult.data;

    // --- spec compat ------------------------------------------------------
    if (!semver.validRange(manifest.specCompat)) {
      return {
        ...fail(pluginPath, manifest.id, 'invalid-manifest', `specCompat not a valid semver range: ${manifest.specCompat}`),
        manifest,
      };
    }
    if (!semver.satisfies(this.#options.specVersion, manifest.specCompat, { includePrerelease: true })) {
      return {
        path: pluginPath,
        id: manifest.id,
        status: 'incompatible-spec',
        manifest,
        reason: `@skill-map/spec ${this.#options.specVersion} does not satisfy specCompat ${manifest.specCompat}`,
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
        reason: 'disabled by config_plugins or settings.json',
      };
    }

    // --- extension imports + kind validation ------------------------------
    const loaded: ILoadedExtension[] = [];
    for (const relEntry of manifest.extensions) {
      const abs = resolve(pluginPath, relEntry);
      if (!existsSync(abs)) {
        return {
          ...fail(pluginPath, manifest.id, 'load-error', `extension file not found: ${relEntry}`),
          manifest,
        };
      }

      let mod: unknown;
      try {
        mod = await import(pathToFileURL(abs).href);
      } catch (err) {
        return {
          ...fail(pluginPath, manifest.id, 'load-error', `${relEntry}: ${describe(err)}`),
          manifest,
        };
      }

      const exported = extractDefault(mod);
      if (!isRecord(exported) || typeof exported['kind'] !== 'string') {
        return {
          ...fail(pluginPath, manifest.id, 'load-error', `${relEntry}: default export missing a string 'kind' field`),
          manifest,
        };
      }

      const kind = exported['kind'] as TExtensionKind;
      if (!KNOWN_KINDS.has(kind)) {
        return {
          ...fail(pluginPath, manifest.id, 'load-error', `${relEntry}: unknown extension kind '${exported['kind']}'`),
          manifest,
        };
      }

      const extValidator = this.#options.validators.validatorForExtension(kind);
      if (!extValidator(exported)) {
        const errors = (extValidator.errors ?? [])
          .map((e) => `${e.instancePath || '(root)'} ${e.message ?? e.keyword}`)
          .join('; ');
        return {
          ...fail(pluginPath, manifest.id, 'load-error', `${relEntry}: ${errors}`),
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
