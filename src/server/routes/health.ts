/**
 * `GET /api/health` — liveness + version probe used by the SPA bootstrap.
 *
 * Extracted from `app.ts` for symmetry with the other Step 14.2 routes.
 * The response shape and the underlying `buildHealth` helper still live
 * in `src/server/health.ts` (unchanged from 14.1).
 */

import type { Hono } from 'hono';

import { buildHealth } from '../health.js';
import type { IServerOptions } from '../options.js';

export interface IHealthRouteDeps {
  options: IServerOptions;
  /** Pre-resolved spec version (sync at request time — boot-time async resolve). */
  specVersion: string;
}

export function registerHealthRoute(app: Hono, deps: IHealthRouteDeps): void {
  app.get('/api/health', (c) => {
    const payload = buildHealth({
      dbPath: deps.options.dbPath,
      scope: deps.options.scope,
      specVersion: deps.specVersion,
    });
    return c.json(payload);
  });
}
