import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { CollectionLoaderService } from '../services/collection-loader';
import type { TNodeKind } from '../models/node';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  private readonly loader = inject(CollectionLoaderService);

  readonly loading = this.loader.loading;
  readonly error = this.loader.error;
  readonly nodes = this.loader.nodes;
  readonly count = this.loader.count;
  readonly byKind = this.loader.byKind;

  readonly kindOrder: TNodeKind[] = ['skill', 'agent', 'command', 'hook', 'note'];

  readonly kindSummary = computed(() => {
    const buckets = this.byKind();
    return this.kindOrder.map((kind) => ({ kind, count: buckets[kind].length }));
  });

  ngOnInit(): void {
    void this.loader.load();
  }
}
