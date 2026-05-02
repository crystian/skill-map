/**
 * URL search params → kernel `IExportQuery` adapter.
 *
 * One grammar, two transports. The kernel's `parseExportQuery` already
 * speaks a small filter language used by `sm export`:
 *
 *   `kind=skill,agent has=issues path=foo/*`
 *
 * The BFF speaks the same grammar through URL params:
 *
 *   `?kind=skill,agent&hasIssues=true&path=foo/*`
 *
 * Funnelling URL params through `parseExportQuery` (instead of building
 * `IExportQuery` directly) means new filters land once and propagate to
 * both the CLI and the BFF. When `has=findings` ships post-Step 11,
 * `parseExportQuery` is the only edit; both transports pick it up
 * automatically.
 *
 * **Asymmetry note**: `hasIssues=false` is NOT representable in the
 * query language today (the grammar only supports `has=issues`, no
 * negation). Callers that want the inverse use the post-filter helper
 * below to drop nodes that touch any issue, applied after the kernel
 * filter has already been evaluated.
 *
 * Pure: no IO. Throws `ExportQueryError` on bad input — the route
 * handler catches and translates to the `bad-query` envelope (HTTP 400).
 */

import {
  ExportQueryError,
  parseExportQuery,
  type IExportQuery,
} from '../kernel/index.js';
import type { Issue, Node } from '../kernel/index.js';

/**
 * Parsed view of the URL params relevant to the node / link / issue
 * routes. Only the keys actually present in the request appear here —
 * the route handlers branch on `undefined` to know whether a filter was
 * intentionally absent vs. set to an empty string.
 */
export interface INodeUrlFilters {
  /** From `?kind=`. Comma-separated list of kinds (any non-empty string). */
  kinds?: string[];
  /**
   * From `?hasIssues=`. Tri-state: `true` (only nodes touching ≥ 1 issue),
   * `false` (only nodes touching 0 issues), `undefined` (no filter).
   */
  hasIssues?: boolean;
  /** From `?path=`. Comma-separated list of glob patterns. */
  pathGlobs?: string[];
}

/**
 * Lift the URL params for `/api/nodes` into both
 *
 *   1. an `IExportQuery` the kernel filter understands, and
 *   2. the parsed `INodeUrlFilters` echo the route handler needs to
 *      apply the `hasIssues=false` post-filter (which the kernel
 *      grammar can't express).
 *
 * Bad input → `ExportQueryError` (e.g. unknown query token, malformed
 * `hasIssues` value). Caller (`app.onError`) maps to HTTP 400.
 */
export function urlParamsToExportQuery(params: URLSearchParams): {
  query: IExportQuery;
  filters: INodeUrlFilters;
} {
  const filters: INodeUrlFilters = {};
  const tokens: string[] = [];

  const kindRaw = params.get('kind');
  if (kindRaw !== null) {
    const kinds = splitCsv(kindRaw);
    if (kinds.length === 0) {
      throw new ExportQueryError('kind: empty value list');
    }
    filters.kinds = kinds;
    tokens.push(`kind=${kinds.join(',')}`);
  }

  const hasIssuesRaw = params.get('hasIssues');
  if (hasIssuesRaw !== null) {
    const lower = hasIssuesRaw.toLowerCase();
    if (lower === 'true') {
      filters.hasIssues = true;
      tokens.push('has=issues');
    } else if (lower === 'false') {
      filters.hasIssues = false;
      // No grammar token — applied as a post-filter by the route.
    } else {
      throw new ExportQueryError(`hasIssues: expected "true" or "false", got "${hasIssuesRaw}"`);
    }
  }

  const pathRaw = params.get('path');
  if (pathRaw !== null) {
    const globs = splitCsv(pathRaw);
    if (globs.length === 0) {
      throw new ExportQueryError('path: empty value list');
    }
    filters.pathGlobs = globs;
    tokens.push(`path=${globs.join(',')}`);
  }

  // Empty query is valid — `parseExportQuery('')` returns `{ raw: '' }`
  // which `applyExportQuery` treats as "match everything".
  const raw = tokens.join(' ');
  const query = parseExportQuery(raw);
  return { query, filters };
}

/**
 * Post-filter for the `hasIssues=false` case the kernel grammar can't
 * express. Returns the subset of `nodes` that do NOT appear in any
 * issue's `nodeIds`. Idempotent against the empty issues array (every
 * node passes when there are no issues to consult).
 */
export function filterNodesWithoutIssues(nodes: Node[], issues: Issue[]): Node[] {
  if (issues.length === 0) return nodes;
  const nodesWithIssues = new Set<string>();
  for (const issue of issues) {
    for (const id of issue.nodeIds) nodesWithIssues.add(id);
  }
  return nodes.filter((n) => !nodesWithIssues.has(n.path));
}

/**
 * CSV splitter that drops empty entries and trims whitespace. Mirrors
 * what `parseExportQuery` does internally so the two transports share
 * the same "what counts as a value" semantics.
 */
function splitCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
