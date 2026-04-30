/**
 * Base manifest shape shared by every extension kind. Mirrors
 * `spec/schemas/extensions/base.schema.json` at the TypeScript level.
 *
 * Spec § A.6 — every extension is identified in the registry by the
 * qualified id `<pluginId>/<id>`. The `pluginId` field is required at the
 * runtime / TS level: built-ins declare it directly in
 * `src/extensions/built-ins.ts`; user plugins have it injected by the
 * `PluginLoader` from `plugin.json#/id` before the extension reaches the
 * registry. A plugin author who hand-codes a `pluginId` that disagrees
 * with the manifest's `id` is rejected as `invalid-manifest`.
 *
 * The JSON Schema deliberately does NOT model `pluginId` — the qualifier
 * is a runtime concern composed by the loader, not a manifest field
 * authors are expected to set. Stripping it before AJV validation in
 * the loader keeps the spec contract clean ("authors declare only the
 * short id").
 */

import type { Stability } from '../types.js';

export interface IExtensionBase {
  id: string;
  /**
   * Owning plugin namespace. Composed with `id` to produce the
   * qualified registry key `<pluginId>/<id>`. Built-ins declare this
   * directly; user plugins have it injected by the `PluginLoader`
   * from `plugin.json#/id`.
   */
  pluginId: string;
  version: string;
  description?: string;
  stability?: Stability;
  preconditions?: string[];
  entry?: string;
}
