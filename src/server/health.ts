/**
 * `/api/health` — liveness + version surface for the SPA bootstrap.
 *
 * Shape (`IHealthResponse`):
 *
 *   ```json
 *   {
 *     "ok": true,
 *     "schemaVersion": "1",
 *     "specVersion": "0.11.0",
 *     "implVersion": "0.9.0",
 *     "scope": "project",
 *     "db": "present"
 *   }
 *   ```
 *
 * The endpoint deliberately boots even when the DB file is missing.
 * The SPA polls health on first paint to decide whether to render an
 * empty-state CTA ("run `sm scan` first") versus the live data flow.
 *
 * `db` resolution:
 *
 *   - `existsSync(dbPath)` true  → `'present'`.
 *   - `existsSync(dbPath)` false → `'missing'`.
 *
 * A separate `'error'` value is reserved for future use (corrupt header,
 * permission denied) but the 14.1 surface only emits the two-state
 * present / missing pair — opening the DB to assert integrity is
 * Step 14.2 territory.
 *
 * The `schemaVersion` field tracks `scan-result.schema.json#/properties/schemaVersion/const`
 * (numeric in the schema, stringified here so the SPA branches on a single
 * type). Hardcoded to `'1'` until the spec ever bumps the on-the-wire
 * `schemaVersion` — at which point this constant moves into the
 * `@skill-map/spec` index payload.
 */

import { existsSync } from 'node:fs';

import { VERSION } from '../cli/version.js';
import type { TServerScope } from './options.js';

export type THealthDbState = 'present' | 'missing' | 'error';

export interface IHealthResponse {
  ok: true;
  schemaVersion: string;
  specVersion: string;
  implVersion: string;
  scope: TServerScope;
  db: THealthDbState;
}

export interface IHealthDeps {
  dbPath: string;
  scope: TServerScope;
  /**
   * Pre-resolved spec version. Computed once at server boot via
   * `resolveSpecVersion()` and threaded in — keeps `buildHealth`
   * synchronous (every health probe must be fast) and avoids re-walking
   * Node's resolution graph on each request.
   */
  specVersion: string;
}

const FALLBACK_SCHEMA_VERSION = '1';

/**
 * Build the health payload. Synchronous: every read is either an
 * `existsSync` call or a value the composition root injected.
 */
export function buildHealth(deps: IHealthDeps): IHealthResponse {
  return {
    ok: true,
    schemaVersion: FALLBACK_SCHEMA_VERSION,
    specVersion: deps.specVersion,
    implVersion: VERSION,
    scope: deps.scope,
    db: existsSync(deps.dbPath) ? 'present' : 'missing',
  };
}

/**
 * Resolve `@skill-map/spec`'s package version once at boot. Reads the
 * `specPackageVersion` field from the spec index payload (the package's
 * default export). Failure → `'unknown'`, mirroring `sm version`'s
 * degradation policy — the health endpoint must never crash.
 */
export async function resolveSpecVersion(): Promise<string> {
  try {
    const mod = await import('@skill-map/spec', { with: { type: 'json' } });
    const version = (mod as { default?: { specPackageVersion?: string } }).default
      ?.specPackageVersion;
    return version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
