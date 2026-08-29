/**
 * Catalog of "extra" themes that sit on top of the tri-state base
 * (`light` / `dark` / `auto`). Each entry binds the things the
 * `ThemeService` needs to activate the theme:
 *   - the html class it toggles on `<html>`;
 *   - whether activation forces dark-mode classes (`.app-dark` +
 *     `.dark`) so the retint sits on a dark base;
 *   - an optional favicon swap, lazy font stylesheet, and a
 *     persisted DOM id for the injected `<link>`;
 *   - a UI label + description rendered by the Settings modal.
 *
 * Adding a new theme is one entry here plus one CSS file under
 * `ui/src/themes/` plus one line in `ui/angular.json`. No edit to
 * the service, the settings component, or the i18n catalog is
 * needed.
 */

export interface IExtraThemeDescriptor {
  /** Stable id persisted to localStorage and used as the wire value
   * in the Settings selectbutton. Lowercase kebab. */
  readonly id: string;
  /** Class toggled on `<html>` when this theme is active. */
  readonly htmlClass: string;
  /** Whether activation should also force the dark classes
   * (`.app-dark` + `.dark`). Matrix piggybacks on the dark palette
   * so its retint sits on a dark base rather than the light one. */
  readonly forcesDark: boolean;
  /** Whether activation should force the LIGHT base (drop `.app-dark`
   * + `.dark` even when the tri-state resolves dark). Paper sits on
   * the light palette the way the neons sit on the dark one. Mutually
   * exclusive with `forcesDark`. */
  readonly forcesLight?: boolean;
  /** Optional SVG favicon swapped while the theme is active.
   * Resolved against the app root (so `'favicon-matrix.svg'` lives
   * next to the default `favicon.svg`). */
  readonly favicon?: string;
  /** Optional remote stylesheet URL injected lazily into `<head>`
   * the first time this theme activates (e.g. a Google Fonts
   * stylesheet). The browser dedupes subsequent loads. */
  readonly fontHref?: string;
  /** DOM id assigned to the injected `<link>` so the lazy injection
   * stays idempotent across reactivations. Required when
   * `fontHref` is set. */
  readonly fontLinkId?: string;
  /** UI-facing label rendered by the Settings selectbutton. */
  readonly label: string;
  /** UI-facing one-line description rendered next to the label. */
  readonly description: string;
}

export const EXTRA_THEMES: readonly IExtraThemeDescriptor[] = [
  {
    id: 'neon-red',
    htmlClass: 'app-neon-red',
    forcesDark: true,
    favicon: 'favicon-neon-red.svg',
    label: 'Neon R',
    description: 'Electric-red glow on a deep console.',
  },
  {
    id: 'neon-green',
    htmlClass: 'app-neon-green',
    forcesDark: true,
    favicon: 'favicon-neon-green.svg',
    label: 'Neon G',
    description: 'Electric-green glow on a deep console.',
  },
  {
    // Renamed from the bare `neon` (it predates the R/G variants); the
    // legacy stored id is remapped on read in `ThemeService`, and the
    // favicon / mark assets follow the id convention. Only the DOM class
    // keeps the historical `app-neon` name (the themes CSS keys on it).
    id: 'neon-blue',
    htmlClass: 'app-neon',
    forcesDark: true,
    favicon: 'favicon-neon-blue.svg',
    label: 'Neon B',
    description: 'Electric-cyan glow on a deep-navy console.',
  },
  {
    id: 'matrix',
    htmlClass: 'app-matrix',
    forcesDark: true,
    favicon: 'favicon-matrix.svg',
    fontHref: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono&display=swap',
    fontLinkId: 'sm-matrix-font',
    label: 'Matrix',
    description: 'Cyber-green retint on the dark palette.',
  },
  {
    id: 'blueprint',
    htmlClass: 'app-blueprint',
    forcesDark: true,
    favicon: 'favicon-blueprint.svg',
    label: 'Blueprint',
    description: 'Drafting-sheet blue with white ink and a technical grid.',
  },
  {
    id: 'paper',
    htmlClass: 'app-paper',
    forcesDark: false,
    forcesLight: true,
    favicon: 'favicon-paper.svg',
    label: 'Paper',
    description: 'Warm parchment with sepia ink, on the light palette.',
  },
] as const;

/** Union of every theme id in the registry, plus `null` for the
 * "no extra theme" state. */
export type TExtraThemeId = (typeof EXTRA_THEMES)[number]['id'] | null;

/** Lookup helper. Returns `null` when the id is not in the registry
 * (e.g. a stale value left over in localStorage by an older build). */
export function findExtraTheme(id: string | null | undefined): IExtraThemeDescriptor | null {
  if (!id) return null;
  return EXTRA_THEMES.find((theme) => theme.id === id) ?? null;
}
