/**
 * `PluginLoaderPort` — discovers plugin directories and imports extensions.
 *
 * Step 0b: shape-only. Drop-in discovery (`.skill-map/plugins/`,
 * `~/.skill-map/plugins/`) lands with Step 8 (plugin author UX).
 */

import type { ExtensionKind } from '../registry.js';

export interface PluginManifest {
  id: string;
  version: string;
  specCompat: string;
  entries: Array<{ kind: ExtensionKind; module: string }>;
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
