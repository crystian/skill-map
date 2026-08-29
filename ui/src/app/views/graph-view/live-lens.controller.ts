/**
 * Live-lens controller: the graph-view side of the "Live lens" mode.
 * `LiveLensService` owns WHAT is live (the watermark membership + the
 * curation-independent node cache); this controller owns HOW the graph
 * shows it: a parallel, fully ephemeral render pipeline, a seeded
 * force layout, a lens-scoped follow camera, and the enter / exit
 * transitions.
 *
 * LAYERED BESIDE the main pipeline ON PURPOSE (the spawn-overlay
 * contract): nothing here ever reaches the main `fullLayout`, the
 * reconcile effect, `sm.graph.node-positions`, map views, or the
 * curated map's fit bbox. The lens pipeline gets:
 *
 *   - `nodes` / `scan` from the lens service (live membership only,
 *     corpus-wide, curation ignored);
 *   - a pass-through filter stub: facets, search, and link-kind
 *     whitelists deliberately do NOT apply, the lens answers "what is
 *     executing", not "what matches my filters";
 *   - a permanently-empty `nodePositions` signal, so nothing the lens
 *     does can produce a manual pin or a storage write;
 *   - `force` layout with an incremental seed: survivors keep their
 *     position, newcomers place near their neighbours, so membership
 *     churn reads as growth instead of reshuffles.
 *
 * The host component decides per signal whether the template reads the
 * lens pipeline or the main one (display switchers); the main pipeline
 * keeps computing underneath so exit restores the curated map exactly
 * as it was, BY CONSTRUCTION. The camera transition is the only stated
 * exception: enter snapshots the viewport + the main paths
 * fingerprint, exit restores the snapshot only while the fingerprint
 * still matches (a scan that changed the corpus mid-lens lets the
 * standard fit win via `fitMainView`).
 */

import { computed, effect, signal, untracked, type Signal } from '@angular/core';

import type { TLinkKindApi } from '../../../models/api';
import type { INodeView } from '../../../models/node';
import type { IIssuePathsBySeverity } from '../../../services/issue-paths';
import type { LiveLensService } from '../../../services/live-lens';
import type { IPlaybackState } from '../../../services/activity-playback-state';
import type { LivePreferencesService } from '../../../services/live-preferences';
import type { NodeActivityService } from '../../../services/node-activity';
import {
  setupFollowActivity,
  type IFollowActivityHandle,
  type IFollowSession,
} from './follow-activity.controller';
import {
  computeForceLayoutPositions,
  topologyFingerprint,
  type IPoint,
  type TNodePositions,
} from './graph-layout';
import { setupGraphPipeline, type IGraphPipelineHandle } from './graph-pipeline';
import { computeFitTransform, type IViewportTransform } from './viewport-animation';
import { resolveDirectorTargets } from './director';

export interface ILiveLensControllerConfig {
  lens: LiveLensService;
  nodeActivity: NodeActivityService;
  livePrefs: LivePreferencesService;
  /**
   * Replay transport slice the director camera reads: `active`, the
   * cursor / total pair (end-of-tape pull-back) and the fold (cursor
   * caption). Structural so the spec stubs it without the service.
   */
  playback: {
    active: Signal<boolean>;
    cursor: Signal<number>;
    total: Signal<number>;
    state: Signal<IPlaybackState>;
  };
  /** `LivePreferencesService.directorEnabled`, the replay camera taste. */
  directorEnabled: Signal<boolean>;
  /** Real severity index; the lens filter stub never reads it, passed only to satisfy the pipeline config. */
  issuesBySeverity: Signal<IIssuePathsBySeverity>;
  /** MAIN pipeline fingerprint, frozen while the lens is on (see `layoutFitFingerprint`). */
  mainPathsFingerprint: Signal<string>;
  /** Viewport signals, read for the enter snapshot (never written here). */
  viewportPosition: Signal<IPoint>;
  viewportScale: Signal<number>;
  /** Live session capsules (lens-projected while the lens is on). */
  sessions: () => readonly IFollowSession[];
  /** Canvas wrap element, `null` while unmounted (soft bail). */
  hostElement: () => HTMLElement | null;
  /** Width the open inspector panel reserves over the canvas. */
  panelWidth: () => number;
  /** Boot-fit flag (MUST be signal-backed, same contract as follow). */
  bootFitDone: () => boolean;
  zoomMin: number;
  /** Host's single animated-camera entry point (shared supersession). */
  animateToTransform: (transform: IViewportTransform) => void;
  /**
   * Animated fit over the MAIN visible set; the exit fallback when the
   * corpus changed mid-lens and the snapshot no longer frames reality.
   */
  fitMainView: () => void;
  /** Host's `view-switching` fade trigger (PRM-gated in CSS). */
  beginViewSwitch: () => void;
}

export interface ILiveLensHandle {
  /** Re-export of `LiveLensService.active` for the display switchers. */
  readonly active: Signal<boolean>;
  /** The parallel, ephemeral lens pipeline. */
  readonly pipeline: IGraphPipelineHandle;
  /** Lens-scoped follow camera (session-local arming, never the global pref). */
  readonly follow: IFollowActivityHandle;
  /**
   * What `setupLayoutFit` should see as the paths fingerprint: frozen
   * at its enter value while the lens is on, so lens membership churn
   * (and the enter/exit swap itself) never fires the curated map's
   * auto-fit.
   */
  readonly layoutFitFingerprint: Signal<string>;
  /** Toolbar toggle: enter (snapshot + arm) or exit (restore via the effect). */
  toggle(): void;
  /** Animated fit over the lens set (the toolbar fit button while on). */
  fitToLens(): void;
  /** Effective lens position (force output only, no pin layer). */
  positionOf(path: string): IPoint | undefined;
}

/** Viewport + main-fingerprint snapshot captured on enter. */
interface ILensSnapshot {
  position: IPoint;
  scale: number;
  fingerprint: string;
}

/**
 * Wire the lens. Must be called where `effect()` can be created (a
 * field initializer or constructor of the host component).
 */
export function setupLiveLens(config: ILiveLensControllerConfig): ILiveLensHandle {
  const { lens } = config;

  // Pass-through filter stub (see module doc). Structural `Pick` of
  // FilterStoreService: `apply` ignores every argument beyond `nodes`.
  const noLinkKinds = signal<TLinkKindApi[]>([]);
  const off = signal(false);
  const filterStub = {
    apply: (nodes: INodeView[]): INodeView[] => nodes,
    searchAffectsMap: off.asReadonly(),
    selectedLinkKinds: noLinkKinds.asReadonly(),
    linkKindToggleExplicitEmpty: off.asReadonly(),
  };

  // Permanently-empty pin layer: the whole point of the lens is that
  // no position it shows can ever become persisted state.
  const lensPositions = signal<TNodePositions>(new Map());

  const lensAlgorithm = computed(() => 'force' as const);
  const lensDirection = computed(() => 'LEFT_RIGHT' as const);

  const pipeline = setupGraphPipeline({
    nodes: lens.lensNodes,
    scan: lens.lensScan,
    filters: filterStub,
    issuesBySeverity: config.issuesBySeverity,
    nodePositions: lensPositions,
    layoutAlgorithm: lensAlgorithm,
    layoutDirection: lensDirection,
  });

  /**
   * Seeded force layout, keyed on the lens topology fingerprint (same
   * skip-if-unchanged discipline as the main dagre effect). Synchronous
   * by design: `computeForceLayoutPositions` is a one-shot simulation,
   * and the seed carry-over is what keeps survivors still while
   * newcomers settle. The seed intentionally survives an exit/enter
   * cycle, so re-entering shortly after keeps the previous arrangement.
   */
  let lastLayoutKey = '';
  let layoutSeed: ReadonlyMap<string, IPoint> = new Map();
  effect(() => {
    if (!lens.active()) return;
    const nodes = lens.lensNodes();
    const topology = pipeline.topology();
    if (nodes.length === 0) return;
    const key = topologyFingerprint(nodes, topology.edges);
    if (key === lastLayoutKey) return;
    lastLayoutKey = key;
    const positions = untracked(() =>
      computeForceLayoutPositions(nodes, topology.edges, layoutSeed),
    );
    layoutSeed = positions;
    untracked(() => {
      pipeline.layoutPositions.set(positions);
      pipeline.layoutComputedAtSignal.set(performance.now());
    });
  });

  const positionOf = (path: string): IPoint | undefined =>
    pipeline.fullLayout().positions.get(path);

  /**
   * Session-local camera arming: re-armed on every enter, never
   * persisted, so a gesture-disarm during the lens cannot clobber the
   * user's global Follow the Activity preference.
   */
  const lensFollowArmed = signal(true);
  const follow = setupFollowActivity({
    livePrefs: config.livePrefs,
    nodeActivity: config.nodeActivity,
    // The camera frames the WHOLE lens set (executing + lingering),
    // except under the replay's director camera, which frames the node
    // the cursor frame is about (close-ups gliding from caller to
    // callee, overview before the first frame and at the end of the
    // tape); see `director.ts`.
    targetPaths: computed(() =>
      resolveDirectorTargets({
        replayOn: config.playback.active(),
        director: config.directorEnabled(),
        atEnd: config.playback.cursor() >= config.playback.total() - 1,
        caption: config.playback.state().caption,
        membership: lens.membership(),
      }),
    ),
    followState: {
      enabled: lensFollowArmed.asReadonly(),
      setEnabled: (value) => lensFollowArmed.set(value),
    },
    visiblePaths: pipeline.mapVisiblePaths,
    sessions: config.sessions,
    layoutComputedAt: pipeline.layoutComputedAt,
    bootFitDone: config.bootFitDone,
    hostElement: config.hostElement,
    positionOf,
    panelWidth: config.panelWidth,
    zoomMin: config.zoomMin,
    animateToTransform: config.animateToTransform,
  });

  const frozenFingerprint = signal('');
  const layoutFitFingerprint = computed(() =>
    lens.active() ? frozenFingerprint() : config.mainPathsFingerprint(),
  );

  let snapshot: ILensSnapshot | null = null;

  const toggle = (): void => {
    if (lens.active()) {
      // Exit path: the transition effect below runs the restore, so a
      // forced exit (Real Time off) and this toggle share one path.
      lens.setActive(false);
      return;
    }
    // Enter: capture BEFORE flipping so the frozen fingerprint and the
    // snapshot are consistent by the time any effect re-evaluates.
    snapshot = {
      position: config.viewportPosition(),
      scale: config.viewportScale(),
      fingerprint: config.mainPathsFingerprint(),
    };
    frozenFingerprint.set(snapshot.fingerprint);
    lensFollowArmed.set(true);
    config.beginViewSwitch();
    lens.setActive(true);
  };

  /**
   * Exit transition (single path: user toggle AND the service's forced
   * exit on Real Time off). Restores the enter viewport only while the
   * main paths fingerprint still matches the snapshot; a corpus change
   * mid-lens means the saved frame no longer shows reality, so the
   * standard animated fit over the main set wins instead.
   */
  let prevActive = untracked(() => lens.active());
  effect(() => {
    const active = lens.active();
    if (active === prevActive) return;
    prevActive = active;
    if (active) return; // enter work happens in `toggle()`
    untracked(() => {
      config.beginViewSwitch();
      const snap = snapshot;
      snapshot = null;
      if (snap && config.mainPathsFingerprint() === snap.fingerprint) {
        config.animateToTransform({ position: snap.position, scale: snap.scale });
      } else {
        config.fitMainView();
      }
    });
  });

  /**
   * Animated fit over the lens set + session capsules; the toolbar fit
   * button routes here while the lens is on (the camera controller's
   * fit reads main-pipeline geometry and must stay main-bound).
   */
  const fitToLens = (): void => {
    const host = config.hostElement();
    if (!host) return;
    const positions = pipeline.fullLayout().positions;
    const points: IPoint[] = [];
    for (const path of pipeline.mapVisiblePaths()) {
      const pt = positions.get(path);
      if (pt) points.push({ x: pt.x, y: pt.y });
    }
    for (const session of config.sessions()) {
      points.push({ x: session.position.x, y: session.position.y });
    }
    if (points.length === 0) return;
    const transform = computeFitTransform({
      points,
      wrap: { width: host.clientWidth, height: host.clientHeight },
      panelW: config.panelWidth(),
      zoomMin: config.zoomMin,
    });
    if (transform) config.animateToTransform(transform);
  };

  return {
    active: lens.active,
    pipeline,
    follow,
    layoutFitFingerprint,
    toggle,
    fitToLens,
    positionOf,
  };
}
