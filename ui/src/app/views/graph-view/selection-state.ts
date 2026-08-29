/**
 * Selection-driven node + edge predicates for the graph view. Owns the
 * adjacency map (derived from the visible graph's edges) and the
 * `is*` helpers the template binds to drive highlight / dim CSS
 * classes after a click. Tag-selection suspension is read off the
 * caller's signal so the multi-select halo wins over per-node dim.
 *
 * Extracted from `graph-view.ts` so the view component focuses on
 * graph rendering + node-drag concerns. Mirrors the
 * `inspector-body-state` helper pattern: a `createX` factory returns
 * a small handle the component captures in its constructor.
 */

import { computed, type Signal } from '@angular/core';

import type { IEdgeSelectionView, ISelectionView } from '../../../models/selection';
import type { IGraphData, IGraphEdge } from './graph-layout';

/**
 * Edge opacity tunables. `DIMMED` paints the near ring (an endpoint two
 * hops from the focus) and `FAR` everything beyond it; active edges run
 * a confidence-weighted gradient `MIN + RANGE * confidence` so
 * high-confidence links read solid and low-confidence ones recede.
 * `CONFIDENCE_DEFAULT` fills in when an edge's `confidence` is missing
 * from the projection. The mapping is intentionally linear: a
 * non-linear curve would amplify any clustering of extractor emissions
 * in the middle of the range.
 */
const EDGE_OPACITY_DIMMED = 0.3;
const EDGE_OPACITY_FAR = 0.12;
const EDGE_OPACITY_MIN = 0.25;
const EDGE_OPACITY_RANGE = 0.75;
const EDGE_CONFIDENCE_DEFAULT = 0.6;

export interface ISelectionStateConfig {
  readonly graph: Signal<IGraphData>;
  readonly selectedNodeId: Signal<string | null>;
  /**
   * Truthy while a tag chip is active. The shape is `string | null`
   * today (see `tag-selection.controller.ts`); typed as `unknown`
   * here so the helper stays decoupled from the controller's return
   * shape.
   */
  readonly activeTagSelection: Signal<unknown>;
  /**
   * Activity focus origins: the executing node paths while the
   * follow-the-activity focus applies (curated map, Real Time on,
   * follow armed), EMPTY otherwise. Read only when no node is
   * selected: a selection is the operator's own focus and wins.
   */
  readonly activityFocus?: Signal<ReadonlySet<string>>;
}

/** Hop distance at which a node (or edge endpoint) leaves the focus ring: `far`. */
export const FOCUS_FAR_DEPTH = 3;

const EMPTY_ORIGINS: ReadonlySet<string> = new Set();
const EMPTY_DEPTHS: ReadonlyMap<string, number> = new Map();

/**
 * Multi-source BFS over the undirected adjacency: hop distance from the
 * nearest origin, capped at `maxDepth` (nodes farther than that, or
 * unreachable, are absent and read as `far`). Pure, exported for tests.
 */
export function computeFocusDepths(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  origins: ReadonlySet<string>,
  maxDepth: number = FOCUS_FAR_DEPTH,
): ReadonlyMap<string, number> {
  const depths = new Map<string, number>();
  let frontier: string[] = [];
  for (const origin of origins) {
    depths.set(origin, 0);
    frontier.push(origin);
  }
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbour of adjacency.get(id) ?? []) {
        if (depths.has(neighbour)) continue;
        depths.set(neighbour, depth);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return depths;
}

// `ISelectionView` / `IEdgeSelectionView` live in `models/selection.ts`:
// `<sm-node-card>` (a shared component also mounted outside the graph)
// binds the node bundle, and shared components must not import from a
// feature view's internals.

export interface ISelectionStateHandle {
  isSelected(id: string): boolean;
  isHighlighted(id: string): boolean;
  isDimmed(id: string): boolean;
  /** Beyond the near ring: deeper fade plus desaturation. */
  isFar(id: string): boolean;
  isEdgeHighlighted(edge: IGraphEdge): boolean;
  isEdgeDimmed(edge: IGraphEdge): boolean;
  /**
   * Pre-computed selection state for every visible node. The map is
   * rebuilt when `graph` / `selectedNodeId` / `activeTagSelection`
   * change; otherwise template reads are O(1). Bound on `<sm-node-card>`
   * via the single `[selection]` input.
   */
  readonly selectionView: Signal<ReadonlyMap<string, ISelectionView>>;
  /**
   * Pre-computed selection state for every visible edge, keyed by
   * `edge.id`. Rebuilt on the same triggers as `selectionView`; template
   * reads are O(1). Bound on each `<f-connection>` through a single
   * `@let` so highlight / dim / opacity cost one lookup per edge, not
   * three function calls per CD pass.
   */
  readonly edgeSelectionView: Signal<ReadonlyMap<string, IEdgeSelectionView>>;
}

export function createSelectionState(
  config: ISelectionStateConfig,
): ISelectionStateHandle {
  /**
   * Adjacency map (undirected): node id → set of node ids it shares an edge with.
   * Used by `is*` helpers to drive highlight / dim classes after a click.
   */
  const adjacency = computed<Map<string, Set<string>>>(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of config.graph().edges) {
      if (!map.has(edge.from)) map.set(edge.from, new Set());
      if (!map.has(edge.to)) map.set(edge.to, new Set());
      map.get(edge.from)!.add(edge.to);
      map.get(edge.to)!.add(edge.from);
    }
    return map;
  });

  const isSelected = (id: string): boolean => config.selectedNodeId() === id;

  /**
   * Focus origins: the selected node when there is one (the operator's
   * own focus always wins), else the activity focus (executing nodes
   * while the follow focus applies), else nothing.
   */
  const focusOrigins = computed<ReadonlySet<string>>(() => {
    const sel = config.selectedNodeId();
    if (sel !== null) return new Set([sel]);
    return config.activityFocus?.() ?? EMPTY_ORIGINS;
  });

  /** Hop distance from the nearest origin, absent = beyond the ring. */
  const focusDepths = computed<ReadonlyMap<string, number>>(() => {
    const origins = focusOrigins();
    return origins.size === 0 ? EMPTY_DEPTHS : computeFocusDepths(adjacency(), origins);
  });

  /**
   * Adjacency-driven dim, graded by hop distance from the focus so the
   * map falls off like depth of field: hop 2 is the near ring
   * (`dimmed`), hop 3 and beyond or unreachable is `far` (deeper fade
   * plus desaturation). Suspended while a tag selection is active: the
   * multi-select halo (Foblex `.f-selected`) is the dominant visual
   * then, and stacking a fade on top of matching nodes made them read
   * "selected but ghosted".
   */
  const focusActive = (): boolean =>
    config.activeTagSelection() === null && focusOrigins().size > 0;

  const isHighlighted = (id: string): boolean =>
    config.selectedNodeId() !== null && focusDepths().get(id) === 1;

  const isDimmed = (id: string): boolean => {
    if (!focusActive()) return false;
    const depth = focusDepths().get(id);
    return depth === undefined || depth >= 2;
  };

  const isFar = (id: string): boolean => {
    if (!focusActive()) return false;
    const depth = focusDepths().get(id);
    return depth === undefined || depth >= FOCUS_FAR_DEPTH;
  };

  const isEdgeHighlighted = (edge: IGraphEdge): boolean => {
    const sel = config.selectedNodeId();
    return sel !== null && (edge.from === sel || edge.to === sel);
  };

  /**
   * Edge grading follows the FARTHER endpoint: an edge leading into the
   * near ring dims with it, one leading beyond it goes `far`. Edges
   * inside the focus ring (both endpoints within one hop) stay at
   * their confidence opacity, so the neighbourhood reads as one lit
   * cluster. Same tag-selection suspension as the nodes.
   */
  const edgeDepth = (edge: IGraphEdge): number => {
    const depths = focusDepths();
    const from = depths.get(edge.from) ?? Number.POSITIVE_INFINITY;
    const to = depths.get(edge.to) ?? Number.POSITIVE_INFINITY;
    return Math.max(from, to);
  };

  const isEdgeDimmed = (edge: IGraphEdge): boolean =>
    focusActive() && !isEdgeHighlighted(edge) && edgeDepth(edge) >= 2;

  const selectionView = computed<ReadonlyMap<string, ISelectionView>>(() => {
    const sel = config.selectedNodeId();
    const active = focusActive();
    const depths = focusDepths();
    const out = new Map<string, ISelectionView>();
    for (const node of config.graph().nodes) {
      const id = node.id;
      const depth = depths.get(id);
      const isSel = sel === id;
      const isHigh = sel !== null && depth === 1;
      const isDim = active && (depth === undefined || depth >= 2);
      const far = isDim && (depth === undefined || depth >= FOCUS_FAR_DEPTH);
      out.set(id, { selected: isSel, highlighted: isHigh, dimmed: isDim, far });
    }
    return out;
  });

  const edgeSelectionView = computed<ReadonlyMap<string, IEdgeSelectionView>>(() => {
    const sel = config.selectedNodeId();
    const active = focusActive();
    const out = new Map<string, IEdgeSelectionView>();
    for (const edge of config.graph().edges) {
      const touchesSel = sel !== null && (edge.from === sel || edge.to === sel);
      const depth = active && !touchesSel ? edgeDepth(edge) : 0;
      const dimmed = depth >= 2;
      const far = depth >= FOCUS_FAR_DEPTH;
      const confidence =
        typeof edge.confidence === 'number' ? edge.confidence : EDGE_CONFIDENCE_DEFAULT;
      const opacity = far
        ? EDGE_OPACITY_FAR
        : dimmed
          ? EDGE_OPACITY_DIMMED
          : EDGE_OPACITY_MIN + EDGE_OPACITY_RANGE * confidence;
      out.set(edge.id, { highlighted: touchesSel, dimmed, far, opacity });
    }
    return out;
  });

  return {
    isSelected,
    isHighlighted,
    isDimmed,
    isFar,
    isEdgeHighlighted,
    isEdgeDimmed,
    selectionView,
    edgeSelectionView,
  };
}
