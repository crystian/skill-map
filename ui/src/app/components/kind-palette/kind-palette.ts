import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { TooltipModule } from 'primeng/tooltip';

import { KIND_PALETTE_TEXTS } from '../../../i18n/kind-palette.texts';
import { KIND_LABELS } from '../../../i18n/kinds.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { ALL_KINDS, FilterStoreService } from '../../../services/filter-store';
import type { TNodeKind } from '../../../models/node';

interface IKindEntry {
  readonly kind: TNodeKind;
  readonly icon: string;
  readonly label: string;
  readonly count: number;
}

const KIND_ICON: Record<TNodeKind, string> = {
  skill: 'pi pi-wrench',
  agent: 'pi pi-user',
  command: 'pi pi-bolt',
  hook: 'pi pi-link',
  note: 'pi pi-file',
};

/**
 * Floating top-left palette for toggling node-kind visibility on the graph
 * view. Mirrors the layout of the call-center example's `flow-palette` in
 * Foblex/f-flow but adapted to PrimeIcons + the `--sm-kind-*` accent vars.
 *
 * Toggling delegates to `FilterStoreService.toggleKind`, so the palette
 * and the existing `<app-filter-bar>` `kinds` multi-select stay in sync
 * through the same signal — pick whichever the user prefers.
 *
 * Counts are total loaded nodes per kind (not "visible" — those would
 * shrink to 0 when this palette deactivates a kind, which is confusing).
 */
@Component({
  selector: 'app-kind-palette',
  imports: [FormsModule, ToggleButtonModule, TooltipModule],
  templateUrl: './kind-palette.html',
  styleUrl: './kind-palette.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KindPalette {
  private readonly loader = inject(CollectionLoaderService);
  private readonly filters = inject(FilterStoreService);

  protected readonly texts = KIND_PALETTE_TEXTS;

  protected readonly entries = computed<readonly IKindEntry[]>(() => {
    const counts: Record<TNodeKind, number> = {
      skill: 0,
      agent: 0,
      command: 0,
      hook: 0,
      note: 0,
    };
    for (const n of this.loader.nodes()) counts[n.kind] += 1;
    return ALL_KINDS.map((kind) => ({
      kind,
      icon: KIND_ICON[kind],
      label: KIND_LABELS[kind],
      count: counts[kind],
    }));
  });

  isActive(kind: TNodeKind): boolean {
    return this.filters.isKindActive(kind);
  }

  toggle(kind: TNodeKind): void {
    this.filters.toggleKind(kind);
  }
}
