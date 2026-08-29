/**
 * DB seam of the execution-stats accumulator (`activity-stats.ts`): the
 * checkpoint sink it flushes into and the boot hydration that reads it
 * back (`spec/provider-activity.md` §Execution stats, "checkpointed
 * into the project DB"). Both halves are BEST-EFFORT by contract: no
 * DB file (`tryWithSqlite` answers `null`), a DB that predates the
 * `state_activity_*` tables, or any other storage failure degrades to
 * the memory-only behaviour the accumulator always had, never to an
 * ingest error and never to a boot failure.
 *
 * Each call opens / closes its own adapter (the favorites route idiom):
 * the sink fires at most once per debounce window and the hydration
 * once per boot, so the open cost is noise, and holding a long-lived
 * handle from the server would fight `sm scan`'s write-side drift
 * reset of the same file.
 */

import { tryWithSqlite } from '../core/sqlite/with-sqlite.js';
import type { IActivityPairRow, IActivityStatsRow } from '../kernel/types/storage.js';
import type { ActivityStatsService, IActivityStatsSink } from './activity-stats.js';

/** Sink writing the accumulator's dirty rows into the project DB. */
export function createActivityStatsSink(dbPath: string): IActivityStatsSink {
  const opts = { databasePath: dbPath, autoBackup: false };
  return {
    async upsertNodes(rows: readonly IActivityStatsRow[]): Promise<void> {
      await tryWithSqlite(opts, (adapter) => adapter.activity.upsertNodes(rows));
    },
    async upsertPairs(rows: readonly IActivityPairRow[]): Promise<void> {
      await tryWithSqlite(opts, (adapter) => adapter.activity.upsertPairs(rows));
    },
  };
}

/**
 * Boot hydration: load the checkpoint and hand it to the accumulator.
 * Swallows every failure (see the module doc); returns whether rows
 * were adopted, for the boot log.
 */
export async function hydrateActivityStats(
  stats: ActivityStatsService,
  dbPath: string,
): Promise<boolean> {
  try {
    const checkpoint = await tryWithSqlite(
      { databasePath: dbPath, autoBackup: false },
      (adapter) => adapter.activity.loadAll(),
    );
    if (checkpoint === null) return false;
    stats.hydrate(checkpoint.nodes, checkpoint.pairs);
    return checkpoint.nodes.length > 0 || checkpoint.pairs.length > 0;
  } catch {
    return false;
  }
}
