/**
 * `PluginLoaderPort` — discovers plugin directories and loads their
 * extensions. The shape mirrors what the concrete loader actually
 * exposes (see `kernel/adapters/plugin-loader.ts`); the port exists so
 * the CLI consumes the abstract contract via `createPluginLoader(...)`
 * instead of `new PluginLoader(...)` and so the concrete adapter is
 * structurally pinned to the port (`implements PluginLoaderPort` makes
 * any drift a compile error).
 *
 * Domain types (`IPluginManifest`, `ILoadedExtension`, `IDiscoveredPlugin`,
 * `TPluginStorage`, `TPluginLoadStatus`, `TGranularity`) live in
 * `kernel/types/plugin.ts` because they are spec-mirroring DTOs, not
 * port-shape types. The port re-exports them for callers that import
 * from the ports barrel.
 */

import type {
  IDiscoveredPlugin,
  ILoadedExtension,
  IPluginManifest,
  IPluginStorageSchema,
  TGranularity,
  TPluginLoadStatus,
  TPluginStorage,
} from '../types/plugin.js';

export type {
  IDiscoveredPlugin,
  ILoadedExtension,
  IPluginManifest,
  IPluginStorageSchema,
  TGranularity,
  TPluginLoadStatus,
  TPluginStorage,
};

export interface PluginLoaderPort {
  /**
   * Synchronously enumerate every directory containing a `plugin.json`
   * across the configured search paths. Non-existent paths are skipped.
   */
  discoverPaths(): string[];

  /**
   * Discover every plugin, attempt to load each, then apply the
   * cross-root id-collision pass. Never throws — failures are reported
   * via `IDiscoveredPlugin.status`.
   */
  discoverAndLoadAll(): Promise<IDiscoveredPlugin[]>;

  /**
   * Load a single plugin from its directory. Never throws — failure is
   * reported via the returned `status`.
   */
  loadOne(pluginPath: string): Promise<IDiscoveredPlugin>;
}
