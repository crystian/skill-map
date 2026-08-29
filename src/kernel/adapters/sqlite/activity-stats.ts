/**
 * Runtime activity-stats checkpoint, the `state_activity_stats` /
 * `state_activity_pairs` half of `StoragePort.activity`
 * (`spec/db-schema.md` §state_activity_stats). Backs the BFF's
 * execution-stats accumulator (`spec/provider-activity.md` §Execution
 * stats): the accumulator projects its in-memory state into these rows
 * on a debounce and reads them back once at boot, so counts survive an
 * `sm serve` restart.
 *
 * The rows are opaque to the kernel: `owners` and `recent` travel as
 * JSON arrays (the accumulator owns their shapes and caps), the kernel
 * only stores, loads, deletes and migrates them (`migrateNodeFks` in
 * `history.ts` moves both tables on a rename).
 *
 * Every mutating helper accepts a `Kysely<IDatabase>` *or* a
 * `Transaction<IDatabase>` so callers can compose them inside a larger
 * tx, same convention as `history.ts`.
 */

import type { Kysely, Transaction } from 'kysely';

import type {
  IActivityPairRow,
  IActivityRecentRow,
  IActivityStatsRow,
} from '../../types/storage.js';
import type { IDatabase } from './schema.js';

type TDbOrTx = Kysely<IDatabase> | Transaction<IDatabase>;

export interface IActivityCheckpoint {
  nodes: IActivityStatsRow[];
  pairs: IActivityPairRow[];
}

/** Every persisted row of both tables (the boot hydration read). */
export async function loadActivityCheckpoint(db: TDbOrTx): Promise<IActivityCheckpoint> {
  const nodeRows = await db.selectFrom('state_activity_stats').selectAll().execute();
  const pairRows = await db.selectFrom('state_activity_pairs').selectAll().execute();
  return {
    nodes: nodeRows.map((row) => ({
      nodePath: row.nodePath,
      count: row.count,
      firstSeenAt: row.firstSeenAt,
      lastStartAt: row.lastStartAt,
      lastOwner: row.lastOwner,
      owners: parseStringArray(row.ownersJson),
      recent: parseRecent(row.recentJson),
      toolUses: row.toolUses,
      tokens: row.tokens,
      summarizedRuns: row.summarizedRuns,
    })),
    pairs: pairRows.map((row) => ({
      parent: row.parent,
      childNodePath: row.childNodePath,
      count: row.count,
      lastStartAt: row.lastStartAt,
    })),
  };
}

/** Insert-or-replace node rows (the debounced checkpoint write). */
export async function upsertActivityStatsRows(
  db: TDbOrTx,
  rows: readonly IActivityStatsRow[],
): Promise<void> {
  for (const row of rows) {
    const values = {
      nodePath: row.nodePath,
      count: row.count,
      firstSeenAt: row.firstSeenAt,
      lastStartAt: row.lastStartAt,
      lastOwner: row.lastOwner,
      ownersJson: JSON.stringify(row.owners),
      recentJson: JSON.stringify(row.recent),
      toolUses: row.toolUses,
      tokens: row.tokens,
      summarizedRuns: row.summarizedRuns,
    };
    await db
      .insertInto('state_activity_stats')
      .values(values)
      .onConflict((oc) => oc.column('nodePath').doUpdateSet(values))
      .execute();
  }
}

/** Insert-or-replace pair rows (the debounced checkpoint write). */
export async function upsertActivityPairRows(
  db: TDbOrTx,
  rows: readonly IActivityPairRow[],
): Promise<void> {
  for (const row of rows) {
    const values = {
      parent: row.parent,
      childNodePath: row.childNodePath,
      count: row.count,
      lastStartAt: row.lastStartAt,
    };
    await db
      .insertInto('state_activity_pairs')
      .values(values)
      .onConflict((oc) => oc.columns(['parent', 'childNodePath']).doUpdateSet(values))
      .execute();
  }
}

/**
 * Drop the node's row plus every pair row naming it on either side (the
 * Activity clear-all, `spec/provider-activity.md` §DELETE /api/activity/node).
 */
export async function deleteActivityForNode(db: TDbOrTx, nodePath: string): Promise<void> {
  await db.deleteFrom('state_activity_stats').where('nodePath', '=', nodePath).execute();
  await db
    .deleteFrom('state_activity_pairs')
    .where((eb) => eb.or([eb('parent', '=', nodePath), eb('childNodePath', '=', nodePath)]))
    .execute();
}

function parseStringArray(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function parseRecent(json: string): IActivityRecentRow[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is IActivityRecentRow =>
        typeof v === 'object' && v !== null && typeof (v as { at?: unknown }).at === 'number',
    );
  } catch {
    return [];
  }
}
