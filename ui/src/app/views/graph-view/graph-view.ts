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
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
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

import { GRAPH_VIEW_TEXTS } from '../../../i18n/graph-view.texts';
import { DEFAULT_SETTINGS } from '../../../models/settings';

import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { detectLinks, type TLinkKind } from '../../../services/mock-links';
import { buildMockSummary } from '../../../services/mock-summary';
import { FilterBar } from '../../components/filter-bar/filter-bar';
import { KindPalette } from '../../components/kind-palette/kind-palette';
import { NodeCard } from '../../components/node-card/node-card';
import { PerfHud } from '../../components/perf-hud/perf-hud';
import type {
  TNodeKind,
  INodeStats,
  INodeView,
  TSummary,
} from '../../../models/node';

interface IGraphNode {
  id: string;
  path: string;
  /** Full parsed node — passed to <sm-node-card>. */
  view: INodeView;
  kind: TNodeKind;
  position: { x: number; y: number };
  /** Footer / subtitle stats. Computed during layout projection. */
  stats: INodeStats;
  /**
   * Deterministic mock summary so the LLM cluster on the card renders
   * during the in-browser prototype phase. Replaced by kernel-emitted
   * `TSummary` once `sm summarize` lands.
   */
  summary: TSummary;
}

type TEdgeKind = TLinkKind;

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

/**
 * Layout footprint for `<sm-node-card>` in its collapsed state. Used by
 * Dagre when computing initial positions; smaller than reality means
 * cards overlap, larger means wasted whitespace. Height is generous
 * because the card grows when the user expands the panel — keeping the
 * collapsed footprint a bit taller avoids re-layout jitter for the
 * common-case mid-expand. Update if the card's collapsed dimensions
 * change in `node-card.css` (`:host { width: ... }` and the main row).
 */
const NODE_WIDTH = 260;
const NODE_HEIGHT = 120;

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;
const ZOOM_BUTTON_STEP = 0.2;

const VIEWPORT_STORAGE_KEY = 'sm.graph.viewport';
const NODE_POSITIONS_STORAGE_KEY = 'sm.graph.node-positions';
const NODE_EXPANDED_STORAGE_KEY = 'sm.graph.node-expanded';

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
  imports: [
    FilterBar,
    FFlowModule,
    FVirtualFor,
    KindPalette,
    NodeCard,
    PerfHud,
    ButtonModule,
    TooltipModule,
  ],
  templateUrl: './graph-view.html',
  styleUrl: './graph-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphView implements OnInit, OnDestroy {
  private readonly loader = inject(CollectionLoaderService);
  private readonly filters = inject(FilterStoreService);
  private readonly router = inject(Router);

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

  protected readonly texts = GRAPH_VIEW_TEXTS;

  private middlePanOrigin: { mouseX: number; mouseY: number; canvasX: number; canvasY: number } | null = null;

  private readonly nodePositions = signal<TNodePositions>(readStoredNodePositions());
  private readonly expandedNodeIds = signal<ReadonlySet<string>>(readStoredExpanded());

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
    // During drag, accumulate positions in a non-signal buffer. Writing
    // to `nodePositions` here would invalidate the `graph` computed
    // (which projects positions into the @for) on every move, forcing
    // Angular to reconcile all node + edge bindings 60–120×/sec — pure
    // overhead since Foblex already manages the dragged node's DOM
    // transform internally. We flush the buffer once at pointerup.
    if (!this.dragBuffer) this.dragBuffer = { ...this.nodePositions() };
    this.dragBuffer[id] = { x: position.x, y: position.y };
    this.nodeDragInProgress = true;
  }

  zoomIn(): void {
    this.zoom()?.setZoom(this.getViewportCenter(), ZOOM_BUTTON_STEP, EFZoomDirection.ZOOM_IN, true);
  }

  zoomOut(): void {
    this.zoom()?.setZoom(this.getViewportCenter(), ZOOM_BUTTON_STEP, EFZoomDirection.ZOOM_OUT, true);
  }

  fitToScreen(): void {
    this.canvas()?.fitToScreen({ x: 40, y: 40 }, true);
  }

  resetLayout(): void {
    if (Object.keys(this.nodePositions()).length === 0) {
      this.canvas()?.fitToScreen({ x: 40, y: 40 }, true);
      return;
    }
    const ok = window.confirm(GRAPH_VIEW_TEXTS.resetLayoutConfirm);
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

  private middlePanRafId: number | null = null;
  private pendingPanPosition: IPoint | null = null;

  private readonly onMiddlePanMove = (event: MouseEvent): void => {
    if (!this.middlePanOrigin) return;
    // High-polling mice fire mousemove 500–1000×/sec. setPosition needs a
    // matching canvas.redraw() to flush to the DOM, but redrawing per
    // event is wasteful — coalesce into one redraw per animation frame.
    this.pendingPanPosition = {
      x: this.middlePanOrigin.canvasX + (event.clientX - this.middlePanOrigin.mouseX),
      y: this.middlePanOrigin.canvasY + (event.clientY - this.middlePanOrigin.mouseY),
    };
    if (this.middlePanRafId !== null) return;
    this.middlePanRafId = requestAnimationFrame(() => {
      this.middlePanRafId = null;
      const canvas = this.canvas();
      if (!canvas || !this.pendingPanPosition) return;
      canvas.setPosition(this.pendingPanPosition);
      canvas.redraw();
    });
  };

  private readonly onMiddlePanEnd = (): void => {
    if (this.middlePanRafId !== null) {
      cancelAnimationFrame(this.middlePanRafId);
      this.middlePanRafId = null;
    }
    this.pendingPanPosition = null;
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
    // Defer localStorage persistence + signal flush to mouseup. Foblex
    // intercepts pointer events via fDragHandle, so listening on
    // `mouseup` (the same channel the existing middle-mouse pan uses
    // successfully on `document`) is the reliable path. `queueMicrotask`
    // inside the handler defers the flush until after any final
    // fNodePositionChange that Foblex may emit synchronously.
    document.addEventListener('mouseup', this.onNodeMouseUp, { once: true });
  }

  private nodeDragInProgress = false;
  private dragBuffer: TNodePositions | null = null;

  private readonly onNodeMouseUp = (): void => {
    queueMicrotask(() => {
      if (!this.nodeDragInProgress) {
        this.dragBuffer = null;
        return;
      }
      this.nodeDragInProgress = false;
      if (this.dragBuffer) {
        this.nodePositions.set(this.dragBuffer);
        this.dragBuffer = null;
      }
      writeStoredNodePositions(this.nodePositions());
    });
  };

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

  isExpanded(id: string): boolean {
    return this.expandedNodeIds().has(id);
  }

  setExpanded(id: string, value: boolean): void {
    const current = this.expandedNodeIds();
    if (current.has(id) === value) return;
    const next = new Set(current);
    if (value) next.add(id);
    else next.delete(id);
    this.expandedNodeIds.set(next);
    writeStoredExpanded(next);
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
  nodesByPath: Map<string, INodeView>;
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
function computeFullLayout(allNodes: INodeView[]): IFullLayout {
  // Step 4 will replace this with kernel-emitted detector output;
  // the shape of `IDetectedLink` is identical to `IGraphEdge` minus
  // `id`/`label`, so the swap is local to this function.
  const detected = detectLinks(allNodes);
  const byId = new Map<string, IGraphEdge>();
  for (const link of detected) {
    const id = edgeId(link.kind, link.from, link.to);
    if (!byId.has(id)) {
      byId.set(id, { id, from: link.from, to: link.to, kind: link.kind });
    }
  }
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

  const nodesByPath = new Map<string, INodeView>();
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
    const bytesTotal = utf8ByteLength(view.raw);
    nodes.push({
      id,
      path: id,
      view,
      kind: view.kind,
      position,
      stats: {
        linksIn: inCount.get(id) ?? 0,
        linksOut: outCount.get(id) ?? 0,
        // The kernel will publish these once `sm scan` ships; in the
        // browser-only prototype we derive from the parsed file directly
        // so the card's footer + sub-stats render with realistic values.
        bytesTotal,
        tokensTotal: estimateTokens(bytesTotal),
        externalRefsCount: countExternalUrls(view.body),
      },
      summary: buildMockSummary(view),
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

function readStoredExpanded(): ReadonlySet<string> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(NODE_EXPANDED_STORAGE_KEY);
  } catch {
    return new Set();
  }
  if (!raw) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Set();
  }
  if (!Array.isArray(parsed)) return new Set();
  const result = new Set<string>();
  for (const id of parsed) {
    if (typeof id === 'string' && id.length > 0) result.add(id);
  }
  return result;
}

function writeStoredExpanded(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(NODE_EXPANDED_STORAGE_KEY, JSON.stringify([...ids]));
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

/**
 * UTF-8 byte length of the raw file. Used to populate `bytesTotal` from
 * the in-browser loader. `TextEncoder` is universal in modern browsers
 * (the only target the prototype ships to today).
 */
function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Rough token-count estimator based on the OpenAI rule-of-thumb
 * (1 token ≈ 4 bytes for English-leaning prose). Replaced by the
 * kernel's real tokenizer once scan results expose `tokensTotal`.
 */
function estimateTokens(bytesTotal: number): number {
  return Math.max(1, Math.round(bytesTotal / 4));
}

/**
 * Count of unique http(s) URLs present in the body. Mirrors the
 * "external refs" footer pill described in `spec/architecture.md`
 * — anything that looks like a link out of the collection counts.
 */
function countExternalUrls(body: string): number {
  const matches = body.match(/https?:\/\/[^\s)>\]"']+/g);
  if (!matches) return 0;
  return new Set(matches).size;
}

