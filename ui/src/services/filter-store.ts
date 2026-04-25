/**
 * Cross-view filter state. Kept in a root-level service so the list view,
 * graph view, and (future) inspector-list all read the same filter values
 * without URL coupling. Resetting is a single call.
 */

import { Injectable, computed, signal } from '@angular/core';
import type { TNodeKind, TNodeView, TStability } from '../models/node';

/**
 * Display order of kinds across the UI (palette, filter-bar dropdown,
 * any future kind-iterating widget). Agent first because it is the
 * primary actor in most user mental models; skills follow as the tools
 * an agent uses.
 */
export const ALL_KINDS: readonly TNodeKind[] = ['agent', 'skill', 'command', 'hook', 'note'];
export const ALL_STABILITIES: readonly TStability[] = ['stable', 'experimental', 'deprecated'];

@Injectable({ providedIn: 'root' })
export class FilterStoreService {
  readonly searchText = signal<string>('');
  readonly selectedKinds = signal<TNodeKind[]>([]);
  readonly selectedStabilities = signal<TStability[]>([]);
  readonly hasIssuesOnly = signal<boolean>(false);

  readonly isActive = computed(
    () =>
      this.searchText().trim().length > 0 ||
      this.selectedKinds().length > 0 ||
      this.selectedStabilities().length > 0 ||
      this.hasIssuesOnly(),
  );

  setSearchText(value: string): void {
    this.searchText.set(value);
  }

  setKinds(kinds: TNodeKind[]): void {
    this.selectedKinds.set([...kinds]);
  }

  /**
   * Toggle a single kind. Semantics align with `apply()`:
   *   - empty `selectedKinds` array = "no kind filter" = all kinds active.
   *   - non-empty array = whitelist; only listed kinds pass.
   * The toggle treats the current visible set (all kinds when empty) as
   * the starting point, flips the requested kind, and normalises back to
   * the empty array when every kind is on (so the filter-bar `isActive`
   * computation keeps reading false for the all-on state).
   */
  toggleKind(kind: TNodeKind): void {
    const sel = this.selectedKinds();
    const startSet = sel.length === 0 ? new Set<TNodeKind>(ALL_KINDS) : new Set(sel);
    if (startSet.has(kind)) {
      startSet.delete(kind);
    } else {
      startSet.add(kind);
    }
    if (startSet.size === ALL_KINDS.length) {
      this.selectedKinds.set([]);
    } else {
      this.selectedKinds.set([...startSet]);
    }
  }

  /** True when the kind is currently visible (passes the kind filter). */
  isKindActive(kind: TNodeKind): boolean {
    const sel = this.selectedKinds();
    if (sel.length === 0) return true;
    return sel.includes(kind);
  }

  setStabilities(stabilities: TStability[]): void {
    this.selectedStabilities.set([...stabilities]);
  }

  setHasIssuesOnly(value: boolean): void {
    this.hasIssuesOnly.set(value);
  }

  reset(): void {
    this.searchText.set('');
    this.selectedKinds.set([]);
    this.selectedStabilities.set([]);
    this.hasIssuesOnly.set(false);
  }

  /**
   * Applies all three filters to a list of nodes in declared order:
   * (1) text search over path / name / description; (2) kind membership;
   * (3) stability membership. Empty filter values are treated as "allow all".
   */
  apply(nodes: TNodeView[]): TNodeView[] {
    const text = this.searchText().trim().toLowerCase();
    const kinds = this.selectedKinds();
    const stabilities = this.selectedStabilities();
    const issuesOnly = this.hasIssuesOnly();

    return nodes.filter((n) => {
      if (text) {
        const haystack = [
          n.path,
          n.frontmatter.name ?? '',
          n.frontmatter.description ?? '',
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(text)) return false;
      }
      if (kinds.length > 0 && !kinds.includes(n.kind)) return false;
      if (stabilities.length > 0) {
        const s = n.frontmatter.metadata?.stability;
        if (!s || !stabilities.includes(s)) return false;
      }
      if (issuesOnly && !nodeHasIssues(n)) return false;
      return true;
    });
  }
}

function nodeHasIssues(n: TNodeView): boolean {
  const meta = n.frontmatter.metadata;
  if (!meta) return false;
  return meta.stability === 'deprecated' || !!meta.supersededBy;
}
