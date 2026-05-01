/**
 * Storage-port domain types — option bags and result shapes the
 * `StoragePort` namespaces consume / return. Live next to the port
 * (`kernel/ports/storage.ts`) so adapters and CLI consumers share a
 * single source of truth without depending on the SQLite adapter's
 * internal types.
 *
 * Naming bucket: category 4 (internal shapes) per `AGENTS.md` § Type
 * naming convention. Every name carries the `I*` prefix.
 */

import type { Issue, Link, Node } from '../types.js';

/**
 * Row-level filter for `port.scans.findNodes(...)` (driven by
 * `sm list`'s flags). All fields are optional — an empty filter
 * returns every node sorted by `path` asc.
 */
export interface INodeFilter {
  /** Restrict to a single node kind. Open string (matches `Node.kind`). */
  kind?: string;
  /**
   * When `true`, keep only nodes whose path is referenced by at least
   * one `scan_issues.nodeIds` array.
   */
  hasIssues?: boolean;
  /**
   * Sort column. The adapter validates against its own whitelist and
   * rejects anything else with an Error (the CLI's own usage-error
   * exit is the right place to surface a bad `--sort-by`; the port
   * defends in depth).
   */
  sortBy?: string;
  /** `'asc'` or `'desc'`. Defaults to the adapter's per-column convention. */
  sortDirection?: 'asc' | 'desc';
  /** Cap the result. Positive integer; absent → no limit. */
  limit?: number;
}

/**
 * Bundled fetch for `port.scans.findNode(path)` — one node and
 * everything `sm show <path>` displays alongside it. Every field is
 * computed from `scan_*` zone reads only; per-domain data (history,
 * jobs, plugin enrichments) ships through other namespaces.
 */
export interface INodeBundle {
  node: Node;
  linksOut: Link[];
  linksIn: Link[];
  issues: Issue[];
}

/**
 * Output of `port.scans.countRows()`. Used by `sm scan` to decide
 * whether the persist would wipe a populated DB (the "refusing to
 * wipe" guard) and by `sm db status` for the human summary.
 */
export interface INodeCounts {
  nodes: number;
  links: number;
  issues: number;
}

/**
 * Lightweight option bag for `port.scans.persist`. Mirrors the trailing
 * arguments of the legacy `persistScanResult(db, result, renameOps,
 * extractorRuns, enrichments)` free function so the adapter
 * implementation is a one-line delegation today; the named-bag shape
 * tomorrow lets new optional inputs land without breaking callers.
 */
export interface IPersistOptions {
  renameOps?: import('../orchestrator.js').RenameOp[];
  extractorRuns?: import('../orchestrator.js').IExtractorRunRecord[];
  enrichments?: import('../orchestrator.js').IEnrichmentRecord[];
}

/**
 * Issue row as the storage layer sees it — paired with its DB-assigned
 * id so `port.issues.deleteById(id)` can target it inside a
 * transaction. The runtime `Issue` shape (per `issue.schema.json`) does
 * not carry `id` because the spec models issues as ephemeral findings
 * scoped to a scan; the DB does need the synthetic id to update / delete
 * a single row.
 */
export interface IIssueRow {
  id: number;
  issue: Issue;
}
