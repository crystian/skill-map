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

/** Raw `plugin.json` shape after successful AJV validation. */
export interface IPluginManifest {
  id: string;
  version: string;
  specCompat: string;
  extensions: string[];
  description?: string;
  storage?: TPluginStorage;
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
export type TPluginLoadStatus = 'loaded' | 'incompatible-spec' | 'invalid-manifest' | 'load-error';

export interface ILoadedExtension {
  kind: TExtensionKind;
  id: string;
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
  /** Human-readable diagnostic shown by `sm plugins list/show`. */
  reason?: string;
}
