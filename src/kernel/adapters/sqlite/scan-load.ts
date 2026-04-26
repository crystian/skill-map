/**
 * `loadScanResult` — driving inverse of `persistScanResult`. Reads the
 * `scan_*` tables and reconstructs a `ScanResult` shape so the
 * orchestrator can run an incremental scan (`sm scan --changed`,
 * Step 4.4) on top of a prior snapshot.
 *
 * The reconstruction is faithful for everything that was actually
 * persisted: nodes (with triple-split bytes / tokens, denormalised
 * counts, JSON frontmatter), internal links (with regrouped
 * `trigger` / `location`, parsed `sources[]`), and issues
 * (with parsed `nodeIds` / `linkIndices` / `fix` / `data`).
 *
 * **Documented omission**: external pseudo-links (those whose target is
 * an `http://` / `https://` URL emitted by the external-url-counter
 * detector) are NEVER persisted to `scan_links` — only their per-node
 * count survives in `scan_nodes.external_refs_count`. Therefore the
 * `result.links` returned by `loadScanResult` contains only internal
 * graph links, and `node.externalRefsCount` is the authoritative count
 * carried over from the prior scan. The orchestrator's incremental path
 * preserves that count for "unchanged" nodes and re-derives it for
 * new / modified nodes from a fresh detector pass.
 *
 * Synthetic `ScanResult` envelope: this loader cannot fully reconstruct
 * the spec-required meta fields because the snapshot tables today only
 * persist per-node `scanned_at` and never the original `scope` / `roots` /
 * `adapters` / `scannedBy` / `stats`. The loader therefore fabricates a
 * spec-conformant envelope:
 *
 *   - `scannedAt` ← max(`scan_nodes.scanned_at`); falls back to `Date.now()`
 *     for empty snapshots so the field stays a positive integer.
 *   - `scope`     ← `'project'` (the original scope is not persisted today
 *     — persisting it requires a `state_scan_meta` table; deferred).
 *   - `roots`     ← `['.']` so the spec's `minItems: 1` holds even on
 *     empty / synthetic snapshots. NOT load-bearing: the orchestrator's
 *     incremental path only reads `nodes` / `links` / `issues` from the
 *     prior; it never reuses the prior `roots`.
 *   - `adapters`  ← `[]` (also not persisted; rebuild is left to the
 *     fresh scan that consumes this snapshot).
 *   - `stats`     ← zeros for `filesWalked` / `filesSkipped` / `durationMs`
 *     and the live counts derived from the loaded rows.
 *
 * Once `state_scan_meta` lands, this loader can return the real values
 * and the synthetic notes go away.
 */

import type { Kysely } from 'kysely';

import type {
  Confidence,
  Issue,
  IssueFix,
  Link,
  LinkKind,
  LinkLocation,
  LinkTrigger,
  Node,
  NodeKind,
  ScanResult,
  Severity,
  Stability,
  TripleSplit,
} from '../../types.js';
import type {
  IDatabase,
  IScanIssuesTable,
  IScanLinksTable,
  IScanNodesTable,
} from './schema.js';
import type { Selectable } from 'kysely';

export async function loadScanResult(
  db: Kysely<IDatabase>,
): Promise<ScanResult> {
  const [nodeRows, linkRows, issueRows] = await Promise.all([
    db.selectFrom('scan_nodes').selectAll().execute(),
    db.selectFrom('scan_links').selectAll().execute(),
    db.selectFrom('scan_issues').selectAll().execute(),
  ]);

  const nodes = nodeRows.map(rowToNode);
  const links = linkRows.map(rowToLink);
  const issues = issueRows.map(rowToIssue);

  // Pick the most recent persisted scannedAt so the synthetic envelope
  // matches what `persistScanResult` wrote. Within a single snapshot
  // every node row carries the same value; max() is just defensive.
  let scannedAt = 0;
  for (const row of nodeRows) {
    if (row.scannedAt > scannedAt) scannedAt = row.scannedAt;
  }
  if (scannedAt === 0) scannedAt = Date.now();

  return {
    schemaVersion: 1,
    scannedAt,
    scope: 'project',
    // synthetic — see scan-load.ts header. Spec requires minItems: 1; the
    // orchestrator's incremental path never reads this field from a prior.
    roots: ['.'],
    adapters: [],
    nodes,
    links,
    issues,
    stats: {
      filesWalked: 0,
      filesSkipped: 0,
      nodesCount: nodes.length,
      linksCount: links.length,
      issuesCount: issues.length,
      durationMs: 0,
    },
  };
}

/**
 * Convert a `scan_nodes` row to its `Node` domain shape. Exported so
 * read-side commands (`sm list`, `sm show`) can reuse the exact mapping
 * used by the incremental scan loader — keeping the two paths byte-aligned
 * with the spec's `node.schema.json`.
 */
export function rowToNode(row: Selectable<IScanNodesTable>): Node {
  const bytes: TripleSplit = {
    frontmatter: row.bytesFrontmatter,
    body: row.bytesBody,
    total: row.bytesTotal,
  };
  const node: Node = {
    path: row.path,
    kind: row.kind as NodeKind,
    adapter: row.adapter,
    bodyHash: row.bodyHash,
    frontmatterHash: row.frontmatterHash,
    bytes,
    linksOutCount: row.linksOutCount,
    linksInCount: row.linksInCount,
    externalRefsCount: row.externalRefsCount,
    title: row.title,
    description: row.description,
    stability: (row.stability as Stability | null) ?? null,
    version: row.version,
    author: row.author,
    frontmatter: parseJsonObject(row.frontmatterJson),
  };
  if (
    row.tokensFrontmatter !== null &&
    row.tokensBody !== null &&
    row.tokensTotal !== null
  ) {
    node.tokens = {
      frontmatter: row.tokensFrontmatter,
      body: row.tokensBody,
      total: row.tokensTotal,
    };
  }
  return node;
}

/**
 * Convert a `scan_links` row to its `Link` domain shape. Exported for
 * read-side reuse (`sm show` lists in/out edges).
 */
export function rowToLink(row: Selectable<IScanLinksTable>): Link {
  const link: Link = {
    source: row.sourcePath,
    target: row.targetPath,
    kind: row.kind as LinkKind,
    confidence: row.confidence as Confidence,
    sources: parseJsonArray<string>(row.sourcesJson),
  };
  if (row.originalTrigger !== null && row.normalizedTrigger !== null) {
    const trigger: LinkTrigger = {
      originalTrigger: row.originalTrigger,
      normalizedTrigger: row.normalizedTrigger,
    };
    link.trigger = trigger;
  }
  if (row.locationLine !== null) {
    const location: LinkLocation = { line: row.locationLine };
    if (row.locationColumn !== null) location.column = row.locationColumn;
    if (row.locationOffset !== null) location.offset = row.locationOffset;
    link.location = location;
  }
  if (row.raw !== null) link.raw = row.raw;
  return link;
}

/**
 * Convert a `scan_issues` row to its `Issue` domain shape. Exported for
 * read-side reuse (`sm check` and `sm show`).
 */
export function rowToIssue(row: Selectable<IScanIssuesTable>): Issue {
  const issue: Issue = {
    ruleId: row.ruleId,
    severity: row.severity as Severity,
    nodeIds: parseJsonArray<string>(row.nodeIdsJson),
    message: row.message,
  };
  if (row.linkIndicesJson !== null) {
    issue.linkIndices = parseJsonArray<number>(row.linkIndicesJson);
  }
  if (row.detail !== null) issue.detail = row.detail;
  if (row.fixJson !== null) {
    issue.fix = JSON.parse(row.fixJson) as IssueFix;
  }
  if (row.dataJson !== null) {
    issue.data = JSON.parse(row.dataJson) as Record<string, unknown>;
  }
  return issue;
}

function parseJsonObject(s: string): Record<string, unknown> {
  const parsed = JSON.parse(s) as unknown;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return {};
}

function parseJsonArray<T>(s: string): T[] {
  const parsed = JSON.parse(s) as unknown;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}
