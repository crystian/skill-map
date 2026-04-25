import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  FCanvasComponent,
  FFlowModule,
  FVirtualFor,
  FZoomDirective,
  EFConnectableSide,
  EFZoomDirection,
  type FCanvasChangeEvent,
} from '@foblex/flow';
import { graphlib, layout as dagreLayout } from '@dagrejs/dagre';

import { DEFAULT_SETTINGS } from '../../../models/settings';

import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { ThemeService } from '../../../services/theme';
import { FilterBar } from '../../components/filter-bar/filter-bar';
import { KindPalette } from '../../components/kind-palette/kind-palette';
import { PerfHud } from '../../components/perf-hud/perf-hud';
import type {
  TNodeKind,
  TNodeView,
  IFrontmatterAgent,
  IFrontmatterCommand,
  IFrontmatterHook,
  IFrontmatterSkill,
} from '../../../models/node';

interface IGraphNode {
  id: string;
  path: string;
  label: string;
  kind: TNodeKind;
  subtitle: string | null;
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
const NODE_HEIGHT = 110;

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;
const ZOOM_BUTTON_STEP = 0.2;

const VIEWPORT_STORAGE_KEY = 'sm.graph.viewport';
const NODE_POSITIONS_STORAGE_KEY = 'sm.graph.node-positions';

interface IStoredViewport {
  x: number;
  y: number;
  scale: number;
}

interface IPoint {
  x: number;
  y: number;
}

type TNodePositions = Record<string, IPoint>;

@Component({
  selector: 'app-graph-view',
  standalone: true,
  imports: [FilterBar, FFlowModule, FVirtualFor, KindPalette, PerfHud],
  templateUrl: './graph-view.html',
  styleUrl: './graph-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphView implements OnInit, OnDestroy {
  private readonly loader = inject(CollectionLoaderService);
  private readonly filters = inject(FilterStoreService);
  private readonly router = inject(Router);
  private readonly theme = inject(ThemeService);

  private readonly canvas = viewChild(FCanvasComponent);
  private readonly zoom = viewChild(FZoomDirective);
  private readonly canvasWrap = viewChild<ElementRef<HTMLElement>>('canvasWrap');

  readonly outputSide = EFConnectableSide.BOTTOM;
  readonly inputSide = EFConnectableSide.TOP;

  /**
   * Compile-time defaults from `models/settings.ts`. Read directly today;
   * the runtime config service that loads `/config.json` and merges with
   * defaults lands with the `sm ui` CLI (ROADMAP §Step 14). Until then,
   * the shape here matches the future service signal exactly so the
   * migration is a one-line import swap.
   */
  protected readonly perf = DEFAULT_SETTINGS.graph.perf;
  protected readonly perfHud = DEFAULT_SETTINGS.graph.perfHud;

  private pointerDownAt: { x: number; y: number } | null = null;
  private readonly savedViewport = readStoredViewport();
  private hasCompletedInitialLayout = false;

  protected readonly initialPosition = this.savedViewport
    ? { x: this.savedViewport.x, y: this.savedViewport.y }
    : { x: 0, y: 0 };
  protected readonly initialScale = this.savedViewport?.scale ?? 1;

  private readonly scale = signal(this.initialScale);
  protected readonly canZoomIn = computed(() => this.scale() < ZOOM_MAX - 1e-6);
  protected readonly canZoomOut = computed(() => this.scale() > ZOOM_MIN + 1e-6);

  protected readonly themeMode = this.theme.mode;
  protected readonly themeIcon = computed(() =>
    this.themeMode() === 'dark' ? 'pi pi-sun' : 'pi pi-moon',
  );
  protected readonly themeLabel = computed(() =>
    this.themeMode() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
  );

  private middlePanOrigin: { mouseX: number; mouseY: number; canvasX: number; canvasY: number } | null = null;

  private readonly nodePositions = signal<TNodePositions>(readStoredNodePositions());

  readonly loading = this.loader.loading;
  readonly error = this.loader.error;

  private readonly visibleNodes = computed(() => this.filters.apply(this.loader.nodes()));

  /**
   * Layout cache — dagre runs ONCE over the full collection, not over the
   * filtered subset. Filters then project this cache to the visible nodes
   * without recomputing positions, so unmoved nodes stay put when the user
   * toggles a filter. Recomputed only when `loader.nodes()` itself changes
   * (initial load + the rare collection refresh). Manual drag positions
   * (`nodePositions`) are NOT a dagre input — they override per-node at
   * projection time, so dragging a node never invalidates the cache.
   */
  private readonly fullLayout = computed<IFullLayout>(() => computeFullLayout(this.loader.nodes()));

  readonly graph = computed<IGraphData>(() => {
    const visibleIds = new Set(this.visibleNodes().map((n) => n.path));
    return projectVisible(this.fullLayout(), visibleIds, this.nodePositions());
  });

  readonly hasData = computed(() => this.graph().nodes.length > 0);

  /** Counters / timestamp exposed to the perf HUD. Pure derivations. */
  protected readonly visibleCount = computed(() => this.graph().nodes.length);
  protected readonly totalCount = computed(() => this.loader.nodes().length);
  protected readonly edgeCount = computed(() => this.graph().edges.length);
  protected readonly layoutComputedAt = computed(() => this.fullLayout().computedAt);

  readonly selectedNodeId = signal<string | null>(null);

  /**
   * Adjacency map (undirected): node id → set of node ids it shares an edge with.
   * Used by `is*` helpers to drive highlight / dim classes after a click.
   */
  private readonly adjacency = computed<Map<string, Set<string>>>(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of this.graph().edges) {
      if (!map.has(edge.from)) map.set(edge.from, new Set());
      if (!map.has(edge.to)) map.set(edge.to, new Set());
      map.get(edge.from)!.add(edge.to);
      map.get(edge.to)!.add(edge.from);
    }
    return map;
  });

  /**
   * Drop the selection if the underlying graph no longer contains the
   * selected node (e.g. filters changed). Avoids dangling highlight state.
   */
  private readonly selectionGuard = effect(() => {
    const id = this.selectedNodeId();
    if (id === null) return;
    const exists = this.graph().nodes.some((n) => n.id === id);
    if (!exists) this.selectedNodeId.set(null);
  });

  constructor() {
    // Initial layout only — fit to screen once when the first batch of
    // nodes arrives. Filter changes do NOT trigger a re-fit: the layout
    // cache keeps unmoved nodes in place, and re-fitting would jump the
    // viewport every time the user toggles a kind. The "Fit to screen"
    // toolbar button is the explicit re-fit affordance.
    effect(() => {
      const visible = this.visibleNodes();
      if (this.hasCompletedInitialLayout) return;
      if (visible.length === 0) return;
      queueMicrotask(() => {
        this.hasCompletedInitialLayout = true;
        if (!this.savedViewport) {
          this.canvas()?.fitToScreen({ x: 40, y: 40 }, false);
        }
      });
    });
  }

  ngOnInit(): void {
    if (this.loader.nodes().length === 0 && !this.loader.loading()) {
      void this.loader.load();
    }
  }

  onLoaded(): void {
    // Intentional no-op — the effect above handles initial layout once the
    // graph data is ready. Kept as a template hook in case we need it later.
  }

  onCanvasChange(event: FCanvasChangeEvent): void {
    this.scale.set(event.scale);
    if (!this.hasCompletedInitialLayout) return;
    const payload: IStoredViewport = {
      x: event.position.x,
      y: event.position.y,
      scale: event.scale,
    };
    try {
      localStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Quota exceeded or storage blocked (private mode) — ignore.
    }
  }

  onNodePositionChange(id: string, position: IPoint): void {
    this.nodePositions.update((current) => ({
      ...current,
      [id]: { x: position.x, y: position.y },
    }));
    writeStoredNodePositions(this.nodePositions());
  }

  zoomIn(): void {
    this.zoom()?.setZoom(this.getViewportCenter(), ZOOM_BUTTON_STEP, EFZoomDirection.ZOOM_IN, true);
  }

  zoomOut(): void {
    this.zoom()?.setZoom(this.getViewportCenter(), ZOOM_BUTTON_STEP, EFZoomDirection.ZOOM_OUT, true);
  }

  resetZoom(): void {
    this.canvas()?.resetScale();
  }

  fitToScreen(): void {
    this.canvas()?.fitToScreen({ x: 40, y: 40 }, true);
  }

  resetLayout(): void {
    if (Object.keys(this.nodePositions()).length === 0) {
      this.canvas()?.fitToScreen({ x: 40, y: 40 }, true);
      return;
    }
    const ok = window.confirm(
      'Reset all node positions to the automatic layout? This cannot be undone.',
    );
    if (!ok) return;
    this.nodePositions.set({});
    try {
      localStorage.removeItem(NODE_POSITIONS_STORAGE_KEY);
    } catch {
      // ignore
    }
    queueMicrotask(() => this.canvas()?.fitToScreen({ x: 40, y: 40 }, true));
  }

  private getViewportCenter(): { x: number; y: number } {
    const host = this.canvasWrap()?.nativeElement;
    if (!host) return { x: 0, y: 0 };
    const rect = host.getBoundingClientRect();
    return { x: rect.width / 2, y: rect.height / 2 };
  }

  onCanvasMouseDown(event: MouseEvent): void {
    if (event.button !== 1) return;
    event.preventDefault();
    const pos = this.canvas()?.getPosition() ?? { x: 0, y: 0 };
    this.middlePanOrigin = { mouseX: event.clientX, mouseY: event.clientY, canvasX: pos.x, canvasY: pos.y };
    document.addEventListener('mousemove', this.onMiddlePanMove);
    document.addEventListener('mouseup', this.onMiddlePanEnd);
  }

  private readonly onMiddlePanMove = (event: MouseEvent): void => {
    if (!this.middlePanOrigin) return;
    const canvas = this.canvas();
    if (!canvas) return;
    canvas.setPosition({
      x: this.middlePanOrigin.canvasX + (event.clientX - this.middlePanOrigin.mouseX),
      y: this.middlePanOrigin.canvasY + (event.clientY - this.middlePanOrigin.mouseY),
    });
    canvas.redraw();
  };

  private readonly onMiddlePanEnd = (): void => {
    this.middlePanOrigin = null;
    document.removeEventListener('mousemove', this.onMiddlePanMove);
    document.removeEventListener('mouseup', this.onMiddlePanEnd);
    this.canvas()?.emitCanvasChangeEvent();
  };

  ngOnDestroy(): void {
    this.onMiddlePanEnd();
  }

  onNodePointerDown(event: PointerEvent): void {
    this.pointerDownAt = { x: event.clientX, y: event.clientY };
  }

  selectNode(node: IGraphNode, event: MouseEvent): void {
    if (!this.isClickWithoutDrag(event)) return;
    this.selectedNodeId.set(node.id);
  }

  openNode(node: IGraphNode): void {
    // Single-click already filtered drag→click sequences via selectNode's
    // guard; dblclick only fires for two close, in-place clicks. Just navigate.
    void this.router.navigate(['/inspector'], { queryParams: { path: node.path } });
  }

  /**
   * Click anywhere on the canvas that is NOT a node deselects. Foblex's
   * `<f-flow>` does not expose a "background click" event, so we listen on
   * the wrapper and filter by target.
   */
  onCanvasClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.sm-gnode')) return;
    if (target?.closest('.graph__toolbar')) return;
    if (target?.closest('.perf-hud')) return;
    if (target?.closest('.kind-palette')) return;
    this.selectedNodeId.set(null);
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  isSelected(id: string): boolean {
    return this.selectedNodeId() === id;
  }

  isHighlighted(id: string): boolean {
    const sel = this.selectedNodeId();
    if (sel === null || sel === id) return false;
    return this.adjacency().get(sel)?.has(id) ?? false;
  }

  isDimmed(id: string): boolean {
    const sel = this.selectedNodeId();
    if (sel === null) return false;
    if (sel === id) return false;
    return !(this.adjacency().get(sel)?.has(id) ?? false);
  }

  isEdgeHighlighted(edge: IGraphEdge): boolean {
    const sel = this.selectedNodeId();
    return sel !== null && (edge.from === sel || edge.to === sel);
  }

  isEdgeDimmed(edge: IGraphEdge): boolean {
    const sel = this.selectedNodeId();
    if (sel === null) return false;
    return edge.from !== sel && edge.to !== sel;
  }

  private isClickWithoutDrag(event: MouseEvent): boolean {
    const start = this.pointerDownAt;
    this.pointerDownAt = null;
    if (!start) return true;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    return Math.hypot(dx, dy) <= 4;
  }
}

interface IFullLayout {
  /** Node views indexed by path — handy to project without re-iterating. */
  nodesByPath: Map<string, TNodeView>;
  /** Deduped, valid edges (both endpoints present in the loaded set). */
  edges: IGraphEdge[];
  /** Dagre-computed top-left positions for every loaded node. */
  positions: Map<string, IPoint>;
  /** `performance.now()` timestamp when this layout was computed. */
  computedAt: number;
}

/**
 * One-shot layout over the FULL loaded collection. Result is cached and
 * reused as the user filters — see `fullLayout` computed in GraphView.
 * Filters never trigger a re-layout, so unmoved nodes never jump.
 */
function computeFullLayout(allNodes: TNodeView[]): IFullLayout {
  const loadedIds = new Set(allNodes.map((n) => n.path));
  const edges: IGraphEdge[] = [];

  for (const n of allNodes) {
    const meta = n.frontmatter.metadata ?? {};
    for (const target of meta.supersedes ?? []) {
      if (loadedIds.has(target)) {
        edges.push({ id: edgeId('sup', n.path, target), from: n.path, to: target, kind: 'supersedes' });
      }
    }
    if (meta.supersededBy && loadedIds.has(meta.supersededBy)) {
      edges.push({
        id: edgeId('sup', n.path, meta.supersededBy),
        from: n.path,
        to: meta.supersededBy,
        kind: 'supersedes',
      });
    }
    for (const target of meta.requires ?? []) {
      if (loadedIds.has(target)) {
        edges.push({ id: edgeId('req', n.path, target), from: n.path, to: target, kind: 'requires' });
      }
    }
    for (const target of meta.related ?? []) {
      if (loadedIds.has(target)) {
        edges.push({ id: edgeId('rel', n.path, target), from: n.path, to: target, kind: 'related' });
      }
    }
  }

  // Dedup edges by id (supersedes can come from both sides).
  const byId = new Map<string, IGraphEdge>();
  for (const e of edges) byId.set(e.id, e);
  const uniqueEdges = [...byId.values()];

  // Dagre layout over the full graph.
  const g = new graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 80, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of allNodes) {
    g.setNode(n.path, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const e of uniqueEdges) {
    g.setEdge(e.from, e.to);
  }
  dagreLayout(g);

  const positions = new Map<string, IPoint>();
  for (const n of allNodes) {
    const pos = g.node(n.path);
    positions.set(n.path, {
      x: (pos?.x ?? 0) - NODE_WIDTH / 2,
      y: (pos?.y ?? 0) - NODE_HEIGHT / 2,
    });
  }

  const nodesByPath = new Map<string, TNodeView>();
  for (const n of allNodes) nodesByPath.set(n.path, n);

  return { nodesByPath, edges: uniqueEdges, positions, computedAt: performance.now() };
}

/**
 * Project the cached layout to the visible subset. Pure projection — no
 * dagre, no relayout. Manual drag positions (`stored`) override the
 * cached dagre position per node. Edge link counts are computed against
 * visible-only edges so the in/out badges reflect what the user can see.
 */
function projectVisible(
  layout: IFullLayout,
  visibleIds: Set<string>,
  stored: TNodePositions,
): IGraphData {
  const visibleEdges = layout.edges.filter(
    (e) => visibleIds.has(e.from) && visibleIds.has(e.to),
  );

  const outCount = new Map<string, number>();
  const inCount = new Map<string, number>();
  for (const e of visibleEdges) {
    outCount.set(e.from, (outCount.get(e.from) ?? 0) + 1);
    inCount.set(e.to, (inCount.get(e.to) ?? 0) + 1);
  }

  const nodes: IGraphNode[] = [];
  for (const id of visibleIds) {
    const view = layout.nodesByPath.get(id);
    if (!view) continue;
    const override = stored[id];
    const cached = layout.positions.get(id) ?? { x: 0, y: 0 };
    const position = override ? { x: override.x, y: override.y } : cached;
    nodes.push({
      id,
      path: id,
      label: view.frontmatter.name ?? id,
      kind: view.kind,
      subtitle: nodeSubtitle(view),
      position,
      linksOut: outCount.get(id) ?? 0,
      linksIn: inCount.get(id) ?? 0,
    });
  }

  return { nodes, edges: visibleEdges };
}

function readStoredViewport(): IStoredViewport | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(VIEWPORT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isStoredViewport(parsed) ? parsed : null;
}

function readStoredNodePositions(): TNodePositions {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(NODE_POSITIONS_STORAGE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};
  const result: TNodePositions = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (isPoint(value)) result[key] = { x: value.x, y: value.y };
  }
  return result;
}

function writeStoredNodePositions(positions: TNodePositions): void {
  try {
    localStorage.setItem(NODE_POSITIONS_STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // Quota exceeded or storage blocked — ignore.
  }
}

function isPoint(value: unknown): value is IPoint {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['x'] === 'number' &&
    typeof v['y'] === 'number' &&
    Number.isFinite(v['x']) &&
    Number.isFinite(v['y'])
  );
}

function isStoredViewport(value: unknown): value is IStoredViewport {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['x'] === 'number' &&
    typeof v['y'] === 'number' &&
    typeof v['scale'] === 'number' &&
    Number.isFinite(v['x']) &&
    Number.isFinite(v['y']) &&
    Number.isFinite(v['scale']) &&
    (v['scale'] as number) > 0
  );
}

function edgeId(prefix: string, from: string, to: string): string {
  const [a, b] = [from, to].sort();
  return `${prefix}:${a}::${b}`;
}

function nodeSubtitle(n: TNodeView): string | null {
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
      return ins || outs ? `${ins} in · ${outs} out` : null;
    }
    default:
      return null;
  }
}
