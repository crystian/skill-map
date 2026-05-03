/**
 * `FilterUrlSyncService` — bidirectional sync between `FilterStoreService`
 * signals and the router URL query string. Enables deep linking
 * (filters survive a hard reload + share-link).
 *
 * Sync keys (omitted when empty / default):
 *   - `?search=`                — non-empty trimmed string.
 *   - `?kinds=agent,skill`      — comma-joined; empty array = absent.
 *   - `?stabilities=stable,…`   — comma-joined; empty array = absent.
 *   - `?hasIssues=true`         — present only when true.
 *
 * Loop avoidance: every URL write compares against the current params
 * before pushing. The reverse direction (URL → store) only runs once,
 * during construction (boot) and on subsequent NavigationEnd events. A
 * write triggered by a store change therefore round-trips through
 * Router → store unchanged (the store value already matches), and the
 * effect that writes the URL also short-circuits because the URL hasn't
 * changed.
 *
 * The service is `providedIn: 'root'` and self-bootstraps in its
 * constructor — `inject(FilterUrlSyncService)` once at app boot is
 * sufficient to wire the sync.
 */

import { Injectable, effect, inject } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';

import type { TNodeKind, TStability } from '../models/node';
import { ALL_STABILITIES, FilterStoreService } from './filter-store';
import { KindRegistryService } from './kind-registry';

const PARAM_SEARCH = 'search';
const PARAM_KINDS = 'kinds';
const PARAM_STABILITIES = 'stabilities';
const PARAM_HAS_ISSUES = 'hasIssues';

@Injectable({ providedIn: 'root' })
export class FilterUrlSyncService {
  private readonly filters = inject(FilterStoreService);
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly kindRegistry = inject(KindRegistryService);

  /** Suppress the URL→store sync while the store→URL effect is mid-flush. */
  private suppressUrlReadback = false;

  constructor() {
    // 1) Seed from current URL on boot.
    this.applyUrlToFilters(this.currentParams());

    // 2) Re-apply on every NavigationEnd (covers programmatic nav,
    //    back/forward, deep-link via direct URL bar edit).
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        if (this.suppressUrlReadback) return;
        this.applyUrlToFilters(this.currentParams());
      }
    });

    // 3) Push store changes to the URL.
    effect(() => {
      const next = this.computeQueryParams();
      this.writeQueryParams(next);
    });
  }

  // ---------- URL → store ----------

  /**
   * Read the current query params from the router's serialized URL.
   * Going through `Router.url` (rather than `window.location.search`)
   * keeps the lookup synchronous AND consistent with router state in
   * test harnesses (jsdom's `window.location` does not update on
   * `Router.navigateByUrl`).
   */
  private currentParams(): URLSearchParams {
    const tree = this.router.parseUrl(this.router.url);
    const out = new URLSearchParams();
    for (const [key, value] of Object.entries(tree.queryParams)) {
      if (Array.isArray(value)) {
        out.set(key, value.join(','));
      } else if (value !== null && value !== undefined) {
        out.set(key, String(value));
      }
    }
    // `activatedRoute` is referenced so Angular wires the dep — keeps
    // the service lifecycle-aware in case future versions of Router
    // demand an ActivatedRoute injection for `relativeTo` navigation.
    void this.activatedRoute;
    return out;
  }

  private applyUrlToFilters(params: URLSearchParams): void {
    const search = params.get(PARAM_SEARCH) ?? '';
    if (search !== this.filters.searchText()) {
      this.filters.setSearchText(search);
    }

    const kinds = parseKinds(params.get(PARAM_KINDS), this.kindRegistry.kinds().map((k) => k.name));
    if (!arraysEqual(kinds, this.filters.selectedKinds())) {
      this.filters.setKinds(kinds);
    }

    const stabilities = parseStabilities(params.get(PARAM_STABILITIES));
    if (!arraysEqual(stabilities, this.filters.selectedStabilities())) {
      this.filters.setStabilities(stabilities);
    }

    const hasIssues = params.get(PARAM_HAS_ISSUES) === 'true';
    if (hasIssues !== this.filters.hasIssuesOnly()) {
      this.filters.setHasIssuesOnly(hasIssues);
    }
  }

  // ---------- store → URL ----------

  /** Build the desired query-params record from current filter state. */
  private computeQueryParams(): Record<string, string | null> {
    const search = this.filters.searchText().trim();
    const kinds = this.filters.selectedKinds();
    const stabilities = this.filters.selectedStabilities();
    const hasIssues = this.filters.hasIssuesOnly();

    return {
      [PARAM_SEARCH]: search.length > 0 ? search : null,
      [PARAM_KINDS]: kinds.length > 0 ? kinds.join(',') : null,
      [PARAM_STABILITIES]: stabilities.length > 0 ? stabilities.join(',') : null,
      [PARAM_HAS_ISSUES]: hasIssues ? 'true' : null,
    };
  }

  /**
   * Push the desired params to the URL via `Router.navigate`. Skips
   * when the URL already carries the same values (loop guard). Uses
   * `queryParamsHandling: 'merge'` so unrelated params (other features
   * later) survive.
   */
  private writeQueryParams(next: Record<string, string | null>): void {
    const current = this.currentParams();
    const desired = new Map<string, string | null>(Object.entries(next));
    let changed = false;
    for (const [key, value] of desired) {
      const existing = current.get(key);
      const normalized = existing ?? null;
      if (normalized !== value) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    this.suppressUrlReadback = true;
    void this.router
      .navigate([], {
        relativeTo: this.activatedRoute,
        queryParams: next,
        queryParamsHandling: 'merge',
        replaceUrl: true,
      })
      .finally(() => {
        // Release the suppression on the next macro-task so the
        // NavigationEnd this navigate emits has finished propagating.
        setTimeout(() => {
          this.suppressUrlReadback = false;
        }, 0);
      });
  }
}

/**
 * Parse the comma-joined `kinds` query param. The allowed set comes
 * from the KindRegistryService at call time so the URL layer never
 * locks in a closed enum — a user-plugin Provider that ships a new
 * kind name participates in deep-link parsing as soon as the registry
 * ingests the BFF envelope.
 */
function parseKinds(raw: string | null, knownKinds: readonly TNodeKind[]): TNodeKind[] {
  if (!raw) return [];
  const allowed = new Set<TNodeKind>(knownKinds);
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => allowed.has(s));
}

function parseStabilities(raw: string | null): TStability[] {
  if (!raw) return [];
  const allowed = new Set<TStability>(ALL_STABILITIES);
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is TStability => allowed.has(s as TStability));
}

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

