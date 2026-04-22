import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-graph-view',
  standalone: true,
  template: `
    <section class="stub">
      <h2>Graph view</h2>
      <p>Coming in Step 0c Phase B3 — Foblex Flow cards + edges.</p>
    </section>
  `,
  styles: [
    `
      .stub {
        padding: 2rem;
        color: var(--p-text-muted-color, #666);
      }
      .stub h2 {
        margin: 0 0 0.5rem;
        font-size: 1.25rem;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphView {}
