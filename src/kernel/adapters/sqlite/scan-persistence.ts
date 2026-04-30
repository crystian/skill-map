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
 *
 * After the transaction commits we run `PRAGMA wal_checkpoint(TRUNCATE)`
 * to force the WAL contents into the main `.db` file and truncate
 * `<db>-wal` to zero bytes. SQLite only auto-checkpoints once the WAL
 * crosses `wal_autocheckpoint` (default 1000 pages); for typical small
 * scans the WAL never crosses that threshold, so the main `.db` lags
 * arbitrarily far behind and external read-only tools (sqlitebrowser,
 * DBeaver) opening the file see stale state. `sm scan` is a single-
 * writer one-shot, so the truncate cost is negligible (~ms on small
 * DBs) and there are no concurrent readers to contend with.
 */

import { sql, type Insertable, type Kysely } from 'kysely';

import type { RenameOp } from '../../orchestrator.js';
import type { Issue, Link, Node, ScanResult } from '../../types.js';
import {
  findStrandedStateOrphans,
  migrateNodeFks,
  type IMigrateNodeFksReport,
} from './history.js';
import type {
  IDatabase,
  IScanIssuesTable,
  IScanLinksTable,
  IScanMetaTable,
  IScanNodesTable,
} from './schema.js';

export async function persistScanResult(
  db: Kysely<IDatabase>,
  result: ScanResult,
  renameOps: RenameOp[] = [],
): Promise<{ renames: IMigrateNodeFksReport[] }> {
  // Spec contract (`scan-result.schema.json#/properties/scannedAt`):
  // Unix milliseconds, integer ≥ 0. The DB column is INTEGER too, so
  // there's nothing to convert — just guard against malformed callers.
  const scannedAt = result.scannedAt;
  if (!Number.isInteger(scannedAt) || scannedAt < 0) {
    throw new Error(
      `persistScanResult: invalid scannedAt ${JSON.stringify(scannedAt)} (expected non-negative integer ms)`,
    );
  }

  const renames: IMigrateNodeFksReport[] = [];
  await db.transaction().execute(async (trx) => {
    // Migrate state_* FKs FIRST so a failure here rolls back BEFORE the
    // scan zone is wiped. Rename heuristic guarantees ops are all-or-
    // nothing (per `spec/db-schema.md` §Rename detection: "either all
    // renames land or none do") — the same tx wraps the whole sequence.
    for (const op of renameOps) {
      const report = await migrateNodeFks(trx, op.from, op.to);
      renames.push(report);
    }

    // Step 5.9 — orphan persistence. Sweep `state_*` for any node_id
    // not in the new live set and emit an `orphan` issue for it (unless
    // the per-scan rename heuristic already covered it). Without this
    // sweep, a state row stranded by a deletion 2+ scans ago becomes
    // invisible (the `orphan` issue from the deletion-scan disappears
    // with the next replace-all on `scan_issues`), making
    // `sm orphans reconcile` impossible to invoke. Spec language is
    // "the kernel emits an issue (...) until the user runs `sm orphans
    // reconcile` or accepts the orphan" — accomplished by re-emitting
    // on every scan as long as the stranded refs persist.
    const livePaths = new Set(result.nodes.map((n) => n.path));
    const knownOrphanPaths = new Set<string>();
    for (const issue of result.issues) {
      if (issue.ruleId !== 'orphan') continue;
      const dataPath = issue.data?.['path'];
      if (typeof dataPath === 'string') knownOrphanPaths.add(dataPath);
    }
    const stranded = await findStrandedStateOrphans(trx, livePaths);
    for (const path of stranded) {
      if (knownOrphanPaths.has(path)) continue;
      result.issues.push({
        ruleId: 'orphan',
        severity: 'info',
        nodeIds: [path],
        message: `Orphan history: ${path} has stranded state_* references but no live node.`,
        data: { path },
      });
    }
    // Keep stats in sync with the augmented issue list so the
    // ScanResult returned by callers (and emitted via `sm scan --json`)
    // reflects what's actually persisted.
    result.stats.issuesCount = result.issues.length;

    // Order matters only inasmuch as the scan zone has no FKs across its
    // four tables today; deleting in one fixed order keeps query plans
    // identical run-to-run.
    await trx.deleteFrom('scan_issues').execute();
    await trx.deleteFrom('scan_links').execute();
    await trx.deleteFrom('scan_nodes').execute();
    await trx.deleteFrom('scan_meta').execute();

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
    await trx.insertInto('scan_meta').values(metaToRow(result)).execute();
  });

  // Force the WAL into the main `.db` file so external read-only tools
  // see the snapshot immediately. Run on the top-level handle, NOT inside
  // the transaction — `wal_checkpoint` is meaningless mid-transaction.
  // `:memory:` doesn't use WAL, so the pragma is a no-op there.
  await sql`PRAGMA wal_checkpoint(TRUNCATE)`.execute(db);

  return { renames };
}

function nodeToRow(node: Node, scannedAt: number): Insertable<IScanNodesTable> {
  return {
    path: node.path,
    kind: node.kind,
    provider: node.provider,
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

function metaToRow(result: ScanResult): Insertable<IScanMetaTable> {
  return {
    id: 1,
    scope: result.scope,
    rootsJson: JSON.stringify(result.roots),
    scannedAt: result.scannedAt,
    scannedByName: result.scannedBy?.name ?? 'skill-map',
    scannedByVersion: result.scannedBy?.version ?? 'unknown',
    scannedBySpecVersion: result.scannedBy?.specVersion ?? 'unknown',
    providersJson: JSON.stringify(result.providers),
    statsFilesWalked: result.stats.filesWalked,
    statsFilesSkipped: result.stats.filesSkipped,
    statsDurationMs: result.stats.durationMs,
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
