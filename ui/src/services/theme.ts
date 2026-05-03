/**
 * Theme service — tri-state (`auto` | `light` | `dark`) with live system-pref
 * detection. Persists the chosen mode (not the resolved theme) to localStorage
 * and toggles two classes on the document root in sync with `resolved()`:
 *
 * - `.app-dark`  — registered as Aura's `darkModeSelector` in `app.config.ts`
 *   so PrimeNG swaps its palette.
 * - `.dark`      — the selector Foblex Flow ships defaults for in
 *   `@foblex/flow/styles/tokens/_semantic.scss` (`.dark, [data-theme='dark']`).
 *   Without it the graph stays on the light palette regardless of the rest
 *   of the app.
 *
 * In `auto` mode the resolved theme follows the OS via the
 * `(prefers-color-scheme: dark)` media query and reacts live to changes.
 * Closes the Step 14.6 dark-mode tri-state pick.
 */

import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';

export type TThemeMode = 'auto' | 'light' | 'dark';
export type TResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'skill-map.ui.theme';
const PRIMENG_DARK_CLASS = 'app-dark';
const FOBLEX_DARK_CLASS = 'dark';
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);

  readonly mode = signal<TThemeMode>(this.readInitial());
  private readonly systemPrefersDark = signal<boolean>(this.readSystemPref());

  readonly resolved = computed<TResolvedTheme>(() => {
    const m = this.mode();
    if (m === 'auto') return this.systemPrefersDark() ? 'dark' : 'light';
    return m;
  });

  constructor() {
    this.subscribeToSystemPref();

    effect(() => {
      const isDark = this.resolved() === 'dark';
      const root = this.doc.documentElement;
      root.classList.toggle(PRIMENG_DARK_CLASS, isDark);
      root.classList.toggle(FOBLEX_DARK_CLASS, isDark);
      try {
        this.doc.defaultView?.localStorage.setItem(STORAGE_KEY, this.mode());
      } catch {
        // Storage may be unavailable (privacy mode); tolerate silently.
      }
    });
  }

  /** Cycle through the three modes: `auto` → `light` → `dark` → `auto`. */
  toggle(): void {
    this.mode.update((m) => (m === 'auto' ? 'light' : m === 'light' ? 'dark' : 'auto'));
  }

  set(mode: TThemeMode): void {
    this.mode.set(mode);
  }

  private readInitial(): TThemeMode {
    try {
      const stored = this.doc.defaultView?.localStorage.getItem(STORAGE_KEY);
      if (stored === 'auto' || stored === 'light' || stored === 'dark') return stored;
    } catch {
      // ignore
    }
    return 'auto';
  }

  private readSystemPref(): boolean {
    try {
      return this.doc.defaultView?.matchMedia(SYSTEM_DARK_QUERY).matches ?? false;
    } catch {
      return false;
    }
  }

  private subscribeToSystemPref(): void {
    const win = this.doc.defaultView;
    if (!win || typeof win.matchMedia !== 'function') return;
    const mq = win.matchMedia(SYSTEM_DARK_QUERY);
    mq.addEventListener('change', (event) => {
      this.systemPrefersDark.set(event.matches);
    });
  }
}
