/**
 * Pure layout / projection helpers for the graph view. Extracted from
 * `graph-view.ts` so the heavy d3-force code, the topology cache, and the
 * filter-time projection are testable in isolation without spinning up
 * Angular / Foblex / PrimeNG.
 *
 * Two responsibilities:
 *
 *   1. **`createLayoutComputer()`** — factory that returns a stateful
 *      computer with a per-instance cache. The cache key is a topology
 *      fingerprint (sorted paths + sorted edge ids). When a WebSocket
 *      `scan.completed` event drives a fresh `loader.nodes()` array, the
 *      computer reuses cached positions when topology is unchanged
 *      (the common case: edited frontmatter / body of an existing node)
 *      and only re-runs d3-force when nodes or edges enter / leave the
 *      graph. Without this, every WS event re-runs 400 d3-force ticks
 *      and produces visibly different positions for unmoved nodes — the
 *      "graph resets on update" bug.
 *
 *   2. **`projectVisible()`** — pure filter-time projection from the
 *      cached full layout to the visible subset, layering manual drag
 *      overrides on top of cached force-layout positions.
 */

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from 'd3-force';

import type {
  IReportSafety,
  INodeStats,
  INodeView,
  ISummaryNote,
  TNodeKind,
  TSummary,
} from '../../../models/node';
import type { ILinkApi, INodeApi, IScanResultApi, TLinkKindApi } from '../../../models/api';

/**
 * Layout footprint for `<sm-node-card>` in its collapsed state. Fed into
 * d3-force's collision radius so cards don't overlap. Height is generous
 * because the card grows when the user expands the panel — keeping the
 * collapsed footprint a bit taller avoids re-layout jitter for the
 * common-case mid-expand. Update if the card's collapsed dimensions
 * change in `node-card.css` (`:host { width: ... }` and the main row).
 */
export const NODE_WIDTH = 260;
export const NODE_HEIGHT = 120;

export interface IPoint {
  x: number;
  y: number;
}

export type TNodePositions = Record<string, IPoint>;

export type TEdgeKind = TLinkKindApi;

export interface IGraphNode {
  id: string;
  path: string;
  /** Full parsed node — passed to <sm-node-card>. */
  view: INodeView;
  kind: TNodeKind;
  position: IPoint;
  /** Footer / subtitle stats. Computed during layout projection. */
  stats: INodeStats;
  /**
   * Deterministic mock summary so the LLM cluster on the card renders
   * during the in-browser prototype phase. Replaced by kernel-emitted
   * `TSummary` once `sm summarize` lands.
   */
  summary: TSummary;
}

export interface IGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: TEdgeKind;
}

export interface IGraphData {
  nodes: IGraphNode[];
  edges: IGraphEdge[];
}

export interface IFullLayout {
  /** Node views indexed by path — handy to project without re-iterating. */
  nodesByPath: Map<string, INodeView>;
  /** BFF-shaped node rows by path — used to read persisted byte/token counts. */
  apiNodesByPath: Map<string, INodeApi>;
  /** Deduped, valid edges (both endpoints present in the loaded set). */
  edges: IGraphEdge[];
  /** d3-force-computed top-left positions for every loaded node. */
  positions: Map<string, IPoint>;
  /** `performance.now()` timestamp when this layout was computed. */
  computedAt: number;
}

interface ILayoutCacheEntry {
  fingerprint: string;
  positions: Map<string, IPoint>;
  edges: IGraphEdge[];
  computedAt: number;
}

/**
 * Compute a topology fingerprint from the resolved (filtered + deduped)
 * edge set and the full path list. Two inputs that produce the same
 * fingerprint are guaranteed to produce the same d3-force layout — kind /
 * frontmatter / title / hash changes do NOT participate, so editing a
 * node's content leaves the fingerprint untouched and the cached
 * positions get reused.
 *
 * Exported for tests; not consumed elsewhere.
 */
export function topologyFingerprint(allNodes: INodeView[], edges: IGraphEdge[]): string {
  const paths = allNodes.map((n) => n.path).sort();
  const edgeIds = edges.map((e) => e.id).sort();
  return `${paths.length}|${paths.join(',')}|${edgeIds.length}|${edgeIds.join(',')}`;
}

/**
 * Factory for the layout computer. Returns a function that:
 *   - Builds the resolved edge set (filter to valid endpoints, dedupe).
 *   - Compares the resulting topology fingerprint against the per-instance
 *     cache. On hit, reuses cached positions and edges; only `nodesByPath`
 *     / `apiNodesByPath` are rebuilt because their VALUES (not keys) may
 *     have changed (e.g. updated frontmatter from a WS-driven refresh).
 *   - On miss (initial call or topology change), runs the full d3-force
 *     simulation, caches the result, and returns it.
 *
 * Cache lives in the closure (one per `GraphView` instance) so tests and
 * hot-reload start clean without a manual reset hook.
 *
 * Edges come straight from the persisted `ScanResult.links` (kernel
 * extractor output). Until the BFF starts emitting links, `scan` may be
 * `null` — in that case the graph renders nodes only.
 */
export function createLayoutComputer(): (
  allNodes: INodeView[],
  scan: IScanResultApi | null,
) => IFullLayout {
  let cache: ILayoutCacheEntry | null = null;

  return (allNodes, scan) => {
    const validPaths = new Set(allNodes.map((n) => n.path));
    const byId = new Map<string, IGraphEdge>();
    const links: ILinkApi[] = scan?.links ?? [];
    for (const link of links) {
      if (!validPaths.has(link.source) || !validPaths.has(link.target)) continue;
      if (link.source === link.target) continue;
      const id = edgeId(link.kind, link.source, link.target);
      if (!byId.has(id)) {
        byId.set(id, { id, from: link.source, to: link.target, kind: link.kind });
      }
    }
    const uniqueEdges = [...byId.values()];

    // Always rebuild the data maps — view payloads (frontmatter, title,
    // body hash) may have changed even when topology has not.
    const nodesByPath = new Map<string, INodeView>();
    for (const n of allNodes) nodesByPath.set(n.path, n);
    const apiNodesByPath = new Map<string, INodeApi>();
    for (const n of scan?.nodes ?? []) apiNodesByPath.set(n.path, n);

    const fingerprint = topologyFingerprint(allNodes, uniqueEdges);
    if (cache && cache.fingerprint === fingerprint) {
      // Topology unchanged — reuse positions + edges. `computedAt`
      // intentionally preserves the original timestamp so the perf HUD
      // reflects the last *actual* layout, not the last cache hit.
      return {
        nodesByPath,
        apiNodesByPath,
        edges: cache.edges,
        positions: cache.positions,
        computedAt: cache.computedAt,
      };
    }

    const positions = computeForceLayoutPositions(allNodes, uniqueEdges);
    const computedAt = performance.now();
    cache = { fingerprint, positions, edges: uniqueEdges, computedAt };

    return { nodesByPath, apiNodesByPath, edges: uniqueEdges, positions, computedAt };
  };
}

/**
 * Run the d3-force simulation over the full node + edge set and return
 * a `path → topLeftPoint` map. Pure function: same input order produces
 * the same output (d3-force seeds initial positions via phyllotaxis,
 * no Math.random).
 *
 * Tuning notes:
 *   - `linkDistance: 90` ≈ NODE_WIDTH so connected nodes sit roughly one
 *     node-width apart.
 *   - `chargeStrength: -200` is moderate repulsion (default is -30, way
 *     too soft for graph layouts; -350 was strong enough to fling
 *     disconnected nodes off-screen).
 *   - `forceCenter` only TRANSLATES (per d3-force docs — it shifts the
 *     centroid to origin but doesn't restrain spread). Real "gravity"
 *     comes from `forceX(0)` / `forceY(0)` which apply velocity towards
 *     the origin every tick. Strength 0.06 gives a gentle pull that
 *     reins in disconnected nodes without squashing connected clusters.
 *   - `collideRadius: NODE_WIDTH/2 + 12` adds a 12 px gutter around each
 *     node so labels don't kiss.
 *   - 400 ticks is past d3-force's default cooling threshold (300) — the
 *     cloud is fully settled.
 */
function computeForceLayoutPositions(
  allNodes: INodeView[],
  uniqueEdges: IGraphEdge[],
): Map<string, IPoint> {
  interface ISimNode extends SimulationNodeDatum {
    id: string;
  }
  interface ISimLink {
    source: string;
    target: string;
  }
  const simNodes: ISimNode[] = allNodes.map((n) => ({ id: n.path }));
  const simLinks: ISimLink[] = uniqueEdges.map((e) => ({ source: e.from, target: e.to }));

  const sim = forceSimulation<ISimNode>(simNodes)
    .force(
      'link',
      forceLink<ISimNode, ISimLink>(simLinks).id((d) => d.id).distance(90).strength(1),
    )
    .force('charge', forceManyBody<ISimNode>().strength(-200))
    .force('center', forceCenter(0, 0))
    .force('x', forceX<ISimNode>(0).strength(0.06))
    .force('y', forceY<ISimNode>(0).strength(0.06))
    .force('collide', forceCollide<ISimNode>(NODE_WIDTH / 2 + 12))
    .stop();

  const TICKS = 400;
  for (let i = 0; i < TICKS; i++) sim.tick();

  const positions = new Map<string, IPoint>();
  for (const sn of simNodes) {
    positions.set(sn.id, {
      x: (sn.x ?? 0) - NODE_WIDTH / 2,
      y: (sn.y ?? 0) - NODE_HEIGHT / 2,
    });
  }
  return positions;
}

/**
 * Run d3-force with a subset of nodes pinned to known coordinates and only
 * `freeIds` allowed to move. Used by the graph view's reconcile effect to
 * place a newly-added node (or a small batch of them) AROUND the existing
 * layout instead of re-laying out everything from scratch.
 *
 * Why this exists:
 *
 *   The full `computeForceLayoutPositions` is a fresh phyllotaxis seed
 *   plus 400 ticks — every call produces a self-consistent layout but
 *   ignores any prior positions. When a single node enters the topology
 *   (e.g. a WS scan refresh adds one more file), running the full sim
 *   again would relocate every existing node too, undoing the user's
 *   stored coordinates. Reading just the new node's row out of that
 *   fresh sim and pinning it next to the OLD positions of the others
 *   is worse: the new sim doesn't know where the OLD nodes "really" are
 *   on screen, so the new node lands on top of them.
 *
 *   Pinning (`fx` / `fy`) tells d3-force "treat these positions as
 *   immovable constraints". The free nodes get phyllotaxis-seeded near
 *   the origin, then the link / charge / collide forces push them out
 *   to a non-overlapping spot that respects the actual layout the user
 *   sees. 200 ticks is enough because only a handful of nodes are free
 *   — the bulk of the system is already at equilibrium.
 *
 * Coordinate convention: `pinned` is in TOP-LEFT space (matches the
 * shape persisted to `nodePositions`). d3-force operates on CENTER
 * coordinates, so we offset by `NODE_WIDTH/2` / `NODE_HEIGHT/2` on the
 * way in and back out.
 */
export function computeIncrementalPositions(
  allNodes: INodeView[],
  edges: IGraphEdge[],
  pinned: TNodePositions,
  freeIds: readonly string[],
): Map<string, IPoint> {
  interface ISimNode extends SimulationNodeDatum {
    id: string;
    fx?: number | null;
    fy?: number | null;
  }
  interface ISimLink {
    source: string;
    target: string;
  }

  const freeSet = new Set(freeIds);
  const simNodes: ISimNode[] = allNodes.map((n) => {
    const node: ISimNode = { id: n.path };
    if (freeSet.has(n.path)) return node;
    const tl = pinned[n.path];
    if (!tl) return node;
    // Pinned: convert top-left → center, fix the position.
    const cx = tl.x + NODE_WIDTH / 2;
    const cy = tl.y + NODE_HEIGHT / 2;
    node.x = cx;
    node.y = cy;
    node.fx = cx;
    node.fy = cy;
    return node;
  });
  const simLinks: ISimLink[] = edges.map((e) => ({ source: e.from, target: e.to }));

  const sim = forceSimulation<ISimNode>(simNodes)
    .force(
      'link',
      forceLink<ISimNode, ISimLink>(simLinks).id((d) => d.id).distance(90).strength(1),
    )
    .force('charge', forceManyBody<ISimNode>().strength(-200))
    // No `forceCenter` here — translating the whole cloud would
    // contradict the pinned positions. The pull-to-origin from
    // `forceX` / `forceY` keeps a free disconnected node from
    // drifting forever.
    .force('x', forceX<ISimNode>(0).strength(0.06))
    .force('y', forceY<ISimNode>(0).strength(0.06))
    .force('collide', forceCollide<ISimNode>(NODE_WIDTH / 2 + 12))
    .stop();

  const TICKS = 200;
  for (let i = 0; i < TICKS; i++) sim.tick();

  const out = new Map<string, IPoint>();
  for (const sn of simNodes) {
    if (!freeSet.has(sn.id)) continue;
    out.set(sn.id, {
      x: (sn.x ?? 0) - NODE_WIDTH / 2,
      y: (sn.y ?? 0) - NODE_HEIGHT / 2,
    });
  }
  return out;
}

/**
 * Project the cached layout to the visible subset. Pure projection —
 * no simulation, no relayout. Manual drag positions (`stored`) override
 * the cached force-layout position per node. Edge link counts are
 * computed against visible-only edges so the in/out badges reflect
 * what the user can see.
 */
export function projectVisible(
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
    const apiNode = layout.apiNodesByPath.get(id);
    const override = stored[id];
    const cached = layout.positions.get(id) ?? { x: 0, y: 0 };
    const position = override ? { x: override.x, y: override.y } : cached;
    nodes.push({
      id,
      path: id,
      view,
      kind: view.kind,
      position,
      stats: {
        linksIn: inCount.get(id) ?? 0,
        linksOut: outCount.get(id) ?? 0,
        // BFF-persisted counts. Older snapshots / partial scans may omit
        // tokens; default to undefined so the card hides the pill cleanly.
        bytesTotal: apiNode?.bytes.total,
        tokensTotal: apiNode?.tokens?.total,
        externalRefsCount: apiNode?.externalRefsCount,
      },
      summary: deriveStubSummary(view),
    });
  }

  return { nodes, edges: visibleEdges };
}

/**
 * Lightweight stand-in for the kernel's per-kind summarizer (Step 9+).
 * `<sm-node-card>` requires a `TSummary` — once the real summarizer
 * lands, this collapses to a no-op and the kernel's payload flows
 * through verbatim.
 */
function deriveStubSummary(view: INodeView): TSummary {
  const safety: IReportSafety = {
    injectionDetected: false,
    contentQuality: 'clean',
  };
  const whatItDoes = (view.frontmatter.description ?? view.frontmatter.name ?? '').trim();
  const stub: ISummaryNote = {
    kind: 'note',
    confidence: 0.6,
    safety,
    whatItCovers: whatItDoes || `${view.kind} entry`,
    topics: [],
    keyFacts: [],
  };
  return stub;
}

function edgeId(prefix: string, from: string, to: string): string {
  const [a, b] = [from, to].sort();
  return `${prefix}:${a}::${b}`;
}
