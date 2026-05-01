/**
 * Storage helpers for `state_jobs` retention GC. Powers `sm job prune`.
 *
 * Two operations, both DB-only — the storage layer never touches the
 * filesystem (kept portable across runner backends; the FS walk that
 * pairs with `selectReferencedJobFilePaths` lives in
 * `kernel/jobs/orphan-files.ts`):
 *
 *   1. **Retention GC** — delete `state_jobs` rows whose `status` is
 *      terminal (`completed` or `failed`) and whose `finishedAt` is
 *      older than the supplied cutoff. The matching MD job files in
 *      `.skill-map/jobs/` are deleted by the CLI command using the
 *      `filePath` returned by this helper.
 *
 *   2. **Referenced job-file paths** — return every `state_jobs.filePath`
 *      that points at a real MD file, normalized through `resolve()`.
 *      The CLI's `sm job prune --orphan-files` flow combines this set
 *      with a directory walk (`findOrphanJobFiles`) to compute the
 *      MD files on disk that no row references.
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

import { resolve } from 'node:path';

import type { Kysely, Transaction } from 'kysely';

import type { IDatabase, TJobStatus } from './schema.js';
import type { IPruneResult } from '../../types/storage.js';

export type { IPruneResult } from '../../types/storage.js';

type DbOrTx = Kysely<IDatabase> | Transaction<IDatabase>;

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

/**
 * Read every `state_jobs.filePath` currently set, normalized through
 * `resolve()`. The CLI pairs this set with `findOrphanJobFiles` (in
 * `kernel/jobs/orphan-files.ts`) to compute the MD files on disk that
 * no row references — the storage layer stays FS-free so a future
 * Postgres / in-memory adapter inherits no `node:fs` dependency.
 */
export async function selectReferencedJobFilePaths(
  db: DbOrTx,
): Promise<Set<string>> {
  const rows = await db
    .selectFrom('state_jobs')
    .select(['filePath'])
    .where('filePath', 'is not', null)
    .execute();
  const out = new Set<string>();
  for (const row of rows) {
    if (row.filePath !== null) out.add(resolve(row.filePath));
  }
  return out;
}
