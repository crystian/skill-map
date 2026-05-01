/**
 * Step 5.6 acceptance tests for `sm orphans`, `sm orphans reconcile`,
 * `sm orphans undo-rename`.
 *
 * Tests instantiate each Command class and call `execute()` against a
 * captured context (same pattern as `scan-readers.test.ts`). Each test
 * primes the DB by running a real scan + persistence, then mutates the
 * fixture and re-scans so the rename heuristic emits the expected
 * issues that the verbs operate on.
 */

import { describe, it, before, after } from 'node:test';
import {
  deepStrictEqual,
  match,
  ok,
  strictEqual,
} from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BaseContext } from 'clipanion';

import {
  OrphansCommand,
  OrphansReconcileCommand,
  OrphansUndoRenameCommand,
} from '../cli/commands/orphans.js';
import { builtIns, listBuiltIns } from '../built-in-plugins/built-ins.js';
import {
  createKernel,
  runScanWithRenames,
} from '../kernel/index.js';
import type { ExecutionRecord, ScanResult } from '../kernel/index.js';
import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import {
  insertExecution,
  listExecutions,
} from '../kernel/adapters/sqlite/history.js';
import { loadScanResult } from '../kernel/adapters/sqlite/scan-load.js';
import { persistScanResult } from '../kernel/adapters/sqlite/scan-persistence.js';

let tmpRoot: string;
let counter = 0;

function freshDbPath(label: string): string {
  counter += 1;
  return join(tmpRoot, `${label}-${counter}.db`);
}

function freshFixture(label: string): string {
  return mkdtempSync(join(tmpRoot, `${label}-`));
}

function writeFile(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-orphans-cli-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

interface ICapturedContext {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICapturedContext {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const context = {
    stdout: { write: (s: string) => { stdoutChunks.push(s); return true; } },
    stderr: { write: (s: string) => { stderrChunks.push(s); return true; } },
  } as unknown as BaseContext;
  return {
    context,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
  };
}

async function runScanAndPersist(
  fixture: string,
  dbPath: string,
  prior: ScanResult | null = null,
): Promise<{ result: ScanResult }> {
  const kernel = createKernel();
  for (const m of listBuiltIns()) kernel.registry.register(m);
  const opts: Parameters<typeof runScanWithRenames>[1] = {
    roots: [fixture],
    extensions: builtIns(),
  };
  if (prior) opts.priorSnapshot = prior;
  const ran = await runScanWithRenames(kernel, opts);
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await persistScanResult(adapter.db, ran.result, ran.renameOps);
  } finally {
    await adapter.close();
  }
  return { result: ran.result };
}

async function loadFromDb(dbPath: string): Promise<ScanResult> {
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    return await loadScanResult(adapter.db);
  } finally {
    await adapter.close();
  }
}

function makeExec(id: string, nodePath: string, startedAt = 1_000_000): ExecutionRecord {
  return {
    id,
    kind: 'action',
    extensionId: 'a1',
    extensionVersion: '1.0.0',
    nodeIds: [nodePath],
    contentHash: null,
    status: 'completed',
    failureReason: null,
    exitCode: 0,
    runner: 'cli',
    startedAt,
    finishedAt: startedAt + 1000,
    durationMs: 1000,
    tokensIn: 10,
    tokensOut: 5,
    reportPath: null,
    jobId: null,
  };
}

// --- sm orphans -----------------------------------------------------------

describe('sm orphans (list)', () => {
  it('empty DB → exit 5 (DB missing)', async () => {
    const cap = captureContext();
    const cmd = new OrphansCommand();
    cmd.global = false; cmd.db = '/nope/missing.db'; cmd.kind = undefined; cmd.json = false; cmd.quiet = true;
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 5);
  });

  it('lists orphan + medium + ambiguous after a scan that produces all three', async () => {
    const fixture = freshFixture('list');
    const dbPath = freshDbPath('list');

    // Initial: foo (high), shared-fm-a / shared-fm-b (will be ambiguous), gone (will be orphan).
    writeFile(fixture, '.claude/skills/foo.md',
      ['---', 'name: foo', 'metadata:', '  version: 1.0.0', '---', 'Body F.'].join('\n'),
    );
    writeFile(fixture, '.claude/skills/shared-fm-a.md',
      ['---', 'name: ambig', 'metadata:', '  version: 1.0.0', '---', 'Body A.'].join('\n'),
    );
    writeFile(fixture, '.claude/skills/shared-fm-b.md',
      ['---', 'name: ambig', 'metadata:', '  version: 1.0.0', '---', 'Body B.'].join('\n'),
    );
    writeFile(fixture, '.claude/skills/medium-old.md',
      ['---', 'name: medium-fm', 'metadata:', '  version: 1.0.0', '---', 'Old body.'].join('\n'),
    );
    writeFile(fixture, '.claude/skills/gone.md',
      ['---', 'name: gone', 'metadata:', '  version: 1.0.0', '---', 'Body G.'].join('\n'),
    );
    await runScanAndPersist(fixture, dbPath);
    const prior = await loadFromDb(dbPath);

    // Mutations: foo unchanged. shared-fm-a/b deleted, one new shared-fm-c
    // appears (ambiguous). medium-old → medium-new (same fm, new body).
    // gone → deleted (orphan).
    rmSync(join(fixture, '.claude/skills/shared-fm-a.md'));
    rmSync(join(fixture, '.claude/skills/shared-fm-b.md'));
    writeFile(fixture, '.claude/skills/shared-fm-c.md',
      ['---', 'name: ambig', 'metadata:', '  version: 1.0.0', '---', 'Body C.'].join('\n'),
    );
    rmSync(join(fixture, '.claude/skills/medium-old.md'));
    writeFile(fixture, '.claude/skills/medium-new.md',
      ['---', 'name: medium-fm', 'metadata:', '  version: 1.0.0', '---', 'New body.'].join('\n'),
    );
    rmSync(join(fixture, '.claude/skills/gone.md'));

    await runScanAndPersist(fixture, dbPath, prior);

    const cap = captureContext();
    const cmd = new OrphansCommand();
    cmd.global = false; cmd.db = dbPath; cmd.kind = undefined; cmd.json = true; cmd.quiet = true;
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);

    const out = JSON.parse(cap.stdout()) as { ruleId: string }[];
    const counts: Record<string, number> = {};
    for (const i of out) counts[i.ruleId] = (counts[i.ruleId] ?? 0) + 1;
    strictEqual(counts['orphan'] ?? 0, 3, 'gone + 2 ambiguous candidates → orphan');
    strictEqual(counts['auto-rename-medium'] ?? 0, 1);
    strictEqual(counts['auto-rename-ambiguous'] ?? 0, 1);
  });

  it('--kind filter restricts the result', async () => {
    const fixture = freshFixture('kind');
    const dbPath = freshDbPath('kind');

    writeFile(fixture, '.claude/skills/foo.md',
      ['---', 'name: foo', 'metadata:', '  version: 1.0.0', '---', 'Body.'].join('\n'),
    );
    await runScanAndPersist(fixture, dbPath);
    const prior = await loadFromDb(dbPath);
    rmSync(join(fixture, '.claude/skills/foo.md'));
    await runScanAndPersist(fixture, dbPath, prior);

    const cap = captureContext();
    const cmd = new OrphansCommand();
    cmd.global = false; cmd.db = dbPath; cmd.kind = 'orphan'; cmd.json = true; cmd.quiet = true;
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);
    const arr = JSON.parse(cap.stdout()) as { ruleId: string }[];
    strictEqual(arr.length, 1);
    strictEqual(arr[0]!.ruleId, 'orphan');
  });

  it('--kind invalid → exit 2', async () => {
    const cap = captureContext();
    const cmd = new OrphansCommand();
    cmd.global = false; cmd.db = undefined; cmd.kind = 'banana'; cmd.json = false; cmd.quiet = true;
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 2);
    match(cap.stderr(), /--kind: invalid value/);
  });
});

// --- sm orphans reconcile -------------------------------------------------

describe('sm orphans reconcile', () => {
  async function setup(): Promise<{ fixture: string; dbPath: string }> {
    const fixture = freshFixture('rec');
    const dbPath = freshDbPath('rec');
    writeFile(fixture, '.claude/skills/foo.md',
      ['---', 'name: foo', 'metadata:', '  version: 1.0.0', '---', 'Body.'].join('\n'),
    );
    writeFile(fixture, '.claude/skills/keep.md',
      ['---', 'name: keep', 'metadata:', '  version: 1.0.0', '---', 'Other.'].join('\n'),
    );
    await runScanAndPersist(fixture, dbPath);
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      await insertExecution(adapter.db, makeExec('e1', '.claude/skills/foo.md'));
    } finally {
      await adapter.close();
    }
    const prior = await loadFromDb(dbPath);
    rmSync(join(fixture, '.claude/skills/foo.md'));
    await runScanAndPersist(fixture, dbPath, prior);
    return { fixture, dbPath };
  }

  it('happy path: migrates state_* FKs and resolves the orphan issue', async () => {
    const { dbPath } = await setup();

    const cap = captureContext();
    const cmd = new OrphansReconcileCommand();
    cmd.global = false; cmd.db = dbPath;
    cmd.orphanPath = '.claude/skills/foo.md';
    cmd.to = '.claude/skills/keep.md';
    cmd.quiet = true;
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);

    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      const rows = await listExecutions(adapter.db);
      strictEqual(rows.length, 1);
      deepStrictEqual(rows[0]!.nodeIds, ['.claude/skills/keep.md']);

      const issuesAfter = await adapter.db
        .selectFrom('scan_issues')
        .selectAll()
        .where('ruleId', '=', 'orphan')
        .execute();
      strictEqual(issuesAfter.length, 0, 'orphan issue resolved');
    } finally {
      await adapter.close();
    }
  });

  it('--to references a non-existent node → exit 5', async () => {
    const { dbPath } = await setup();
    const cap = captureContext();
    const cmd = new OrphansReconcileCommand();
    cmd.global = false; cmd.db = dbPath;
    cmd.orphanPath = '.claude/skills/foo.md';
    cmd.to = '.claude/skills/does-not-exist.md';
    cmd.quiet = true;
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 5);
    match(cap.stderr(), /target node "[^"]+" not found/);
  });

  it('no active orphan issue → exit 5', async () => {
    const { dbPath } = await setup();
    // Resolve the orphan first so the second invocation finds nothing.
    const cap1 = captureContext();
    const cmd1 = new OrphansReconcileCommand();
    cmd1.global = false; cmd1.db = dbPath;
    cmd1.orphanPath = '.claude/skills/foo.md'; cmd1.to = '.claude/skills/keep.md';
    cmd1.quiet = true; cmd1.context = cap1.context;
    strictEqual(await cmd1.execute(), 0);

    const cap2 = captureContext();
    const cmd2 = new OrphansReconcileCommand();
    cmd2.global = false; cmd2.db = dbPath;
    cmd2.orphanPath = '.claude/skills/foo.md'; cmd2.to = '.claude/skills/keep.md';
    cmd2.quiet = true; cmd2.context = cap2.context;
    strictEqual(await cmd2.execute(), 5);
    match(cap2.stderr(), /no active orphan issue/);
  });
});

// --- sm orphans undo-rename ----------------------------------------------

describe('sm orphans undo-rename', () => {
  async function setupMedium(): Promise<{ dbPath: string }> {
    const fixture = freshFixture('undo-medium');
    const dbPath = freshDbPath('undo-medium');
    writeFile(fixture, '.claude/skills/foo.md',
      ['---', 'name: foo', 'metadata:', '  version: 1.0.0', '---', 'Original.'].join('\n'),
    );
    await runScanAndPersist(fixture, dbPath);
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      await insertExecution(adapter.db, makeExec('e1', '.claude/skills/foo.md'));
    } finally {
      await adapter.close();
    }
    const prior = await loadFromDb(dbPath);
    rmSync(join(fixture, '.claude/skills/foo.md'));
    writeFile(fixture, '.claude/skills/bar.md',
      ['---', 'name: foo', 'metadata:', '  version: 1.0.0', '---', 'Different body, same fm.'].join('\n'),
    );
    await runScanAndPersist(fixture, dbPath, prior);
    return { dbPath };
  }

  it('medium: --force migrates FKs back, resolves issue, emits new orphan on the prior path', async () => {
    const { dbPath } = await setupMedium();

    const cap = captureContext();
    const cmd = new OrphansUndoRenameCommand();
    cmd.global = false; cmd.db = dbPath;
    cmd.newPath = '.claude/skills/bar.md';
    cmd.from = undefined; cmd.force = true; cmd.quiet = true;
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);

    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      const rows = await listExecutions(adapter.db);
      deepStrictEqual(rows[0]!.nodeIds, ['.claude/skills/foo.md']);

      const ruleIds = (await adapter.db.selectFrom('scan_issues').select('ruleId').execute()).map((r) => r.ruleId);
      ok(!ruleIds.includes('auto-rename-medium'), 'medium issue resolved');
      ok(ruleIds.includes('orphan'), 'orphan emitted on prior path');
    } finally {
      await adapter.close();
    }
  });

  it('medium: --from mismatch → exit 2', async () => {
    const { dbPath } = await setupMedium();

    const cap = captureContext();
    const cmd = new OrphansUndoRenameCommand();
    cmd.global = false; cmd.db = dbPath;
    cmd.newPath = '.claude/skills/bar.md';
    cmd.from = '.claude/skills/wrong.md'; cmd.force = true; cmd.quiet = true;
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 2);
    match(cap.stderr(), /does not match auto-rename-medium data\.from/);
  });

  it('no active auto-rename issue → exit 5', async () => {
    const fixture = freshFixture('undo-empty');
    const dbPath = freshDbPath('undo-empty');
    writeFile(fixture, '.claude/skills/foo.md',
      ['---', 'name: foo', 'metadata:', '  version: 1.0.0', '---', 'Body.'].join('\n'),
    );
    await runScanAndPersist(fixture, dbPath);

    const cap = captureContext();
    const cmd = new OrphansUndoRenameCommand();
    cmd.global = false; cmd.db = dbPath;
    cmd.newPath = '.claude/skills/foo.md';
    cmd.from = undefined; cmd.force = true; cmd.quiet = true;
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 5);
    match(cap.stderr(), /no active auto-rename issue/);
  });

  it('ambiguous: --from required (exit 5 without it), then valid --from succeeds', async () => {
    const fixture = freshFixture('undo-ambig');
    const dbPath = freshDbPath('undo-ambig');

    writeFile(fixture, '.claude/skills/a.md',
      ['---', 'name: shared', 'metadata:', '  version: 1.0.0', '---', 'Body A.'].join('\n'),
    );
    writeFile(fixture, '.claude/skills/b.md',
      ['---', 'name: shared', 'metadata:', '  version: 1.0.0', '---', 'Body B.'].join('\n'),
    );
    await runScanAndPersist(fixture, dbPath);
    const prior = await loadFromDb(dbPath);
    rmSync(join(fixture, '.claude/skills/a.md'));
    rmSync(join(fixture, '.claude/skills/b.md'));
    writeFile(fixture, '.claude/skills/c.md',
      ['---', 'name: shared', 'metadata:', '  version: 1.0.0', '---', 'Body C.'].join('\n'),
    );
    await runScanAndPersist(fixture, dbPath, prior);

    // Without --from
    const cap1 = captureContext();
    const cmd1 = new OrphansUndoRenameCommand();
    cmd1.global = false; cmd1.db = dbPath;
    cmd1.newPath = '.claude/skills/c.md';
    cmd1.from = undefined; cmd1.force = true; cmd1.quiet = true;
    cmd1.context = cap1.context;
    strictEqual(await cmd1.execute(), 5);
    match(cap1.stderr(), /--from <old\.path> is REQUIRED for auto-rename-ambiguous/);

    // --from outside candidates
    const cap2 = captureContext();
    const cmd2 = new OrphansUndoRenameCommand();
    cmd2.global = false; cmd2.db = dbPath;
    cmd2.newPath = '.claude/skills/c.md';
    cmd2.from = '.claude/skills/nope.md'; cmd2.force = true; cmd2.quiet = true;
    cmd2.context = cap2.context;
    strictEqual(await cmd2.execute(), 5);
    match(cap2.stderr(), /not in auto-rename-ambiguous candidates/);

    // Valid --from
    const cap3 = captureContext();
    const cmd3 = new OrphansUndoRenameCommand();
    cmd3.global = false; cmd3.db = dbPath;
    cmd3.newPath = '.claude/skills/c.md';
    cmd3.from = '.claude/skills/a.md'; cmd3.force = true; cmd3.quiet = true;
    cmd3.context = cap3.context;
    strictEqual(await cmd3.execute(), 0);
  });
});
