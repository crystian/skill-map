/**
 * Pure projection from the executing spine (static edges whose two
 * endpoints execute together, `GraphView.isEdgeExecuting`) to the
 * graph's comet overlay: one Foblex connection per live pair, drawn
 * OVER the static edge with the exact same geometry inputs (same
 * connector ids, sides, type, behaviour) and dressed as comets only
 * (a marching capsule dash, no continuous stroke, no markers), so the
 * spine underneath keeps its gradient line while bright particles
 * travel along it from the caller to the callee.
 *
 * Why a second connection instead of decorating the static edge: a
 * Foblex connection renders ONE visible path, and a dash pattern on
 * it would replace the solid spine. Layering a sibling connection is
 * the same shape the spawn and invocation overlays use (separate
 * `[fConnections]` block, library-computed geometry), so the comets
 * never read or patch the library's rendered DOM.
 *
 * LAYERED BESIDE `graph()` like the other overlays: nothing here
 * reaches `fullLayout`, the reconciler, persisted positions, or the
 * fit bbox.
 *
 * Visibility rules:
 *   - only executing pairs get a comet track;
 *   - a spawn-active pair draws none: the spawn treatment (marching
 *     magenta dash) replaces the spine gradient on that edge and is
 *     already the flow signal, comets on top would double it;
 *   - one track per DIRECTED pair. Several link kinds between the same
 *     two nodes collapse into one comet connection: their static edges
 *     share the geometry anyway, and two overlaid comet trains with
 *     independent phases would read as a smear, not as particles.
 */

import type { IGraphEdge } from './graph-layout';

export interface ICometOverlayEdge {
  /** Stable track key (`<from>>><to>`). */
  key: string;
  /** Foblex connector ids (plain node paths, unified fConnector registry). */
  sourceId: string;
  targetId: string;
}

export const EMPTY_COMET_EDGES: readonly ICometOverlayEdge[] = [];

export interface IResolveCometOverlayArgs {
  edges: readonly IGraphEdge[];
  /** The host's active-spine predicate (`GraphView.isEdgeExecuting`). */
  isExecuting: (edge: IGraphEdge) => boolean;
  /** True when a live spawn already rides this static edge. */
  isSpawnActive: (edge: IGraphEdge) => boolean;
}

export function resolveCometOverlay(args: IResolveCometOverlayArgs): readonly ICometOverlayEdge[] {
  const seen = new Set<string>();
  const tracks: ICometOverlayEdge[] = [];
  for (const edge of args.edges) {
    const key = `${edge.from}>>${edge.to}`;
    if (seen.has(key)) continue;
    if (!args.isExecuting(edge)) continue;
    if (args.isSpawnActive(edge)) continue;
    seen.add(key);
    tracks.push({ key, sourceId: edge.from, targetId: edge.to });
  }
  return tracks.length === 0 ? EMPTY_COMET_EDGES : tracks;
}
