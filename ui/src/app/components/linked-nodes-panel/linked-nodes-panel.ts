import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { ChipModule } from 'primeng/chip';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { LINKED_NODES_PANEL_TEXTS } from '../../../i18n/linked-nodes-panel.texts';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../services/data-source/data-source.port';
import type { ILinkApi, TLinkConfidenceApi, TLinkKindApi } from '../../../models/api';

/**
 * Linked-nodes panel state machine. Drives the card's `@switch` block.
 *   - `idle` — no path selected (component renders nothing).
 *   - `loading` — outgoing+incoming fetch in flight.
 *   - `ready` — both lists resolved (each may be empty independently).
 *   - `error` — at least one list-links call threw.
 */
type TPanelState = 'idle' | 'loading' | 'ready' | 'error';

const KIND_SEVERITY: Record<TLinkKindApi, 'info' | 'success' | 'warn' | 'danger' | 'secondary'> = {
  invokes: 'warn',
  references: 'info',
  mentions: 'secondary',
  supersedes: 'success',
};

const CONFIDENCE_SEVERITY: Record<TLinkConfidenceApi, 'success' | 'info' | 'warn'> = {
  high: 'success',
  medium: 'info',
  low: 'warn',
};

@Component({
  selector: 'sm-linked-nodes-panel',
  standalone: true,
  imports: [CardModule, TagModule, ChipModule, ButtonModule, TooltipModule],
  templateUrl: './linked-nodes-panel.html',
  styleUrl: './linked-nodes-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinkedNodesPanel {
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly texts = LINKED_NODES_PANEL_TEXTS;

  /** Current node path. Falsy → component sits in `idle` (renders nothing). */
  readonly path = input<string | null | undefined>(null);

  /**
   * Emitted when the user clicks a target/source path in the rendered
   * rows. The Inspector view subscribes and routes to the chosen node.
   * The panel itself stays unaware of routing.
   */
  readonly openPath = output<string>();

  protected readonly state = signal<TPanelState>('idle');
  protected readonly outgoing = signal<readonly ILinkApi[]>([]);
  protected readonly incoming = signal<readonly ILinkApi[]>([]);

  /**
   * Monotonic fetch token. A late resolution from a previous `path()`
   * value is dropped if the user already navigated to a different node.
   * Same pattern as the body card (`inspector-view.ts`).
   */
  private fetchToken = 0;

  /**
   * Computed for the template — true while no path is set OR while
   * loading. The card itself stays mounted but the inner block
   * branches on `state()`.
   */
  protected readonly hasResults = computed(
    () => this.state() === 'ready' && (this.outgoing().length > 0 || this.incoming().length > 0),
  );

  constructor() {
    // Reactive refresh on `scan.completed` — same trigger the
    // CollectionLoader uses. Re-running list-links keeps the panel in
    // step with watcher-driven re-scans without forcing the user to
    // hit refresh manually.
    this.dataSource
      .events()
      .pipe(
        filter((e) => e.type === 'scan.completed'),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        const path = this.path();
        if (path) void this.fetch(path);
      });

    // Initial + path-change fetch.
    effect(() => {
      const path = this.path();
      if (!path) {
        this.fetchToken++;
        this.state.set('idle');
        this.outgoing.set([]);
        this.incoming.set([]);
        return;
      }
      void this.fetch(path);
    });
  }

  /** Manual refresh — wired to the card header's button. */
  protected refresh(): void {
    const path = this.path();
    if (path) void this.fetch(path);
  }

  protected onOpen(target: string): void {
    this.openPath.emit(target);
  }

  protected kindSeverity(kind: TLinkKindApi): 'info' | 'success' | 'warn' | 'danger' | 'secondary' {
    return KIND_SEVERITY[kind] ?? 'secondary';
  }

  protected confidenceSeverity(c: TLinkConfidenceApi): 'success' | 'info' | 'warn' {
    return CONFIDENCE_SEVERITY[c] ?? 'info';
  }

  protected confidenceLabel(c: TLinkConfidenceApi): string {
    return this.texts.confidence[c] ?? c;
  }

  /**
   * Fetch the two link lists in parallel. The token guard discards a
   * stale resolution if the user navigated mid-flight.
   */
  private async fetch(path: string): Promise<void> {
    const token = ++this.fetchToken;
    this.state.set('loading');
    try {
      const [outRes, inRes] = await Promise.all([
        this.dataSource.listLinks({ from: path }),
        this.dataSource.listLinks({ to: path }),
      ]);
      if (token !== this.fetchToken) return;
      this.outgoing.set(outRes.items);
      this.incoming.set(inRes.items);
      this.state.set('ready');
    } catch {
      if (token !== this.fetchToken) return;
      this.outgoing.set([]);
      this.incoming.set([]);
      this.state.set('error');
    }
  }
}
