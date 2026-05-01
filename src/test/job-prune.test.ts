/**
 * Step 7.3 — `sm job prune` storage helpers + CLI command.
 *
 * Covers:
 *   1. `pruneTerminalJobs` — only deletes terminal jobs older than the
 *      cutoff; preserves running/queued; returns the right file paths.
 *   2. `selectReferencedJobFilePaths` + `findOrphanJobFiles` — DB
 *      returns the referenced set; the FS helper finds MD files in
 *      `.skill-map/jobs/` not referenced; tolerates missing dirs.
 *   3. `JobPruneCommand` — end-to-end with seeded DB + jobs dir:
 *      • empty DB → exit 0, zero counts.
 *      • retention policy applied — terminal jobs and files removed.
 *      • `--dry-run` — DB and FS untouched.
 *      • `--orphan-files` — orphans removed; referenced files preserved.
 *      • `--json` output shape.
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import {
  pruneTerminalJobs,
  selectReferencedJobFilePaths,
} from '../kernel/adapters/sqlite/jobs.js';
import { findOrphanJobFiles } from '../kernel/jobs/orphan-files.js';
import { JobPruneCommand } from '../cli/commands/jobs.js';

let tempRoot: string;
let counter = 0;

interface ICapturedContext {
  context: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream };
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICapturedContext {
  const outChunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  const stdout = {
    write(chunk: string | Uint8Array): boolean {
      outChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  const stderr = {
    write(chunk: string | Uint8Array): boolean {
      errChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  return {
    context: { stdout, stderr },
    stdout: () => Buffer.concat(outChunks).toString('utf8'),
    stderr: () => Buffer.concat(errChunks).toString('utf8'),
  };
}

function freshScope(label: string): string {
  counter += 1;
  const dir = join(tempRoot, `${label}-${counter}`);
  mkdirSync(join(dir, '.skill-map', 'jobs'), { recursive: true });
  return dir;
}

interface ISeedJobOpts {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  finishedAt?: number | null;
  filePath?: string | null;
  nodeId?: string;
  contentHash?: string;
}

async function seedJob(adapter: SqliteStorageAdapter, opts: ISeedJobOpts): Promise<void> {
  await adapter.db
    .insertInto('state_jobs')
    .values({
      id: opts.id,
      actionId: 'a-test',
      actionVersion: '1.0.0',
      nodeId: opts.nodeId ?? `node-${opts.id}`,
      contentHash: opts.contentHash ?? `hash-${opts.id}`,
      nonce: `nonce-${opts.id}`,
      status: opts.status,
      ttlSeconds: 3600,
      filePath: opts.filePath ?? null,
      createdAt: Date.now(),
      finishedAt: opts.finishedAt ?? null,
    })
    .execute();
}

async function initDb(scope: string): Promise<SqliteStorageAdapter> {
  const dbPath = join(scope, '.skill-map', 'skill-map.db');
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  return adapter;
}

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'skill-map-job-prune-'));
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// pruneTerminalJobs
// ---------------------------------------------------------------------------

describe('pruneTerminalJobs', () => {
  it('returns 0 deletions on an empty table', async () => {
    const scope = freshScope('prune-empty');
    const adapter = await initDb(scope);
    try {
      const result = await pruneTerminalJobs(adapter.db, 'completed', Date.now());
      strictEqual(result.deletedCount, 0);
      strictEqual(result.filePaths.length, 0);
    } finally {
      await adapter.close();
    }
  });

  it('deletes only completed jobs older than cutoff', async () => {
    const scope = freshScope('prune-cutoff');
    const adapter = await initDb(scope);
    try {
      const now = Date.now();
      // Old completed → should prune.
      await seedJob(adapter, { id: 'old', status: 'completed', finishedAt: now - 60_000, filePath: '/tmp/old.md' });
      // Recent completed → should NOT prune.
      await seedJob(adapter, { id: 'fresh', status: 'completed', finishedAt: now - 1_000, filePath: '/tmp/fresh.md' });
      // Failed → not in scope for the completed pass.
      await seedJob(adapter, { id: 'failed', status: 'failed', finishedAt: now - 60_000, filePath: '/tmp/failed.md' });
      // Running → never pruned.
      await seedJob(adapter, { id: 'running', status: 'running' });

      const cutoff = now - 30_000;
      const result = await pruneTerminalJobs(adapter.db, 'completed', cutoff);
      strictEqual(result.deletedCount, 1);
      deepStrictEqual(result.filePaths, ['/tmp/old.md']);

      const remaining = await adapter.db.selectFrom('state_jobs').select('id').orderBy('id').execute();
      deepStrictEqual(
        remaining.map((r) => r.id),
        ['failed', 'fresh', 'running'],
      );
    } finally {
      await adapter.close();
    }
  });

  it('skips rows whose finishedAt is null', async () => {
    const scope = freshScope('prune-null');
    const adapter = await initDb(scope);
    try {
      // Edge case: a "completed" row that somehow has null finishedAt
      // (shouldn't happen via the lifecycle, but defensively guarded).
      await seedJob(adapter, { id: 'orphan', status: 'completed', finishedAt: null });
      const result = await pruneTerminalJobs(adapter.db, 'completed', Date.now());
      strictEqual(result.deletedCount, 0);
    } finally {
      await adapter.close();
    }
  });

  it('returns only non-null filePath values', async () => {
    const scope = freshScope('prune-paths');
    const adapter = await initDb(scope);
    try {
      const now = Date.now();
      await seedJob(adapter, { id: 'with-file', status: 'completed', finishedAt: now - 60_000, filePath: '/tmp/x.md' });
      await seedJob(adapter, { id: 'no-file', status: 'completed', finishedAt: now - 60_000, filePath: null });
      const result = await pruneTerminalJobs(adapter.db, 'completed', now - 30_000);
      strictEqual(result.deletedCount, 2);
      deepStrictEqual(result.filePaths, ['/tmp/x.md']);
    } finally {
      await adapter.close();
    }
  });
});

// ---------------------------------------------------------------------------
// orphan job files (selectReferencedJobFilePaths + findOrphanJobFiles)
// ---------------------------------------------------------------------------

describe('orphan job files', () => {
  it('returns no orphans when the directory is missing', async () => {
    const scope = freshScope('orphans-no-dir');
    const adapter = await initDb(scope);
    try {
      const referenced = await selectReferencedJobFilePaths(adapter.db);
      const result = findOrphanJobFiles(
        join(scope, '.skill-map', 'jobs', 'missing-subdir'),
        referenced,
      );
      strictEqual(result.orphanFilePaths.length, 0);
      strictEqual(result.referencedCount, 0);
    } finally {
      await adapter.close();
    }
  });

  it('flags MD files with no matching state_jobs row', async () => {
    const scope = freshScope('orphans-detect');
    const adapter = await initDb(scope);
    const jobsDir = join(scope, '.skill-map', 'jobs');
    try {
      // Two files on disk; one referenced, one orphan.
      const referencedPath = resolve(join(jobsDir, 'd-referenced.md'));
      const orphanPath = resolve(join(jobsDir, 'd-orphan.md'));
      writeFileSync(referencedPath, '# referenced');
      writeFileSync(orphanPath, '# orphan');
      // Non-MD entry — should be ignored.
      writeFileSync(join(jobsDir, 'README.txt'), 'note');

      await seedJob(adapter, { id: 'd-referenced', status: 'queued', filePath: referencedPath });

      const referenced = await selectReferencedJobFilePaths(adapter.db);
      const result = findOrphanJobFiles(jobsDir, referenced);
      strictEqual(result.referencedCount, 1);
      deepStrictEqual(result.orphanFilePaths, [orphanPath]);
    } finally {
      await adapter.close();
    }
  });
});

// ---------------------------------------------------------------------------
// JobPruneCommand (end-to-end)
// ---------------------------------------------------------------------------

interface IRunCmdOpts {
  cwd: string;
  orphanFiles?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

async function runPrune(opts: IRunCmdOpts): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new JobPruneCommand();
  cmd.orphanFiles = opts.orphanFiles ?? false;
  cmd.dryRun = opts.dryRun ?? false;
  cmd.json = opts.json ?? false;
  const cap = captureContext();
  cmd.context = cap.context as never;
  const original = process.cwd();
  process.chdir(opts.cwd);
  try {
    const code = await cmd.execute();
    return { code, stdout: cap.stdout(), stderr: cap.stderr() };
  } finally {
    process.chdir(original);
  }
}

describe('JobPruneCommand', () => {
  it('exits 5 (NotFound) with a clear message when the DB is missing', async () => {
    const scope = freshScope('cmd-no-db');
    // Don't initDb — leave the DB absent.
    const result = await runPrune({ cwd: scope });
    strictEqual(result.code, 5);
    ok(result.stderr.includes('not found'));
  });

  it('returns zero counts on an empty DB (default config: completed=30d, failed=null)', async () => {
    const scope = freshScope('cmd-empty');
    const adapter = await initDb(scope);
    await adapter.close();

    const result = await runPrune({ cwd: scope, json: true });
    strictEqual(result.code, 0);
    const out = JSON.parse(result.stdout);
    strictEqual(out.dryRun, false);
    strictEqual(out.retention.completed.deleted, 0);
    strictEqual(out.retention.failed.deleted, 0);
    strictEqual(out.orphanFiles.scanned, false);
  });

  it('prunes expired completed jobs and unlinks their files', async () => {
    const scope = freshScope('cmd-prune-completed');
    const adapter = await initDb(scope);
    const jobsDir = join(scope, '.skill-map', 'jobs');
    const expiredFile = join(jobsDir, 'd-expired.md');
    const recentFile = join(jobsDir, 'd-recent.md');
    writeFileSync(expiredFile, 'expired');
    writeFileSync(recentFile, 'recent');

    const now = Date.now();
    // 30d default = 2_592_000s. Push old completed past that boundary.
    await seedJob(adapter, {
      id: 'd-expired',
      status: 'completed',
      finishedAt: now - 31 * 86_400_000,
      filePath: expiredFile,
    });
    await seedJob(adapter, {
      id: 'd-recent',
      status: 'completed',
      finishedAt: now - 1 * 86_400_000,
      filePath: recentFile,
    });
    await adapter.close();

    const result = await runPrune({ cwd: scope, json: true });
    strictEqual(result.code, 0);
    const out = JSON.parse(result.stdout);
    strictEqual(out.retention.completed.deleted, 1);
    strictEqual(out.retention.completed.files, 1);
    // Files: only the expired file should be gone.
    strictEqual(existsSync(expiredFile), false);
    strictEqual(existsSync(recentFile), true);
    // DB: only the recent row remains.
    const adapter2 = await initDb(scope);
    try {
      const remaining = await adapter2.db.selectFrom('state_jobs').select('id').execute();
      strictEqual(remaining.length, 1);
      strictEqual(remaining[0]!.id, 'd-recent');
    } finally {
      await adapter2.close();
    }
  });

  it('does NOT prune failed jobs by default (policy null)', async () => {
    const scope = freshScope('cmd-failed-default');
    const adapter = await initDb(scope);
    const now = Date.now();
    await seedJob(adapter, {
      id: 'd-old-failure',
      status: 'failed',
      finishedAt: now - 365 * 86_400_000,
      filePath: null,
    });
    await adapter.close();

    const result = await runPrune({ cwd: scope, json: true });
    strictEqual(result.code, 0);
    const out = JSON.parse(result.stdout);
    strictEqual(out.retention.failed.policySeconds, null);
    strictEqual(out.retention.failed.deleted, 0);
  });

  it('--dry-run leaves both DB and FS untouched', async () => {
    const scope = freshScope('cmd-dry-run');
    const adapter = await initDb(scope);
    const jobsDir = join(scope, '.skill-map', 'jobs');
    const file = join(jobsDir, 'd-old.md');
    writeFileSync(file, 'old');

    const now = Date.now();
    await seedJob(adapter, {
      id: 'd-old',
      status: 'completed',
      finishedAt: now - 31 * 86_400_000,
      filePath: file,
    });
    await adapter.close();

    const result = await runPrune({ cwd: scope, dryRun: true, json: true });
    strictEqual(result.code, 0);
    const out = JSON.parse(result.stdout);
    strictEqual(out.dryRun, true);
    strictEqual(out.retention.completed.deleted, 1, 'reports what WOULD be pruned');
    strictEqual(existsSync(file), true, 'file survives dry-run');

    const adapter2 = await initDb(scope);
    try {
      const remaining = await adapter2.db.selectFrom('state_jobs').select('id').execute();
      strictEqual(remaining.length, 1, 'row survives dry-run');
    } finally {
      await adapter2.close();
    }
  });

  it('--orphan-files removes unreferenced MD files; preserves referenced', async () => {
    const scope = freshScope('cmd-orphans');
    const adapter = await initDb(scope);
    const jobsDir = join(scope, '.skill-map', 'jobs');
    const referenced = resolve(join(jobsDir, 'd-keep.md'));
    const orphan = resolve(join(jobsDir, 'd-orphan.md'));
    writeFileSync(referenced, 'keep');
    writeFileSync(orphan, 'orphan');

    await seedJob(adapter, { id: 'd-keep', status: 'queued', filePath: referenced });
    await adapter.close();

    const result = await runPrune({ cwd: scope, orphanFiles: true, json: true });
    strictEqual(result.code, 0);
    const out = JSON.parse(result.stdout);
    strictEqual(out.orphanFiles.scanned, true);
    strictEqual(out.orphanFiles.deleted, 1);
    strictEqual(existsSync(orphan), false, 'orphan unlinked');
    strictEqual(existsSync(referenced), true, 'referenced file preserved');
  });

  it('--orphan-files + --dry-run reports counts but unlinks nothing', async () => {
    const scope = freshScope('cmd-orphans-dry');
    const adapter = await initDb(scope);
    const jobsDir = join(scope, '.skill-map', 'jobs');
    const orphan = resolve(join(jobsDir, 'd-orphan.md'));
    writeFileSync(orphan, 'orphan');
    await adapter.close();

    const result = await runPrune({ cwd: scope, orphanFiles: true, dryRun: true, json: true });
    strictEqual(result.code, 0);
    const out = JSON.parse(result.stdout);
    strictEqual(out.dryRun, true);
    strictEqual(out.orphanFiles.deleted, 1);
    strictEqual(existsSync(orphan), true, 'dry-run leaves the orphan in place');
  });

  it('pretty output names the policies and counts', async () => {
    const scope = freshScope('cmd-pretty');
    const adapter = await initDb(scope);
    await adapter.close();
    const result = await runPrune({ cwd: scope });
    strictEqual(result.code, 0);
    ok(result.stdout.includes('completed: policy 30d'));
    ok(result.stdout.includes('failed:'));
    ok(result.stdout.includes('policy never'));
  });
});

// `readdirSync` is referenced by `findOrphanJobFiles` — keep the import
// alive in case future tests need to inspect the raw entries.
void readdirSync;
