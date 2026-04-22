/**
 * Simple light/dark theme toggle. Persists the choice to localStorage and
 * toggles `.app-dark` on the document root so PrimeNG's Aura preset picks
 * up the dark palette (the selector is registered in `providePrimeNG` at
 * `app.config.ts`).
 *
 * System-preference detection and tri-state (`system`) are Step 12 work
 * per ROADMAP §Step 12 open picks.
 */

import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';

export type TThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'skill-map.ui.theme';
const DARK_CLASS = 'app-dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);

  readonly mode = signal<TThemeMode>(this.readInitial());

  constructor() {
    effect(() => {
      const next = this.mode();
      const root = this.doc.documentElement;
      root.classList.toggle(DARK_CLASS, next === 'dark');
      try {
        this.doc.defaultView?.localStorage.setItem(STORAGE_KEY, next);
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
