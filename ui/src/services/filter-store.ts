/**
 * Cross-view filter state. Kept in a root-level service so the list view,
 * graph view, and (future) inspector-list all read the same filter values
 * without URL coupling. Resetting is a single call.
 */

import { Injectable, computed, signal } from '@angular/core';
import type { TNodeKind, TNodeView, TStability } from '../models/node';

export const ALL_KINDS: readonly TNodeKind[] = ['skill', 'agent', 'command', 'hook', 'note'];
export const ALL_STABILITIES: readonly TStability[] = ['stable', 'experimental', 'deprecated'];

@Injectable({ providedIn: 'root' })
export class FilterStoreService {
  readonly searchText = signal<string>('');
  readonly selectedKinds = signal<TNodeKind[]>([]);
  readonly selectedStabilities = signal<TStability[]>([]);

  readonly isActive = computed(
    () =>
      this.searchText().trim().length > 0 ||
      this.selectedKinds().length > 0 ||
      this.selectedStabilities().length > 0,
  );

  setSearchText(value: string): void {
    this.searchText.set(value);
  }

  setKinds(kinds: TNodeKind[]): void {
    this.selectedKinds.set([...kinds]);
  }

  setStabilities(stabilities: TStability[]): void {
    this.selectedStabilities.set([...stabilities]);
  }

  reset(): void {
    this.searchText.set('');
    this.selectedKinds.set([]);
    this.selectedStabilities.set([]);
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
      return true;
    });
  }
}
