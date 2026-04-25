import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';

import { LIST_VIEW_TEXTS } from '../../../i18n/list-view.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { FilterBar } from '../../components/filter-bar/filter-bar';
import type {
  TNodeKind,
  INodeView,
  TStability,
  IFrontmatterAgent,
  IFrontmatterCommand,
  IFrontmatterHook,
  IFrontmatterSkill,
} from '../../../models/node';

interface IListRow {
  path: string;
  kind: TNodeKind;
  name: string;
  detail: string | null;
  version: string;
  stability: TStability | '—';
  priority: number | null;
  node: INodeView;
}

const STABILITY_SEVERITY: Record<TStability | '—', 'success' | 'info' | 'warn' | 'danger' | 'secondary'> = {
  stable: 'success',
  experimental: 'info',
  deprecated: 'warn',
  '—': 'secondary',
};

const KIND_SEVERITY: Record<TNodeKind, 'info' | 'success' | 'warn' | 'danger' | 'secondary'> = {
  skill: 'info',
  agent: 'success',
  command: 'warn',
  hook: 'danger',
  note: 'secondary',
};

@Component({
  selector: 'app-list-view',
  imports: [
    FilterBar,
    TableModule,
    TagModule,
    ProgressSpinnerModule,
    MessageModule,
    ButtonModule,
  ],
  templateUrl: './list-view.html',
  styleUrl: './list-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListView implements OnInit {
  private readonly loader = inject(CollectionLoaderService);
  private readonly filters = inject(FilterStoreService);
  private readonly router = inject(Router);

  protected readonly texts = LIST_VIEW_TEXTS;

  readonly loading = this.loader.loading;
  readonly error = this.loader.error;
  readonly total = this.loader.count;
  readonly filtersActive = this.filters.isActive;

  readonly rows = computed<IListRow[]>(() => {
    const filtered = this.filters.apply(this.loader.nodes());
    return filtered.map((node) => ({
      path: node.path,
      kind: node.kind,
      name: node.frontmatter.name ?? LIST_VIEW_TEXTS.missing,
      detail: nodeDetail(node),
      version: node.frontmatter.metadata?.version ?? LIST_VIEW_TEXTS.missing,
      stability: (node.frontmatter.metadata?.stability as TStability | undefined) ?? LIST_VIEW_TEXTS.missing,
      priority: node.frontmatter.metadata?.priority ?? null,
      node,
    }));
  });

  readonly visibleCount = computed(() => this.rows().length);

  ngOnInit(): void {
    if (this.loader.nodes().length === 0 && !this.loader.loading()) {
      void this.loader.load();
    }
  }

  kindSeverity(kind: TNodeKind): 'info' | 'success' | 'warn' | 'danger' | 'secondary' {
    return KIND_SEVERITY[kind];
  }

  stabilitySeverity(s: TStability | '—'): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    return STABILITY_SEVERITY[s];
  }

  openInspector(row: IListRow): void {
    void this.router.navigate(['/inspector'], { queryParams: { path: row.path } });
  }

  resetFilters(): void {
    this.filters.reset();
  }
}

function nodeDetail(n: INodeView): string | null {
  switch (n.kind) {
    case 'agent':
      return (n.frontmatter as IFrontmatterAgent).model ?? null;
    case 'hook':
      return (n.frontmatter as IFrontmatterHook).event ?? null;
    case 'command':
      return (n.frontmatter as IFrontmatterCommand).shortcut ?? null;
    case 'skill': {
      const fm = n.frontmatter as IFrontmatterSkill;
      const ins = fm.inputs?.length ?? 0;
      const outs = fm.outputs?.length ?? 0;
      return ins || outs ? LIST_VIEW_TEXTS.detail.skillIO(ins, outs) : null;
    }
    default:
      return null;
  }
}
