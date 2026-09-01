/**
 * Embed-mode discriminator for the SPA (`spec/provider-activity.md`
 * §Session journal, "Embedded replay").
 *
 * `?embed=1` is a BOOT-ONLY flag: the SPA renders the map canvas alone
 * (no shell chrome, no rail, no inspector, no toolbar, no transport)
 * so a host page can frame it as a living illustration. The public
 * site's hero does exactly that with `/demo/?embed=1&replay=…`.
 *
 * `theme=<id>` rides along ONLY under `embed` (a base `light` / `dark`
 * or an extra theme id from `themes/registry.ts`) and is never
 * persisted: the host page picks the look, the visitor's own SPA
 * settings stay untouched (`ThemeService` skips its storage writes
 * under embed for the same reason).
 *
 * Sourced from `location.search` (not the router): the token is read
 * during injector construction, synchronously and side-effect-free,
 * the same posture as `readSkillMapModeFromMeta`. The pure parser is
 * exported so module-load code with no injector (`scoped-storage.ts`,
 * which namespaces the embed's project state) can share the exact
 * same reading.
 */

import { InjectionToken } from '@angular/core';

export interface IEmbedConfig {
  /** Requested look; `null` = the SPA's own default resolution. */
  readonly theme: string | null;
}

/** `null` outside embed mode. */
export const SKILL_MAP_EMBED = new InjectionToken<IEmbedConfig | null>('SKILL_MAP_EMBED');

export const EMBED_PARAM = 'embed';
export const EMBED_THEME_PARAM = 'theme';

/**
 * Parse an embed request out of a query string. Only the literal
 * `embed=1` enables it (a bare `?embed` or `embed=true` does not: the
 * flag is a contract, not a hint).
 */
export function parseEmbedConfig(search: string): IEmbedConfig | null {
  const params = new URLSearchParams(search);
  if (params.get(EMBED_PARAM) !== '1') return null;
  const theme = params.get(EMBED_THEME_PARAM);
  return { theme: theme !== null && theme.length > 0 ? theme : null };
}

/** Read the flag from the document location; `null` without a DOM. */
export function readEmbedConfigFromLocation(): IEmbedConfig | null {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') return null;
  return parseEmbedConfig(window.location.search);
}
