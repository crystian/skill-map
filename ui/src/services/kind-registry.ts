/**
 * `KindRegistryService` — runtime catalog of node kinds the UI knows
 * how to render (Step 14.5.d).
 *
 * Replaces the pre-14.5.d `TNodeKind = 'skill' | 'agent' | …` closed
 * union and the static `--sm-kind-*` CSS vars in `styles.css`. The
 * registry is fed by every payload-bearing BFF envelope (see
 * `spec/schemas/api/rest-envelope.schema.json#/properties/kindRegistry`):
 * the data source ingests the field on every fetch, this service stores
 * it as a signal-readable map, and components / views read kind
 * presentation through `lookup()` / `labelOf()` / `colorOf()` /
 * `iconOf()` instead of switching on hardcoded literals.
 *
 * `applyCssVars()` injects `--sm-kind-<id>`, `--sm-kind-<id>-bg`, and
 * `--sm-kind-<id>-fg` (light + dark variants) onto `document.documentElement`
 * so existing CSS that styles by var token (e.g. `node-card.css`) keeps
 * working without per-component refactors. The light/dark variants both
 * land at boot; the existing `data-theme` attribute (or the
 * `prefers-color-scheme` media query) decides which one applies.
 *
 * `ingest()` is idempotent — repeated calls with the same payload are
 * cheap (signal equality short-circuits to no-op). The first ingest
 * after empty state triggers `applyCssVars()`; subsequent ingests
 * re-apply only when the registry actually changes (handles hot-reload
 * in dev when a plugin's manifest is edited at runtime).
 */

import { Injectable, computed, signal } from '@angular/core';

import type { IKindRegistryEntryApi } from '../models/api';
import { deriveTints } from './kind-tints';

export interface IKindRegistryEntry extends IKindRegistryEntryApi {
  /** Kind name — duplicated here so iterating `kinds()` keeps insertion order without a separate Map. */
  name: string;
}

@Injectable({ providedIn: 'root' })
export class KindRegistryService {
  private readonly _entries = signal<readonly IKindRegistryEntry[]>([]);

  /** Ordered list of registered kinds. Insertion order = manifest declaration order = visual order. */
  readonly kinds = this._entries.asReadonly();

  /**
   * Quick lookup map. Computed from `_entries` so consumers can branch
   * `lookup(kindName) === undefined` without re-walking the array.
   */
  private readonly index = computed(() => {
    const map = new Map<string, IKindRegistryEntry>();
    for (const entry of this._entries()) {
      map.set(entry.name, entry);
    }
    return map;
  });

  /**
   * Replace the registry with the catalog from the latest envelope.
   * Insertion order in the input object is preserved (V8 preserves
   * own-string-key order). No-op when the new payload is structurally
   * equal to the current one (cheap stringify compare — the registry
   * is small, ≤ tens of entries in realistic plugins).
   */
  ingest(payload: Record<string, IKindRegistryEntryApi> | null | undefined): void {
    if (!payload) return;
    const entries: IKindRegistryEntry[] = [];
    for (const [name, raw] of Object.entries(payload)) {
      entries.push({ name, ...raw });
    }
    const current = this._entries();
    if (sameRegistry(current, entries)) return;
    this._entries.set(entries);
    this.applyCssVars();
  }

  lookup(name: string): IKindRegistryEntry | undefined {
    return this.index().get(name);
  }

  labelOf(name: string): string {
    return this.lookup(name)?.label ?? name;
  }

  /**
   * Return the base color for a kind in the requested theme. Falls back
   * to a neutral gray when the kind isn't in the registry yet (first
   * paint while the boot fetch is in flight).
   */
  colorOf(name: string, theme: 'light' | 'dark' = 'light'): string {
    const entry = this.lookup(name);
    if (!entry) return '#9ca3af';
    if (theme === 'dark') return entry.colorDark ?? entry.color;
    return entry.color;
  }

  iconOf(name: string): IKindRegistryEntry['icon'] | undefined {
    return this.lookup(name)?.icon;
  }

  emojiOf(name: string): string | undefined {
    return this.lookup(name)?.emoji;
  }

  /**
   * Inject `--sm-kind-<id>`, `--sm-kind-<id>-bg`, `--sm-kind-<id>-fg`
   * for light AND dark themes via a managed `<style id="sm-kind-vars">`
   * tag in `<head>`. Using a stylesheet (rather than inline
   * `documentElement.style.setProperty`) preserves the existing
   * `.app-dark { … }` cascade — inline styles would win specificity
   * and freeze the light variant in dark mode. The dark variant lives
   * inside `.app-dark { … }` so the existing theme toggle keeps
   * working with dynamic kinds the same way it works with the
   * built-in catalog declared in `styles.css`.
   *
   * Bg / fg derived from the base color via `deriveTints`
   * (`kind-tints.ts`).
   *
   * Safe in SSR / tests: bails out when `document` is undefined.
   */
  applyCssVars(): void {
    if (typeof document === 'undefined') return;
    const styleEl = ensureStyleElement();
    const lightDecls: string[] = [];
    const darkDecls: string[] = [];
    for (const entry of this._entries()) {
      const lightTints = deriveTints(entry.color, 'light');
      const darkBase = entry.colorDark ?? entry.color;
      const darkTints = deriveTints(darkBase, 'dark');
      lightDecls.push(`--sm-kind-${entry.name}: ${entry.color};`);
      lightDecls.push(`--sm-kind-${entry.name}-bg: ${lightTints.bg};`);
      lightDecls.push(`--sm-kind-${entry.name}-fg: ${lightTints.fg};`);
      darkDecls.push(`--sm-kind-${entry.name}: ${darkBase};`);
      darkDecls.push(`--sm-kind-${entry.name}-bg: ${darkTints.bg};`);
      darkDecls.push(`--sm-kind-${entry.name}-fg: ${darkTints.fg};`);
    }
    styleEl.textContent =
      `:root { ${lightDecls.join(' ')} } .app-dark { ${darkDecls.join(' ')} }`;
  }
}

const STYLE_EL_ID = 'sm-kind-vars';

function ensureStyleElement(): HTMLStyleElement {
  let el = document.getElementById(STYLE_EL_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_EL_ID;
    document.head.appendChild(el);
  }
  return el;
}

function sameRegistry(a: readonly IKindRegistryEntry[], b: readonly IKindRegistryEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.name !== y.name || x.providerId !== y.providerId || x.label !== y.label) return false;
    if (x.color !== y.color || x.colorDark !== y.colorDark || x.emoji !== y.emoji) return false;
    if (JSON.stringify(x.icon) !== JSON.stringify(y.icon)) return false;
  }
  return true;
}
