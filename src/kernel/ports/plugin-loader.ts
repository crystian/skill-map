/**
 * `PluginLoaderPort` — discovers plugin directories and imports extensions.
 *
 * `PluginManifest` matches `spec/schemas/plugins-registry.schema.json#/$defs/PluginManifest`.
 * Storage modes follow the normative `oneOf`: a plugin declares either `kv`
 * (shared `state_plugin_kvs`) or `dedicated` (plugin-owned prefixed tables + SQL migrations),
 * never both. Absent = plugin does not persist state.
 *
 * Step 0b: shape-only. Drop-in discovery (`.skill-map/plugins/`,
 * `~/.skill-map/plugins/`) lands with Step 8 (plugin author UX).
 */

import type { ExtensionKind } from '../registry.js';

export type PluginStorage =
  | { mode: 'kv' }
  | { mode: 'dedicated'; tables: string[]; migrations: string[] };

export interface PluginManifest {
  id: string;
  version: string;
  specCompat: string;
  extensions: string[];
  description?: string;
  storage?: PluginStorage;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: string;
}

export interface LoadedExtension {
  kind: ExtensionKind;
  id: string;
  module: unknown;
}

export interface PluginLoaderPort {
  discover(scopes: string[]): Promise<string[]>;
  load(pluginPath: string): Promise<LoadedExtension[]>;
  validateManifest(raw: unknown): PluginManifest;
}
