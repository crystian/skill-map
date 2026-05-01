/**
 * `sm job prune` — retention GC for `state_jobs` rows + orphan job-file
 * cleanup. Lands in Step 7.3; the stub it replaces lived in
 * `commands/stubs.ts`.
 *
 * Default behaviour (no flags):
 *   - Read `jobs.retention.completed` and `jobs.retention.failed` from
 *     the layered config. Each is `seconds | null` — `null` means
 *     "never auto-prune".
 *   - For each terminal status with a non-null retention:
 *       cutoffMs = Date.now() - retentionSeconds * 1000
 *     Delete `state_jobs` rows in that status with `finished_at <
 *     cutoffMs`. Unlink the matching MD files in `.skill-map/jobs/`.
 *   - `state_executions` is NOT touched (append-only through v1.0 per
 *     `spec/db-schema.md`).
 *
 * `--orphan-files`: ALSO scan `.skill-map/jobs/` for MD files whose
 * absolute path is not referenced by any `state_jobs.file_path`, and
 * delete them. Useful when the DB was wiped manually but the file
 * tree is still around (or vice versa, recovered DB but the runner
 * crashed mid-render and the file never made it into the row). When
 * combined with retention, both passes run; orphan detection happens
 * AFTER retention so files released by pruned rows don't show up as
 * orphans.
 *
 * `--dry-run`: print what would happen and touch nothing — neither DB
 * nor FS. Output shape is identical to the live mode.
 *
 * `--json`: emit a single document on stdout shaped as
 *
 *   {
 *     dryRun: boolean,
 *     retention: {
 *       completed: { policySeconds: 2592000 | null, deleted: 4, files: 4 },
 *       failed:    { policySeconds: null,           deleted: 0, files: 0 }
 *     },
 *     orphanFiles: { scanned: true, deleted: 2 } | { scanned: false }
 *   }
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  on success (or no-op).
 *   2  config load failure / IO error.
 *   5  DB missing — run `sm init` first.
 */

import { unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import {
  listOrphanJobFiles,
  pruneTerminalJobs,
  type IPruneResult,
} from '../../kernel/adapters/sqlite/jobs.js';
import { loadConfig } from '../../kernel/config/loader.js';
import { assertDbExists } from '../util/db-path.js';
import { ExitCode } from '../util/exit-codes.js';
import { formatErrorMessage } from '../util/error-reporter.js';
import { tx } from '../../kernel/util/tx.js';
import { JOBS_TEXTS } from '../i18n/jobs.texts.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { withSqlite } from '../util/with-sqlite.js';

const PROJECT_DB_REL = '.skill-map/skill-map.db';
const JOBS_DIR_REL = '.skill-map/jobs';

interface IRetentionStatusOutput {
  policySeconds: number | null;
  deleted: number;
  files: number;
}

interface IPruneOutput {
  dryRun: boolean;
  retention: {
    completed: IRetentionStatusOutput;
    failed: IRetentionStatusOutput;
  };
  orphanFiles:
    | { scanned: true; deleted: number }
    | { scanned: false };
}

export class JobPruneCommand extends Command {
  static override paths = [['job', 'prune']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Retention GC for completed / failed jobs (per config policy). --orphan-files removes MD files with no DB row.',
    details: `
      Reads jobs.retention.completed and jobs.retention.failed from the
      layered config. For each non-null policy, deletes terminal jobs
      whose finishedAt is older than the cutoff and unlinks their MD
      files in .skill-map/jobs/.

      With --orphan-files: ALSO scans .skill-map/jobs/ for MD files not
      referenced by any state_jobs row and deletes them. Both passes
      run; orphans are scanned AFTER retention so freshly-pruned
      files don't double-count.

      With --dry-run: counts and reports what would happen without
      touching the DB or the FS.

      Exits 0 on success, 5 if the DB is missing (run \`sm init\`
      first), 2 on any other operational failure (malformed config,
      IO error).
    `,
    examples: [
      ['Apply retention policy', '$0 job prune'],
      ['Apply retention + clean orphan files', '$0 job prune --orphan-files'],
      ['Preview without touching the DB', '$0 job prune --dry-run --json'],
    ],
  });

  orphanFiles = Option.Boolean('--orphan-files', false, {
    description: 'Also remove MD files in .skill-map/jobs/ that have no matching state_jobs row.',
  });
  dryRun = Option.Boolean('-n,--dry-run', false, {
    description: 'Report what would be pruned without touching the DB or filesystem.',
  });
  json = Option.Boolean('--json', false, {
    description: 'Emit a structured prune-result document on stdout.',
  });

  async execute(): Promise<number> {
    const cwd = process.cwd();
    const dbPath = resolve(cwd, PROJECT_DB_REL);
    const jobsDir = resolve(cwd, JOBS_DIR_REL);

    if (!assertDbExists(dbPath, this.context.stderr)) return ExitCode.NotFound;

    let cfg;
    try {
      cfg = loadConfig({ scope: 'project', ...defaultRuntimeContext() }).effective;
    } catch (err) {
      const message = formatErrorMessage(err);
      this.context.stderr.write(tx(JOBS_TEXTS.pruneErrorPrefix, { message }));
      return ExitCode.Error;
    }

    const completedPolicy = cfg.jobs.retention.completed;
    const failedPolicy = cfg.jobs.retention.failed;
    const now = Date.now();

    const out: IPruneOutput = {
      dryRun: this.dryRun,
      retention: {
        completed: { policySeconds: completedPolicy, deleted: 0, files: 0 },
        failed: { policySeconds: failedPolicy, deleted: 0, files: 0 },
      },
      orphanFiles: this.orphanFiles ? { scanned: true, deleted: 0 } : { scanned: false },
    };

    try {
      await withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
        // --- retention pass ------------------------------------------------
        // Two independent passes (one per terminal status). For dry-run we
        // mirror the same query but stop before DELETE / unlink.
        if (completedPolicy !== null) {
          const cutoff = now - completedPolicy * 1000;
          const result = await this.pruneOrPreview('completed', cutoff, adapter, this.dryRun);
          out.retention.completed.deleted = result.deletedCount;
          out.retention.completed.files = await this.unlinkFiles(result.filePaths, this.dryRun);
        }
        if (failedPolicy !== null) {
          const cutoff = now - failedPolicy * 1000;
          const result = await this.pruneOrPreview('failed', cutoff, adapter, this.dryRun);
          out.retention.failed.deleted = result.deletedCount;
          out.retention.failed.files = await this.unlinkFiles(result.filePaths, this.dryRun);
        }

        // --- orphan-files pass ---------------------------------------------
        // Runs AFTER retention so freshly-pruned files are seen by
        // listOrphanJobFiles only if their state_jobs row was already gone
        // (which it isn't, after we just deleted it — they would qualify).
        // We don't double-count: retention unlinked them, the FS scan
        // won't find them anymore.
        if (this.orphanFiles && out.orphanFiles.scanned) {
          const orphans = await listOrphanJobFiles(adapter.db, jobsDir);
          const removed = await this.unlinkFiles(orphans.orphanFilePaths, this.dryRun);
          out.orphanFiles = { scanned: true, deleted: removed };
        }
      });
    } catch (err) {
      const message = formatErrorMessage(err);
      this.context.stderr.write(tx(JOBS_TEXTS.pruneErrorPrefix, { message }));
      return ExitCode.Error;
    }

    if (this.json) {
      this.context.stdout.write(JSON.stringify(out) + '\n');
      return ExitCode.Ok;
    }
    this.printPretty(out);
    return ExitCode.Ok;
  }

  private async pruneOrPreview(
    status: 'completed' | 'failed',
    cutoffMs: number,
    adapter: SqliteStorageAdapter,
    dryRun: boolean,
  ): Promise<IPruneResult> {
    if (dryRun) {
      // Mirror the SELECT side of pruneTerminalJobs without the DELETE.
      // Keeps dry-run honest about exactly which rows would be hit.
      const rows = await adapter.db
        .selectFrom('state_jobs')
        .select(['id', 'filePath'])
        .where('status', '=', status)
        .where('finishedAt', 'is not', null)
        .where('finishedAt', '<', cutoffMs)
        .execute();
      return {
        deletedCount: rows.length,
        filePaths: rows
          .map((r) => r.filePath)
          .filter((p): p is string => p !== null),
      };
    }
    return pruneTerminalJobs(adapter.db, status, cutoffMs);
  }

  private async unlinkFiles(paths: string[], dryRun: boolean): Promise<number> {
    if (dryRun) return paths.length;
    let removed = 0;
    for (const p of paths) {
      try {
        unlinkSync(p);
        removed += 1;
      } catch {
        // Already missing or permission denied — count it as "not removed"
        // but keep going. The DB row is already gone (or about to be);
        // a stale file path is a tolerable inconsistency.
      }
    }
    return removed;
  }

  private printPretty(out: IPruneOutput): void {
    const tag = out.dryRun ? 'sm job prune (dry-run)' : 'sm job prune';
    const c = out.retention.completed;
    const f = out.retention.failed;
    this.context.stdout.write(
      `${tag}\n` +
        `  completed: policy ${formatPolicy(c.policySeconds)}, ${c.deleted} row(s) ${out.dryRun ? 'would be deleted' : 'deleted'}, ${c.files} file(s) ${out.dryRun ? 'would be unlinked' : 'unlinked'}\n` +
        `  failed:    policy ${formatPolicy(f.policySeconds)}, ${f.deleted} row(s) ${out.dryRun ? 'would be deleted' : 'deleted'}, ${f.files} file(s) ${out.dryRun ? 'would be unlinked' : 'unlinked'}\n`,
    );
    if (out.orphanFiles.scanned) {
      this.context.stdout.write(
        `  orphan-files: ${out.orphanFiles.deleted} file(s) ${out.dryRun ? 'would be removed' : 'removed'}\n`,
      );
    }
  }
}

function formatPolicy(seconds: number | null): string {
  if (seconds === null) return 'never';
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  return `${seconds}s`;
}

// `join` import retained for symmetry with the JOBS_DIR_REL constant —
// the helper currently resolves `cwd + JOBS_DIR_REL` via `resolve()`,
// but keeping `join` available avoids a future churn when sub-paths
// are added (e.g. per-runner subdirectories).
void join;
