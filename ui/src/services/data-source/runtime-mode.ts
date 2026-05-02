/**
 * Runtime-mode discriminator for the SPA.
 *
 * Two modes today:
 *   - `live` — talks to the BFF over HTTP (`RestDataSource`). Default.
 *   - `demo` — reads a precomputed bundle baked into the build
 *              (`StaticDataSource`). Wired in Step 14.3.b.
 *
 * The mode is sourced from a `<meta name="skill-map-mode" content="live" />`
 * tag injected at build time. Reading from `<meta>` (not from a runtime
 * fetch or env var) keeps the decision synchronous and side-effect-free
 * — important for the factory that runs during Angular's injector
 * construction.
 *
 * Defensive default: anything other than `'demo'` collapses to `'live'`.
 * The demo bundle is opt-in; an absent or malformed meta tag must not
 * silently disable real-data mode.
 */

import { InjectionToken } from '@angular/core';

export type TSkillMapMode = 'live' | 'demo';

export const SKILL_MAP_MODE = new InjectionToken<TSkillMapMode>(
  'SKILL_MAP_MODE',
);

/**
 * Read the `skill-map-mode` meta tag from the document and coerce to
 * `TSkillMapMode`. Returns `'live'` when the document is unavailable
 * (SSR / test harness without DOM) or when the tag is missing / invalid.
 */
export function readSkillMapModeFromMeta(): TSkillMapMode {
  if (typeof document === 'undefined') return 'live';
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="skill-map-mode"]',
  );
  const value = meta?.content;
  return value === 'demo' ? 'demo' : 'live';
}
