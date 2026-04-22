import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { CollectionLoaderService } from '../../../services/collection-loader';

@Component({
  selector: 'app-inspector-view',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="inspector">
      <header>
        <h2>Inspector</h2>
        <a routerLink="/list">&larr; back to list</a>
      </header>
      @if (!pathParam()) {
        <p class="inspector__hint">No node selected. Pick one from the list.</p>
      } @else if (!node()) {
        <p class="inspector__hint">Node not found: <code>{{ pathParam() }}</code></p>
      } @else {
        <h3>{{ node()!.frontmatter.name }}</h3>
        <p class="inspector__meta">
          <code>{{ node()!.path }}</code> · <strong>{{ node()!.kind }}</strong>
        </p>
        <p>Full inspector UI lands in Phase B2.</p>
      }
    </section>
  `,
  styles: [
    `
      .inspector {
        padding: 2rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .inspector header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
      }
      .inspector h2 {
        margin: 0;
        font-size: 1.25rem;
      }
      .inspector__hint {
        color: var(--p-text-muted-color, #666);
      }
      .inspector__meta code {
        background: var(--p-surface-100, #f3f4f6);
        padding: 0.1rem 0.35rem;
        border-radius: 0.25rem;
        font-size: 0.85rem;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorView implements OnInit {
  private readonly loader = inject(CollectionLoaderService);

  readonly path = input<string | undefined>(undefined);

  readonly pathParam = computed(() => this.path() ?? null);

  readonly node = computed(() => {
    const path = this.pathParam();
    if (!path) return null;
    return this.loader.nodes().find((n) => n.path === path) ?? null;
  });

  ngOnInit(): void {
    if (this.loader.nodes().length === 0 && !this.loader.loading()) {
      void this.loader.load();
    }
  }
}
