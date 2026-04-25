import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { TNodeKind } from '../../../models/node';

/**
 * Kind icon — renders the canonical glyph for a node kind. Single source
 * of iconography for the app: graph nodes (`<sm-node-card>`) and the
 * filter toolbar (`<app-kind-palette>`) both consume it so the visual
 * vocabulary is consistent.
 *
 * Mix of PrimeIcons (where the official set has the right glyph) and
 * inline Lucide-style SVG (where it doesn't — terminal prompt for
 * `command`, anchor for `hook`, file-with-lines for `note`). All SVG
 * paths inherit `currentColor` so kind-tinting comes from the host.
 */
@Component({
  selector: 'sm-kind-icon',
  imports: [],
  templateUrl: './kind-icon.html',
  styleUrl: './kind-icon.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KindIcon {
  readonly kind = input.required<TNodeKind>();
  readonly size = input<number>(18);

  protected readonly variant = computed<'pi' | 'svg'>(() => {
    const k = this.kind();
    return k === 'agent' || k === 'skill' ? 'pi' : 'svg';
  });

  protected readonly piClass = computed<string>(() => {
    const k = this.kind();
    if (k === 'agent') return 'pi pi-user';
    if (k === 'skill') return 'pi pi-bolt';
    return ''; // SVG kinds — see template
  });
}
