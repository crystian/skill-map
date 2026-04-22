import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { FCanvasComponent, FFlowModule, EFConnectableSide } from '@foblex/flow';
import { graphlib, layout as dagreLayout } from '@dagrejs/dagre';
import { ButtonModule } from 'primeng/button';

import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { FilterBar } from '../../components/filter-bar/filter-bar';
import type { TNodeKind, TNodeView } from '../../../models/node';

interface IGraphNode {
  id: string;
  path: string;
  label: string;
  kind: TNodeKind;
  position: { x: number; y: number };
  linksOut: number;
  linksIn: number;
}

type TEdgeKind = 'supersedes' | 'requires' | 'related';

interface IGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: TEdgeKind;
}

interface IGraphData {
  nodes: IGraphNode[];
  edges: IGraphEdge[];
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 96;

@Component({
  selector: 'app-graph-view',
  standalone: true,
  imports: [FilterBar, FFlowModule, ButtonModule],
  templateUrl: './graph-view.html',
  styleUrl: './graph-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphView implements OnInit {
  private readonly loader = inject(CollectionLoaderService);
  private readonly filters = inject(FilterStoreService);
  private readonly router = inject(Router);

  private readonly canvas = viewChild(FCanvasComponent);

  readonly outputSide = EFConnectableSide.BOTTOM;
  readonly inputSide = EFConnectableSide.TOP;

  readonly loading = this.loader.loading;
  readonly error = this.loader.error;

  readonly graph = computed<IGraphData>(() => {
    const visible = this.filters.apply(this.loader.nodes());
    return buildGraph(visible);
  });

  readonly hasData = computed(() => this.graph().nodes.length > 0);

  constructor() {
    effect(() => {
      // Re-fit when the graph data changes.
      const data = this.graph();
      if (data.nodes.length === 0) return;
      queueMicrotask(() => this.canvas()?.fitToScreen({ x: 40, y: 40 }, false));
    });
  }

  ngOnInit(): void {
    if (this.loader.nodes().length === 0 && !this.loader.loading()) {
      void this.loader.load();
    }
  }

  onLoaded(): void {
    queueMicrotask(() => this.canvas()?.fitToScreen({ x: 40, y: 40 }, false));
  }

  openNode(node: IGraphNode): void {
    void this.router.navigate(['/inspector'], { queryParams: { path: node.path } });
  }

  fitToScreen(): void {
    this.canvas()?.fitToScreen({ x: 40, y: 40 }, false);
  }
}

function buildGraph(nodes: TNodeView[]): IGraphData {
  const visibleIds = new Set(nodes.map((n) => n.path));
  const edges: IGraphEdge[] = [];

  for (const n of nodes) {
    const meta = n.frontmatter.metadata ?? {};
    for (const target of meta.supersedes ?? []) {
      if (visibleIds.has(target)) {
        edges.push({ id: edgeId('sup', n.path, target), from: n.path, to: target, kind: 'supersedes' });
      }
    }
    if (meta.supersededBy && visibleIds.has(meta.supersededBy)) {
      edges.push({
        id: edgeId('sup', n.path, meta.supersededBy),
        from: n.path,
        to: meta.supersededBy,
        kind: 'supersedes',
      });
    }
    for (const target of meta.requires ?? []) {
      if (visibleIds.has(target)) {
        edges.push({ id: edgeId('req', n.path, target), from: n.path, to: target, kind: 'requires' });
      }
    }
    for (const target of meta.related ?? []) {
      if (visibleIds.has(target)) {
        edges.push({ id: edgeId('rel', n.path, target), from: n.path, to: target, kind: 'related' });
      }
    }
  }

  // Dedup edges by id (supersedes can come from both sides).
  const byId = new Map<string, IGraphEdge>();
  for (const e of edges) byId.set(e.id, e);
  const uniqueEdges = [...byId.values()];

  // Dagre layout.
  const g = new graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 80, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    g.setNode(n.path, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const e of uniqueEdges) {
    g.setEdge(e.from, e.to);
  }
  dagreLayout(g);

  const outCount = new Map<string, number>();
  const inCount = new Map<string, number>();
  for (const e of uniqueEdges) {
    outCount.set(e.from, (outCount.get(e.from) ?? 0) + 1);
    inCount.set(e.to, (inCount.get(e.to) ?? 0) + 1);
  }

  const laidOut: IGraphNode[] = nodes.map((n) => {
    const pos = g.node(n.path);
    return {
      id: n.path,
      path: n.path,
      label: n.frontmatter.name ?? n.path,
      kind: n.kind,
      position: {
        x: (pos?.x ?? 0) - NODE_WIDTH / 2,
        y: (pos?.y ?? 0) - NODE_HEIGHT / 2,
      },
      linksOut: outCount.get(n.path) ?? 0,
      linksIn: inCount.get(n.path) ?? 0,
    };
  });

  return { nodes: laidOut, edges: uniqueEdges };
}

function edgeId(prefix: string, from: string, to: string): string {
  const [a, b] = [from, to].sort();
  return `${prefix}:${a}::${b}`;
}
