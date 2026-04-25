import type { TStability } from '../models/node';

/** User-facing labels for `TStability`. Shared by filter-bar, list-view, inspector. */
export const STABILITY_LABELS: Readonly<Record<TStability, string>> = {
  stable: 'Stable',
  experimental: 'Experimental',
  deprecated: 'Deprecated',
};
