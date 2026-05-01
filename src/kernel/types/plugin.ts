/**
 * Plugin-surface types, hand-written to mirror
 * `spec/schemas/plugins-registry.schema.json#/$defs/PluginManifest` and the
 * extension-kind manifests under `spec/schemas/extensions/`.
 *
 * Per ROADMAP §DTO gap (review-pass decision): the proper emission of
 * typed DTOs from `@skill-map/spec` is deferred to a future iteration when a
 * third consumer (real providers / extractors / rules) forces a single
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
 *
 * Optional output-schema declarations (spec § A.12 — opt-in correctness
 * for plugin custom storage):
 *   - Mode `kv` → `schema` (single relative path). Validates the value
 *     written by `ctx.store.set(key, value)`.
 *   - Mode `dedicated` → `schemas` (per-table relative paths). Validates
 *     each row written by `ctx.store.write(table, row)` whose table has
 *     a declared schema; tables absent from the map accept any shape.
 *
 * Absent in both cases = permissive (status quo, no validation). Schema
 * load failures surface as `load-error`. `emitLink` and `enrichNode`
 * keep their universal kernel validation regardless of these fields.
 */
export type TPluginStorage =
  | { mode: 'kv'; schema?: string }
  | { mode: 'dedicated'; tables: string[]; migrations: string[]; schemas?: Record<string, string> };

/**
 * Toggle granularity for a plugin / built-in bundle.
 *
 * - `'bundle'`  — the plugin id is the only enable/disable key. The whole
 *                 bundle of extensions follows the toggle; the user cannot
 *                 enable some extensions of the bundle and disable others.
 *                 Default for plugins (and for the built-in `claude`
 *                 bundle, where the provider and its kind-aware extractors
 *                 form a coherent provider).
 * - `'extension'` — each extension is independently toggle-able under its
 *                   qualified id `<plugin-id>/<extension-id>`. Used for
 *                   the built-in `core` bundle (every kernel built-in
 *                   rule / formatter is removable per spec
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
 * Possible outcomes after the loader sees a plugin.json. Mirrors the
 * `status` enum in `spec/schemas/plugins-registry.schema.json`.
 *
 * - `enabled`             — manifest valid, specCompat satisfied, every
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
  | 'enabled'
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
  /** Raw module namespace as returned by the dynamic `import()`. */
  module: unknown;
  /**
   * Runtime extension instance ready for the registry / orchestrator —
   * the `default` export of `module` (or the module itself when no
   * default), shallow-cloned with `pluginId` injected per spec § A.6.
   *
   * The clone is essential: ESM caches the imported module, so two
   * plugins importing the same file would otherwise share a single
   * mutable instance and overwrite each other's `pluginId`. The loader
   * owns the clone so consumers (CLI, tests) never need to mutate.
   */
  instance: unknown;
}

export interface IDiscoveredPlugin {
  /** Absolute path to the plugin directory. */
  path: string;
  /** Plugin id — populated from the manifest if it parsed, else a path hint. */
  id: string;
  status: TPluginLoadStatus;
  /** Only present when status === 'enabled' or 'incompatible-spec'. */
  manifest?: IPluginManifest;
  /** Only present when status === 'enabled'. */
  extensions?: ILoadedExtension[];
  /**
   * Resolved granularity for this plugin. Always populated from
   * `manifest.granularity` (default `'bundle'`) when the manifest parsed;
   * absent for `invalid-manifest` paths where the manifest never validated.
   */
  granularity?: TGranularity;
  /**
   * Runtime-only — never persisted, never spec-modeled.
   *
   * Spec § A.12 — opt-in JSON Schema validation for plugin custom storage.
   * Populated by the loader when `manifest.storage.schemas` (Mode B) or
   * `manifest.storage.schema` (Mode A) declares schema paths the loader
   * successfully read and AJV-compiled. Consumed by the runtime store
   * wrapper to validate `ctx.store.write(table, row)` (Mode B) and
   * `ctx.store.set(key, value)` (Mode A) before persisting.
   *
   * Mode B layout — keyed by logical table name (without the
   * `plugin_<normalizedId>_` prefix), matching the manifest's `schemas`
   * map. Tables not present in the map accept any shape (permissive).
   *
   * Mode A layout — uses the sentinel key `__kv__` for the single
   * value-shape schema. The sentinel survives the runtime contract change
   * if Mode A ever grows multiple namespaces.
   *
   * Absent (`undefined`) when no schemas were declared OR when the load
   * surfaced a `load-error` (the discovered plugin keeps its failure
   * status; consumers must check `status === 'enabled'`).
   */
  storageSchemas?: Record<string, IPluginStorageSchema>;
  /** Human-readable diagnostic shown by `sm plugins list/show`. */
  reason?: string;
}

/**
 * Runtime-only — a single AJV-compiled storage schema attached to a
 * loaded plugin. The schema path (relative to the plugin directory) is
 * preserved so error messages can name the offending file. `validate`
 * is the AJV `ValidateFunction` itself: it returns `true` on shape
 * match, otherwise `false` with `validate.errors` populated. Typed
 * loosely here (no `ajv/dist/2020.js` import) to keep the shared type
 * module free of Ajv at compile time; the runtime adapter narrows.
 */
export interface IPluginStorageSchema {
  /** Plugin-relative path to the schema file (`storage.schemas[<table>]` or `storage.schema`). */
  schemaPath: string;
  /** AJV-compiled validator. `errors` is populated after a failed call. */
  validate: ((row: unknown) => boolean) & {
    errors?: { instancePath: string; message?: string; keyword: string }[] | null;
  };
}
