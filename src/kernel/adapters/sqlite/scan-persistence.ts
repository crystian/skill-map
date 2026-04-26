/**
 * `persistScanResult` — driven adapter that writes a `ScanResult` into the
 * `scan_*` tables. Replace-all semantics: every scan is a fresh snapshot,
 * so prior rows are deleted before insert. The whole write happens inside
 * a single transaction so a partial failure leaves the DB on the previous
 * snapshot.
 *
 * Incremental scans (`sm scan --changed`, Step 4.4) load the prior
 * snapshot, merge unchanged nodes back in, recompute counts, and call
 * this with the merged ScanResult. The replace-all stays — the merge
 * happens upstream.
 */

import type { Insertable, Kysely } from 'kysely';

import type { Issue, Link, Node, ScanResult } from '../../types.js';
import type {
  IDatabase,
  IScanIssuesTable,
  IScanLinksTable,
  IScanNodesTable,
} from './schema.js';

export async function persistScanResult(
  db: Kysely<IDatabase>,
  result: ScanResult,
): Promise<void> {
  // Spec contract (`scan-result.schema.json#/properties/scannedAt`):
  // Unix milliseconds, integer ≥ 0. The DB column is INTEGER too, so
  // there's nothing to convert — just guard against malformed callers.
  const scannedAt = result.scannedAt;
  if (!Number.isInteger(scannedAt) || scannedAt < 0) {
    throw new Error(
      `persistScanResult: invalid scannedAt ${JSON.stringify(scannedAt)} (expected non-negative integer ms)`,
    );
  }

  await db.transaction().execute(async (trx) => {
    // Order matters only inasmuch as the scan zone has no FKs across its
    // three tables today; deleting in one fixed order keeps query plans
    // identical run-to-run.
    await trx.deleteFrom('scan_issues').execute();
    await trx.deleteFrom('scan_links').execute();
    await trx.deleteFrom('scan_nodes').execute();

    if (result.nodes.length > 0) {
      await trx
        .insertInto('scan_nodes')
        .values(result.nodes.map((n) => nodeToRow(n, scannedAt)))
        .execute();
    }
    if (result.links.length > 0) {
      await trx
        .insertInto('scan_links')
        .values(result.links.map(linkToRow))
        .execute();
    }
    if (result.issues.length > 0) {
      await trx
        .insertInto('scan_issues')
        .values(result.issues.map(issueToRow))
        .execute();
    }
  });
}

function nodeToRow(node: Node, scannedAt: number): Insertable<IScanNodesTable> {
  return {
    path: node.path,
    kind: node.kind,
    adapter: node.adapter,
    title: node.title ?? null,
    description: node.description ?? null,
    stability: node.stability ?? null,
    version: node.version ?? null,
    author: node.author ?? null,
    frontmatterJson: JSON.stringify(node.frontmatter ?? {}),
    bodyHash: node.bodyHash,
    frontmatterHash: node.frontmatterHash,
    bytesFrontmatter: node.bytes.frontmatter,
    bytesBody: node.bytes.body,
    bytesTotal: node.bytes.total,
    tokensFrontmatter: node.tokens?.frontmatter ?? null,
    tokensBody: node.tokens?.body ?? null,
    tokensTotal: node.tokens?.total ?? null,
    linksOutCount: node.linksOutCount,
    linksInCount: node.linksInCount,
    externalRefsCount: node.externalRefsCount,
    scannedAt,
  };
}

function linkToRow(link: Link): Insertable<IScanLinksTable> {
  return {
    sourcePath: link.source,
    targetPath: link.target,
    kind: link.kind,
    confidence: link.confidence,
    sourcesJson: JSON.stringify(link.sources),
    originalTrigger: link.trigger?.originalTrigger ?? null,
    normalizedTrigger: link.trigger?.normalizedTrigger ?? null,
    locationLine: link.location?.line ?? null,
    locationColumn: link.location?.column ?? null,
    locationOffset: link.location?.offset ?? null,
    raw: link.raw ?? null,
  };
}

function issueToRow(issue: Issue): Insertable<IScanIssuesTable> {
  return {
    ruleId: issue.ruleId,
    severity: issue.severity,
    nodeIdsJson: JSON.stringify(issue.nodeIds),
    linkIndicesJson:
      issue.linkIndices && issue.linkIndices.length > 0
        ? JSON.stringify(issue.linkIndices)
        : null,
    message: issue.message,
    detail: issue.detail ?? null,
    fixJson: issue.fix ? JSON.stringify(issue.fix) : null,
    dataJson: issue.data ? JSON.stringify(issue.data) : null,
  };
}
