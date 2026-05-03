/**
 * Cross-view filter state. Kept in a root-level service so the list view,
 * graph view, and (future) inspector-list all read the same filter values
 * without URL coupling. Resetting is a single call.
 *
 * Step 14.5.d — kinds are open per Provider. The "all kinds active"
 * universe is no longer a hardcoded enum; the toggle reads it from the
 * `KindRegistryService` (Provider-declared visual catalog) at call time
 * so a user-plugin Provider that adds a new kind participates in the
 * toggle / filter-bar without code changes here.
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import type { TNodeKind, INodeView, TStability } from '../models/node';
import { KindRegistryService } from './kind-registry';

export const ALL_STABILITIES: readonly TStability[] = ['stable', 'experimental', 'deprecated'];

@Injectable({ providedIn: 'root' })
export class FilterStoreService {
  private readonly kindRegistry = inject(KindRegistryService);

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
    const universe = this.kindRegistry.kinds().map((k) => k.name);
    const startSet = sel.length === 0 ? new Set<TNodeKind>(universe) : new Set(sel);
    if (startSet.has(kind)) {
      startSet.delete(kind);
    } else {
      startSet.add(kind);
    }
    if (startSet.size === universe.length) {
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
  apply(nodes: INodeView[]): INodeView[] {
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

function nodeHasIssues(n: INodeView): boolean {
  const meta = n.frontmatter.metadata;
  if (!meta) return false;
  return meta.stability === 'deprecated' || !!meta.supersededBy;
}
