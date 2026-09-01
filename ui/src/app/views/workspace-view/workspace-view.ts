import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, forwardRef, inject, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';

import { WORKSPACE_VIEW_TEXTS } from '../../../i18n/workspace-view.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilesFollowSelectionService } from '../../../services/files-follow-selection';
import { FilterStoreService } from '../../../services/filter-store';
import { LiveLensService } from '../../../services/live-lens';
import { MapVisibilityService } from '../../../services/map-visibility';
import { setupEdgeResize } from '../../core/edge-resize.controller';
import { handleRovingTablistKeydown } from '../../core/roving-tablist';
import { MAP_ISOLATE_INTENT, type IMapIsolateIntent } from '../../slots/map-isolate-intent';
import {
  SESSION_RECORD_INTENT,
  type ISessionRecordIntent,
} from '../../slots/session-record-intent';
import {
  SESSION_REPLAY_INTENT,
  type ISessionReplayIntent,
} from '../../slots/session-replay-intent';
import type { ISessionReplaySelection, ISessionStep } from '../../../services/session-index';
import { SKILL_MAP_MODE } from '../../../services/data-source/runtime-mode';
import { SKILL_MAP_EMBED } from '../../../services/embed-mode';
import { ActivityReadinessService } from '../../services/activity-readiness';
import { UsageTrackerService } from '../../services/usage-tracker';
import { NODE_OPEN_INTENT } from '../../slots/node-open-intent';
import { SessionRecordControl } from '../../components/session-record-control/session-record-control';
import { FilesView } from '../files-view/files-view';
import { GraphView } from '../graph-view/graph-view';
import { QueueView } from '../queue-view/queue-view';
import { SessionsView } from '../sessions-view/sessions-view';
import { WorkspaceNodeOpenIntent } from './workspace-open-intent';
import {
  readStoredActiveSection,
  readStoredRailCollapsed,
  readStoredRailWidth,
  writeStoredActiveSection,
  writeStoredRailCollapsed,
  writeStoredRailWidth,
  type TWorkspaceSection,
} from './workspace-view.storage';

const RAIL_WIDTH_DEFAULT = 440;
const RAIL_WIDTH_MIN = 280;
/** Minimum map area to keep visible at any viewport width. */
const RAIL_VIEWPORT_RESERVE = 480;
/** Pixels the rail grows / shrinks per arrow keypress (WCAG 2.1.1). */
const RAIL_RESIZE_STEP = 24;
/**
 * Tab order of the open rail's strip, in the order the template renders the
 * buttons. Only consumed by the arrow-key handler's fallback branch (see
 * `onSectionKeydown`); the tabs themselves are read off the DOM, so this
 * stays a plain list and does NOT drive the markup. Reorder the template
 * buttons and this list moves with them.
 */
const WORKSPACE_TAB_ORDER: readonly TWorkspaceSection[] = ['files', 'queue', 'sessions'];

/**
 * Fused single-screen workspace: a resizable files rail on the left, the
 * map canvas in the center (which brings its own floating inspector slide-
 * over), and the shared `?path` query param as the selection bus between
 * them. Clicking a file row writes `?path`; the graph view centers on that
 * node and opens the inspector, all without leaving the route.
 *
 * The rail is an activity-bar + tabbed panel: collapsed, it is a 44px
 * icon strip (Files / Queue / Sessions) that opens onto the clicked
 * section; open, a tab header switches its body between the files
 * navigator, the job queue and the recorded-sessions list, with a
 * compact search cluster (driving the shared
 * `FilterStoreService`, so it filters both the table and the map) and a
 * collapse chevron alongside the tabs. Width is drag-resizable like the
 * inspector; faceted filters live on the map's floating palettes.
 *
 * This is the only primary view (route `/`); the former standalone
 * `/files` and `/map` destinations were retired in favour of it.
 */
@Component({
  selector: 'sm-workspace-view',
  imports: [
    FilesView,
    QueueView,
    SessionRecordControl,
    SessionsView,
    GraphView,
    FormsModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    TooltipModule,
  ],
  templateUrl: './workspace-view.html',
  styleUrl: './workspace-view.css',
  // Override the open-intent so "open node" stays on this screen instead
  // of navigating to `/map`. Also self-provide the isolate-intent so the
  // rail's chain gesture forwards to the mounted graph view. Both are
  // scoped to this element injector, so the files rail (a view child)
  // resolves these implementations.
  providers: [
    { provide: NODE_OPEN_INTENT, useClass: WorkspaceNodeOpenIntent },
    { provide: MAP_ISOLATE_INTENT, useExisting: forwardRef(() => WorkspaceView) },
    { provide: SESSION_REPLAY_INTENT, useExisting: forwardRef(() => WorkspaceView) },
    { provide: SESSION_RECORD_INTENT, useExisting: forwardRef(() => WorkspaceView) },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceView implements IMapIsolateIntent, ISessionReplayIntent, ISessionRecordIntent {
  private readonly store = inject(FilterStoreService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly loader = inject(CollectionLoaderService);
  private readonly liveLens = inject(LiveLensService);
  private readonly mapVisibility = inject(MapVisibilityService);
  private readonly followSelection = inject(FilesFollowSelectionService);
  private readonly usageTracker = inject(UsageTrackerService);

  protected readonly texts = WORKSPACE_VIEW_TEXTS;

  /**
   * Enabled only when there is actually something to reset: an active
   * facet filter (search / kind / severity / favorites) OR a map folder
   * selection. Keeps the rail control from sitting permanently lit with
   * nothing to undo.
   */
  protected readonly canReset = computed(
    () => this.store.isActive() || this.mapVisibility.isActive(),
  );

  /**
   * Saved rail preference (`true` collapsed, `false` open), or `null` when
   * the user has never toggled it, so the corpus-size auto-default can
   * decide without overriding an explicit choice.
   */
  private readonly storedRailPref = readStoredRailCollapsed();

  /**
   * In-rail toggle: collapses the files panel to a thin strip. A saved
   * preference is restored as-is; otherwise the rail starts collapsed
   * (map front-and-center) and the constructor effect opens it once the
   * corpus is known to exceed the map render cap (the folders tree is then
   * needed to navigate). A manual toggle persists and always wins over the
   * auto-default.
   */
  protected readonly railCollapsed = signal(this.storedRailPref ?? true);

  /**
   * Which panel the open rail shows (files navigator or job queue), and
   * which icon-bar button / tab reads as active when collapsed. Restored
   * from storage, else the files default. The body swaps its child on
   * this, so only the active section's component is mounted at a time.
   */
  protected readonly activeSection = signal<TWorkspaceSection>(
    readStoredActiveSection() ?? 'files',
  );

  /**
   * The queue is off while the Live lens is on: the lens (and its
   * replay) narrate what the runtime EXECUTED, and the job queue is a
   * different, unrelated timeline whose live rows would read as part of
   * that story. Disabled rather than hidden so the tab keeps its place
   * and can explain itself (`aria-disabled` + the reason in the
   * tooltip); the section switch below moves off it on entry.
   */
  protected readonly queueDisabled = this.liveLens.active;

  /**
   * Sessions need the active lens's live-activity hook: without it no
   * frames ever arrive, so recording is a dead control. `null`
   * (unknown) fails OPEN like every consumer of the readiness probe; a
   * KNOWN not-installed disables the tab (user decision 2026-08-17).
   */
  private readonly activityReadiness = inject(ActivityReadinessService);
  /**
   * Demo-exempt: the static snapshot honestly reports "nothing
   * installed" (it has no filesystem), but its canned sessions are the
   * whole point of the demo tour, so the gate only applies live.
   */
  private readonly mode = inject(SKILL_MAP_MODE);
  /** Embedded boot (`?embed=1`): the map alone, the rail never mounts. */
  protected readonly embed = inject(SKILL_MAP_EMBED, { optional: true }) !== null;
  protected readonly sessionsDisabled = computed(
    () => this.mode !== 'demo' && this.activityReadiness.hookInstalled() === false,
  );

  /** Guards so the corpus-size auto-default applies at most once and never
   *  fights a manual toggle. */
  private autoRailApplied = false;
  private userToggledRail = false;

  /**
   * True for a beat around a collapse/expand toggle. Gates the width
   * transition so it animates ONLY on toggle, never during a drag resize
   * (where a permanent `transition: width` would lag every frame, the
   * same trap the inspector dodges by animating `transform`, not width).
   */
  protected readonly railAnimating = signal(false);
  private railAnimTimer: ReturnType<typeof setTimeout> | null = null;

  /** Compact search, shared with the table and the map via the store. */
  protected readonly searchText = this.store.searchText;

  /**
   * Search → map coupling preference (persisted by the store). Drives
   * the toggle button next to the search input: OFF (default) keeps
   * the map intact while the rail narrows; ON restores the legacy
   * filter-everything behavior.
   */
  protected readonly searchAffectsMap = this.store.searchAffectsMap;

  /**
   * "Files follows selection" preference (persisted by its own service).
   * Drives the toggle button next to the search → map toggle: OFF (default)
   * leaves the rail untouched when a node is selected on the map; ON reveals
   * the selected node in the tree (highlight + auto-expand + scroll).
   */
  protected readonly filesFollow = this.followSelection.enabled;

  /** The mounted map, reached so the rail's isolate gesture (routed
   *  here via `MAP_ISOLATE_INTENT`) forwards to it. */
  private readonly graphView = viewChild(GraphView);

  /** `IMapIsolateIntent`: forward the rail's isolate gesture to the map. */
  isolate(path: string): void {
    this.graphView()?.isolateNeighborhood(path);
  }

  /** `ISessionReplayIntent`: forward the sessions rail's Play to the map. */
  replaySession(selection: ISessionReplaySelection, label: string, step?: ISessionStep): void {
    this.graphView()?.replaySessionFromTape(selection, label, step);
  }

  /** `ISessionRecordIntent`: forward the rail's record control to the map. */
  startRecording(): void {
    this.graphView()?.startSessionRecording();
  }

  stopRecording(): void {
    this.graphView()?.stopSessionRecording();
  }

  // Rail sits on the LEFT edge (handle on its right), so dragging
  // right grows it; the clamp reserves map width on the other side.
  private readonly resize = setupEdgeResize({
    destroyRef: this.destroyRef,
    edge: 'left',
    defaultWidth: RAIL_WIDTH_DEFAULT,
    minWidth: RAIL_WIDTH_MIN,
    viewportReserve: RAIL_VIEWPORT_RESERVE,
    initialWidth: readStoredRailWidth() ?? RAIL_WIDTH_DEFAULT,
    onCommit: (width) => writeStoredRailWidth(width),
  });
  protected readonly clampedRailWidth = this.resize.clampedWidth;
  protected readonly onRailResizeStart = this.resize.onResizeStart;
  // Keyboard resize surface for the rail separator (WCAG 2.1.1). The
  // template binds these to `aria-valuenow`/min/max + the arrow handlers.
  protected readonly railWidth = this.resize.clampedWidth;
  protected readonly railResizeMin = this.resize.minWidth;
  protected readonly railResizeMax = this.resize.maxWidth;
  protected onRailResizeKey(direction: 'wider' | 'narrower'): void {
    this.resize.stepBy(direction === 'wider' ? RAIL_RESIZE_STEP : -RAIL_RESIZE_STEP);
  }

  constructor() {
    // The toggle animation timer outlives its 220ms window only when the
    // view unmounts mid-animation; clear it so the deferred signal write
    // never fires against a destroyed component.
    this.destroyRef.onDestroy(() => {
      if (this.railAnimTimer !== null) clearTimeout(this.railAnimTimer);
    });

    // Auto-open the rail when the corpus has more nodes than the map can
    // render (corpusCount > maxRenderNodes, default 256): the map shows a
    // focused subset, so the folders tree must be visible to navigate it.
    // Applies only when there is no saved rail preference and the user has
    // not toggled, fires once, and never re-collapses. A manual toggle
    // (which persists) wins from then on.
    effect(() => {
      // Guards (plain fields, not signals) BEFORE the first signal read, so
      // a saved preference / prior decision skips reading the corpus and the
      // effect simply never subscribes (no re-run, no dependency).
      if (this.autoRailApplied || this.userToggledRail || this.storedRailPref !== null) return;
      const count = this.loader.corpusCount();
      if (count === 0) return;
      this.autoRailApplied = true;
      const cap = this.loader.scanMeta()?.maxRenderNodes ?? 256;
      if (count > cap) this.railCollapsed.set(false);
    });

    // Entering the lens while the queue is open would strand the rail on
    // a panel that just went unavailable, so the rail falls back to
    // files. Leaving the lens does NOT restore the queue: the operator
    // is looking at files by then, and yanking the panel back would be
    // the more surprising move.
    effect(() => {
      if (this.queueDisabled() && untracked(() => this.activeSection()) === 'queue') {
        this.setActiveSection('files');
      }
    });

    // Same fallback for Sessions: an uninstall (Settings hook row
    // refreshes the shared readiness signal, a CLI uninstall lands on
    // the next scan tick) must not strand the rail on a panel whose
    // feature just went unavailable.
    effect(() => {
      if (this.sessionsDisabled() && untracked(() => this.activeSection()) === 'sessions') {
        this.setActiveSection('files');
      }
    });
  }

  /**
   * Activity gesture: select `section` and (if the rail is collapsed)
   * open it, firing the width animation. Bound by BOTH the collapsed
   * icon-bar buttons and the open tab strip: clicking an already-open
   * tab just switches the panel (the collapse branch is skipped), while
   * a collapsed icon opens the rail onto that section.
   */
  protected openSection(section: TWorkspaceSection): void {
    // The queue is unavailable while the Live lens owns the workspace
    // (see `queueDisabled`). Guarded HERE rather than at each call site:
    // the tab click, the collapsed activity-bar button and the roving
    // arrow keys all route through this one verb.
    if (section === 'queue' && this.queueDisabled()) return;
    if (section === 'sessions') {
      if (this.sessionsDisabled()) return;
      // Cheap staleness guard: a CLI uninstall between scans would
      // otherwise open a dead panel; if the probe answers not-installed
      // the fallback effect above bounces to files.
      void this.activityReadiness.refresh();
    }
    this.userToggledRail = true;
    // Usage analytics (opt-in, default OFF): only a gesture that actually
    // opens the rail or switches the panel counts; re-clicking the already
    // open tab is a no-op and the corpus-size auto-open never routes here.
    // See spec/telemetry.md §Usage event taxonomy.
    if (this.railCollapsed() || this.activeSection() !== section) {
      this.usageTracker.trackFeature(section);
    }
    this.setActiveSection(section);
    if (this.railCollapsed()) {
      this.railCollapsed.set(false);
      writeStoredRailCollapsed(false);
      this.animateRail();
    }
  }

  /**
   * APG tabs keyboard navigation for the open rail's tab strip (WCAG 2.1.1).
   *
   * The strip carries a roving tabindex (only the selected tab is in the
   * tab sequence), which the pattern permits ONLY when the arrow keys move
   * focus between tabs. Without this handler the inactive section could be
   * reached solely by collapsing the rail with the chevron and hitting the
   * activity-bar buttons, a route nothing announces.
   *
   * Selection FOLLOWS focus (automatic activation), same call as the Quick
   * Start rail: the roving tabindex is keyed off `activeSection()`, so
   * focus and selection must not diverge. Routed through `openSection` so
   * an arrow is exactly the gesture a click is (same persistence, same
   * `userToggledRail` bookkeeping); the collapse branch inside it is inert
   * here because this strip only renders while the rail is open.
   *
   * The strip is horizontal, so ONLY Left / Right are bound (the vertical
   * Quick Start rail binds Up / Down instead); Home / End jump to the ends
   * and both directions wrap. Keep the two strips in step.
   */
  protected onSectionKeydown(event: KeyboardEvent): void {
    handleRovingTablistKeydown(event, {
      orientation: 'horizontal',
      selectedIndex: () => WORKSPACE_TAB_ORDER.indexOf(this.activeSection()),
      select: (index) => {
        const section = WORKSPACE_TAB_ORDER[index];
        if (section !== undefined) this.openSection(section);
      },
    });
  }

  /** Chevron gesture (open state only): collapse the rail to the icon bar. */
  protected collapse(): void {
    this.userToggledRail = true;
    this.railCollapsed.set(true);
    writeStoredRailCollapsed(true);
    this.animateRail();
  }

  /** Persist + set the active section (no-op when unchanged). */
  private setActiveSection(section: TWorkspaceSection): void {
    if (this.activeSection() === section) return;
    this.activeSection.set(section);
    writeStoredActiveSection(section);
  }

  /** Open the 220ms width-transition window (see `railAnimating`). */
  private animateRail(): void {
    this.railAnimating.set(true);
    if (this.railAnimTimer !== null) clearTimeout(this.railAnimTimer);
    this.railAnimTimer = setTimeout(() => this.railAnimating.set(false), 220);
  }

  protected onSearchChange(value: string): void {
    this.store.setSearchText(value);
  }

  /** Clear just the text search (the in-input clear button); leaves the
   *  other facet filters and the map selection untouched, unlike the
   *  full `resetView`. */
  protected clearSearch(): void {
    this.store.setSearchText('');
  }

  protected onToggleSearchMap(): void {
    this.usageTracker.trackFeature('files-search-map');
    this.store.toggleSearchAffectsMap();
  }

  protected onToggleFilesFollow(): void {
    this.usageTracker.trackFeature('files-follow-selection');
    this.followSelection.toggle();
  }

  /**
   * Reset the workspace to its default overview: clear the map folder
   * selection (show every node again, the rail strip's eraser without
   * the view-exit ceremony) AND reset every facet filter (search, kind,
   * severity, favorites). Same pair of actions the rail's eraser + the
   * empty-state "Reset filters" expose, surfaced as one control at the
   * top of the rail.
   */
  protected resetView(): void {
    this.mapVisibility.clear();
    this.store.reset();
  }

  // Rail width / collapse persistence lives in `./workspace-view.storage`
  // (the shared `*.storage.ts` convention: guarded reads, quota-safe
  // writes, keys owned by the storage module).
}
