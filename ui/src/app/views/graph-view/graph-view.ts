import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import {
  EFConnectionBehavior,
  EFConnectionConnectableSide,
  EFLayoutMode,
  EFMarkerType,
  EFZoomDirection,
  FCanvasComponent,
  FFlowComponent,
  FFlowModule,
  FVirtualFor,
  FZoomDirective,
  provideFFlow,
  provideFLayout,
  withA11y,
} from '@foblex/flow';
import type { FCanvasChangeEvent, FSelectionChangeEvent } from '@foblex/flow';
import { DagreLayoutEngine } from '@foblex/flow-dagre-layout';

import { GRAPH_VIEW_TEXTS } from '../../../i18n/graph-view.texts';
import { DEFAULT_SETTINGS } from '../../../models/settings';

import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { GraphPreferencesService } from '../../../services/graph-preferences';
import { IssuePathsService } from '../../../services/issue-paths';
import { LivePreferencesService } from '../../../services/live-preferences';
import { MapVisibilityService } from '../../../services/map-visibility';
import { MapViewsService } from '../../../services/map-views';
import { AgentSpawnService } from '../../../services/agent-spawn';
import { NodeActivityService } from '../../../services/node-activity';
import { NodeSparkService } from '../../../services/node-spark';
import { NodeActivityStatsService } from '../../../services/node-activity-stats';
import { DATA_SOURCE } from '../../../services/data-source/data-source.port';
import type { INodeActivityStatsApi } from '../../../models/api';
import { directNeighborhood } from './node-neighborhood';
import { BranchCapBanner } from './branch-cap-banner/branch-cap-banner';
import { GraphLayoutToolbar } from './graph-layout-toolbar/graph-layout-toolbar';
import { MapViewSwitcher } from './map-view-switcher/map-view-switcher';
import { ConversationDialog } from '../../components/conversation-dialog/conversation-dialog';
import { KindPalette } from '../../components/kind-palette/kind-palette';
import { LinkKindPalette } from '../../components/link-kind-palette/link-kind-palette';
import { AgentCapsule } from '../../components/agent-capsule/agent-capsule';
import { SessionNode } from '../../components/session-node/session-node';
import { SeverityPalette } from '../../components/severity-palette/severity-palette';
import { NodeCard } from '../../components/node-card/node-card';
import { PerfHud } from '../../components/perf-hud/perf-hud';
/* ViewContributionsHost: real graph.node.alert slot mount (also ringed by the kept debug-slots overlay; see context/ui.md). */
import { ViewContributionsHost } from '../../components/view-contributions-host/view-contributions-host';
import { DebugPerfService } from '../../services/debug-perf';
import { A11yAnnouncerService } from '../../services/a11y-announcer';
import { ActivityReadinessService } from '../../services/activity-readiness';
import { ActivityPlaybackService } from '../../../services/activity-playback';
import { ActivityRecorderService } from '../../../services/activity-recorder';
import { LiveLensService } from '../../../services/live-lens';
import {
  filterTapeForSession,
  type ISessionReplaySelection,
  type ISessionStep,
} from '../../../services/session-index';
import { pathBasenameForLink } from '../../../services/path-basename';
import { InspectorView } from '../inspector-view/inspector-view';
import { MiddleMousePanDirective, type IMiddleMousePanTarget } from './middle-mouse-pan';
import {
  computeLayoutPositions,
  topologyFingerprint,
  type IGraphEdge,
  type IGraphNode,
  type IPoint,
  type TNodePositions,
} from './graph-layout';
import { reconcileNodePositions } from './graph-view.reconcile';
import { bindSelectionToUrl } from './selection-url-sync';
import {
  readStoredNodePositions,
  readStoredPanelWidth,
  readStoredViewport,
  writeStoredNodePositions,
  writeStoredPanelWidth,
} from './graph-view.storage';
import { setupEdgeResize } from '../../core/edge-resize.controller';
import { setupTagSelection } from './tag-selection.controller';
import { setupViewportStore, ZOOM_MIN, ZOOM_MAX } from './viewport-store';
import { isAnyPrimengOverlayOpen, isFlowDragging } from './graph-view.utils';
import type { IEdgeSelectionView, ISelectionView } from '../../../models/selection';
import { createSelectionState } from './selection-state';
import { CLICK_DRAG_TOLERANCE_PX, setupNodeDrag } from './node-drag.controller';
import { setupExpansion } from './expansion.controller';
import { setupFollowActivity } from './follow-activity.controller';
import { setupLiveLens } from './live-lens.controller';
import { PlaybackBar } from './playback-bar/playback-bar';
import { setupLayoutFit } from './layout-fit.controller';
import { setupGraphPipeline } from './graph-pipeline';
import { setupCamera, type ICameraHandle } from './camera.controller';
import { setupSpawnAnchors } from './spawn-anchors.controller';
import { edgePairKey, type ISpawnOverlayEdge } from './spawn-overlay';
import type { IInvocationOverlayEdge } from './invocation-overlay';
import { resolveCometOverlay, type ICometOverlayEdge } from './comet-overlay';
import { buildTrailIndex, EMPTY_TRAIL_INDEX, type ITrailStep } from './director';
import { INTRO_SWEEP_MS, setupIntro } from './intro.controller';
import { type IViewportTransform } from './viewport-animation';

const ZOOM_BUTTON_STEP = 0.2;

/**
 * How long the `view-switching` host class stays on after a map view
 * applies its pin set: the CSS entry fade runs ~200ms, the window
 * doubles it so nodes mounted by late layout writes (dagre re-run for
 * unpinned nodes, the branch refetch for the new visible set) still
 * ride the same fade. Positions themselves jump deliberately, see the
 * rule-3 note above the animation block in graph-view.css.
 */
const VIEW_SWITCH_ANIMATION_MS = 450;

/** Inspector panel width the view opens at when nothing is persisted. */
const PANEL_WIDTH_DEFAULT = 500;
const PANEL_WIDTH_MIN = 400;
/** Minimum graph area to keep visible at any viewport width. */
const PANEL_VIEWPORT_RESERVE = 80;
/** Pixels the inspector panel grows / shrinks per arrow keypress (WCAG 2.1.1). */
const PANEL_RESIZE_STEP = 24;

/** Default selection bundle when a node is not yet in the selection map. */
const SELECTION_DEFAULT: ISelectionView = {
  selected: false,
  highlighted: false,
  dimmed: false,
  far: false,
};

/** Default edge bundle when an edge is not yet in the selection map. */
const EDGE_SELECTION_DEFAULT: IEdgeSelectionView = {
  highlighted: false,
  dimmed: false,
  far: false,
  opacity: 1,
};

/**
 * Frozen empties the live-lens display switchers return while the lens
 * is on (stable identities, so OnPush consumers see one change on the
 * flip, not a fresh object per read).
 */
const EMPTY_NODE_POSITIONS: TNodePositions = new Map();
const EMPTY_PATH_SET: ReadonlySet<string> = new Set();


// Direction icons / spacing icons / connection-type SVG paths now live
// inside `<sm-graph-layout-toolbar>` along with the catalogs and
// labelers they feed. Connector-side resolution (direction -> side
// table + force-layout fallback) lives in `./connection-sides`.

@Component({
  selector: 'sm-graph-view',
  imports: [
    FFlowModule,
    FVirtualFor,
    BranchCapBanner,
    ConversationDialog,
    GraphLayoutToolbar,
    MapViewSwitcher,
    PlaybackBar,
    KindPalette,
    LinkKindPalette,
    AgentCapsule,
    SessionNode,
    SeverityPalette,
    NodeCard,
    PerfHud,
    InspectorView,
    ButtonModule,
    ConfirmDialogModule,
    TooltipModule,
    /* ViewContributionsHost: real graph.node.alert slot mount (also ringed by the kept debug-slots overlay; see context/ui.md). */
    ViewContributionsHost,
    MiddleMousePanDirective,
  ],
  providers: [
    ConfirmationService,
    // Manual mode: we own the relayout lifecycle (topology cache,
    // preference-driven recompute, animated viewport refit) and call
    // `DagreLayoutEngine.calculate()` directly from the layout effect
    // below. Auto mode would have Foblex re-measure + relayout on
    // every render which conflicts with our cached `nodePositions`.
    provideFLayout(DagreLayoutEngine, { mode: EFLayoutMode.MANUAL }),
    // Opt-in keyboard layer (Foblex v19): arrows move the selection
    // spatially, Home/End jump to first/last node, Ctrl/Cmd+arrow walks
    // the topology, Space+arrows moves the selected node (feature parity
    // with mouse drag; flows through the same fNodePositionChange
    // buffer). The graph is read-only, so the connection-creation and
    // delete actions are unbound. Selection ownership: Foblex is the
    // single owner, see `applySelection` / `onFlowSelectionChange`.
    provideFFlow(
      withA11y({
        keys: {
          connect: [],
          deleteSelected: [],
        },
      }),
    ),
  ],
  templateUrl: './graph-view.html',
  styleUrl: './graph-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
    // Short-lived while a map view applies its pin set; the CSS keys
    // the (PRM-gated) node transition + fade on it.
    '[class.view-switching]': 'viewSwitching()',
    // Boot intro (intro.controller.ts): `intro-pending` hides the
    // unpositioned pile until the first dagre pass is reconciled,
    // `intro-running` keys the (PRM-gated) draw-in in graph-view.css.
    '[class.intro-pending]': "intro.phase() === 'pending'",
    '[class.intro-running]': "intro.phase() === 'running'",
  },
})
export class GraphView implements OnInit {
  private readonly loader = inject(CollectionLoaderService);
  private readonly filters = inject(FilterStoreService);
  private readonly issuePaths = inject(IssuePathsService);
  // Protected so the template can read `isActive()` / `count()` (toolbar
  // "show all" affordance + curation empty-state) and call `clear()`.
  protected readonly mapVisibility = inject(MapVisibilityService);
  // Map views (spec/map-views.md): the graph consumes `pendingPins` and
  // feeds back the manual pin subset; see the two effects in the
  // constructor. The switcher component owns every other surface.
  private readonly mapViews = inject(MapViewsService);
  private readonly graphPreferences = inject(GraphPreferencesService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dagreLayout = inject(DagreLayoutEngine);
  private readonly injector = inject(Injector);
  protected readonly nodeActivity = inject(NodeActivityService);
  private readonly nodeSpark = inject(NodeSparkService);
  private readonly activityStats = inject(NodeActivityStatsService);
  private readonly agentSpawns = inject(AgentSpawnService);
  private readonly livePrefs = inject(LivePreferencesService);
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly announcer = inject(A11yAnnouncerService);
  private readonly liveLens = inject(LiveLensService);
  protected readonly playback = inject(ActivityPlaybackService);
  private readonly recorder = inject(ActivityRecorderService);
  private readonly activityReadiness = inject(ActivityReadinessService);

  private readonly flow = viewChild(FFlowComponent);
  // Inspector panel container, focused (and announced) when a node
  // becomes selected so keyboard / screen-reader users land on the
  // freshly opened details instead of staying on the canvas (WCAG 2.4.3).
  private readonly inspectorPanel = viewChild<ElementRef<HTMLElement>>('inspectorPanel');
  // Protected: `panTarget` (below) reads this for the middle-mouse pan's
  // final `emitCanvasChangeEvent()` flush.
  protected readonly canvas = viewChild(FCanvasComponent);
  private readonly zoom = viewChild(FZoomDirective);
  private readonly canvasWrap = viewChild<ElementRef<HTMLElement>>('canvasWrap');
  // Connection visual contract, typed via Foblex enums instead of raw
  // string literals so a future enum rename surfaces at compile time.
  // `END_ALL_STATES` covers selected + non-selected with the same arrow
  // glyph (we currently disable connection selection, but this stays
  // correct if `[fSelectionDisabled]` is ever flipped).
  //
  // `connectionType` is a signal from `GraphPreferencesService` so the
  // graph re-renders when the user picks a different edge shape from
  // Settings → General. The Foblex `EFConnectionType` enum IS a string
  // union, so the wire literal flows straight into `[fType]` without a
  // mapping table.
  protected readonly connectionType = this.graphPreferences.connectionType;
  readonly connectionBehavior = EFConnectionBehavior.FIXED;
  // Schema-designer style endpoints: a small circle at the source and
  // an arrow at the target. `*_ALL_STATES` covers selected + idle with
  // the same glyph (we currently disable connection selection, but the
  // marker stays correct if `[fSelectionDisabled]` is ever flipped).
  readonly markerStart = EFMarkerType.START_ALL_STATES;
  readonly markerEnd = EFMarkerType.END_ALL_STATES;

  /**
   * Compile-time defaults from `models/settings.ts`. Read directly today;
   * the runtime config service that loads `/config.json` and merges with
   * defaults lands with the `sm ui` CLI (ROADMAP §Step 14). Until then,
   * the shape here matches the future service signal exactly so the
   * migration is a one-line import swap.
   */
  protected readonly perf = DEFAULT_SETTINGS.graph.perf;
  /**
   * PerfHud visibility. Gated by `DebugPerfService` (`?debug-fps=1` /
   * localStorage `sm-debug-perf`) until the runtime settings loader
   * lands and a real `graph.perfHud` config key takes over. The signal
   * shape matches what the future settings-driven flag will look like
   *, migration is a one-line import swap.
   */
  protected readonly perfHud = inject(DebugPerfService).visible;

  private readonly savedViewport = readStoredViewport();
  // Middle-mouse pan lives in `[smMiddleMousePan]` directive applied
  // to `.graph__canvas-wrap` in the template, see
  // `middle-mouse-pan.ts`.

  // Viewport state, owned by `setupViewportStore`. See the helper for
  // the rationale around using signals (Foblex reconciliation gotcha).
  private readonly viewportStore = setupViewportStore({
    savedViewport: this.savedViewport,
    hasCompletedInitialLayout: () => this.layoutFit.hasCompletedInitialLayout(),
  });
  protected readonly viewportPosition = this.viewportStore.viewportPosition;
  protected readonly viewportScale = this.viewportStore.viewportScale;
  /**
   * Accessors the middle-mouse pan directive drives. Foblex 18.6 dropped
   * the public `setPosition`, so the pan writes the `[position]` signal
   * (the same path the viewport animations use) instead of poking the
   * canvas imperatively; `emitChange` flushes a final persist at the end
   * of the gesture.
   */
  protected readonly panTarget: IMiddleMousePanTarget = {
    readPosition: () => this.viewportPosition(),
    writePosition: (p) => this.viewportPosition.set(p),
    emitChange: () => this.canvas()?.emitCanvasChangeEvent(),
  };
  protected readonly canZoomIn = this.viewportStore.canZoomIn;

  /**
   * Whole-corpus path set (lite nodes, not the rendered branch). The
   * position reconcile prunes MANUAL pins against this set only: a pin
   * on a node merely hidden by the current map scope survives, a pin
   * whose file left the corpus is garbage-collected.
   */
  private readonly corpusPathSet = computed<ReadonlySet<string>>(
    () => new Set(this.loader.liteNodes().map((n) => n.path)),
  );
  protected readonly canZoomOut = this.viewportStore.canZoomOut;

  // Re-expose the zoom range so the `<f-canvas>` bindings can read from
  // the same constants the toolbar's enable/disable logic uses (single
  // source of truth, see `viewport-store.ts`).
  protected readonly zoomMin = ZOOM_MIN;
  protected readonly zoomMax = ZOOM_MAX;

  protected readonly texts = GRAPH_VIEW_TEXTS;

  private readonly nodePositions = signal<TNodePositions>(readStoredNodePositions());

  // Node drag state machine, owns pointer-down anchor + drag buffer.
  // See `node-drag.controller.ts` for the buffer rationale.
  private readonly nodeDrag = setupNodeDrag({
    destroyRef: this.destroyRef,
    nodePositions: this.nodePositions,
    // A drag repositions a node, it does not inspect it. Foblex selected
    // the grabbed node on pointerdown and `onFlowSelectionChange` refused
    // to mirror that (see there); re-asserting the app's own selection
    // here realigns both sides, so the drag leaves selection untouched.
    // A multi-node selection (Shift+marquee, Ctrl/Cmd+click) is the
    // exception: the user built it deliberately and just moved the whole
    // group, so Foblex's selection IS the intent and must survive the
    // release. The app side already shows no inspected node for multi
    // (see `onFlowSelectionChange`), so both sides stay coherent.
    onDragEnd: () => {
      if ((this.flow()?.getSelection().fNodeIds.length ?? 0) > 1) return;
      this.applySelection(this.selectedNodeId());
    },
  });

  // Card-expansion state, owns `expandedNodeIds`, the persistence
  // writer, and the GC effect that drops stale ids.
  private readonly expansion = setupExpansion({ nodes: this.loader.nodes });

  // Inspector panel width, owned by the shared edge-resize factory.
  // The panel hugs the RIGHT edge (handle on its left), so dragging
  // left grows it; the clamp reserves graph width on the other side.
  private readonly panelResize = setupEdgeResize({
    destroyRef: this.destroyRef,
    edge: 'right',
    defaultWidth: PANEL_WIDTH_DEFAULT,
    minWidth: PANEL_WIDTH_MIN,
    viewportReserve: PANEL_VIEWPORT_RESERVE,
    initialWidth: readStoredPanelWidth() ?? PANEL_WIDTH_DEFAULT,
    onCommit: (width) => writeStoredPanelWidth(width),
  });
  protected readonly clampedPanelWidth = this.panelResize.clampedWidth;

  readonly loading = this.loader.loading;
  readonly error = this.loader.error;

  // Pure derivation chain (visible set -> topology -> layout -> graph),
  // owned by `setupGraphPipeline`. See `graph-pipeline.ts` for the
  // per-computed rationale (topology-fingerprint caching, link-kind
  // whitelist semantics, perf counters, connector sides). The aliases
  // below keep the template bindings and the rest of this component on
  // the pre-extraction member names.
  private readonly pipeline = setupGraphPipeline({
    nodes: this.loader.nodes,
    scan: this.loader.scan,
    filters: this.filters,
    issuesBySeverity: this.issuePaths.bySeverity,
    nodePositions: this.nodePositions,
    layoutAlgorithm: this.graphPreferences.layoutAlgorithm,
    layoutDirection: this.graphPreferences.layoutDirection,
  });
  private readonly visibleNodes = this.pipeline.visibleNodes;
  private readonly topology = this.pipeline.topology;
  /** Dagre output signals, written by the async layout effect in the constructor. */
  private readonly layoutPositions = this.pipeline.layoutPositions;
  private readonly layoutComputedAtSignal = this.pipeline.layoutComputedAtSignal;
  private readonly fullLayout = this.pipeline.fullLayout;
  private readonly mapVisiblePaths = this.pipeline.mapVisiblePaths;
  private readonly fullAdjacency = this.pipeline.fullAdjacency;
  private readonly pathsFingerprint = this.pipeline.pathsFingerprint;

  // ── Live lens ───────────────────────────────────────────────────────
  // Ephemeral "camera on what executes" mode. `LiveLensService` owns
  // WHAT is live (watermark membership + curation-independent cache);
  // `setupLiveLens` owns the parallel lens pipeline, the seeded force
  // layout, the lens follow camera, and the enter/exit transitions.
  // Declared right after the main pipeline so the display switchers
  // below can reference its handle; cross-field references inside the
  // config are lazy closures, resolved at effect/call time when every
  // field exists (same contract as `camera`).
  private readonly liveLensCtl = setupLiveLens({
    lens: this.liveLens,
    nodeActivity: this.nodeActivity,
    livePrefs: this.livePrefs,
    playback: this.playback,
    directorEnabled: this.livePrefs.directorEnabled,
    issuesBySeverity: this.issuePaths.bySeverity,
    mainPathsFingerprint: this.pathsFingerprint,
    viewportPosition: this.viewportPosition,
    viewportScale: this.viewportScale,
    // Live session capsules vanish during replay: they narrate the
    // present, and the replay canvas narrates the tape.
    sessions: () => (this.playback.active() ? [] : this.spawnOverlay().sessions),
    hostElement: () => this.canvasWrap()?.nativeElement ?? null,
    panelWidth: () => this.reservedPanelWidth(),
    bootFitDone: () => this.layoutFit.hasCompletedInitialLayout(),
    zoomMin: ZOOM_MIN,
    animateToTransform: (transform) => this.animateToTransform(transform),
    fitMainView: () => this.camera.runAnimatedFit(),
    beginViewSwitch: () => this.beginViewSwitchAnimation(),
  });
  protected readonly lensOn = this.liveLensCtl.active;
  /** Replay sub-mode of the lens (the fold drives what is painted). */
  protected readonly replayOn = this.playback.active;
  /**
   * Replay paused (user request 2026-08-16): stamps
   * `graph--replay-paused` on the root so every execution animation
   * (halo, ring, ribbon, badge pulse, edge hue, marching dashes)
   * freezes its current frame via `animation-play-state`; hitting Play
   * resumes them mid-cycle. Frozen narration, frozen dressing.
   */
  protected readonly replayPaused = computed(
    () => this.playback.active() && !this.playback.playing(),
  );
  /**
   * With no toolbar lens control left (user decision 2026-08-16), the
   * lens exists only as the face of RECORD or REPLAY: when a replay
   * exits (the transport's X, a deleted recording) and no recording is
   * running, the lens leaves with it, back to the curated map. The
   * falling edge is tracked by hand so a replay RE-entry (exit + enter
   * inside one gesture, `replaySessionFromTape`) never observes one.
   */
  private wasReplaying = false;
  private readonly lensStandDownEffect = effect(() => {
    const replaying = this.playback.active();
    const was = this.wasReplaying;
    this.wasReplaying = replaying;
    if (!was || replaying) return;
    if (this.lensOn() && !this.recorder.recording()) this.liveLensCtl.toggle();
  });

  /**
   * The inverse invariant (user call 2026-08-17): RECORDING implies the
   * recording view. `startSessionRecording` handles the normal gesture;
   * this effect covers every other way recording can become true with
   * the lens down, today the F5 resume (the boot probe re-engages
   * capture because the server never stopped, but the button saying
   * Stop over the curated map read as a half-state). A running replay
   * keeps the canvas: it is also a lens face, and the stand-down above
   * returns to the recording view when it exits.
   */
  private readonly lensRecordingFaceEffect = effect(() => {
    if (this.recorder.recording() && !this.lensOn() && !this.playback.active()) {
      this.liveLensCtl.toggle();
    }
  });

  // Display switchers: while the lens is on, the template + overlay
  // controllers read the LENS pipeline; the main pipeline keeps
  // computing underneath (reconcile, map views, storage all stay wired
  // to `this.pipeline` / `this.nodePositions` explicitly), so exiting
  // restores the curated map BY CONSTRUCTION. `hasData` and the
  // top-level empty states stay MAIN-bound on purpose: the lens must
  // never unmount `<f-flow>` (teardown flashes, see the template).
  readonly graph = computed(() =>
    this.lensOn() ? this.liveLensCtl.pipeline.graph() : this.pipeline.graph(),
  );
  private readonly displayVisiblePaths = computed(() =>
    this.lensOn() ? this.liveLensCtl.pipeline.mapVisiblePaths() : this.mapVisiblePaths(),
  );
  private readonly displayFullLayout = computed(() =>
    this.lensOn() ? this.liveLensCtl.pipeline.fullLayout() : this.fullLayout(),
  );
  private readonly displayNodePositions = computed<TNodePositions>(() =>
    this.lensOn() ? EMPTY_NODE_POSITIONS : this.nodePositions(),
  );

  readonly hasData = computed(() => this.pipeline.graph().nodes.length > 0);
  /**
   * Show the empty-state card when no nodes are visible AND the user
   * did NOT intentionally drive the view to zero matches. Two cases
   * are treated as intentional and skip the empty-state card:
   *
   *   1. The kind toggle is explicitly empty (sticky flag on the filter
   *      store). The operator switched every kind off; we keep the
   *      canvas rendered with zero nodes so the floating palette stays
   *      one click away from re-enabling a kind.
   *   2. The search input has text. A no-match search means the typed
   *      query simply filters everything out; surfacing a full-card "No
   *      nodes match" message on every keystroke would shout at the
   *      user mid-typing. The blank canvas + the active-tinted search
   *      icon in the palette already communicate the filter state.
   */
  readonly showEmptyState = computed(
    () =>
      !this.hasData() &&
      !this.mapVisibility.isActive() &&
      !this.filters.kindToggleExplicitEmpty() &&
      this.filters.searchText().trim().length === 0,
  );

  /**
   * Curation drove the canvas to zero: the user curated a visible set,
   * but nothing in it survives the active facet filters (or every curated
   * path got filtered out). Distinct from `showEmptyState` so we can offer
   * a "Show all on map" escape instead of the generic "no matches" copy.
   */
  readonly showCurationEmptyState = computed(
    () => !this.hasData() && this.mapVisibility.isActive(),
  );

  /**
   * Live lens empty state: the lens is on with nothing live (or not yet
   * fetched). A floating overlay over the canvas, NOT a branch of the
   * top-level empty-state chain: `<f-flow>` must stay mounted (teardown
   * flashes the whole canvas, see the template comment).
   */
  protected readonly showLensEmptyState = computed(
    () => this.lensOn() && this.graph().nodes.length === 0,
  );
  /**
   * Copy branches on a CONFIRMED missing hook only
   * (`hookInstalled === false`; `null` = probe unavailable, fail open):
   * without the hook no frame can ever arrive, so "waiting" would lie.
   */
  protected readonly lensEmptyCopy = computed(() =>
    this.activityReadiness.hookInstalled() === false
      ? {
          title: GRAPH_VIEW_TEXTS.lens.emptyHookMissing,
          hint: GRAPH_VIEW_TEXTS.lens.emptyHookMissingHint,
        }
      : {
          title: GRAPH_VIEW_TEXTS.lens.emptyWaiting,
          hint: GRAPH_VIEW_TEXTS.lens.emptyWaitingHint,
        },
  );

  /** Counters / timestamp exposed to the perf HUD. Pure derivations in
   *  the pipeline; visible/edge counts display-switch with the lens so
   *  the HUD narrates what is actually painted. `totalCount` stays
   *  loader-bound (branch size is a fact about the corpus, not the lens). */
  protected readonly visibleCount = computed(() =>
    this.lensOn() ? this.liveLensCtl.pipeline.visibleCount() : this.pipeline.visibleCount(),
  );
  protected readonly totalCount = this.pipeline.totalCount;
  protected readonly edgeCount = computed(() =>
    this.lensOn() ? this.liveLensCtl.pipeline.edgeCount() : this.pipeline.edgeCount(),
  );
  protected readonly layoutComputedAt = this.pipeline.layoutComputedAt;

  // Connector sides per layout direction (direction table +
  // force-layout fallback live in `./connection-sides`, the computeds
  // in `graph-pipeline.ts`). Display-switched: the lens always runs the
  // force layout, so its pipeline resolves the force fallback sides.
  protected readonly inputSide = computed(() =>
    this.lensOn() ? this.liveLensCtl.pipeline.inputSide() : this.pipeline.inputSide(),
  );
  protected readonly outputSide = computed(() =>
    this.lensOn() ? this.liveLensCtl.pipeline.outputSide() : this.pipeline.outputSide(),
  );

  /**
   * Fixed sides for overlay-chrome spawn edges (`edge.vertical`): the
   * overlay always places vertically (session above, capsules below
   * their anchor), so the arrow leaves the source's underside and
   * enters the target's top whatever the layout direction is.
   */
  protected readonly overlaySourceSide = EFConnectionConnectableSide.BOTTOM;
  protected readonly overlayTargetSide = EFConnectionConnectableSide.TOP;

  // Layout-control catalogs, labelers, setters, and dynamic icons now
  // live in `<sm-graph-layout-toolbar>` (graph-layout-toolbar/). The
  // toolbar reads + writes `GraphPreferencesService` directly so no
  // wiring crosses the parent-child boundary.

  /**
   * True for `VIEW_SWITCH_ANIMATION_MS` after a map view applies its
   * pin set; bound to the `view-switching` host class so the entry
   * fade in `graph-view.css` engages only around the swap (it must
   * never ride normal drags or layout runs).
   */
  protected readonly viewSwitching = signal(false);
  private viewSwitchTimer: number | null = null;

  private beginViewSwitchAnimation(): void {
    this.viewSwitching.set(true);
    if (this.viewSwitchTimer !== null) clearTimeout(this.viewSwitchTimer);
    this.viewSwitchTimer = window.setTimeout(() => {
      this.viewSwitching.set(false);
      this.viewSwitchTimer = null;
    }, VIEW_SWITCH_ANIMATION_MS);
  }

  readonly selectedNodeId = signal<string | null>(null);

  /**
   * Focus + announce management for the inspector panel (WCAG 2.4.3 +
   * 4.1.3). Tracks the previously selected id so the effect fires ONLY
   * on a real null -> id (or id -> other id) transition, never on the
   * unrelated re-renders that also read `selectedNodeId` (highlight,
   * dim, layout). On a genuine selection it moves keyboard focus into
   * the inspector container and announces the node name; on a
   * deselection it hands focus BACK (see the closing branch).
   */
  private previousSelectedId: string | null = null;
  private readonly selectionFocusEffect = effect(() => {
    const id = this.selectedNodeId();
    const prev = untracked(() => this.previousSelectedId);
    if (id === prev) return;
    this.previousSelectedId = id;
    if (id === null) {
      // Closing branch. The panel slides off-screen AND goes `inert`
      // (see the template), so focus parked inside it is dropped on
      // `<body>` and the keyboard user is stranded at the top of the
      // document with no way back to the node they were reading. Return
      // focus where it came from, the node host that was just
      // deselected, and fall back to the canvas wrap when that node is
      // gone (filtered away, re-scanned out, map curation). The
      // `previousSelectedId` bookkeeping above is untouched: `prev` is
      // the id we are closing, and it is non-null here because an
      // id === prev transition already returned.
      if (prev !== null) {
        this.announcer.announce(GRAPH_VIEW_TEXTS.a11y.nodeDeselected);
        afterNextRender(() => this.restoreFocusAfterClose(prev), {
          injector: this.injector,
        });
      }
      return;
    }
    const node = untracked(() => this.graph().nodes.find((n) => n.id === id));
    if (!node) return;
    this.announcer.announce(GRAPH_VIEW_TEXTS.a11y.nodeSelected(this.nodeDisplayName(node)));
    // The panel is always in the DOM (visibility toggles via `is-open`),
    // so the viewChild resolves; move focus after the current render.
    // `preventScroll` is load-bearing: the closed panel sits at
    // `translateX(100%)` INSIDE the overflow-hidden canvas wrap, so a
    // plain focus() mid slide-in makes the browser scroll the wrap to
    // reveal it (the whole graph lurches left, then glides back as the
    // transition lands and the overflow clamps scrollLeft back to 0).
    afterNextRender(
      () => this.inspectorPanel()?.nativeElement.focus({ preventScroll: true }),
      { injector: this.injector },
    );
  });

  protected readonly selectedPath = computed<string | undefined>(() => {
    const id = this.selectedNodeId();
    if (!id) return undefined;
    const node = this.graph().nodes.find((n) => n.id === id);
    return node?.view.path;
  });

  /**
   * Width the inspector panel currently reserves over the canvas, its
   * live (resizable) width while a node is selected, `0` otherwise. The
   * panel is an absolute overlay pinned to the right edge, so it never
   * shrinks `canvasWrap`; every "centre in the visible area" computation
   * has to subtract this from the usable width by hand. Consumed by the
   * auto-fit camera, the single-node center pan, and the floating
   * toolbar's horizontal centering (so the pill glides clear of the
   * panel instead of hiding behind it).
   */
  protected readonly reservedPanelWidth = computed(() =>
    this.selectedNodeId() !== null ? this.clampedPanelWidth() : 0,
  );

  /**
   * Drop the selection if the underlying graph no longer contains the
   * selected node (e.g. filters changed). Avoids dangling highlight state.
   */
  private readonly selectionGuard = effect(() => {
    const id = this.selectedNodeId();
    if (id === null) return;
    const exists = this.graph().nodes.some((n) => n.id === id);
    if (!exists) this.applySelection(null);
  });

  // URL ↔ selection deep-link wiring lives in `bindSelectionToUrl`,
  // see `selection-url-sync.ts` for the loop-guard contract. Called
  // from the constructor below.

  /**
   * Tick stamped by the reconcile effect once it has processed a dagre
   * pass (dirty or not): its value is that pass's `computedAt`, so one
   * stamp maps to exactly one layout run and the echo re-run the
   * `nodePositions` write triggers re-stamps the same value (no
   * propagation). The camera's deferred fits key on THIS instead of the
   * raw `layoutComputedAt` tick: "positions are reconciled" is a data
   * dependency, not an effect creation-order coincidence (Angular does
   * not guarantee sibling-effect execution order, only the
   * `afterRender*` family documents ordering).
   */
  private readonly layoutReconciledAt = signal(0);

  /**
   * Boot intro phase (`pending` -> `running` -> `done`), keyed on the
   * reconcile stamp above so the draw-in starts only once every card
   * has its dagre position; see `intro.controller.ts`.
   */
  protected readonly intro = setupIntro({
    destroyRef: this.destroyRef,
    layoutReconciledAt: this.layoutReconciledAt,
  });

  // Camera controller handle (fit / center / tween orchestration).
  // Assigned in the constructor; closures created before the assignment
  // (layout-fit's `fit`, follow's `animateToTransform`) only
  // dereference it at call time, safely after construction. Its
  // deferred fits react to `layoutReconciledAt` (stamped by the
  // reconcile effect), so no ordering contract between the two exists.
  private camera!: ICameraHandle;

  // Initial fit-to-screen + auto-fit on topology change. Owns the
  // `hasCompletedInitialLayout` flag the viewport store reads to gate
  // storage writes during the boot tween. The animated path runs on
  // WS-scan add / remove (the user sees the camera glide to frame the
  // new layout); the snap path stays the initial-fit fallback because
  // it goes through Foblex's `fitToScreen` (which doesn't honour the
  // zoom clamp during its own tween, hence the clamp-after-snap).
  private readonly layoutFit = setupLayoutFit({
    visibleNodes: this.visibleNodes,
    // Frozen at its enter value while the lens is on: lens membership
    // churn (and the enter/exit swap itself) must never fire the
    // curated map's auto-fit. See `setupLiveLens`.
    pathsFingerprint: this.liveLensCtl.layoutFitFingerprint,
    savedViewport: this.savedViewport,
    fit: () => this.camera.fitToScreenClamped(),
    animatedFit: () => this.camera.animatedFitToScreen(),
  });

  constructor() {
    // URL ↔ selection deep-link wiring (extracted helper). The
    // `graphNodes` signal feeds a lightweight {id, view.path} list
    // derived straight from the loader, NOT from the full `graph()`
    // pipeline. Without this, the async dagre layout effect's
    // `layoutPositions` write would tick `graph()` (different array
    // ref each time) and re-fire the URL→selection reader with the
    // stale URL path, undoing a freshly-closed panel before
    // `router.navigate` has cleared the `?path=` query param.
    const selectionNodes = computed(
      () => this.loader.nodes().map((n) => ({ id: n.path, view: { path: n.path } })),
      {
        equal: (a, b) => {
          if (a.length !== b.length) return false;
          for (let i = 0; i < a.length; i++) {
            if (a[i]?.id !== b[i]?.id) return false;
          }
          return true;
        },
      },
    );
    bindSelectionToUrl({
      selectedPath: this.selectedPath,
      setSelectedNodeId: (id) => this.applySelection(id),
      readSelectedNodeId: () => this.selectedNodeId(),
      graphNodes: selectionNodes,
      // A deep link from the files view ("open in map") should glide
      // the camera onto the node. Stash the id; the camera's center
      // effect runs the pan once the boot fit has fixed the zoom and
      // the dagre positions are in.
      onDeepLinkSelect: (id) => {
        // The center pan resolves MAIN-pipeline geometry; while the
        // lens is on that frame would not match what is painted, so the
        // deep link only selects (inspector opens, no camera move).
        if (this.lensOn()) return;
        this.camera.pendingCenterNodeId.set(id);
      },
      router: this.router,
      route: this.route,
    });

    // Reconcile `nodePositions` against the loaded set so storage holds
    // the position of every visible node, not just the ones the user
    // manually dragged. Reads the latest dagre output for missing ids,
    // drops stale entries, and refreshes auto pins whose dagre position
    // drifted (manual pins stay verbatim). After `resetLayout()` clears
    // the map this effect runs on the next tick and reseeds every
    // visible node from the freshest dagre layout, then persists.
    // Single localStorage write per cycle, gated by the helper's `dirty`
    // flag. Empty-loader case is skipped so we don't wipe storage
    // during the boot loading phase. Pure reconcile in
    // `graph-view.reconcile.ts`.
    //
    // The camera's deferred fits (`runAnimatedFit` reads `nodePositions`
    // for the bbox) must see post-reconcile geometry, so this effect
    // stamps `layoutReconciledAt` AFTER the positions write and the
    // camera keys on that stamp, never on the raw layout tick. The
    // stamp value is the pass's own `computedAt`, so the echo re-run
    // this effect's `nodePositions` write triggers re-stamps the same
    // number and propagates nothing.
    effect(() => {
      const nodes = this.loader.nodes();
      if (nodes.length === 0) return;
      const layout = this.fullLayout();
      if (layout.positions.size === 0) return; // dagre hasn't run yet
      const result = reconcileNodePositions({
        nodes,
        current: this.nodePositions(),
        layout,
        corpusPaths: this.corpusPathSet(),
      });
      if (result.dirty) {
        this.nodePositions.set(result.next);
        writeStoredNodePositions(result.next);
      }
      this.layoutReconciledAt.set(layout.computedAt);
    });

    // Fit / center / tween orchestration, owned by `setupCamera`
    // (auto-fit runner, deep-link center pan, curation re-fit debounce;
    // see `camera.controller.ts` for each effect's rationale). Its
    // deferred fits key on `layoutReconciledAt` (stamped by the
    // reconcile effect above), so creation order between the two is
    // irrelevant: the camera only wakes once reconciled positions are
    // in `nodePositions`.
    this.camera = setupCamera({
      injector: this.injector,
      destroyRef: this.destroyRef,
      canvas: () => this.canvas(),
      zoom: () => this.zoom(),
      canvasWrap: () => this.canvasWrap()?.nativeElement ?? null,
      viewportPosition: this.viewportPosition,
      viewportScale: this.viewportScale,
      storeOnCanvasChange: (event) => this.viewportStore.onCanvasChange(event),
      zoomMin: this.zoomMin,
      nodes: this.loader.nodes,
      topology: this.topology,
      fullLayout: this.fullLayout,
      mapVisiblePaths: this.mapVisiblePaths,
      layoutSettledAt: this.layoutReconciledAt,
      nodePositions: this.nodePositions,
      reservedPanelWidth: () => this.reservedPanelWidth(),
      hasCompletedInitialLayout: () => this.layoutFit.hasCompletedInitialLayout(),
      graphPreferences: this.graphPreferences,
      dagreLayout: this.dagreLayout,
      framing: () => this.followCtl.framing(),
      disableFollow: () => this.disableFollow(),
      resetExpansion: () => this.expansion.resetAll(),
      curationOverrides: this.mapVisibility.overrides,
      activeTagSelection: this.activeTagSelection,
    });

    // Garbage-collect curated paths a re-scan removed. Keyed on the
    // whole-corpus LITE node set, NOT the rendered branch: curation is
    // corpus-wide and must survive a branch switch (a curated path that
    // is simply outside the current branch is still valid). Only a path
    // the re-scan genuinely dropped from the corpus is pruned. If
    // pruning empties the curation the map falls back to "show all".
    effect(() => {
      const lite = this.loader.liteNodes();
      if (lite.length === 0) return;
      // `untracked`: prune is a re-scan garbage-collect, it must fire only
      // when the CORPUS changes (lite list), never on a selection toggle.
      // prune reads `mapVisibility.paths()` internally, so without this the
      // effect would track the selection and re-run on every checkbox click,
      // wiping a freshly-selected folder prefix before the map even renders.
      untracked(() => this.mapVisibility.prune(new Set(lite.map((n) => n.path))));
    });

    // Map views, apply side: consume a freshly applied view's pin set
    // (spec/map-views.md §Apply semantics: pins REPLACE the manual pin
    // set, everything unpinned re-lays out). The next positions map
    // holds ONLY the view's pins (`manual: true`); every other entry is
    // dropped, which is the same mechanism `resetLayout()` uses, so the
    // reconcile effect re-seeds the unpinned nodes from the freshest
    // dagre output. Keeping the old entries as demoted autos was the
    // "no switcheo" bug: the reconcile only refreshes autos when a node
    // ENTERS the graph, so between two views sharing the same visible
    // set the outgoing view's arrangement never moved. One positions
    // write + one storage write per apply; the mailbox clears inside
    // `untracked` so this effect only ever fires on a new apply, and
    // the short-lived `view-switching` host class drives the
    // (PRM-gated) entry fade in graph-view.css.
    effect(() => {
      const pending = this.mapViews.pendingPins();
      if (pending === null) return;
      untracked(() => {
        const next: TNodePositions = new Map();
        for (const [path, point] of Object.entries(pending)) {
          next.set(path, { x: point.x, y: point.y, manual: true });
        }
        this.beginViewSwitchAnimation();
        this.nodePositions.set(next);
        writeStoredNodePositions(next);
        this.mapViews.clearPendingPins();
      });
    });
    this.destroyRef.onDestroy(() => {
      if (this.viewSwitchTimer !== null) clearTimeout(this.viewSwitchTimer);
    });

    // Live lens transition announcements (WCAG 4.1.3): the canvas swap
    // is purely visual, a screen-reader user would otherwise not know
    // the map they were reading was replaced (or restored). Watches the
    // signal, not the toggle handler, so the forced exit (Real Time
    // off) announces too.
    let prevLensOn = untracked(() => this.lensOn());
    effect(() => {
      const on = this.lensOn();
      if (on === prevLensOn) return;
      prevLensOn = on;
      this.announcer.announce(
        on ? GRAPH_VIEW_TEXTS.a11y.lensEntered : GRAPH_VIEW_TEXTS.a11y.lensExited,
      );
    });

    // Replay transition announcements, same rationale as the lens pair.
    let prevReplayOn = untracked(() => this.replayOn());
    effect(() => {
      const on = this.replayOn();
      if (on === prevReplayOn) return;
      prevReplayOn = on;
      this.announcer.announce(
        on ? GRAPH_VIEW_TEXTS.a11y.replayEntered : GRAPH_VIEW_TEXTS.a11y.replayExited,
      );
    });

    // Map views, save side: project the `manual: true` subset of the
    // live positions to the service, feeding the dirty computation and
    // the pin set `saveActive` / `saveAs` persist. The write is
    // untracked (and value-deduped inside the service), so no loop
    // forms with the apply effect above.
    effect(() => {
      const positions = this.nodePositions();
      const manual: Record<string, IPoint> = {};
      for (const [id, pos] of positions) {
        if (pos.manual === true) manual[id] = { x: pos.x, y: pos.y };
      }
      untracked(() => this.mapViews.setLivePins(manual));
    });

    // Async layout effect, runs dagre when topology or layout
    // preferences change. The cache key combines the topology
    // fingerprint with the preferences tuple so an unchanged WS push
    // (same paths + edges + same algorithm/direction/spacing) skips
    // the engine call entirely.
    //
    // A preference change is treated as an explicit "redo the layout"
    // gesture: `nodePositions` is cleared so the next reconcile pass
    // repaints every card from the fresh dagre output, instead of
    // keeping the user pinned to the previous arrangement.
    //
    // The engine call is deferred to a microtask via
    // `Promise.resolve().then(...)` so the synchronous prelude of
    // `DagreLayoutEngine.calculate()` (which builds the graphlib
    // graph and may touch Foblex internals) runs OUTSIDE this
    // effect's reactive context. Inlining the call subscribes the
    // effect to any signal Foblex reads, producing spurious re-fires
    // on unrelated state changes.
    let lastLayoutKey = '';
    let lastPreferencesKey = '';
    effect(() => {
      const nodes = this.loader.nodes();
      const topology = this.topology();
      const preferences = {
        algorithm: this.graphPreferences.layoutAlgorithm(),
        direction: this.graphPreferences.layoutDirection(),
        spacing: this.graphPreferences.layoutSpacing(),
      };
      if (nodes.length === 0) return;

      const topologyKey = topologyFingerprint(nodes, topology.edges);
      const preferencesKey =
        `${preferences.algorithm}|${preferences.direction}|${preferences.spacing}`;
      const cacheKey = `${topologyKey}|${preferencesKey}`;
      if (cacheKey === lastLayoutKey) return;
      const preferencesChanged =
        lastPreferencesKey !== '' && lastPreferencesKey !== preferencesKey;
      lastLayoutKey = cacheKey;
      lastPreferencesKey = preferencesKey;

      // Algorithm dispatch lives in `computeLayoutPositions` (one owner,
      // three callers), and always answers with a promise.
      const layoutPromise = computeLayoutPositions(
        this.dagreLayout,
        nodes,
        topology.edges,
        preferences,
      );

      void layoutPromise
        .then((positions) => {
          this.layoutPositions.set(positions);
          this.layoutComputedAtSignal.set(performance.now());
          if (preferencesChanged) {
            // The user just asked for a new layout: drop the
            // user-pinned drag positions so every card repaints from
            // the fresh dagre / force output, then fit the viewport
            // to the new bounding box. `fitToScreenClamped` calls
            // `canvas.fitToScreen` which gates on
            // `WaitForConnectionsRendered` internally (waits for both
            // `connectionsRenderedRevision` and the matching
            // `connectionsRenderedNodesRevision`), so the bounding
            // box it measures is always against the post-layout DOM.
            this.nodePositions.set(new Map());
            this.camera.fitToScreenClamped();
          }
        })
        .catch((err) => {
          // Swallow + log: a layout failure (e.g. dagre CJS interop
          // missing in tests) must not crash the graph view. The
          // previous positions stay; the user can still pan, drag,
          // and select cards.
          console.error('[graph-view] layout failed:', err);
        });
    });
  }

  ngOnInit(): void {
    // Boot guard: kick the three-fetch lazy load once if nothing has
    // landed yet. Keyed on `scanMeta()` (the cheapest of the three) so a
    // branch that legitimately renders zero nodes does not re-trigger
    // the boot fetch on every mount.
    if (this.loader.scanMeta() === null && !this.loader.loading()) {
      void this.loader.load();
    }
  }

  onLoaded(): void {
    // Intentional no-op, `setupLayoutFit` owns the initial fit and
    // the prefs-change fit lives in the layout effect. Kept as a
    // template hook in case we need a render-complete callback later.
  }

  /**
   * Canvas change handler, bound in the template. The gesture semantics
   * (viewport mirroring + persistence, the follow interrupt on an
   * in-flight tween) live in `camera.controller.ts`.
   */
  protected onCanvasChange(event: FCanvasChangeEvent): void {
    this.camera.onCanvasChange(event);
  }

  /**
   * Isolate `path` on the map: curate visibility down to the node and its
   * DIRECT neighbors (one hop), and select the origin node. One hop, not
   * the transitive connected component, because a connected graph has a
   * single component, so "isolate" would otherwise show the whole map and
   * read as a plain select. The curation change is picked up by the
   * re-fit effect (which frames the neighborhood, inspector-aware);
   * selecting the node directly writes `?path` via the selection writer
   * effect without firing the deep-link centerer, so the camera frames the
   * neighborhood rather than centering the single origin node. Public
   * because the rail reaches it through `MAP_ISOLATE_INTENT` (the workspace
   * provides an implementation that forwards here).
   *
   * Re-invoking it for the same node while the map still shows exactly that
   * neighborhood toggles back to the pre-isolate visibility (see
   * `MapVisibilityService.isolate`); the service owns that bookkeeping.
   */
  isolateNeighborhood(path: string): void {
    // Isolate is a curated-map intent ("look at THIS neighborhood"):
    // the lens exits first (full restore path), then the curation +
    // re-fit run on the map the user is about to see.
    if (this.lensOn()) this.liveLensCtl.toggle();
    // Isolating curates + re-frames the neighborhood; follow would fight
    // that framing on the next activity tick, so it yields first.
    this.disableFollow();
    const outcome = this.mapVisibility.isolate(path, directNeighborhood(this.fullAdjacency(), path));
    // A toggle-back (re-isolating the same node while the map still shows its
    // neighborhood) restores the prior visibility; leave selection alone so it
    // reads as an undo. A fresh isolate selects the origin so the re-fit effect
    // frames the neighborhood.
    if (outcome === 'isolated') this.applySelection(path);
  }

  onNodePositionChange(id: string, position: IPoint): void {
    // Belt-and-braces with `[fNodeDraggingDisabled]`: nothing the lens
    // shows may ever reach the drag buffer / persisted positions.
    if (this.lensOn()) return;
    this.nodeDrag.onNodePositionChange(id, position);
  }

  // Zoom / fit keep follow armed (every toolbar button does now): they
  // reposition the camera now, and follow re-grabs it on the next
  // activity change. Neither changes layout or membership, so the follow
  // effect does not re-fire and there is nothing to race with.
  zoomIn(): void {
    this.zoom()?.setZoom(this.camera.getViewportCenter(), ZOOM_BUTTON_STEP, EFZoomDirection.ZOOM_IN, true);
  }

  zoomOut(): void {
    this.zoom()?.setZoom(this.camera.getViewportCenter(), ZOOM_BUTTON_STEP, EFZoomDirection.ZOOM_OUT, true);
  }

  fitToScreen(): void {
    // The camera controller's fit reads main-pipeline geometry and must
    // stay main-bound (it also WRITES `nodePositions` on other paths);
    // the lens carries its own fit over the lens set.
    if (this.lensOn()) {
      this.liveLensCtl.fitToLens();
      return;
    }
    this.camera.runAnimatedFit();
  }

  /**
   * Record gesture (the Sessions rail's control, user decision
   * 2026-08-16 replacing every toolbar lens control): start capturing
   * the tape AND watch it live. The watermark reset makes the lens
   * canvas narrate from THIS moment (each recording starts fresh, which
   * is also why the eraser button could retire); an in-flight replay
   * stands down first, recording means watching the present.
   */
  startSessionRecording(): void {
    if (!this.liveLens.available()) return;
    if (this.playback.active()) this.playback.exit();
    this.liveLens.reset();
    this.recorder.start();
    if (!this.lensOn()) this.liveLensCtl.toggle();
  }

  /** Stop capturing; back to the curated map unless a replay is running. */
  stopSessionRecording(): void {
    this.recorder.stop();
    if (this.lensOn() && !this.playback.active()) this.liveLensCtl.toggle();
  }

  resetLayout(): void {
    const visiblePaths = this.mapVisiblePaths();
    const full = visiblePaths.size >= this.loader.nodes().length;
    // Skip the confirm entirely when nothing user-established would be lost:
    // with no manual (dragged / re-arranged) position stored, the current
    // layout IS the automatic one, so re-running it changes nothing to warn
    // about. Only when the user has positioned nodes do we surface the
    // (low-intensity) warning below.
    const hasManualPositions = [...this.nodePositions().values()].some((p) => p.manual === true);
    if (!hasManualPositions) {
      this.camera.applyResetLayout(visiblePaths, full);
      return;
    }
    // Warn that the reset replaces those positions, but at LOW intensity
    // (not a red danger action): an info icon and a normal accept button.
    // The copy differs by case, the full reset replaces every position; the
    // scoped one only re-arranges the currently visible nodes and leaves the
    // hidden ones' coordinates intact.
    const t = GRAPH_VIEW_TEXTS.resetLayoutConfirm;
    this.confirmationService.confirm({
      header: t.header,
      message: full ? t.message : t.messageVisible,
      icon: 'pi pi-info-circle',
      acceptButtonProps: { label: t.accept },
      rejectButtonProps: { label: t.reject, severity: 'secondary', outlined: true },
      accept: () => this.camera.applyResetLayout(visiblePaths, full),
    });
  }

  // Middle-mouse pan is owned by the `[smMiddleMousePan]` directive
  // applied to `.graph__canvas-wrap` in the template, handlers,
  // origin state, rAF coalescing, and cleanup all live there.

  onNodePointerDown(event: PointerEvent): void {
    this.nodeDrag.onNodePointerDown(event);
  }

  // Session-anchor + agent-capsule drags (ephemeral overrides, per-move
  // write-back, `mouseup` drag-end per skill rule 9) are owned by
  // `setupSpawnAnchors`; see `spawn-anchors.controller.ts` for the
  // deliberate rule 9 divergence rationale. One-line delegations keep
  // the template bindings unchanged.
  onSessionPointerDown(owner: string): void {
    this.spawnAnchors.onSessionPointerDown(owner);
  }

  onSessionPositionChange(owner: string, position: IPoint): void {
    this.spawnAnchors.onSessionPositionChange(owner, position);
  }

  onAgentCapsulePointerDown(id: string): void {
    this.spawnAnchors.onAgentCapsulePointerDown(id);
  }

  onAgentCapsulePositionChange(id: string, position: IPoint): void {
    this.spawnAnchors.onAgentCapsulePositionChange(id, position);
  }

  selectNode(node: IGraphNode, event: MouseEvent): void {
    if (!this.nodeDrag.isClickWithoutDrag(event)) return;
    // Modifier clicks are multi-selection gestures owned by Foblex:
    // Ctrl/Cmd+click toggles the node in and out of the selection
    // (`SelectByPointer`), Shift belongs to the marquee. Forcing the
    // single-id selection here would collapse the set the library just
    // built on pointerdown.
    if (event.shiftKey || event.ctrlKey || event.metaKey) return;
    this.applySelection(node.id);
  }

  /**
   * Selection single-owner contract (Foblex v19 keyboard layer): Foblex's
   * internal selection is the source of truth. Every PROGRAMMATIC write
   * (click handler, isolate, deep links, escape/background deselect, the
   * filter guard) goes through here so the canvas paint (`.f-selected`),
   * the keyboard layer's active item, and the app state (`selectedNodeId`
   * driving inspector panel + adjacency highlight + dim) can never
   * diverge. User gestures (arrow keys, Shift+area, Ctrl/Cmd+A) flow the
   * other way: Foblex mutates its own selection and reports through
   * `onFlowSelectionChange`. Writes are idempotent, so the two paths
   * converging on the same id is harmless.
   */
  private applySelection(id: string | null): void {
    this.selectedNodeId.set(id);
    this.flow()?.select(id === null ? [] : [id], [], false);
  }

  /**
   * Foblex → app bridge of the single-owner contract. Exactly one
   * selected node drives the inspector/highlight state; empty and
   * multi-node selections (Shift+area rectangle, Ctrl/Cmd+A) both map to
   * "no inspected node", matching the pre-keyboard behavior where only
   * a single click selected.
   */
  protected onFlowSelectionChange(event: FSelectionChangeEvent): void {
    // Grabbing a node to MOVE it is not a request to inspect it. Foblex
    // selects whatever sits under the pointer on pointerdown and reports
    // that selection the moment the drag threshold is crossed, which
    // would pop the inspector open mid-drag. Drag-induced changes are
    // dropped here (the `f-dragging` host class is the only signal
    // available this early, see `isFlowDragging`); the node-drag
    // controller's `onDragEnd` re-asserts the app selection into Foblex
    // once the gesture settles, so the two sides never stay divergent.
    // A click that never moved is unaffected: the class is never
    // stamped, the event arrives on pointerup, and the inspector opens.
    if (isFlowDragging(this.flow()?.hostElement)) return;
    const ids = event.nodeIds;
    if (ids.length === 1) {
      this.selectedNodeId.set(ids[0] ?? null);
      return;
    }
    // Connection-only selection: the Ctrl+arrow topology walk stops on
    // the connection before hopping to its far node (upstream design,
    // not configurable), and a mouse click can select an edge. Neither
    // should blink the inspector shut, so the last inspected node is
    // preserved (same as the pre-keyboard behavior, where edge clicks
    // never touched the app selection). Empty and multi-node
    // selections still clear it.
    if (ids.length === 0 && event.connectionIds.length > 0) return;
    this.selectedNodeId.set(null);
  }

  // Tag-selection state machine (active tag + pre-tag curation snapshot),
  // owned by `setupTagSelection`. Clicking a tag curates the map to the
  // nodes carrying it (the rest hide); the graph view's curation re-fit
  // effect frames the result. The view still owns the trigger surface
  // (`onTagSelect`, wired to the inspector header's tag chip output) and
  // reads `activeTagSelection` for the dim suspension.
  private readonly tagSelection = setupTagSelection({
    nodes: this.loader.nodes,
    mapVisibility: this.mapVisibility,
  });
  protected readonly activeTagSelection = this.tagSelection.activeTagSelection;

  /**
   * Activity focus origins (selection-state.ts): while Follow the
   * Activity is armed on the curated map with Real Time on, the
   * executing nodes become the focus and the map falls off around them
   * (near ring dimmed, everything farther desaturated), so attention
   * follows the action the way the camera does. Empty under the lens
   * and the replay (they narrow the canvas themselves) and whenever
   * follow is off, which keeps the existing opt-out in charge of both.
   */
  private readonly activityFocus = computed<ReadonlySet<string>>(() => {
    if (this.lensOn() || this.replayOn()) return EMPTY_PATH_SET;
    if (!this.nodeActivity.enabled() || !this.followActivity()) return EMPTY_PATH_SET;
    return this.nodeActivity.activePaths();
  });

  private readonly selectionState = createSelectionState({
    graph: this.graph,
    selectedNodeId: this.selectedNodeId,
    activeTagSelection: this.activeTagSelection,
    activityFocus: this.activityFocus,
  });

  protected onTagSelect(tag: string): void {
    this.tagSelection.onTagSelect(tag);
  }

  /** Close the embedded inspector panel and remove the URL `?path` param. */
  closePanel(): void {
    this.applySelection(null);
  }

  /**
   * Escape closes the inspector panel, but only when no PrimeNG
   * overlay is open. A confirm dialog / settings modal / overlay panel
   * receives Escape first (its own keydown handler closes it), and
   * because the host listener does not control propagation, the same key
   * would otherwise ALSO collapse this panel in the same tick. The
   * selector covers ConfirmDialog, Dialog, OverlayPanel, and Popover
   * variants used in this app.
   */
  onEscape(): void {
    if (typeof document !== 'undefined' && isAnyPrimengOverlayOpen(document)) return;
    if (this.selectedNodeId() !== null) {
      this.closePanel();
      return;
    }
    // No inspected node, but a multi-selection (Shift+marquee,
    // Ctrl/Cmd+click) may still live inside Foblex; Escape drops it so
    // the keyboard path has the same way out as a background click.
    if ((this.flow()?.getSelection().fNodeIds.length ?? 0) > 0) this.applySelection(null);
  }

  /**
   * Clear every active filter, same affordance the list view exposes in
   * its empty state. Wired to the "Reset filters" button rendered when
   * `showEmptyState()` is true so the user can recover from an
   * over-narrow filter combo without leaving the graph.
   */
  protected resetFilters(): void {
    this.filters.reset();
  }

  protected onPanelResizeStart(event: MouseEvent): void {
    this.panelResize.onResizeStart(event);
  }

  openNode(node: IGraphNode): void {
    // Embedded inspector mode: dblclick selects (single click already does
    // the same, kept the handler so the gesture has a clear intent).
    this.applySelection(node.id);
  }

  /**
   * Keyboard activation of a node host (WCAG 2.1.1 / 4.1.2). Mirrors the
   * `(click)` select without the drag guard (`selectNode` rejects a
   * click that was really a drag, which cannot happen from the keyboard).
   * Enter/Space select; the selection effect then moves focus into the
   * inspector. Spatial arrow-key navigation across the canvas belongs to
   * the Foblex keyboard layer (installed via `provideFFlow(withA11y(...))`
   * above), which drives its own active item through `aria-activedescendant`
   * on the `<f-flow>` host; this handler only provides the tab-reachable
   * activation the AA level requires on the node host itself.
   */
  selectNodeByKeyboard(node: IGraphNode, event: Event): void {
    event.preventDefault();
    this.applySelection(node.id);
  }

  /** Display name for a node host (frontmatter name, else a friendly basename). */
  nodeDisplayName(node: IGraphNode): string {
    return node.view.frontmatter.name ?? pathBasenameForLink(node.view.path);
  }

  /** Accessible name for a node host: name + kind + selection state. */
  nodeHostLabel(node: IGraphNode): string {
    return GRAPH_VIEW_TEXTS.a11y.nodeHost(
      this.nodeDisplayName(node),
      node.view.kind,
      this.isSelected(node.id),
    );
  }

  /**
   * Focus destination after the inspector panel closes (WCAG 2.4.3):
   * the node host that was just deselected, i.e. the element that opened
   * the panel, else the canvas wrap (`tabindex="-1"`, a focus target and
   * not a tab stop). Called once per close from `selectionFocusEffect`.
   */
  private restoreFocusAfterClose(deselectedId: string): void {
    const wrap = this.canvasWrap()?.nativeElement ?? null;
    if (!wrap) return;
    (this.nodeHostElement(wrap, deselectedId) ?? wrap).focus({ preventScroll: true });
  }

  /**
   * The rendered `<div fNode>` host for `nodeId`, or null when the node
   * is outside the render window (virtualisation) or gone from the graph.
   *
   * Matched by reading each host's `data-testid` instead of composing a
   * `[data-testid="..."]` selector: node ids are file paths, and a path
   * carrying a quote or a backslash would break the selector string. One
   * pass over the mounted hosts, run only when the panel closes, never
   * per node and never per frame.
   */
  private nodeHostElement(wrap: HTMLElement, nodeId: string): HTMLElement | null {
    const testid = `graph-node-${nodeId}`;
    const hosts = Array.from(wrap.querySelectorAll<HTMLElement>('.sm-gnode-host'));
    return hosts.find((el) => el.dataset['testid'] === testid) ?? null;
  }

  /**
   * Keyboard resize of the inspector panel (WCAG 2.1.1). The panel hugs
   * the right edge, so ArrowLeft widens it and ArrowRight narrows it.
   * `PANEL_RESIZE_STEP` per keypress. Values reflected to the separator's
   * `aria-valuenow`/min/max.
   */
  protected onPanelResizeKey(direction: 'wider' | 'narrower'): void {
    this.panelResize.stepBy(direction === 'wider' ? PANEL_RESIZE_STEP : -PANEL_RESIZE_STEP);
  }

  protected readonly panelResizeMin = this.panelResize.minWidth;
  protected readonly panelResizeMax = this.panelResize.maxWidth;

  /**
   * Click anywhere on the canvas that is NOT an interactive overlay
   * deselects. Foblex's `<f-flow>` does not expose a "background click"
   * event, so we listen on the wrapper and filter by target.
   *
   * Opt-out contract: any surface that must NOT clear the selection
   * marks itself with `data-canvas-click-shield` in the template (node
   * cards, session anchors, palettes, toolbar, inspector panel, perf
   * HUD). The attribute keeps this handler decoupled from child
   * components' CSS class names, a styling refactor cannot silently
   * break the deselect gating, and a new overlay opts out by adding
   * the attribute instead of editing a selector list here.
   */
  /**
   * Anchor of the last primary-button press on the wrapper, consumed by
   * `onCanvasClick` to tell a genuine background click from the click
   * the browser synthesizes at the END of a background drag (Shift
   * marquee, canvas pan), whose down and up both land on the canvas.
   */
  private canvasPointerDownAt: { x: number; y: number } | null = null;

  onCanvasPointerDown(event: MouseEvent): void {
    this.canvasPointerDownAt =
      event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
  }

  onCanvasClick(event: MouseEvent): void {
    const downAt = this.canvasPointerDownAt;
    this.canvasPointerDownAt = null;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-canvas-click-shield]')) return;
    // The click concluding a background DRAG is not a deselect request:
    // releasing a Shift+marquee would otherwise wipe the selection it
    // just built. Same tolerance as the node-level click guard.
    if (
      downAt !== null &&
      Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > CLICK_DRAG_TOLERANCE_PX
    ) {
      return;
    }
    // Modifier clicks are selection-building gestures (Shift = additive
    // marquee, Ctrl/Cmd = toggle); Foblex keeps its selection on them,
    // so the app must not clear on its behalf.
    if (event.shiftKey || event.ctrlKey || event.metaKey) return;
    this.applySelection(null);
  }

  isSelected(id: string): boolean {
    return this.selectionState.isSelected(id);
  }

  isHighlighted(id: string): boolean {
    return this.selectionState.isHighlighted(id);
  }

  isDimmed(id: string): boolean {
    return this.selectionState.isDimmed(id);
  }

  /**
   * Single-call lookup for the bundled selection state of a node, used
   * as the `[selection]` binding on `<sm-node-card>`. Falls back to the
   * all-`false` default when the map has not seen `id` yet (between a
   * graph swap and the next selection recompute).
   */
  selectionFor(id: string): ISelectionView {
    return this.selectionState.selectionView().get(id) ?? SELECTION_DEFAULT;
  }

  isExpanded(id: string): boolean {
    return this.expansion.isExpanded(id);
  }

  setExpanded(id: string, value: boolean): void {
    this.expansion.setExpanded(id, value);
  }

  onFavoriteToggle(payload: { path: string; value: boolean }): void {
    void this.loader.toggleFavorite(payload.path, payload.value);
  }

  /**
   * Single-call lookup for the bundled selection state of an edge, read
   * via a `@let` on each `<f-connection>` so highlight / dim / opacity
   * cost one Map lookup instead of three function calls per CD pass
   * (mirrors `selectionFor` for nodes). The opacity folds the confidence
   * gradient and the dim override into one value; inline styles win over
   * the `.f-conn--dimmed` class rule, so this is the single source of
   * truth for connection opacity. Falls back to the all-visible default
   * between a graph swap and the next selection recompute.
   */
  edgeSelectionFor(id: string): IEdgeSelectionView {
    return this.selectionState.edgeSelectionView().get(id) ?? EDGE_SELECTION_DEFAULT;
  }

  /**
   * Live-activity lookup (spec/provider-activity.md): `true` while the
   * node's unit is executing in the operator's AI runtime. Graph node
   * ids ARE node paths, so the `NodeActivityService` set applies with
   * one O(1) lookup per node; under OnPush only the cards whose value
   * flips re-render.
   */
  isExecuting(id: string): boolean {
    // Replay: the fold's virtual-time executing set replaces the live
    // glow (the past lights up exactly as it did).
    if (this.replayOn()) return this.playback.state().executing.has(id);
    return this.nodeActivity.activePaths().has(id);
  }

  /**
   * Change spark: `true` while the node's file-change flash is live
   * (`NodeSparkService`, watcher-detected disk change). One O(1) set
   * lookup per node; under OnPush only the cards whose value flips
   * re-render.
   */
  isSparking(id: string): boolean {
    return this.nodeSpark.sparkPaths().has(id);
  }

  /**
   * Literal tool name that lit the node (spec/provider-activity.md
   * §detail), rendered by the card as a transient badge while the glow
   * lasts. One O(1) map lookup per node; `null` when the frame carried
   * no detail.
   */
  executingDetail(id: string): string | null {
    if (this.replayOn()) return this.playback.state().details.get(id) ?? null;
    return this.nodeActivity.executionDetails().get(id) ?? null;
  }

  /**
   * Active-spine edge: both endpoints are executing (the agent that is
   * running and the skill it invoked), so the connection between them
   * lights up with them and the path reads as one live chain instead of
   * isolated glowing dots. In lens mode the treatment additionally
   * PERSISTS on links the lens observed live (both ends executed
   * together at some point inside the watermark): links that actually
   * happened stay animated instead of evaporating with the glow.
   */
  isEdgeExecuting(edge: IGraphEdge): boolean {
    if (this.replayOn()) {
      const executing = this.playback.state().executing;
      if (executing.has(edge.from) && executing.has(edge.to)) return true;
      return this.liveLens.observedSpinePairs().has(`${edge.from}|${edge.to}`);
    }
    const active = this.nodeActivity.activePaths();
    if (active.has(edge.from) && active.has(edge.to)) return true;
    return this.lensOn() && this.liveLens.observedSpinePairs().has(`${edge.from}|${edge.to}`);
  }

  /**
   * Execution-stats lookup for the card counter pill
   * (spec/provider-activity.md §Execution stats). One O(1) Map lookup
   * per node; entry identities are stable inside
   * `NodeActivityStatsService`, so under OnPush only the cards whose
   * count actually moved re-render.
   */
  activityStatsFor(id: string): INodeActivityStatsApi | null {
    return this.activityStats.stats().get(id) ?? null;
  }

  // Live-overlay cluster (ephemeral spawn overlay, session anchors,
  // agent capsules, tool-invocation edges, per-pair conversation
  // counters, edge click routing, conversation dialog), owned by
  // `setupSpawnAnchors`; see `spawn-anchors.controller.ts` for the
  // layering + click-routing rationale. `resolveSpawnActiveId` routes
  // through the host's `spawnActiveIdFor` method below so an
  // instance-level pin of that method (the component spec does this)
  // still intercepts the static-edge click routing.
  private readonly spawnAnchors = setupSpawnAnchors({
    destroyRef: this.destroyRef,
    agentSpawns: this.agentSpawns,
    nodeActivity: this.nodeActivity,
    activityStats: this.activityStats,
    livePrefs: this.livePrefs,
    dataSource: this.dataSource,
    // Display-switched geometry: while the lens is on the overlay
    // anchors onto the lens cards (empty pin layer, lens force layout,
    // lens visible set) and silently drops edges whose endpoint is not
    // live; on the curated map everything reads as before.
    nodePositions: this.displayNodePositions,
    fullLayout: this.displayFullLayout,
    mapVisiblePaths: this.displayVisiblePaths,
    graph: this.graph,
    resolveSpawnActiveId: (edge) => this.spawnActiveIdFor(edge),
  });
  protected readonly spawnOverlay = this.spawnAnchors.spawnOverlay;

  /**
   * Invocation edges for the template. Curated map: the live overlay
   * (60s TTL). Lens mode: the lens's OBSERVED invocations instead,
   * same shape and same `.f-conn--invocation` dress, so a call that
   * really happened keeps its labeled edge for as long as its
   * endpoints stay on the lens (links do not evaporate). The observed
   * set is a superset of the live one there, membership-filtered by
   * the service.
   */
  protected readonly invocationEdges = computed<readonly IInvocationOverlayEdge[]>(() => {
    if (!this.lensOn()) return this.spawnAnchors.invocationEdges();
    return this.liveLens.observedInvocations().map((inv) => ({
      key: inv.key,
      sourceId: inv.caller,
      targetId: inv.target,
      label: inv.label,
    }));
  });

  /**
   * Comet tracks for the template: one connection per executing spine
   * pair, layered over the static edge with the same geometry inputs
   * so the library draws the identical path (see `comet-overlay.ts`
   * for the layering rationale). Reads the same signals
   * `isEdgeExecuting` / `spawnActiveIdFor` read, so the tracks follow
   * live activity, lens observation and replay alike.
   */
  protected readonly cometEdges = computed<readonly ICometOverlayEdge[]>(() =>
    resolveCometOverlay({
      edges: this.graph().edges,
      isExecuting: (edge) => this.isEdgeExecuting(edge),
      isSpawnActive: (edge) => this.spawnActiveIdFor(edge) !== null,
    }),
  );

  /**
   * Diagonal extent of the rendered cards while the boot intro runs
   * (`null` otherwise, so the per-card inline delay is removed the
   * moment the intro closes and never rides normal renders). The
   * stagger sweeps along `x + y`: a top-down layout unfolds rank by
   * rank, a left-right one sweeps across, both from the layout's
   * origin corner.
   */
  private readonly introSweep = computed<{ min: number; range: number } | null>(() => {
    if (this.intro.phase() !== 'running') return null;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const node of this.graph().nodes) {
      const diagonal = node.position.x + node.position.y;
      if (diagonal < min) min = diagonal;
      if (diagonal > max) max = diagonal;
    }
    if (!Number.isFinite(min)) return null;
    return { min, range: Math.max(1, max - min) };
  });

  /**
   * Per-card `--sm-intro-delay` (a CSS time string, or `null` to
   * unset) for the boot intro's stagger: 0 at the origin corner of
   * the layout, `INTRO_SWEEP_MS` at the far one.
   */
  protected introDelayFor(node: { position: IPoint }): string | null {
    const sweep = this.introSweep();
    if (sweep === null) return null;
    const t = (node.position.x + node.position.y - sweep.min) / sweep.range;
    return `${Math.round(t * INTRO_SWEEP_MS)}ms`;
  }

  /**
   * Replay trail: step number + recency per node of the route the tape
   * walked so far (the fold's first-touch `trail`), empty outside a
   * replay so the badges never ride the live map. See `director.ts`.
   */
  private readonly trailIndex = computed<ReadonlyMap<string, ITrailStep>>(() =>
    this.replayOn() ? buildTrailIndex(this.playback.state().trail) : EMPTY_TRAIL_INDEX,
  );

  protected trailStepFor(id: string): ITrailStep | null {
    return this.trailIndex().get(id) ?? null;
  }

  /** O(1) pair -> lastSpawnId lookup over the lens's observed spawns. */
  private readonly lensSpawnByPair = computed<ReadonlyMap<string, string>>(() => {
    const map = new Map<string, string>();
    for (const spawn of this.liveLens.observedSpawns()) {
      map.set(`${spawn.parent}|${spawn.child}`, spawn.lastSpawnId);
    }
    return map;
  });

  /**
   * Spawn edges for the template. Curated map: the live overlay
   * verbatim. Lens mode: the live overlay PLUS a persistent dashed
   * edge per observed node-to-node spawn whose pair neither rides a
   * rendered static edge (that pair persists as `.f-conn--spawn-active`
   * via `spawnActiveIdFor`) nor is already drawn live, so a spawn that
   * really happened keeps its edge after its live entry ended.
   */
  protected readonly displaySpawnEdges = computed<readonly ISpawnOverlayEdge[]>(() => {
    // During replay the LIVE overlay stands down entirely: the fold's
    // observed spawns (via the lens switch) are the only spawn edges.
    const live = this.replayOn() ? [] : this.spawnOverlay().edges;
    if (!this.lensOn()) return live;
    const observed = this.liveLens.observedSpawns();
    if (observed.length === 0) return live;
    const livePairs = new Set(live.map((e) => `${e.sourceId}|${e.targetId}`));
    const staticPairs = new Set(this.graph().edges.map((e) => `${e.from}|${e.to}`));
    const extras: ISpawnOverlayEdge[] = [];
    for (const spawn of observed) {
      const pair = `${spawn.parent}|${spawn.child}`;
      if (staticPairs.has(pair) || livePairs.has(pair)) continue;
      extras.push({
        spawnId: spawn.lastSpawnId,
        sourceId: spawn.parent,
        targetId: spawn.child,
        fromSession: false,
        vertical: false,
        pairKey: edgePairKey(spawn.parent, spawn.child),
      });
    }
    return extras.length === 0 ? live : [...live, ...extras];
  });
  protected readonly conversationOpen = this.spawnAnchors.conversationOpen;
  protected readonly conversationThread = this.spawnAnchors.conversationThread;
  protected readonly conversationCaptureEnabled = this.spawnAnchors.conversationCaptureEnabled;

  /**
   * The spawn riding this static edge, or `null` when the edge is
   * plain. Lens mode falls back to the OBSERVED spawn pair so the
   * spawn-active dress (and its conversation click, anchored on the
   * last live spawnId) persists after the live spawn ended; replay
   * skips the live lookup entirely (the fold is the only truth there).
   */
  protected spawnActiveIdFor(edge: IGraphEdge): string | null {
    const live = this.replayOn() ? null : this.spawnAnchors.spawnActiveIdFor(edge);
    if (live !== null) return live;
    if (!this.lensOn()) return null;
    return this.lensSpawnByPair().get(`${edge.from}|${edge.to}`) ?? null;
  }

  /** Session anchors / agent capsules hide during replay (they narrate the present). */
  protected readonly displaySessions = computed(() =>
    this.replayOn() ? [] : this.spawnOverlay().sessions,
  );
  protected readonly displayAgents = computed(() =>
    this.replayOn() ? [] : this.spawnOverlay().agents,
  );

  /**
   * Sessions-rail gesture (via `SESSION_REPLAY_INTENT`): enter the lens
   * if needed and replay the tape scoped to one session or one agent
   * branch. The tape is re-filtered HERE, at gesture time, so a session
   * still running replays everything up to this moment. An empty scope
   * never enters: the playback's delete-recording auto-exit watches the
   * recorder, not the frozen tape, so an empty scoped replay would have
   * no way to stand itself down.
   */
  replaySessionFromTape(selection: ISessionReplaySelection, label: string, step?: ISessionStep): void {
    if (!this.liveLens.replayAvailable()) return;
    // Journal-hydrated sessions carry their own frames (the client
    // recorder never saw them); tape-native sessions re-filter live.
    const source = selection.sourceFrames ?? this.recorder.events();
    const tape = filterTapeForSession(source, selection);
    if (tape.length === 0) return;
    if (this.playback.active()) this.playback.exit();
    // Playback FIRST, lens second: in demo mode the lens only admits
    // an enter while a replay is in flight (`LiveLensService.setActive`).
    this.playback.enter(
      tape,
      label,
      selection.sourceFrames !== undefined
        ? { kind: 'journal' }
        : { kind: 'tape-session', rootOwner: selection.rootOwner },
    );
    if (!this.lensOn()) this.liveLensCtl.toggle();
    // Step deep-link (user request 2026-08-16): a step row's click lands
    // the replay ON that frame and PAUSED there (`enter` auto-plays, so
    // the pause undoes it): the operator asked to look at a moment, not
    // to watch from it; Play resumes forward when they want. Identity is
    // `(tMs, path)` within the scoped tape; a step the filter somehow
    // excluded degrades to a paused from-the-start replay.
    if (step !== undefined) {
      const at = tape.findIndex(
        (e) => e.type === 'node.activity' && e.tMs === step.tMs && e.data.nodePath === step.path,
      );
      if (at >= 0) this.playback.seek(at);
      this.playback.pause();
    }
  }

  // ── Follow the Activity ─────────────────────────────────────────────
  // Camera state machine extracted to `follow-activity.controller.ts`
  // (fingerprint-gated effect, animated fit over the executing nodes +
  // session capsules). This component stays the camera's home and only
  // wires the config; a gesture that interrupts an in-flight camera
  // move hands control back to the operator via `disableFollow`, see
  // `onCanvasChange`.
  private readonly followCtl = setupFollowActivity({
    livePrefs: this.livePrefs,
    nodeActivity: this.nodeActivity,
    // Suspended while the lens is on: the empty set collapses the
    // fingerprint to the '' sentinel, so the MAIN follow effect goes
    // dormant and the lens's own follow instance owns the camera.
    visiblePaths: computed(() =>
      this.lensOn() ? EMPTY_PATH_SET : this.mapVisiblePaths(),
    ),
    sessions: () => this.spawnOverlay().sessions,
    layoutComputedAt: this.layoutComputedAt,
    bootFitDone: () => this.layoutFit.hasCompletedInitialLayout(),
    hostElement: () => this.canvasWrap()?.nativeElement ?? null,
    // Effective position: user-pinned drag wins over the dagre output,
    // like every other camera path.
    positionOf: (path) => this.nodePositions().get(path) ?? this.fullLayout().positions.get(path),
    panelWidth: () => this.reservedPanelWidth(),
    zoomMin: ZOOM_MIN,
    animateToTransform: (transform) => this.animateToTransform(transform),
  });

  /**
   * Follow-the-activity state for the toolbar toggle. Mode-aware: while
   * the lens is on, the button drives the lens's session-local arming
   * (re-armed on every enter), so a disarm there never clobbers the
   * user's persisted follow preference.
   */
  protected readonly followActivity = computed(() =>
    this.lensOn() ? this.liveLensCtl.follow.followActivity() : this.followCtl.followActivity(),
  );

  protected toggleFollowActivity(): void {
    (this.lensOn() ? this.liveLensCtl.follow : this.followCtl).toggle();
  }

  /**
   * The two "look at THIS instead" intents switch follow off: isolate
   * neighborhood and the files-view deep-link center, plus the
   * gesture-interrupt path in `onCanvasChange` (a free-form gesture only
   * counts while a camera move is in flight). Toolbar camera / layout
   * buttons no longer disable. The setter no-ops when already off.
   */
  private disableFollow(): void {
    (this.lensOn() ? this.liveLensCtl.follow : this.followCtl).disable();
  }

  /**
   * Shared animated-camera entry point, delegated to the camera
   * controller (single supersession token, see `camera.controller.ts`).
   * Kept as a host member so the follow controller's config and every
   * other caller reach the tween through one seam.
   */
  private animateToTransform(transform: IViewportTransform): void {
    this.camera.animateToTransform(transform);
  }

  // Per-pair conversation counters + edge click routing + conversation
  // dialog state live in `setupSpawnAnchors` (see
  // `spawn-anchors.controller.ts`); one-line delegations keep the
  // template bindings unchanged.
  protected convoCountFor(edge: IGraphEdge): number {
    return this.spawnAnchors.convoCountFor(edge);
  }

  protected convoCountForKey(pairKey: string): number {
    return this.spawnAnchors.convoCountForKey(pairKey);
  }

  protected onStaticEdgeClick(edge: IGraphEdge, event: MouseEvent): void {
    this.spawnAnchors.onStaticEdgeClick(edge, event);
  }

  protected onSpawnEdgeClick(spawnId: string, event: MouseEvent): void {
    this.spawnAnchors.onSpawnEdgeClick(spawnId, event);
  }

  protected onConversationClosed(): void {
    this.spawnAnchors.onConversationClosed();
  }

  // Layout-popover labelers + setters + per-item icon helpers now live
  // inside `<sm-graph-layout-toolbar>`. The toolbar owns the popover
  // surface end-to-end (catalogs, dynamic icons, click handlers).
}
