/**
 * Plugin-surface types, hand-written to mirror
 * `spec/schemas/plugins-registry.schema.json#/$defs/PluginManifest` and the
 * extension-kind manifests under `spec/schemas/extensions/`.
 *
 * Per ROADMAP §DTO gap (review-pass decision): the proper emission of
 * typed DTOs from `@skill-map/spec` is deferred until Step 2, when a
 * third consumer (real adapters / detectors / rules) forces a single
 * source of truth. Until then, both `ui/src/models/` and `src/kernel/types/`
 * hand-curate their own local mirror — the risk of drift is accepted at
 * this scale (17 schemas) and flagged in the roadmap.
 */

import type { TExtensionKind } from '../adapters/schema-validators.js';

export type { TExtensionKind } from '../adapters/schema-validators.js';

/**
 * Plugin storage mode. Matches the `oneOf` in the plugin manifest schema:
 * either shared `state_plugin_kvs` (mode `kv`) or dedicated plugin-owned
 * tables with explicit migrations (mode `dedicated`). Absent = the plugin
 * does not persist state at all.
 */
export type TPluginStorage =
  | { mode: 'kv' }
  | { mode: 'dedicated'; tables: string[]; migrations: string[] };

/**
 * Toggle granularity for a plugin / built-in bundle.
 *
 * - `'bundle'`  — the plugin id is the only enable/disable key. The whole
 *                 bundle of extensions follows the toggle; the user cannot
 *                 enable some extensions of the bundle and disable others.
 *                 Default for plugins (and for the built-in `claude`
 *                 bundle, where the adapter and its kind-aware detectors
 *                 form a coherent provider).
 * - `'extension'` — each extension is independently toggle-able under its
 *                   qualified id `<plugin-id>/<extension-id>`. Used for
 *                   the built-in `core` bundle (every kernel built-in
 *                   rule / renderer / audit is removable per spec
 *                   "no extension is privileged"). Plugin authors opt in
 *                   only when the plugin ships several orthogonal
 *                   capabilities a user might reasonably want piecemeal.
 */
export type TGranularity = 'bundle' | 'extension';

/** Raw `plugin.json` shape after successful AJV validation. */
export interface IPluginManifest {
  id: string;
  version: string;
  specCompat: string;
  extensions: string[];
  description?: string;
  storage?: TPluginStorage;
  /**
   * Toggle granularity for this plugin. Default `'bundle'`. See
   * `TGranularity` for the trade-off; in practice 95% of plugins want
   * the default.
   */
  granularity?: TGranularity;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: string;
}

/**
 * Failure mode produced by the loader when a plugin cannot be loaded.
 * Matches the three states named in spec §Plugin discovery / load.
 *
 * - `incompatible-spec`: manifest parsed fine but `semver.satisfies` failed
 *   against the installed `@skill-map/spec` version.
 * - `invalid-manifest`: `plugin.json` missing, unparseable, or failing AJV.
 * - `load-error`: manifest passed but an extension module failed to import
 *   or the imported manifest failed its extension-kind schema.
 */
/**
 * Possible outcomes after the loader sees a plugin.json.
 *
 * - `loaded`              — manifest valid, specCompat satisfied, every
 *                           extension imported and validated.
 * - `disabled`            — user-toggled off via `sm plugins disable` or
 *                           `settings.json#/plugins/<id>/enabled`. Manifest
 *                           is parsed and surfaced (so `sm plugins list`
 *                           shows it), but extensions are not imported.
 * - `incompatible-spec`   — manifest parsed but `semver.satisfies` failed.
 * - `invalid-manifest`    — `plugin.json` missing, unparseable, AJV-fails,
 *                           OR the directory name does not equal the
 *                           manifest id (a cheap structural rule that
 *                           rules out same-root collisions by construction:
 *                           a filesystem cannot contain two siblings with
 *                           the same name).
 * - `load-error`          — manifest passed, an extension module failed.
 * - `id-collision`        — two plugins reachable from different roots
 *                           (project + global, or any `--plugin-dir`
 *                           combination) declared the same `id`. Both
 *                           collided plugins receive this status; no
 *                           precedence rule applies. The user resolves
 *                           by renaming one of them and rerunning.
 */
export type TPluginLoadStatus =
  | 'loaded'
  | 'disabled'
  | 'incompatible-spec'
  | 'invalid-manifest'
  | 'load-error'
  | 'id-collision';

export interface ILoadedExtension {
  kind: TExtensionKind;
  id: string;
  /**
   * Owning plugin namespace — `manifest.id` of the `plugin.json` that
   * declared this extension. Composed with `id` to form the qualified
   * registry key `<pluginId>/<id>`. Per spec § A.6 the loader injects
   * this from the manifest; an extension that hand-declares a
   * mismatching `pluginId` is rejected as `invalid-manifest`.
   */
  pluginId: string;
  version: string;
  entryPath: string;
  module: unknown;
}

export interface IDiscoveredPlugin {
  /** Absolute path to the plugin directory. */
  path: string;
  /** Plugin id — populated from the manifest if it parsed, else a path hint. */
  id: string;
  status: TPluginLoadStatus;
  /** Only present when status === 'loaded' or 'incompatible-spec'. */
  manifest?: IPluginManifest;
  /** Only present when status === 'loaded'. */
  extensions?: ILoadedExtension[];
  /**
   * Resolved granularity for this plugin. Always populated from
   * `manifest.granularity` (default `'bundle'`) when the manifest parsed;
   * absent for `invalid-manifest` paths where the manifest never validated.
   */
  granularity?: TGranularity;
  /** Human-readable diagnostic shown by `sm plugins list/show`. */
  reason?: string;
}
