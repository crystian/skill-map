/**
 * `dataSourceFactory` — Angular DI factory that returns the concrete
 * `IDataSourcePort` for the active runtime mode.
 *
 *   - `live` → `RestDataSource` (HTTP against the BFF). Default.
 *   - `demo` → `StaticDataSource` (precomputed bundle). Lands at 14.3.b;
 *              throws a clear error today.
 *
 * Wired in `app.config.ts`:
 *
 *   ```ts
 *   { provide: SKILL_MAP_MODE, useFactory: readSkillMapModeFromMeta },
 *   { provide: DATA_SOURCE,    useFactory: dataSourceFactory },
 *   ```
 */

import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

import { DATA_SOURCE_TEXTS } from '../../i18n/data-source.texts';
import type { IDataSourcePort } from './data-source.port';
import { RestDataSource } from './rest-data-source';
import { SKILL_MAP_MODE } from './runtime-mode';

export function dataSourceFactory(): IDataSourcePort {
  const mode = inject(SKILL_MAP_MODE);
  if (mode === 'live') {
    return new RestDataSource(inject(HttpClient));
  }
  if (mode === 'demo') {
    throw new Error(DATA_SOURCE_TEXTS.errors.demoModeNotImplemented);
  }
  // Defensive: the mode token is typed as `TSkillMapMode`, but the
  // meta-tag reader collapses unknowns to `'live'`. If a future caller
  // bypasses the reader and provides a literal that doesn't satisfy
  // either branch, surface the failure loudly.
  const exhaustive: never = mode;
  throw new Error(DATA_SOURCE_TEXTS.errors.unknownMode(String(exhaustive)));
}
