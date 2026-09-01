/**
 * Theme service, tri-state (`auto` | `light` | `dark`) with live system-pref
 * detection, plus an orthogonal `extraTheme` slot driven by the registry
 * at `themes/registry.ts`. Persists both pieces to localStorage and
 * toggles classes on the document root in sync with `resolved()`:
 *
 * - `.app-dark`: registered as Aura's `darkModeSelector` in `app.config.ts`
 *   so PrimeNG swaps its palette.
 * - `.dark`: the selector Foblex Flow ships defaults for in
 *   `@foblex/flow/styles/tokens/_semantic.scss` (`.dark, [data-theme='dark']`).
 *   Without it the graph stays on the light palette regardless of the rest
 *   of the app.
 * - One class per registered extra theme (e.g. `.app-matrix`), toggled
 *   based on the active id. Themes with `forcesDark: true` (today:
 *   matrix) also force the two dark classes above so their retint sits
 *   on a dark base rather than the light palette.
 *
 * In `auto` mode the resolved theme follows the OS via the
 * `(prefers-color-scheme: dark)` media query and reacts live to changes.
 *
 * `extraTheme` is settings-only: there is no header affordance to enable
 * it. The header dark/light toggle CLEARS it (and advances the mode one
 * step) so the user gets an immediate visual exit from extra themes
 * without needing to open Settings again.
 */

import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';

import { SKILL_MAP_EMBED } from './embed-mode';

import {
  EXTRA_THEMES,
  findExtraTheme,
  type IExtraThemeDescriptor,
  type TExtraThemeId,
} from '../themes/registry';

export type TThemeMode = 'auto' | 'light' | 'dark';
export type TResolvedTheme = 'light' | 'dark';
/** Re-exported for consumers that already imported the old name. */
export type TExtraTheme = TExtraThemeId;

const STORAGE_KEY = 'skill-map.ui.theme';
const EXTRA_STORAGE_KEY = 'skill-map.ui.extra-theme';
const PRIMENG_DARK_CLASS = 'app-dark';
const FOBLEX_DARK_CLASS = 'dark';
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';
const FAVICON_DEFAULT = 'favicon.svg';
const FAVICON_SELECTOR = 'link[rel="icon"][type="image/svg+xml"]';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  /**
   * Embedded boot (`?embed=1&theme=<id>`, spec §"Embedded replay"): the
   * host page picks the look and NOTHING is persisted, so a framed
   * visit never rewrites the visitor's own preference on the shared
   * origin. `theme` names a base mode or an extra theme id.
   */
  private readonly embed = inject(SKILL_MAP_EMBED, { optional: true });

  private readonly modeState = signal<TThemeMode>(this.readInitialMode());
  private readonly extraThemeState = signal<TExtraThemeId>(this.readInitialExtra());
  private readonly systemPrefersDark = signal<boolean>(this.readSystemPref());

  /**
   * Read-only views: every write goes through `toggle()` / `set()` /
   * `setExtraTheme()`, which own the invariants (registry validation,
   * clear-extra-before-mode-change). Exposing the raw writable signals
   * would open a second, unguarded write path.
   */
  readonly mode = this.modeState.asReadonly();
  readonly extraTheme = this.extraThemeState.asReadonly();

  /**
   * Resolved tri-state (`light` | `dark`). Independent of `extraTheme`,
   * extra themes build on top of the dark / light palette rather than
   * replacing the tri-state. Consumers that need to know which extra
   * theme is on read the `extraTheme` signal directly.
   */
  readonly resolved = computed<TResolvedTheme>(() => {
    const m = this.mode();
    if (m === 'auto') return this.systemPrefersDark() ? 'dark' : 'light';
    return m;
  });

  /**
   * Brand mark asset for the active theme. Every extra theme ships its
   * own retinted mark (`ui/public/skill-map-mark-<id>.svg`, accent-matched
   * to the theme palette); without an extra, the mark flips with the
   * resolved base so the strokes stay readable on both backgrounds
   * (white strokes on dark, near-black on light). Single source for the
   * topbar and the Settings About tab.
   */
  readonly markSrc = computed<string>(() => {
    const extra = this.extraTheme();
    if (extra !== null) return `skill-map-mark-${extra}.svg`;
    return this.resolved() === 'dark'
      ? 'skill-map-mark-light.svg'
      : 'skill-map-mark-dark.svg';
  });

  constructor() {
    this.subscribeToSystemPref();

    effect(() => {
      const extraId = this.extraTheme();
      const activeExtra = findExtraTheme(extraId);
      const baseDark = this.resolved() === 'dark';
      // Extra themes that piggyback on the dark palette (matrix, the
      // neons, blueprint) force the PrimeNG / Foblex dark classes
      // whenever they're active so the retint sits on a dark base
      // rather than the light palette; a `forcesLight` theme (paper)
      // does the mirror image and drops them even under a dark mode.
      const isDark =
        activeExtra?.forcesLight === true ? false : baseDark || activeExtra?.forcesDark === true;
      const root = this.doc.documentElement;
      root.classList.toggle(PRIMENG_DARK_CLASS, isDark);
      root.classList.toggle(FOBLEX_DARK_CLASS, isDark);
      // Toggle every registered extra-theme class so a switch from
      // one extra theme to another (future: matrix → solarized)
      // cleanly removes the previous class instead of stacking them.
      for (const theme of EXTRA_THEMES) {
        root.classList.toggle(theme.htmlClass, activeExtra?.id === theme.id);
      }
      // Swap the SVG favicon to the one declared by the active
      // extra theme (if any). The default favicon is self-adaptive
      // via `prefers-color-scheme`, so the non-extra path leaves it
      // untouched and the dark / light auto behavior keeps working.
      this.applyFavicon(activeExtra?.favicon ?? FAVICON_DEFAULT);
      if (activeExtra) this.ensureExtraThemeFont(activeExtra);
      if (this.embed !== null) return;
      try {
        const ls = this.doc.defaultView?.localStorage;
        ls?.setItem(STORAGE_KEY, this.mode());
        if (activeExtra === null) ls?.removeItem(EXTRA_STORAGE_KEY);
        else ls?.setItem(EXTRA_STORAGE_KEY, activeExtra.id);
      } catch {
        // Storage may be unavailable (privacy mode); tolerate silently.
      }
    });
  }

  /**
   * Header button handler. Clears the extra theme (if any) AND advances
   * the tri-state one step, so a single click always produces a visible
   * change: from an extra theme the user lands on the next mode in the
   * cycle (`auto` → `light` → `dark` → `auto`).
   */
  toggle(): void {
    if (this.extraTheme() !== null) this.extraThemeState.set(null);
    this.modeState.update((m) => (m === 'auto' ? 'light' : m === 'light' ? 'dark' : 'auto'));
  }

  set(mode: TThemeMode): void {
    this.modeState.set(mode);
  }

  setExtraTheme(theme: TExtraThemeId): void {
    // Validate against the registry so callers passing an arbitrary
    // string get a graceful no-op instead of an invalid class on
    // `<html>`. `null` clears the slot.
    this.extraThemeState.set(findExtraTheme(theme)?.id ?? null);
  }

  private readInitialMode(): TThemeMode {
    const requested = this.embed?.theme;
    if (requested === 'light' || requested === 'dark') return requested;
    if (this.embed) return 'auto';
    try {
      const stored = this.doc.defaultView?.localStorage.getItem(STORAGE_KEY);
      if (stored === 'auto' || stored === 'light' || stored === 'dark') return stored;
    } catch {
      // ignore
    }
    return 'auto';
  }

  private readInitialExtra(): TExtraThemeId {
    if (this.embed) return findExtraTheme(this.embed.theme)?.id ?? null;
    try {
      const stored = this.doc.defaultView?.localStorage.getItem(EXTRA_STORAGE_KEY);
      // Legacy remap: the cyan variant shipped as the bare `neon` id
      // before the R/G siblings existed; a pref stored back then keeps
      // working (the next write persists the new id).
      const migrated = stored === 'neon' ? 'neon-blue' : stored;
      return findExtraTheme(migrated)?.id ?? null;
    } catch {
      return null;
    }
  }

  private readSystemPref(): boolean {
    try {
      return this.doc.defaultView?.matchMedia(SYSTEM_DARK_QUERY).matches ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Lazy-injects an extra theme's font stylesheet the first time the
   * theme activates. Pure DOM-presence check, the browser dedupes the
   * stylesheet request itself so a second injection would be a no-op,
   * but skipping the second `<link>` keeps `<head>` tidy. Left in place
   * after first inject so subsequent reactivations are zero-cost.
   * No-op for themes that don't declare a `fontHref`.
   */
  private ensureExtraThemeFont(theme: IExtraThemeDescriptor): void {
    if (!theme.fontHref || !theme.fontLinkId) return;
    if (this.doc.getElementById(theme.fontLinkId)) return;
    const head = this.doc.head;
    if (!head) return;
    const link = this.doc.createElement('link');
    link.id = theme.fontLinkId;
    link.rel = 'stylesheet';
    link.href = theme.fontHref;
    head.appendChild(link);
  }

  /**
   * Points the SVG favicon `<link>` at the given href. Idempotent: no
   * DOM write when the value already matches, so a navigation that
   * re-runs the theme effect without a real change does not trigger
   * the browser to re-fetch the icon.
   */
  private applyFavicon(href: string): void {
    const link = this.doc.querySelector(FAVICON_SELECTOR);
    if (!link) return;
    if (link.getAttribute('href') === href) return;
    link.setAttribute('href', href);
  }

  private subscribeToSystemPref(): void {
    const win = this.doc.defaultView;
    if (!win || typeof win.matchMedia !== 'function') return;
    const mq = win.matchMedia(SYSTEM_DARK_QUERY);
    const handler = (event: MediaQueryListEvent): void => {
      this.systemPrefersDark.set(event.matches);
    };
    mq.addEventListener('change', handler);
    // Pair the listener with cleanup so HMR cycles don't accumulate
    // dangling handlers across reload boundaries in dev.
    this.destroyRef.onDestroy(() => mq.removeEventListener('change', handler));
  }
}
