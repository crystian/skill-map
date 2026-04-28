/**
 * Fake storage adapter for plugin tests. The kernel exposes a thin
 * key-value surface to plugins via `state_plugin_kvs` (Storage Mode A).
 * This in-memory stand-in implements the same contract without
 * requiring a real SQLite handle, so plugin authors can unit-test
 * extensions that read or write KV state.
 *
 * Scope: only the `kv` mode is fakeable today. Plugins running in
 * `dedicated` storage mode own raw tables and are tested with a real
 * DatabaseSync instance — that pattern is documented in the plugin
 * author guide (Step 9.4).
 *
 * Type erasure: the real `ctx.store` interface lives in `@skill-map/cli`
 * but is finalized as part of the Step 10 job subsystem. Until that
 * lands we re-publish a structurally identical surface here so users
 * who write detectors / rules that read KV today don't have to import
 * a more general type and downcast.
 */

export interface IFakeStoragePort {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}

export interface IMakeFakeStorageOptions {
  /** Optional initial state. Useful when a test seeds prior values. */
  initial?: Record<string, unknown>;
}

/**
 * Build an in-memory `IFakeStoragePort` with optional seeded state.
 * Keys are stored verbatim — no namespacing, no normalization. The
 * real `ctx.store` namespaces by plugin id; this fake is per-test
 * and does not need to.
 */
export function makeFakeStorage(opts: IMakeFakeStorageOptions = {}): IFakeStoragePort {
  const map = new Map<string, unknown>();
  if (opts.initial) {
    for (const [key, value] of Object.entries(opts.initial)) map.set(key, value);
  }
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return map.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T): Promise<void> {
      map.set(key, value);
    },
    async list(prefix?: string): Promise<string[]> {
      if (prefix === undefined) return [...map.keys()];
      return [...map.keys()].filter((k) => k.startsWith(prefix));
    },
    async delete(key: string): Promise<void> {
      map.delete(key);
    },
  };
}
