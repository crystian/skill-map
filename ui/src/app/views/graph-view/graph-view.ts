import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import {
  FCanvasComponent,
  FFlowModule,
  FVirtualFor,
  FZoomDirective,
  EFConnectableSide,
  EFConnectionBehavior,
  EFConnectionType,
  EFMarkerType,
  EFZoomDirection,
  type FCanvasChangeEvent,
} from '@foblex/flow';

import { GRAPH_VIEW_TEXTS } from '../../../i18n/graph-view.texts';
import { DEFAULT_SETTINGS } from '../../../models/settings';

import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { KindPalette } from '../../components/kind-palette/kind-palette';
import { NodeCard } from '../../components/node-card/node-card';
import { PerfHud } from '../../components/perf-hud/perf-hud';
import { InspectorView } from '../inspector-view/inspector-view';
import {
  computeIncrementalPositions,
  createLayoutComputer,
  projectVisible,
  type IFullLayout,
  type IGraphData,
  type IGraphEdge,
  type IGraphNode,
  type IPoint,
  type TNodePositions,
} from './graph-layout';

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

@Component({
  selector: 'app-graph-view',
  imports: [
    FFlowModule,
    FVirtualFor,
    KindPalette,
    NodeCard,
    PerfHud,
    InspectorView,
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
  private readonly route = inject(ActivatedRoute);

  private readonly canvas = viewChild(FCanvasComponent);
  private readonly zoom = viewChild(FZoomDirective);
  private readonly canvasWrap = viewChild<ElementRef<HTMLElement>>('canvasWrap');
  // PrimeNG `<p-button>` is a wrapper component; we read the host
  // element via ElementRef and focus the inner native <button> in the
  // selection-change effect below. The template ref lands on the
  // `<p-button>` host, so the inner button is reachable through a
  // descendant query.
  private readonly panelCloseBtn = viewChild<ElementRef<HTMLElement>>('panelCloseBtn');

  readonly outputSide = EFConnectableSide.BOTTOM;
  readonly inputSide = EFConnectableSide.TOP;

  // Connection visual contract — typed via Foblex enums instead of raw
  // string literals so a future enum rename surfaces at compile time.
  // `END_ALL_STATES` covers selected + non-selected with the same arrow
  // glyph (we currently disable connection selection, but this stays
  // correct if `[fSelectionDisabled]` is ever flipped).
  readonly connectionType = EFConnectionType.SEGMENT;
  readonly connectionBehavior = EFConnectionBehavior.FIXED;
  readonly markerEnd = EFMarkerType.END_ALL_STATES;

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

  /**
   * Viewport state — bound to `<f-canvas>` `[position]` and `[scale]`.
   *
   * Critical that these are SIGNALS (not field-init constants) and that
   * `onCanvasChange` writes them. Foblex re-evaluates the input bindings
   * on every change-detection pass; if the bound value drifts from the
   * canvas's internal viewport (e.g. user pans → internal viewport
   * moves; bound value stays at its boot literal), Foblex re-applies the
   * bound value to "reconcile" and resets the viewport to the boot
   * position. Symptom: every WS-driven re-render snaps the canvas back
   * to wherever it was when the component mounted, undoing the user's
   * pan / zoom. Storing the viewport in signals that track the canvas
   * keeps the binding always in sync, so reconciliation is a no-op.
   *
   * Initial value comes from the persisted viewport (if any) so a reload
   * restores the user's last pan / zoom.
   */
  protected readonly viewportPosition = signal<IPoint>(
    this.savedViewport
      ? { x: this.savedViewport.x, y: this.savedViewport.y }
      : { x: 0, y: 0 },
  );
  protected readonly viewportScale = signal<number>(this.savedViewport?.scale ?? 1);
  protected readonly canZoomIn = computed(() => this.viewportScale() < ZOOM_MAX - 1e-6);
  protected readonly canZoomOut = computed(() => this.viewportScale() > ZOOM_MIN + 1e-6);

  protected readonly texts = GRAPH_VIEW_TEXTS;

  private middlePanOrigin: { mouseX: number; mouseY: number; canvasX: number; canvasY: number } | null = null;

  private readonly nodePositions = signal<TNodePositions>(readStoredNodePositions());
  private readonly expandedNodeIds = signal<ReadonlySet<string>>(readStoredExpanded());

  readonly loading = this.loader.loading;
  readonly error = this.loader.error;

  private readonly visibleNodes = computed(() => this.filters.apply(this.loader.nodes()));

  /**
   * Layout cache — the d3-force simulation runs ONCE over the full
   * collection, not over the filtered subset. Filters then project this
   * cache to the visible nodes without recomputing positions, so unmoved
   * nodes stay put when the user toggles a filter.
   *
   * The closure inside `createLayoutComputer()` adds a second cache layer
   * keyed on a topology fingerprint (path set + edge set). When a WebSocket
   * `scan.completed` event makes the loader re-fetch and replace
   * `loader.nodes()` with a fresh array, the computed re-runs — but if the
   * topology is unchanged (the common case: the user edited frontmatter or
   * body of an existing node, no node added/removed/relinked), positions
   * are reused and only the data maps (`nodesByPath`, `apiNodesByPath`)
   * refresh with the new view content. Foblex's `@for ... track node.id`
   * then reuses the existing DOM nodes and only re-renders their inner
   * card, so the viewport stays put and unmoved nodes don't jump.
   *
   * Manual drag positions (`nodePositions`) are NOT a layout input — they
   * override per-node at projection time, so dragging never invalidates
   * the cache either.
   */
  private readonly computeLayout = createLayoutComputer();
  private readonly fullLayout = computed<IFullLayout>(() =>
    this.computeLayout(this.loader.nodes(), this.loader.scan()),
  );

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

  protected readonly selectedPath = computed<string | undefined>(() => {
    const id = this.selectedNodeId();
    if (!id) return undefined;
    const node = this.graph().nodes.find((n) => n.id === id);
    return node?.view.path;
  });

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

  /**
   * Deep-link reader: the URL `?path=…` is the source of truth on first
   * mount and on intra-route navigations (a relation chip in the
   * embedded inspector re-navigates here, list-view rows route here).
   * Listening on the live `queryParamMap` Observable keeps this
   * component up to date when only query params change — `route.snapshot`
   * would only fire once.
   *
   * Pairs with `urlWriterEffect` below: that effect mirrors the
   * selection back into the URL. Without a guard the two would loop —
   * reader sets selection, writer pushes URL, reader fires again. The
   * loop is broken by comparing the deep-link path against the path of
   * the currently-selected node before writing: when they already
   * agree, the reader is a no-op.
   */
  private readonly deepLinkPath = toSignal(
    this.route.queryParamMap.pipe(map((m) => m.get('path'))),
    { initialValue: this.route.snapshot.queryParamMap.get('path') },
  );
  private readonly deepLinkEffect = effect(() => {
    const path = this.deepLinkPath();
    const nodes = this.graph().nodes;
    if (nodes.length === 0) return;
    if (!path) {
      // The URL has no `path`. If a node is currently selected only
      // because the writer effect propagated its path, the writer
      // effect itself will keep the URL in sync — don't clear here, or
      // a refresh on a deep-link would clear before the reader has
      // matched the URL to a node.
      return;
    }
    // Loop guard: read the current selection via `untracked` so this
    // effect does NOT subscribe to `selectedNodeId`. Otherwise a
    // close-panel call (which clears `selectedNodeId` BEFORE the
    // writer effect has cleared the URL) re-fires this reader with the
    // stale URL path and immediately re-selects the node we just
    // closed.
    const currentId = untracked(() => this.selectedNodeId());
    if (currentId !== null) {
      const currentNode = nodes.find((n) => n.id === currentId);
      // URL already matches the selection — reader is a no-op.
      if (currentNode?.view.path === path) return;
    }
    const target = nodes.find((n) => n.view.path === path);
    if (target) this.selectedNodeId.set(target.id);
  });

  /**
   * URL writer: mirrors `selectedNodeId` into `?path=…` so the panel's
   * open/closed state survives a refresh and is shareable as a URL.
   *
   *   - Selection set to a node with a `view.path` → write `?path=<p>`.
   *   - Selection cleared (null) → drop the query param.
   *
   * `replaceUrl: true` keeps the back button focused on cross-route
   * transitions instead of stuttering through every node-selection
   * change. `queryParamsHandling: 'merge'` preserves any other query
   * params (filter sync etc.) that may live alongside `path`.
   *
   * The reader effect's loop guard above ensures this writer doesn't
   * cycle: when reader sets selection from the URL, the URL already
   * matches and the writer is also a no-op.
   */
  private readonly urlWriterEffect = effect(() => {
    const path = this.selectedPath();
    // Untracked: the writer must fire only when the selection changes,
    // not when the URL changes (reader's job). Tracking `deepLinkPath`
    // here would make the writer ping-pong with the reader on every
    // navigation.
    const currentInUrl = untracked(() => this.deepLinkPath());
    if ((path ?? null) === (currentInUrl ?? null)) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { path: path ?? null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });

  /**
   * Focus the panel's close button when the inspector opens (transition
   * from no-selection to has-selection). Kept off the per-selection
   * change so switching between nodes doesn't steal focus on every
   * click. `queueMicrotask` defers the focus call until after the
   * panel's slide-in transform begins and the button is in the
   * accessibility tree.
   */
  private lastSelectionWasNonNull = false;
  private readonly panelFocusEffect = effect(() => {
    const id = this.selectedNodeId();
    const opened = id !== null && !this.lastSelectionWasNonNull;
    this.lastSelectionWasNonNull = id !== null;
    if (!opened) return;
    queueMicrotask(() => {
      const host = this.panelCloseBtn()?.nativeElement;
      const btn = host?.querySelector('button');
      btn?.focus();
    });
  });

  /**
   * Fingerprint of the loaded path set (NOT edges). Drives the "auto-fit
   * when a node is added or removed" effect below. Edge-only topology
   * changes (a new link extracted from an edited body, or a link that
   * disappeared) do NOT trip this fingerprint — the user kept the same
   * cards, just their wiring changed; jerking the viewport for that
   * would feel intrusive.
   */
  private readonly pathsFingerprint = computed(() =>
    this.loader.nodes().map((n) => n.path).sort().join('|'),
  );
  private lastPathsFingerprint: string | null = null;

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

    // Auto-fit on add / remove of nodes via WS scan refresh.
    //
    // Filters do NOT trip this — they touch `visibleNodes`, not
    // `loader.nodes()`. Edge-only changes do not trip this either —
    // `pathsFingerprint` excludes edges by design. The first run during
    // boot only seeds `lastPathsFingerprint` (the initial fit is owned
    // by the effect above); subsequent runs animate-fit so the user
    // sees the new layout in full.
    effect(() => {
      const fp = this.pathsFingerprint();
      if (!this.hasCompletedInitialLayout) {
        this.lastPathsFingerprint = fp;
        return;
      }
      if (this.lastPathsFingerprint === fp) return;
      this.lastPathsFingerprint = fp;
      queueMicrotask(() => this.canvas()?.fitToScreen({ x: 40, y: 40 }, true));
    });

    // Garbage-collect `expandedNodeIds` against the current loaded set.
    //
    // Without this, an id that was expanded in a previous session and
    // persisted to localStorage stays in the set forever — even after
    // the file behind it is deleted. If the user later recreates a file
    // at the same path (the typical .skillmapignore demo flow: drop a
    // private file, hide it, then drop another with the same name on a
    // future session), the brand-new node renders with the chevron
    // already open, surprising the user. Filtering on every
    // `loader.nodes()` change keeps the persisted set in sync with what
    // exists on disk. The empty-array case (initial boot before the
    // first scan resolves) is skipped so we don't wipe the set during
    // the loading phase.
    effect(() => {
      const allPaths = new Set(this.loader.nodes().map((n) => n.path));
      if (allPaths.size === 0) return;
      const current = this.expandedNodeIds();
      if (current.size === 0) return;
      let dirty = false;
      const filtered = new Set<string>();
      for (const id of current) {
        if (allPaths.has(id)) filtered.add(id);
        else dirty = true;
      }
      if (dirty) {
        this.expandedNodeIds.set(filtered);
        writeStoredExpanded(filtered);
      }
    });

    // Reconcile `nodePositions` against the loaded set so storage holds
    // the position of every visible node, not just the ones the user
    // manually dragged. Three responsibilities, one effect:
    //
    //   1. Cold start (no stored positions): take the auto-layout's
    //      cached full simulation as-is. That's the same single batch
    //      `projectVisible` was already going to render with — reusing
    //      it avoids running the d3-force solver twice.
    //   2. Incremental (some nodes already pinned, one or more new):
    //      run `computeIncrementalPositions` with the existing entries
    //      held fixed via `fx` / `fy` and the missing nodes free to
    //      settle. The new nodes drop into a non-overlapping spot
    //      defined by the algorithm, but the existing ones stay
    //      exactly where the user (or storage) left them. Without
    //      this branch the new node would inherit a position from a
    //      fresh full simulation that doesn't know where the existing
    //      cards actually sit on screen — they'd land on top of each
    //      other.
    //   3. Removed nodes: drop their entries — mirrors the
    //      `expandedNodeIds` GC above. Stale ids would pile up forever
    //      otherwise.
    //
    // After `resetLayout()` clears the map this effect runs on the next
    // tick and the cold-start branch reseeds the whole graph from the
    // auto-layout, then persists. That's how RESET ends up "deleted →
    // re-arranged → saved" without an explicit save call in
    // `resetLayout` itself.
    //
    // Single localStorage write per cycle, gated by `dirty` to avoid an
    // infinite loop (we read `nodePositions` and conditionally write
    // to it). Empty-loader case is skipped so we don't wipe storage
    // during the boot loading phase.
    effect(() => {
      const nodes = this.loader.nodes();
      if (nodes.length === 0) return;
      const current = this.nodePositions();
      const allPaths = new Set(nodes.map((n) => n.path));

      let dirty = false;
      const next: TNodePositions = { ...current };

      // (3) Drop positions for nodes that no longer exist.
      for (const id of Object.keys(next)) {
        if (allPaths.has(id)) continue;
        delete next[id];
        dirty = true;
      }

      // (1 / 2) Identify newly-loaded nodes and place them.
      const missing: string[] = [];
      for (const path of allPaths) {
        if (!(path in next)) missing.push(path);
      }

      if (missing.length > 0) {
        const layout = this.fullLayout();
        if (Object.keys(next).length === 0) {
          // Cold start — nothing pinned. Reuse the cached full sim.
          for (const path of missing) {
            const pos = layout.positions.get(path);
            if (pos) next[path] = { x: pos.x, y: pos.y };
          }
        } else {
          // Incremental — pin existing, settle the new ones around them.
          const placed = computeIncrementalPositions(nodes, layout.edges, next, missing);
          for (const path of missing) {
            const pos = placed.get(path);
            if (pos) next[path] = pos;
          }
        }
        dirty = true;
      }

      if (dirty) {
        this.nodePositions.set(next);
        writeStoredNodePositions(next);
      }
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
    // Mirror the canvas's internal viewport into our bound signals so a
    // future change-detection pass doesn't reconcile the bindings and
    // snap the canvas back. See the doc on `viewportPosition` /
    // `viewportScale` for the full reasoning.
    this.viewportPosition.set({ x: event.position.x, y: event.position.y });
    this.viewportScale.set(event.scale);
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
    const ok = window.confirm(GRAPH_VIEW_TEXTS.resetLayoutConfirm);
    if (!ok) return;
    // Clearing `nodePositions` here is the only mechanical step needed:
    // the reconcile effect runs on the next tick, sees an empty map plus
    // the current auto-layout, and reseeds every visible node — then
    // persists the freshly-computed positions to storage. That's why
    // "reset" ends up doing the full delete → re-arrange → save loop
    // without any explicit save call here.
    this.nodePositions.set({});
    // Reset layout also collapses every expanded card. The intent of
    // "reset" is "give me back a clean canvas" — leaving cards open
    // would re-introduce the size variation that made the user reach
    // for reset in the first place.
    this.expandedNodeIds.set(new Set());
    writeStoredExpanded(new Set());
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

  /** Close the embedded inspector panel and remove the URL `?path` param. */
  closePanel(): void {
    this.selectedNodeId.set(null);
  }

  /**
   * Escape closes the panel — only when something is selected, so the
   * key still propagates normally (PrimeNG dialogs / overlays) when the
   * panel is closed.
   */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.selectedNodeId() === null) return;
    this.closePanel();
  }

  openNode(node: IGraphNode): void {
    // Embedded inspector mode: dblclick selects (single click already does
    // the same — kept the handler so the gesture has a clear intent).
    this.selectedNodeId.set(node.id);
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
    if (target?.closest('.graph__panel')) return;
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

