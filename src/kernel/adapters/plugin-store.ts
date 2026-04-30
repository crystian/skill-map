/**
 * Plugin store wrappers — runtime injection for `ctx.store` per spec
 * § A.12 (opt-in `outputSchema` for plugin custom storage).
 *
 * Two shapes, mirroring the manifest's storage modes documented in
 * `spec/plugin-kv-api.md`:
 *
 *   - Mode A — `KvStore.set(key, value)`. AJV-validates `value` against
 *     the schema declared by `manifest.storage.schema` (single
 *     value-shape) when present. Absent = permissive.
 *   - Mode B — `DedicatedStore.write(table, row)`. AJV-validates `row`
 *     against the per-table schema declared in `manifest.storage.schemas`
 *     when present. Tables absent from the map accept any shape.
 *
 * Both wrappers are storage-engine agnostic — they accept a `persist`
 * callback the caller supplies. The persistence side (SQLite, in-memory,
 * mock) is the caller's concern; this wrapper's only job is the
 * AJV gate. That separation lets the test suite exercise the validator
 * without spinning up a real DB and lets the kernel adapter (future
 * `state_plugin_kvs` writer / dedicated-table writer) plug in
 * unchanged.
 *
 * Universal validation (`emitLink` against `link.schema.json`,
 * `enrichNode` against `node.schema.json`) is unaffected — it lives on
 * the orchestrator side and runs regardless of the plugin's
 * `outputSchema` opt-in.
 */

import type {
  IDiscoveredPlugin,
  IPluginStorageSchema,
} from '../types/plugin.js';
import { tx } from '../util/tx.js';
import { PLUGIN_STORE_TEXTS } from '../i18n/plugin-store.texts.js';

/**
 * Sentinel key under which Mode A stores its single value-shape schema
 * inside `IDiscoveredPlugin.storageSchemas`. The sentinel keeps the
 * shared `Record<string, IPluginStorageSchema>` map a single-typed
 * surface across both modes; consumers look up by sentinel for KV and
 * by table name for dedicated.
 */
export const KV_SCHEMA_KEY = '__kv__';

export interface IKvStorePersist {
  (key: string, value: unknown): void | Promise<void>;
}

export interface IDedicatedStorePersist {
  (table: string, row: unknown): void | Promise<void>;
}

/**
 * Mode A wrapper. `set(key, value)` AJV-validates `value` against the
 * Mode A schema (sentinel key `__kv__`) when declared, then forwards
 * to `persist`. Validation failure throws with a message naming the
 * schema path and AJV errors; persistence is skipped on failure.
 *
 * `pluginId` is captured for diagnostics (the throw message names the
 * plugin). The wrapper does NOT itself scope by plugin id — that is
 * the persistence layer's job (the spec's `state_plugin_kvs` PK includes
 * `pluginId` and the kernel-side adapter prepends it before write).
 */
export interface IKvStoreWrapper {
  set(key: string, value: unknown): Promise<void>;
}

export function makeKvStoreWrapper(opts: {
  pluginId: string;
  schema: IPluginStorageSchema | undefined;
  persist: IKvStorePersist;
}): IKvStoreWrapper {
  const { pluginId, schema, persist } = opts;
  return {
    async set(key, value) {
      if (schema) {
        if (!schema.validate(value)) {
          throw new Error(
            tx(PLUGIN_STORE_TEXTS.kvValidationFailed, {
              pluginId,
              schemaPath: schema.schemaPath,
              key,
              errors: formatAjvErrors(schema.validate.errors ?? null),
            }),
          );
        }
      }
      await persist(key, value);
    },
  };
}

/**
 * Mode B wrapper. `write(table, row)` AJV-validates `row` against
 * `storageSchemas[table]` when declared, then forwards to `persist`.
 * Tables absent from the map are permissive — the wrapper forwards
 * straight to `persist` without validation.
 *
 * The wrapper accepts the full `storageSchemas` map (rather than a
 * single schema) so a plugin author can declare schemas for some
 * tables and leave others permissive in the same map without the
 * caller having to lookup-then-narrow.
 */
export interface IDedicatedStoreWrapper {
  write(table: string, row: unknown): Promise<void>;
}

export function makeDedicatedStoreWrapper(opts: {
  pluginId: string;
  schemas: Record<string, IPluginStorageSchema> | undefined;
  persist: IDedicatedStorePersist;
}): IDedicatedStoreWrapper {
  const { pluginId, schemas, persist } = opts;
  return {
    async write(table, row) {
      const schema = schemas?.[table];
      if (schema) {
        if (!schema.validate(row)) {
          throw new Error(
            tx(PLUGIN_STORE_TEXTS.dedicatedValidationFailed, {
              pluginId,
              table,
              schemaPath: schema.schemaPath,
              errors: formatAjvErrors(schema.validate.errors ?? null),
            }),
          );
        }
      }
      await persist(table, row);
    },
  };
}

/**
 * Convenience entry point: build whichever wrapper matches the
 * discovered plugin's storage mode. Returns `undefined` when the
 * plugin declared no storage at all (the orchestrator omits
 * `ctx.store` in that case, per the existing contract). Mode A
 * extracts the sentinel-keyed schema; Mode B forwards the full map.
 */
export function makePluginStore(opts: {
  plugin: IDiscoveredPlugin;
  persistKv?: IKvStorePersist;
  persistDedicated?: IDedicatedStorePersist;
}): IKvStoreWrapper | IDedicatedStoreWrapper | undefined {
  const manifest = opts.plugin.manifest;
  if (!manifest?.storage) return undefined;
  const storageSchemas = opts.plugin.storageSchemas;

  if (manifest.storage.mode === 'kv') {
    if (!opts.persistKv) return undefined;
    const schema = storageSchemas?.[KV_SCHEMA_KEY];
    return makeKvStoreWrapper({
      pluginId: manifest.id,
      schema,
      persist: opts.persistKv,
    });
  }

  if (manifest.storage.mode === 'dedicated') {
    if (!opts.persistDedicated) return undefined;
    return makeDedicatedStoreWrapper({
      pluginId: manifest.id,
      schemas: storageSchemas,
      persist: opts.persistDedicated,
    });
  }

  return undefined;
}

/** Compact AJV error string suitable for the throw message. */
function formatAjvErrors(
  errors: { instancePath: string; message?: string; keyword: string }[] | null,
): string {
  if (!errors || errors.length === 0) return '(no AJV details)';
  return errors
    .map((e) => `${e.instancePath || '(root)'} ${e.message ?? e.keyword}`)
    .join('; ');
}
