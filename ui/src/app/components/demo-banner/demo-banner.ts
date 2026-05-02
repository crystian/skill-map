/**
 * `<sm-demo-banner>` — top-of-shell banner shown only when the SPA is
 * running against a static demo bundle (`SKILL_MAP_MODE === 'demo'`).
 *
 * Visibility is gated on **two** signals so the banner stays out of the
 * way once a user has acknowledged it:
 *
 *   1. The injected `SKILL_MAP_MODE` token must be `'demo'`. In live
 *      mode the component renders nothing — the gate happens in the
 *      template, but the constructor short-circuits the localStorage
 *      read too so live-mode users pay no cost.
 *   2. The dismissal flag (`localStorage.getItem(STORAGE_KEY) !== '1'`)
 *      must be unset. Dismissal persists across navigations and reloads
 *      within the same browser profile (same-origin localStorage).
 *
 * Persistence keying matches the AGENTS.md storage convention (sm.*
 * prefix) so multiple skill-map artefacts coexist cleanly.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';

import { DEMO_BANNER_TEXTS } from '../../../i18n/demo-banner.texts';
import { SKILL_MAP_MODE } from '../../../services/data-source/runtime-mode';

const STORAGE_KEY = 'sm.demoBannerDismissed';

@Component({
  selector: 'sm-demo-banner',
  imports: [ButtonModule],
  templateUrl: './demo-banner.html',
  styleUrl: './demo-banner.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoBanner {
  private readonly mode = inject(SKILL_MAP_MODE);

  protected readonly texts = DEMO_BANNER_TEXTS;

  /**
   * `true` when the user has clicked dismiss. Initialised from
   * localStorage so a reload preserves the dismissed state. Defensive
   * `try` keeps the component working in test harnesses or sandboxed
   * iframes where localStorage throws.
   */
  private readonly dismissed = signal<boolean>(this.readDismissed());

  /**
   * Combine mode gate + dismiss state into a single boolean the template
   * binds against. Computed (instead of a method) so Angular caches the
   * result — the template re-checks only when an upstream signal changes.
   */
  protected readonly visible = computed<boolean>(
    () => this.mode === 'demo' && !this.dismissed(),
  );

  dismiss(): void {
    this.dismissed.set(true);
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, '1');
    } catch {
      // Best-effort persistence — the banner stays dismissed in this
      // session regardless. Common failure modes: storage quota,
      // sandboxed iframe with `localStorage` blocked, private mode in
      // certain browsers (rare on modern engines).
    }
  }

  private readDismissed(): boolean {
    if (this.mode !== 'demo') return true; // short-circuit: nothing to show in live mode
    try {
      return globalThis.localStorage?.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }
}
