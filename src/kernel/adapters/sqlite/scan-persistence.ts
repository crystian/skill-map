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

import { sql, type Insertable, type Kysely, type Transaction } from 'kysely';

import type {
  IEnrichmentRecord,
  IExtractorRunRecord,
  RenameOp,
} from '../../orchestrator.js';
import type { Issue, Link, Node, ScanResult } from '../../types.js';
import {
  findStrandedStateOrphans,
  migrateNodeFks,
  type IMigrateNodeFksReport,
} from './history.js';
import type {
  IDatabase,
  INodeEnrichmentsTable,
  IScanExtractorRunsTable,
  IScanIssuesTable,
  IScanLinksTable,
  IScanMetaTable,
  IScanNodesTable,
} from './schema.js';

export async function persistScanResult(
  db: Kysely<IDatabase>,
  result: ScanResult,
  renameOps: RenameOp[] = [],
  extractorRuns: IExtractorRunRecord[] = [],
  enrichments: IEnrichmentRecord[] = [],
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

    await replaceAllScanZone(trx, result, scannedAt, extractorRuns);

    // --- A.8 enrichment layer -----------------------------------------------
    // Universal enrichment table is NOT replace-all — probabilistic rows
    // must survive across scans (preserving the LLM cost). The flow is:
    //
    //   1. Drop rows whose `node_path` is no longer in the live set
    //      (the file disappeared and rename migration didn't claim it —
    //      replace-all already handled the equivalent on `scan_nodes`).
    //   2. Migrate `node_path` for high/medium-confidence renames so the
    //      enrichment audit trail tracks the file like `state_*` rows do.
    //   3. Upsert one row per `(nodePath, extractorId)` pair from this
    //      scan's `enrichments[]`. Conflict on the PRIMARY KEY pisar the
    //      prior row (body / value / stale all refresh to current).
    //   4. Sweep probabilistic rows: any prob row whose
    //      `body_hash_at_enrichment` no longer equals the live node's
    //      `body_hash` AND was NOT just upserted → flag `stale = 1`.
    //      Deterministic rows are never stale-flagged: they regenerate
    //      via the A.9 cache on the next scan and pisar via PK conflict.
    await upsertEnrichmentLayer(trx, result, renameOps, enrichments);
    await flagStaleProbabilisticEnrichments(trx, result, enrichments);
  });

  // Force the WAL into the main `.db` file so external read-only tools
  // see the snapshot immediately. Run on the top-level handle, NOT inside
  // the transaction — `wal_checkpoint` is meaningless mid-transaction.
  // `:memory:` doesn't use WAL, so the pragma is a no-op there.
  await sql`PRAGMA wal_checkpoint(TRUNCATE)`.execute(db);

  return { renames };
}

/**
 * Replace-all on the four `scan_*` tables — issues, links, nodes, meta
 * — plus the fine-grained `scan_extractor_runs` cache. Order: deletes
 * in a fixed sequence (no FKs across these tables today, so the order
 * is just for stable query plans), then inserts. `scan_extractor_runs`
 * is reset together so rows for extractors uninstalled since the last
 * scan disappear automatically; the insert below carries forward only
 * the pairs the orchestrator decided to keep (cached) or freshly ran.
 */
async function replaceAllScanZone(
  trx: Transaction<IDatabase>,
  result: ScanResult,
  scannedAt: number,
  extractorRuns: IExtractorRunRecord[],
): Promise<void> {
  await trx.deleteFrom('scan_issues').execute();
  await trx.deleteFrom('scan_links').execute();
  await trx.deleteFrom('scan_nodes').execute();
  await trx.deleteFrom('scan_meta').execute();
  await trx.deleteFrom('scan_extractor_runs').execute();

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
  if (extractorRuns.length > 0) {
    await trx
      .insertInto('scan_extractor_runs')
      .values(extractorRuns.map(extractorRunToRow))
      .execute();
  }
}

/**
 * Steps 2 + 1 + 3 of the A.8 enrichment layer: migrate `node_path` for
 * renames first (so step 1 doesn't delete what step 2 would have
 * preserved), then drop enrichments whose node disappeared, then upsert
 * the fresh enrichment records carried by this scan.
 *
 * Stale-flagging of probabilistic rows is deliberately a separate
 * helper so this function stays focused on the pisar-the-row path.
 */
async function upsertEnrichmentLayer(
  trx: Transaction<IDatabase>,
  result: ScanResult,
  renameOps: RenameOp[],
  enrichments: IEnrichmentRecord[],
): Promise<void> {
  const enrichmentLivePaths = new Set(result.nodes.map((n) => n.path));

  // Step 2 — migrate renames before step 1 would delete them.
  for (const op of renameOps) {
    await trx
      .updateTable('node_enrichments')
      .set({ nodePath: op.to })
      .where('nodePath', '=', op.from)
      .execute();
  }

  // Step 1 — drop enrichments whose node disappeared.
  if (enrichmentLivePaths.size > 0) {
    const liveList = [...enrichmentLivePaths];
    await trx
      .deleteFrom('node_enrichments')
      .where('nodePath', 'not in', liveList)
      .execute();
  } else {
    await trx.deleteFrom('node_enrichments').execute();
  }

  // Step 3 — upsert fresh enrichments. Composite-PK conflict refreshes
  // every non-key column.
  for (const enrichment of enrichments) {
    const row = enrichmentToRow(enrichment);
    await trx
      .insertInto('node_enrichments')
      .values(row)
      .onConflict((oc) =>
        oc.columns(['nodePath', 'extractorId']).doUpdateSet({
          bodyHashAtEnrichment: row.bodyHashAtEnrichment,
          valueJson: row.valueJson,
          stale: row.stale,
          enrichedAt: row.enrichedAt,
          isProbabilistic: row.isProbabilistic,
        }),
      )
      .execute();
  }
}

/**
 * Step 4 of the A.8 enrichment layer — flag every probabilistic row
 * whose `body_hash_at_enrichment` no longer matches the live node body
 * AND was NOT just upserted by `upsertEnrichmentLayer`. Deterministic
 * rows are never stale-flagged (they regenerate via the A.9 cache on
 * the next scan).
 */
async function flagStaleProbabilisticEnrichments(
  trx: Transaction<IDatabase>,
  result: ScanResult,
  enrichments: IEnrichmentRecord[],
): Promise<void> {
  const refreshedKeys = new Set<string>();
  for (const e of enrichments) {
    refreshedKeys.add(`${e.nodePath}\x00${e.extractorId}`);
  }

  // Probs are sparse (one per LLM-extractor per node), so fetch all
  // and decide in JS — cheap at any practical project size.
  const probRows = await trx
    .selectFrom('node_enrichments')
    .select(['nodePath', 'extractorId', 'bodyHashAtEnrichment', 'stale'])
    .where('isProbabilistic', '=', 1)
    .execute();
  const liveBodyHashByPath = new Map<string, string>();
  for (const node of result.nodes) liveBodyHashByPath.set(node.path, node.bodyHash);

  for (const row of probRows) {
    if (refreshedKeys.has(`${row.nodePath}\x00${row.extractorId}`)) continue;
    const liveBody = liveBodyHashByPath.get(row.nodePath);
    // No live body → already swept by upsertEnrichmentLayer step 1.
    if (liveBody === undefined) continue;
    const shouldBeStale = liveBody !== row.bodyHashAtEnrichment;
    const alreadyStale = row.stale === 1;
    if (shouldBeStale && !alreadyStale) {
      await trx
        .updateTable('node_enrichments')
        .set({ stale: 1 })
        .where('nodePath', '=', row.nodePath)
        .where('extractorId', '=', row.extractorId)
        .execute();
    }
  }
}

// Pure column mapping: every `??` adds one to the cyclomatic count, so
// the limit reads as 13 here despite there being zero branching logic.
// Splitting would replace clarity with ceremony.
// eslint-disable-next-line complexity
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

// Same rationale as `nodeToRow` — pure column mapping, no branches.
// eslint-disable-next-line complexity
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

function extractorRunToRow(
  record: IExtractorRunRecord,
): Insertable<IScanExtractorRunsTable> {
  return {
    nodePath: record.nodePath,
    extractorId: record.extractorId,
    bodyHashAtRun: record.bodyHashAtRun,
    ranAt: record.ranAt,
  };
}

function enrichmentToRow(
  record: IEnrichmentRecord,
): Insertable<INodeEnrichmentsTable> {
  return {
    nodePath: record.nodePath,
    extractorId: record.extractorId,
    bodyHashAtEnrichment: record.bodyHashAtEnrichment,
    valueJson: JSON.stringify(record.value ?? {}),
    stale: 0,
    enrichedAt: record.enrichedAt,
    isProbabilistic: record.isProbabilistic ? 1 : 0,
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
