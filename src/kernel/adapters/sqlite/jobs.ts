/**
 * Storage helpers for `state_jobs` retention GC. Powers `sm job prune`.
 *
 * Two operations:
 *
 *   1. **Retention GC** — delete `state_jobs` rows whose `status` is
 *      terminal (`completed` or `failed`) and whose `finishedAt` is
 *      older than the supplied cutoff. The matching MD job files in
 *      `.skill-map/jobs/` are deleted by the CLI command using the
 *      `filePath` returned by this helper. We do NOT touch the FS
 *      from the storage layer — the helper stays portable across
 *      runner backends.
 *
 *   2. **Orphan file detection** — list MD files in `.skill-map/jobs/`
 *      whose `filePath` is not referenced by any `state_jobs` row.
 *      `sm job prune --orphan-files` deletes them.
 *
 * Per `spec/job-lifecycle.md` §Retention and GC, this MUST NOT run
 * implicitly during normal verb execution. The helpers themselves are
 * pure side-effects on the DB; the policy decision lives in the CLI.
 *
 * Per `spec/db-schema.md`, `state_executions` is append-only through
 * `v1.0`. These helpers do NOT touch that table — pruning a job row
 * leaves the matching execution row in place so post-mortem queries
 * still work after a job's audit trail in `state_jobs` is gone.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Kysely, Transaction } from 'kysely';

import type { IDatabase, TJobStatus } from './schema.js';

type DbOrTx = Kysely<IDatabase> | Transaction<IDatabase>;

export interface IPruneResult {
  /** How many `state_jobs` rows were deleted. */
  deletedCount: number;
  /** Job-file paths from the deleted rows; the CLI unlinks these from disk. `null` `filePath` rows contribute nothing here. */
  filePaths: string[];
}

/**
 * Delete `state_jobs` rows in terminal `status` whose `finishedAt` is
 * older than `cutoffMs` (Unix ms). Returns the row count plus every
 * non-null `filePath` so the caller can unlink the on-disk MD files.
 *
 * `cutoffMs` is computed by the caller from the configured retention:
 * `Date.now() - retentionSeconds * 1000`.
 *
 * Order:
 *   1. SELECT the file_paths of rows that match (small projection).
 *   2. DELETE the same rows.
 * Two queries instead of `DELETE ... RETURNING` because Kysely's
 * SQLite dialect has historically had spotty support for RETURNING
 * across versions; the two-step variant is portable and the table
 * is small enough that the extra round-trip is negligible.
 */
export async function pruneTerminalJobs(
  db: DbOrTx,
  status: 'completed' | 'failed',
  cutoffMs: number,
): Promise<IPruneResult> {
  const rows = await db
    .selectFrom('state_jobs')
    .select(['id', 'filePath'])
    .where('status', '=', status as TJobStatus)
    .where('finishedAt', 'is not', null)
    .where('finishedAt', '<', cutoffMs)
    .execute();

  if (rows.length === 0) {
    return { deletedCount: 0, filePaths: [] };
  }

  const ids = rows.map((r) => r.id);
  await db
    .deleteFrom('state_jobs')
    .where('id', 'in', ids)
    .execute();

  const filePaths = rows
    .map((r) => r.filePath)
    .filter((p): p is string => p !== null);
  return { deletedCount: rows.length, filePaths };
}

export interface IOrphanFilesResult {
  /** Absolute paths of MD files in `jobsDir` that have no matching DB row. */
  orphanFilePaths: string[];
  /** All `state_jobs.filePath` values currently referenced (absolute paths). Useful for the JSON output. */
  referencedCount: number;
}

/**
 * Enumerate MD files in `jobsDir` and return the ones that no
 * `state_jobs.filePath` references. The walk is shallow — job files
 * live directly under `.skill-map/jobs/` per the lifecycle spec, no
 * subdirectories. Symlinks are NOT followed.
 *
 * If `jobsDir` does not exist or is not a directory, returns an empty
 * result instead of throwing — `sm job prune --orphan-files` on a
 * fresh scope (no jobs ever submitted) is a valid no-op.
 */
export async function listOrphanJobFiles(
  db: DbOrTx,
  jobsDir: string,
): Promise<IOrphanFilesResult> {
  const referencedPaths = new Set<string>();
  const rows = await db
    .selectFrom('state_jobs')
    .select(['filePath'])
    .where('filePath', 'is not', null)
    .execute();
  for (const row of rows) {
    if (row.filePath !== null) referencedPaths.add(resolve(row.filePath));
  }

  let entries: string[];
  try {
    const stat = statSync(jobsDir);
    if (!stat.isDirectory()) {
      return { orphanFilePaths: [], referencedCount: referencedPaths.size };
    }
    entries = readdirSync(jobsDir);
  } catch {
    // ENOENT / permission errors → no orphans we can see.
    return { orphanFilePaths: [], referencedCount: referencedPaths.size };
  }

  const orphans: string[] = [];
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    const abs = resolve(join(jobsDir, name));
    if (!referencedPaths.has(abs)) orphans.push(abs);
  }
  orphans.sort();
  return { orphanFilePaths: orphans, referencedCount: referencedPaths.size };
}
