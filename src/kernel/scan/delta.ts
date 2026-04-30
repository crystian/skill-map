/**
 * Scan delta — pure comparison of two `ScanResult` snapshots. Drives
 * `sm scan --compare-with <path>` (Step 8.2) and is the single place
 * the kernel knows how to identify "the same" entity across two scans.
 *
 * **Identity contract** (mirrors decisions made at earlier sub-steps):
 *
 *   - **Node**: `node.path`. The path is the only field stable across
 *     edits — every other Node field is content-derived (hashes, counts,
 *     denormalised frontmatter). Two nodes with the same path are the
 *     "same" node; differences are reported as a `changed` entry with
 *     a reason narrowing what diverged.
 *
 *   - **Link**: `(source, target, kind, normalizedTrigger ?? '')`. This
 *     mirrors Step 7.2's link-conflict rule and `sm show` aggregation —
 *     two links with identical endpoints, kind, and (optional) trigger
 *     are the same link, even if emitted by different extractors. The
 *     `sources[]` union and confidence are NOT part of identity; they
 *     are presentation facets that can churn without making the link
 *     "different" for delta purposes.
 *
 *   - **Issue**: `(ruleId, sorted nodeIds, message)`. Mirrors
 *     `spec/job-events.md` §issue.* — same key → same issue, even when
 *     `data` / `severity` / `linkIndices` shift. A meaningful change in
 *     `message` (or a different set of node ids) is a different issue.
 *     This is the same key future job events will use; keep it aligned
 *     so consumers can reuse logic.
 *
 * No "changed" bucket for links / issues — identity already captures
 * everything that matters there. Nodes get a "changed" bucket because
 * the path stays stable while the body / frontmatter rewrite, and that
 * change is meaningful (formatters, summarisers, downstream consumers
 * all care about it).
 *
 * Pure: no IO, no DB, no FS. Safe to run in-memory inside `sm scan`
 * without polluting the persisted snapshot.
 */

import type { Issue, Link, Node, ScanResult } from '../types.js';

export type TNodeChangeReason = 'body' | 'frontmatter' | 'both';

export interface INodeChange {
  before: Node;
  after: Node;
  /**
   * Which hash diverged. `'body'` means body rewritten, frontmatter
   * untouched; `'frontmatter'` means metadata rewritten, body
   * untouched; `'both'` means both rewritten in the same edit.
   */
  reason: TNodeChangeReason;
}

export interface IScanDelta {
  /** Path the current scan was compared against (echoed for the report header). */
  comparedWith: string;
  nodes: {
    added: Node[];
    removed: Node[];
    changed: INodeChange[];
  };
  links: {
    added: Link[];
    removed: Link[];
  };
  issues: {
    added: Issue[];
    removed: Issue[];
  };
}

export function computeScanDelta(
  prior: ScanResult,
  current: ScanResult,
  comparedWith: string,
): IScanDelta {
  return {
    comparedWith,
    nodes: diffNodes(prior.nodes, current.nodes),
    links: diffLinks(prior.links, current.links),
    issues: diffIssues(prior.issues, current.issues),
  };
}

/**
 * `true` iff every bucket is empty. Callers use this to decide the
 * exit code (`0` clean, `1` non-empty delta).
 */
export function isEmptyDelta(delta: IScanDelta): boolean {
  return (
    delta.nodes.added.length === 0 &&
    delta.nodes.removed.length === 0 &&
    delta.nodes.changed.length === 0 &&
    delta.links.added.length === 0 &&
    delta.links.removed.length === 0 &&
    delta.issues.added.length === 0 &&
    delta.issues.removed.length === 0
  );
}

// --- node delta ------------------------------------------------------------

function diffNodes(
  priorNodes: Node[],
  currentNodes: Node[],
): IScanDelta['nodes'] {
  const priorByPath = new Map(priorNodes.map((n) => [n.path, n]));
  const currentByPath = new Map(currentNodes.map((n) => [n.path, n]));

  const added: Node[] = [];
  const removed: Node[] = [];
  const changed: INodeChange[] = [];

  for (const [path, after] of currentByPath) {
    const before = priorByPath.get(path);
    if (!before) {
      added.push(after);
      continue;
    }
    const reason = compareNodeHashes(before, after);
    if (reason !== null) changed.push({ before, after, reason });
  }
  for (const [path, before] of priorByPath) {
    if (!currentByPath.has(path)) removed.push(before);
  }

  // Deterministic ordering — by path so two consumers comparing the same
  // pair of scans always see the same delta. Match the existing read-side
  // sort (used by `sm list`, ASCII formatter, etc.).
  added.sort(byPath);
  removed.sort(byPath);
  changed.sort((a, b) => byPath(a.after, b.after));

  return { added, removed, changed };
}

function compareNodeHashes(before: Node, after: Node): TNodeChangeReason | null {
  const bodyChanged = before.bodyHash !== after.bodyHash;
  const fmChanged = before.frontmatterHash !== after.frontmatterHash;
  if (bodyChanged && fmChanged) return 'both';
  if (bodyChanged) return 'body';
  if (fmChanged) return 'frontmatter';
  return null;
}

function byPath(a: { path: string }, b: { path: string }): number {
  return a.path.localeCompare(b.path);
}

// --- link delta ------------------------------------------------------------

function diffLinks(
  priorLinks: Link[],
  currentLinks: Link[],
): IScanDelta['links'] {
  const priorKeys = new Set(priorLinks.map(linkIdentity));
  const currentKeys = new Set(currentLinks.map(linkIdentity));

  const added: Link[] = [];
  const removed: Link[] = [];

  for (const link of currentLinks) {
    if (!priorKeys.has(linkIdentity(link))) added.push(link);
  }
  for (const link of priorLinks) {
    if (!currentKeys.has(linkIdentity(link))) removed.push(link);
  }

  added.sort(byLinkSort);
  removed.sort(byLinkSort);

  return { added, removed };
}

function linkIdentity(link: Link): string {
  // NUL separator — collision-free against any path (POSIX paths cannot
  // contain NUL) or trigger string. Same rule used by `sm show`'s
  // aggregation and by Step 7.2's link-conflict rule.
  const trigger = link.trigger?.normalizedTrigger ?? '';
  return `${link.source}\x00${link.target}\x00${link.kind}\x00${trigger}`;
}

function byLinkSort(a: Link, b: Link): number {
  if (a.source !== b.source) return a.source.localeCompare(b.source);
  if (a.target !== b.target) return a.target.localeCompare(b.target);
  return a.kind.localeCompare(b.kind);
}

// --- issue delta -----------------------------------------------------------

function diffIssues(
  priorIssues: Issue[],
  currentIssues: Issue[],
): IScanDelta['issues'] {
  const priorKeys = new Set(priorIssues.map(issueIdentity));
  const currentKeys = new Set(currentIssues.map(issueIdentity));

  const added: Issue[] = [];
  const removed: Issue[] = [];

  for (const issue of currentIssues) {
    if (!priorKeys.has(issueIdentity(issue))) added.push(issue);
  }
  for (const issue of priorIssues) {
    if (!currentKeys.has(issueIdentity(issue))) removed.push(issue);
  }

  added.sort(byIssueSort);
  removed.sort(byIssueSort);

  return { added, removed };
}

function issueIdentity(issue: Issue): string {
  // Matches the spec/job-events.md §issue.* diff key so future job-event
  // consumers can reuse the same identity across the kernel.
  const ids = [...issue.nodeIds].sort().join(',');
  return `${issue.ruleId}\x00${ids}\x00${issue.message}`;
}

function byIssueSort(a: Issue, b: Issue): number {
  if (a.ruleId !== b.ruleId) return a.ruleId.localeCompare(b.ruleId);
  return a.message.localeCompare(b.message);
}
