import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { TooltipModule } from 'primeng/tooltip';

import { KIND_PALETTE_TEXTS } from '../../../i18n/kind-palette.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { KindRegistryService } from '../../../services/kind-registry';
import type { TNodeKind } from '../../../models/node';

interface IKindEntry {
  readonly kind: TNodeKind;
  /**
   * PrimeIcon class string. Falls back to a generic `pi pi-tag` when the
   * Provider declared a non-`pi` icon (SVG path) — the toggle-button
   * icon input only accepts a class, so SVG-based kinds get a neutral
   * icon here while the rich `<sm-kind-icon>` renders the SVG variant
   * everywhere else (list rows, inspector, graph nodes).
   */
  readonly icon: string;
  readonly label: string;
  readonly count: number;
}

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
 *
 * Step 14.5.d: the kind catalog comes from `KindRegistryService` (fed by
 * the BFF's `kindRegistry` envelope field) instead of a hardcoded enum.
 * A user-plugin Provider that declares a new kind shows up automatically.
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
  private readonly kindRegistry = inject(KindRegistryService);

  protected readonly texts = KIND_PALETTE_TEXTS;

  protected readonly entries = computed<readonly IKindEntry[]>(() => {
    const counts = new Map<string, number>();
    for (const n of this.loader.nodes()) {
      counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
    }
    return this.kindRegistry.kinds().map((entry) => ({
      kind: entry.name,
      icon: entry.icon?.kind === 'pi' ? `pi ${entry.icon.id}` : 'pi pi-tag',
      label: entry.label,
      count: counts.get(entry.name) ?? 0,
    }));
  });

  isActive(kind: TNodeKind): boolean {
    return this.filters.isKindActive(kind);
  }

  toggle(kind: TNodeKind): void {
    this.filters.toggleKind(kind);
  }
}
