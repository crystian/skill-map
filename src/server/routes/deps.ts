/**
 * Shared deps bag for the per-route registrars under `routes/`.
 *
 * Every read-side route opens the DB on demand via `tryWithSqlite` /
 * `withSqlite`. Per-request open / close is what the CLI does too — a
 * persistent adapter would shave a few ms per request but introduces
 * lock contention that's not worth it before any real load lands.
 *
 * The `runtimeContext` field is mandatory because `loadConfig` and the
 * fresh-scan path both need a `cwd` / `homedir` pair (the kernel never
 * reads `process.*` itself). The composition root threads it from
 * `defaultRuntimeContext()` at boot.
 */

import type { IRuntimeContext } from '../../cli/util/runtime-context.js';
import type { IServerOptions } from '../options.js';

export interface IRouteDeps {
  options: IServerOptions;
  /**
   * Runtime context (`cwd`, `homedir`) consumed by `loadConfig` (for
   * `/api/config`) and by the fresh-scan branch of `/api/scan` (for the
   * scan runner's plugin discovery + ignore filter resolution).
   */
  runtimeContext: IRuntimeContext;
}
