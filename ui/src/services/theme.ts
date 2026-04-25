/**
 * Simple light/dark theme toggle. Persists the choice to localStorage and
 * toggles two classes on the document root:
 *
 * - `.app-dark`  — registered as Aura's `darkModeSelector` in `app.config.ts`
 *   so PrimeNG swaps its palette.
 * - `.dark`      — the selector Foblex Flow ships defaults for in
 *   `@foblex/flow/styles/tokens/_semantic.scss` (`.dark, [data-theme='dark']`).
 *   Without it the graph stays on the light palette regardless of the rest
 *   of the app.
 *
 * System-preference detection and tri-state (`system`) are Step 13 work
 * per ROADMAP §Step 13 open picks.
 */

import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';

export type TThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'skill-map.ui.theme';
const PRIMENG_DARK_CLASS = 'app-dark';
const FOBLEX_DARK_CLASS = 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);

  readonly mode = signal<TThemeMode>(this.readInitial());

  constructor() {
    effect(() => {
      const isDark = this.mode() === 'dark';
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

  toggle(): void {
    this.mode.update((m) => (m === 'dark' ? 'light' : 'dark'));
  }

  private readInitial(): TThemeMode {
    try {
      const stored = this.doc.defaultView?.localStorage.getItem(STORAGE_KEY);
      if (stored === 'dark' || stored === 'light') return stored;
    } catch {
      // ignore
    }
    return 'light';
  }
}
