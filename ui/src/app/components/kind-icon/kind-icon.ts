import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import type { TNodeKind } from '../../../models/node';
import { KindRegistryService } from '../../../services/kind-registry';

/**
 * Kind icon — renders the canonical glyph for a node kind. Single source
 * of iconography for the app: graph nodes (`<sm-node-card>`) and the
 * filter toolbar (`<app-kind-palette>`) both consume it so the visual
 * vocabulary is consistent.
 *
 * Step 14.5.d: the icon descriptor comes from the runtime
 * `KindRegistryService` (Provider-declared `ui.icon` on `IProviderKind`)
 * instead of a hardcoded `@switch` over closed kind names. The fallback
 * chain is: PrimeIcons class → SVG path → emoji → first letter of label.
 * SVG paths inherit `currentColor` so kind-tinting comes from the host.
 */
type TIconVariant = 'pi' | 'svg' | 'emoji' | 'letter';

@Component({
  selector: 'sm-kind-icon',
  imports: [],
  templateUrl: './kind-icon.html',
  styleUrl: './kind-icon.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KindIcon {
  private readonly kindRegistry = inject(KindRegistryService);

  readonly kind = input.required<TNodeKind>();
  readonly size = input<number>(18);

  protected readonly variant = computed<TIconVariant>(() => {
    const entry = this.kindRegistry.lookup(this.kind());
    if (entry?.icon?.kind === 'pi') return 'pi';
    if (entry?.icon?.kind === 'svg') return 'svg';
    if (entry?.emoji) return 'emoji';
    return 'letter';
  });

  protected readonly piClass = computed<string>(() => {
    const icon = this.kindRegistry.lookup(this.kind())?.icon;
    return icon?.kind === 'pi' ? `pi ${icon.id}` : '';
  });

  protected readonly svgPath = computed<string>(() => {
    const icon = this.kindRegistry.lookup(this.kind())?.icon;
    return icon?.kind === 'svg' ? icon.path : '';
  });

  protected readonly emoji = computed<string>(() => {
    return this.kindRegistry.lookup(this.kind())?.emoji ?? '';
  });

  protected readonly letter = computed<string>(() => {
    const label = this.kindRegistry.labelOf(this.kind());
    return label.charAt(0).toUpperCase();
  });
}
