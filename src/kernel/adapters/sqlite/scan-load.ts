/**
 * `loadScanResult` — driving inverse of `persistScanResult`. Reads the
 * `scan_*` tables and reconstructs a `ScanResult` shape so the
 * orchestrator can run an incremental scan (`sm scan --changed`) on
 * top of a prior snapshot.
 *
 * The reconstruction is faithful for everything that was actually
 * persisted: nodes (with triple-split bytes / tokens, denormalised
 * counts, JSON frontmatter), internal links (with regrouped
 * `trigger` / `location`, parsed `sources[]`), and issues
 * (with parsed `nodeIds` / `linkIndices` / `fix` / `data`).
 *
 * **Documented omission**: external pseudo-links (those whose target is
 * an `http://` / `https://` URL emitted by the external-url-counter
 * extractor) are NEVER persisted to `scan_links` — only their per-node
 * count survives in `scan_nodes.external_refs_count`. Therefore the
 * `result.links` returned by `loadScanResult` contains only internal
 * graph links, and `node.externalRefsCount` is the authoritative count
 * carried over from the prior scan. The orchestrator's incremental path
 * preserves that count for "unchanged" nodes and re-derives it for
 * new / modified nodes from a fresh extractor pass.
 *
 * Meta envelope: the `scan_meta` table persists `scope` / `roots` /
 * `scannedAt` / `scannedBy` / `providers` / `stats.filesWalked` /
 * `stats.filesSkipped` / `stats.durationMs`. When the row exists,
 * those fields come back authoritatively. When it does not (DB
 * freshly migrated but never scanned, or a legacy DB never
 * re-persisted), the loader degrades to a synthetic envelope:
 *
 *   - `scannedAt` ← max(`scan_nodes.scanned_at`); falls back to `Date.now()`
 *     for empty snapshots so the field stays a positive integer.
 *   - `scope`     ← `'project'`.
 *   - `roots`     ← `['.']` to satisfy spec's `minItems: 1`. NOT
 *     load-bearing: the orchestrator's incremental path only reads
 *     `nodes` / `links` / `issues` from the prior; it never reuses the
 *     prior `roots`.
 *   - `providers` ← `[]`.
 *   - `stats`     ← zeros for `filesWalked` / `filesSkipped` /
 *     `durationMs`; the three count fields derive from row counts.
 *
 * Both branches keep `nodesCount` / `linksCount` / `issuesCount` derived
 * from `COUNT(*)` of the loaded rows — never persisted, always recomputed.
 */

import type { Kysely } from 'kysely';

import type { IPersistedEnrichment } from '../../orchestrator.js';
import type {
  Confidence,
  Issue,
  IssueFix,
  Link,
  LinkKind,
  LinkLocation,
  LinkTrigger,
  Node,
  ScanResult,
  ScanScannedBy,
  Severity,
  Stability,
  TripleSplit,
} from '../../types.js';
import type {
  IDatabase,
  IScanIssuesTable,
  IScanLinksTable,
  IScanMetaTable,
  IScanNodesTable,
  TScanScope,
} from './schema.js';
import type { Selectable } from 'kysely';

export async function loadScanResult(
  db: Kysely<IDatabase>,
): Promise<ScanResult> {
  const [nodeRows, linkRows, issueRows, metaRow] = await Promise.all([
    db.selectFrom('scan_nodes').selectAll().execute(),
    db.selectFrom('scan_links').selectAll().execute(),
    db.selectFrom('scan_issues').selectAll().execute(),
    db.selectFrom('scan_meta').selectAll().executeTakeFirst(),
  ]);

  const nodes = nodeRows.map(rowToNode);
  const links = linkRows.map(rowToLink);
  const issues = issueRows.map(rowToIssue);

  if (metaRow) {
    const scannedBy: ScanScannedBy = {
      name: metaRow.scannedByName,
      version: metaRow.scannedByVersion,
      specVersion: metaRow.scannedBySpecVersion,
    };
    return {
      schemaVersion: 1,
      scannedAt: metaRow.scannedAt,
      scope: metaRow.scope as TScanScope,
      roots: parseJsonArray<string>(metaRow.rootsJson),
      providers: parseJsonArray<string>(metaRow.providersJson),
      scannedBy,
      nodes,
      links,
      issues,
      stats: {
        filesWalked: metaRow.statsFilesWalked,
        filesSkipped: metaRow.statsFilesSkipped,
        nodesCount: nodes.length,
        linksCount: links.length,
        issuesCount: issues.length,
        durationMs: metaRow.statsDurationMs,
      },
    };
  }

  // Synthetic fallback: pre-5.1 DB or never-scanned scope.
  let scannedAt = 0;
  for (const row of nodeRows) {
    if (row.scannedAt > scannedAt) scannedAt = row.scannedAt;
  }
  if (scannedAt === 0) scannedAt = Date.now();

  return {
    schemaVersion: 1,
    scannedAt,
    scope: 'project',
    roots: ['.'],
    providers: [],
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
    kind: row.kind,
    provider: row.provider,
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

/**
 * Spec § A.9 — load the fine-grained Extractor cache as a per-node map
 * from qualified extractor id (`<pluginId>/<id>`) to the body hash that
 * extractor saw on its last run. Empty map is the default when the table
 * is empty (fresh DB, never-scanned scope, or every extractor has been
 * uninstalled since the last scan).
 *
 * Returned shape: `Map<nodePath, Map<extractorId, bodyHashAtRun>>`. The
 * orchestrator consults it during the walk to decide per-(node, extractor)
 * whether a fresh `extract()` is needed.
 */
export async function loadExtractorRuns(
  db: Kysely<IDatabase>,
): Promise<Map<string, Map<string, string>>> {
  const rows = await db
    .selectFrom('scan_extractor_runs')
    .select(['nodePath', 'extractorId', 'bodyHashAtRun'])
    .execute();
  const result = new Map<string, Map<string, string>>();
  for (const row of rows) {
    let perNode = result.get(row.nodePath);
    if (!perNode) {
      perNode = new Map<string, string>();
      result.set(row.nodePath, perNode);
    }
    perNode.set(row.extractorId, row.bodyHashAtRun);
  }
  return result;
}

/**
 * Spec § A.8 — load enrichment rows from `node_enrichments`.
 *
 * Returned in the order required by `mergeNodeWithEnrichments` callers:
 * grouped by `nodePath`, then sorted by `enrichedAt` ASC so a spread
 * merge yields last-write-wins per field. Stale rows are included by
 * default — the read-time merge filters them out (the helper takes
 * `includeStale` for the rare UI case that wants to display them).
 *
 * Pass `nodePath` to filter to a single node's enrichments — used by
 * `sm refresh <node>` to read only the rows it intends to refresh, and
 * by `sm show` to render a single node's overlay.
 */
export async function loadNodeEnrichments(
  db: Kysely<IDatabase>,
  nodePath?: string,
): Promise<IPersistedEnrichment[]> {
  let query = db
    .selectFrom('node_enrichments')
    .select([
      'nodePath',
      'extractorId',
      'bodyHashAtEnrichment',
      'valueJson',
      'stale',
      'enrichedAt',
      'isProbabilistic',
    ])
    .orderBy('nodePath', 'asc')
    .orderBy('enrichedAt', 'asc');
  if (nodePath !== undefined) {
    query = query.where('nodePath', '=', nodePath);
  }
  const rows = await query.execute();
  return rows.map((row) => ({
    nodePath: row.nodePath,
    extractorId: row.extractorId,
    bodyHashAtEnrichment: row.bodyHashAtEnrichment,
    value: parseJsonObject(row.valueJson) as Partial<Node>,
    stale: row.stale === 1,
    enrichedAt: row.enrichedAt,
    isProbabilistic: row.isProbabilistic === 1,
  }));
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
