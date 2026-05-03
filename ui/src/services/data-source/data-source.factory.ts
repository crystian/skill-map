/**
 * `dataSourceFactory` — Angular DI factory that returns the concrete
 * `IDataSourcePort` for the active runtime mode.
 *
 *   - `live` → `RestDataSource` (HTTP against the BFF). Default.
 *   - `demo` → `StaticDataSource` (precomputed bundle baked into the
 *              demo build at `web/demo/data{,.meta}.json`).
 *
 * Wired in `app.config.ts`:
 *
 *   ```ts
 *   { provide: SKILL_MAP_MODE, useFactory: readSkillMapModeFromMeta },
 *   { provide: DATA_SOURCE,    useFactory: dataSourceFactory },
 *   ```
 *
 * **Demo-mode wiring decision** — `StaticDataSource` is constructed via
 * plain `new StaticDataSource()` (no DI args) instead of going through
 * Angular's `HttpClient`. The static bundle is fetched via the platform
 * `fetch()` directly because:
 *
 *   1. The demo bundle never speaks HTTP to a BFF — it reads two JSON
 *      assets from its own deploy origin. Routing through `HttpClient`
 *      would only add interceptor overhead and a runtime dependency
 *      that the rest of the demo doesn't need.
 *   2. Tests can swap `fetch` per-instance through the optional
 *      constructor arg without bringing up the Angular `HttpTestingController`.
 */

import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

import { DATA_SOURCE_TEXTS } from '../../i18n/data-source.texts';
import { WsEventStreamService } from '../ws-event-stream';
import type { IDataSourcePort } from './data-source.port';
import { RestDataSource } from './rest-data-source';
import { StaticDataSource } from './static-data-source';
import { SKILL_MAP_MODE } from './runtime-mode';

export function dataSourceFactory(): IDataSourcePort {
  const mode = inject(SKILL_MAP_MODE);
  if (mode === 'live') {
    return new RestDataSource(inject(HttpClient), inject(WsEventStreamService));
  }
  if (mode === 'demo') {
    return new StaticDataSource();
  }
  // Defensive: the mode token is typed as `TSkillMapMode`, but the
  // meta-tag reader collapses unknowns to `'live'`. If a future caller
  // bypasses the reader and provides a literal that doesn't satisfy
  // either branch, surface the failure loudly.
  const exhaustive: never = mode;
  throw new Error(DATA_SOURCE_TEXTS.errors.unknownMode(String(exhaustive)));
}
