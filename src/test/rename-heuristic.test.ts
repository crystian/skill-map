/**
 * Step 5.5 acceptance tests for the auto-rename heuristic. Exercises
 * each branch of `spec/db-schema.md` §Rename detection:
 *
 *   - high-confidence (body hash match) — no issue, FKs migrated.
 *   - medium-confidence (frontmatter hash, 1:1) — `auto-rename-medium`
 *     issue + FKs migrated.
 *   - ambiguous (frontmatter hash, N:1) — `auto-rename-ambiguous` issue,
 *     no migration.
 *   - orphan (no match) — `orphan` issue, state untouched.
 *
 * Plus invariants that the spec leaves implicit:
 *   - 1-to-1 matching (lex order claims first).
 *   - Body match wins over frontmatter match.
 *   - Atomicity: tx-wrapping persists scan zone + state migration as a
 *     single unit.
 */

import { describe, it, before, after } from 'node:test';
import {
  deepStrictEqual,
  ok,
  strictEqual,
} from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { builtIns, listBuiltIns } from '../built-in-plugins/built-ins.js';
import {
  createKernel,
  runScanWithRenames,
} from '../kernel/index.js';
import type { ExecutionRecord } from '../kernel/index.js';
import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import {
  insertExecution,
  listExecutions,
} from '../kernel/adapters/sqlite/history.js';
import {
  loadScanResult,
} from '../kernel/adapters/sqlite/scan-load.js';
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
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-rename-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

async function persistAndReload(
  fixture: string,
  dbPath: string,
  prior: import('../kernel/index.js').ScanResult | null = null,
): Promise<{
  result: import('../kernel/index.js').ScanResult;
  renameOps: import('../kernel/index.js').RenameOp[];
}> {
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
  return ran;
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

describe('rename heuristic — high confidence (body hash match)', () => {
  it('moves a file with identical body: NO issue, FKs migrated, state survives', async () => {
    const fixture = freshFixture('high');
    const dbPath = freshDbPath('high');

    writeFile(fixture, '.claude/skills/foo.md',
      ['---', 'name: foo', 'metadata:', '  version: 1.0.0', '---', 'Body text.'].join('\n'),
    );
    const first = await persistAndReload(fixture, dbPath);
    strictEqual(first.renameOps.length, 0, 'no renames on first scan');

    // Seed an execution row so we can verify FK migration.
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      await insertExecution(adapter.db, makeExec('e1', '.claude/skills/foo.md'));
    } finally {
      await adapter.close();
    }

    // Move the file: same body, new path.
    rmSync(join(fixture, '.claude/skills/foo.md'));
    writeFile(fixture, '.claude/skills/bar.md',
      ['---', 'name: foo', 'metadata:', '  version: 1.0.0', '---', 'Body text.'].join('\n'),
    );

    // Re-scan with prior, applying renames at persist.
    const prior = await loadFromDb(dbPath);
    const second = await persistAndReload(fixture, dbPath, prior);

    deepStrictEqual(second.renameOps, [
      { from: '.claude/skills/foo.md', to: '.claude/skills/bar.md', confidence: 'high' },
    ]);
    // No issue emitted for high-confidence rename.
    const renameIssues = second.result.issues.filter((i) =>
      i.ruleId === 'auto-rename-medium' ||
      i.ruleId === 'auto-rename-ambiguous' ||
      i.ruleId === 'orphan',
    );
    strictEqual(renameIssues.length, 0, 'no issue emitted for high-confidence');

    // FK migrated: e1.nodeIds now points at bar.md.
    const adapter2 = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter2.init();
    try {
      const rows = await listExecutions(adapter2.db);
      strictEqual(rows.length, 1);
      deepStrictEqual(rows[0]!.nodeIds, ['.claude/skills/bar.md']);
    } finally {
      await adapter2.close();
    }
  });
});

describe('rename heuristic — medium confidence (frontmatter 1:1)', () => {
  it('frontmatter match alone: emits auto-rename-medium with from/to in data, FKs migrated', async () => {
    const fixture = freshFixture('medium');
    const dbPath = freshDbPath('medium');

    writeFile(fixture, '.claude/skills/foo.md',
      ['---', 'name: foo', 'metadata:', '  version: 1.0.0', '---', 'Original body.'].join('\n'),
    );
    await persistAndReload(fixture, dbPath);

    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      await insertExecution(adapter.db, makeExec('e1', '.claude/skills/foo.md'));
    } finally {
      await adapter.close();
    }

    // Body changed, frontmatter identical, path changed.
    rmSync(join(fixture, '.claude/skills/foo.md'));
    writeFile(fixture, '.claude/skills/bar.md',
      ['---', 'name: foo', 'metadata:', '  version: 1.0.0', '---', 'Different body, same fm.'].join('\n'),
    );

    const prior = await loadFromDb(dbPath);
    const second = await persistAndReload(fixture, dbPath, prior);

    deepStrictEqual(second.renameOps, [
      { from: '.claude/skills/foo.md', to: '.claude/skills/bar.md', confidence: 'medium' },
    ]);
    const medium = second.result.issues.find((i) => i.ruleId === 'auto-rename-medium');
    ok(medium, 'auto-rename-medium issue emitted');
    deepStrictEqual(medium!.nodeIds, ['.claude/skills/bar.md']);
    deepStrictEqual(medium!.data, {
      from: '.claude/skills/foo.md',
      to: '.claude/skills/bar.md',
      confidence: 'medium',
    });

    const adapter2 = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter2.init();
    try {
      const rows = await listExecutions(adapter2.db);
      deepStrictEqual(rows[0]!.nodeIds, ['.claude/skills/bar.md']);
    } finally {
      await adapter2.close();
    }
  });
});

describe('rename heuristic — ambiguous (frontmatter N:1)', () => {
  it('two deletions share frontmatter with one new path: NO migration, ambiguous issue listing both candidates', async () => {
    const fixture = freshFixture('ambig');
    const dbPath = freshDbPath('ambig');

    // Two prior nodes, same frontmatter, different bodies.
    writeFile(fixture, '.claude/skills/a.md',
      ['---', 'name: shared', 'metadata:', '  version: 1.0.0', '---', 'Body A.'].join('\n'),
    );
    writeFile(fixture, '.claude/skills/b.md',
      ['---', 'name: shared', 'metadata:', '  version: 1.0.0', '---', 'Body B.'].join('\n'),
    );
    await persistAndReload(fixture, dbPath);

    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      await insertExecution(adapter.db, makeExec('eA', '.claude/skills/a.md'));
      await insertExecution(adapter.db, makeExec('eB', '.claude/skills/b.md'));
    } finally {
      await adapter.close();
    }

    // Delete both. Add ONE new file with same frontmatter, different body.
    rmSync(join(fixture, '.claude/skills/a.md'));
    rmSync(join(fixture, '.claude/skills/b.md'));
    writeFile(fixture, '.claude/skills/c.md',
      ['---', 'name: shared', 'metadata:', '  version: 1.0.0', '---', 'Body C, third.'].join('\n'),
    );

    const prior = await loadFromDb(dbPath);
    const second = await persistAndReload(fixture, dbPath, prior);

    strictEqual(second.renameOps.length, 0, 'no migration on ambiguity');
    const ambig = second.result.issues.find((i) => i.ruleId === 'auto-rename-ambiguous');
    ok(ambig, 'auto-rename-ambiguous emitted');
    deepStrictEqual(ambig!.nodeIds, ['.claude/skills/c.md']);
    deepStrictEqual(ambig!.data, {
      to: '.claude/skills/c.md',
      candidates: ['.claude/skills/a.md', '.claude/skills/b.md'],
    });

    // Both prior paths become orphan issues (no rename consumed them).
    const orphans = second.result.issues.filter((i) => i.ruleId === 'orphan');
    deepStrictEqual(
      orphans.map((i) => i.nodeIds[0]).sort(),
      ['.claude/skills/a.md', '.claude/skills/b.md'],
    );

    // FKs unchanged.
    const adapter2 = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter2.init();
    try {
      const rows = await listExecutions(adapter2.db);
      const eA = rows.find((r) => r.id === 'eA')!;
      const eB = rows.find((r) => r.id === 'eB')!;
      deepStrictEqual(eA.nodeIds, ['.claude/skills/a.md']);
      deepStrictEqual(eB.nodeIds, ['.claude/skills/b.md']);
    } finally {
      await adapter2.close();
    }
  });
});

describe('rename heuristic — orphan (no match)', () => {
  it('deleted file with no replacement: orphan issue, state rows untouched', async () => {
    const fixture = freshFixture('orphan');
    const dbPath = freshDbPath('orphan');

    writeFile(fixture, '.claude/skills/foo.md',
      ['---', 'name: foo', 'metadata:', '  version: 1.0.0', '---', 'Body.'].join('\n'),
    );
    writeFile(fixture, '.claude/skills/keep.md',
      ['---', 'name: keep', 'metadata:', '  version: 1.0.0', '---', 'Other.'].join('\n'),
    );
    await persistAndReload(fixture, dbPath);

    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      await insertExecution(adapter.db, makeExec('e1', '.claude/skills/foo.md'));
    } finally {
      await adapter.close();
    }

    rmSync(join(fixture, '.claude/skills/foo.md'));
    const prior = await loadFromDb(dbPath);
    const second = await persistAndReload(fixture, dbPath, prior);

    strictEqual(second.renameOps.length, 0);
    const orphan = second.result.issues.find((i) => i.ruleId === 'orphan');
    ok(orphan, 'orphan issue emitted');
    deepStrictEqual(orphan!.nodeIds, ['.claude/skills/foo.md']);
    deepStrictEqual(orphan!.data, { path: '.claude/skills/foo.md' });

    const adapter2 = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter2.init();
    try {
      const rows = await listExecutions(adapter2.db);
      // FKs intact — state still references the dead path.
      deepStrictEqual(rows[0]!.nodeIds, ['.claude/skills/foo.md']);
    } finally {
      await adapter2.close();
    }
  });
});

describe('rename heuristic — orphan persistence (Step 5.9)', () => {
  it('orphan issue persists across subsequent scans while state_* references the dead path', async () => {
    const fixture = freshFixture('orphan-persist');
    const dbPath = freshDbPath('orphan-persist');

    // 1. Seed two skills, scan, insert executions for both.
    writeFile(fixture, '.claude/skills/foo.md',
      ['---', 'name: foo', 'metadata:', '  version: 1.0.0', '---', 'Body F.'].join('\n'),
    );
    writeFile(fixture, '.claude/skills/keep.md',
      ['---', 'name: keep', 'metadata:', '  version: 1.0.0', '---', 'Body K.'].join('\n'),
    );
    await persistAndReload(fixture, dbPath);

    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      await insertExecution(adapter.db, makeExec('e1', '.claude/skills/foo.md'));
    } finally {
      await adapter.close();
    }

    // 2. Delete foo.md → first orphan-emitting scan.
    rmSync(join(fixture, '.claude/skills/foo.md'));
    const prior1 = await loadFromDb(dbPath);
    const second = await persistAndReload(fixture, dbPath, prior1);
    const orphan2 = second.result.issues.find((i) => i.ruleId === 'orphan');
    ok(orphan2, 'orphan emitted on the deletion-scan');
    deepStrictEqual(orphan2!.data, { path: '.claude/skills/foo.md' });

    // 3. Re-scan WITHOUT touching anything. The per-scan rename heuristic
    //    sees no deletion (foo.md isn't in prior anymore), but the new
    //    sweep MUST still emit orphan because state_executions still
    //    references foo.md.
    const prior2 = await loadFromDb(dbPath);
    const third = await persistAndReload(fixture, dbPath, prior2);
    const orphan3 = third.result.issues.find((i) => i.ruleId === 'orphan');
    ok(orphan3, 'orphan re-emitted on the next scan via state_* sweep');
    deepStrictEqual(orphan3!.data, { path: '.claude/skills/foo.md' });
    strictEqual(orphan3!.severity, 'info');

    // 4. Once the user reconciles (we simulate by manually rewriting the
    //    state_executions row to keep.md), the next scan sees no
    //    stranded refs and emits no orphan.
    const adapter2 = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter2.init();
    try {
      await adapter2.db
        .updateTable('state_executions')
        .set({ nodeIdsJson: JSON.stringify(['.claude/skills/keep.md']) })
        .where('id', '=', 'e1')
        .execute();
    } finally {
      await adapter2.close();
    }

    const prior3 = await loadFromDb(dbPath);
    const fourth = await persistAndReload(fixture, dbPath, prior3);
    const orphan4 = fourth.result.issues.find((i) => i.ruleId === 'orphan');
    strictEqual(orphan4, undefined, 'no orphan once state_* references only live nodes');
  });

  it('per-scan orphan and stranded sweep do not duplicate the same path', async () => {
    const fixture = freshFixture('orphan-no-dup');
    const dbPath = freshDbPath('orphan-no-dup');

    writeFile(fixture, '.claude/skills/foo.md',
      ['---', 'name: foo', 'metadata:', '  version: 1.0.0', '---', 'Body.'].join('\n'),
    );
    writeFile(fixture, '.claude/skills/keep.md',
      ['---', 'name: keep', 'metadata:', '  version: 1.0.0', '---', 'Body.'].join('\n'),
    );
    await persistAndReload(fixture, dbPath);
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      await insertExecution(adapter.db, makeExec('e1', '.claude/skills/foo.md'));
    } finally {
      await adapter.close();
    }

    rmSync(join(fixture, '.claude/skills/foo.md'));
    const prior = await loadFromDb(dbPath);
    const second = await persistAndReload(fixture, dbPath, prior);
    // Per-scan emits orphan(foo.md). Stranded sweep also sees foo.md,
    // but knownOrphanPaths must dedup. Result: exactly 1 orphan issue.
    const orphans = second.result.issues.filter((i) => i.ruleId === 'orphan');
    strictEqual(orphans.length, 1, 'no duplicate orphan for the same path');
  });
});

describe('rename heuristic — invariants', () => {
  it('body match wins over frontmatter match', async () => {
    const fixture = freshFixture('body-vs-fm');
    const dbPath = freshDbPath('body-vs-fm');

    // Two prior files: deletedA has body X + fm Y; deletedB has body Z + fm Y.
    // Two new files: newA has body X + fm W; newB has body Q + fm Y.
    // Body match: deletedA <-> newA (body X). Frontmatter match: deletedA/B
    // share fm Y with newB.
    // Expected: deletedA → newA (high). deletedB → newB (medium, since
    // deletedB's fm-Y matches newB after the high pass consumed deletedA).
    writeFile(fixture, '.claude/skills/del-a.md',
      ['---', 'name: shared-fm', 'metadata:', '  version: 1.0.0', '---', 'Body X.'].join('\n'),
    );
    writeFile(fixture, '.claude/skills/del-b.md',
      ['---', 'name: shared-fm', 'metadata:', '  version: 1.0.0', '---', 'Body Z.'].join('\n'),
    );
    await persistAndReload(fixture, dbPath);
    const prior = await loadFromDb(dbPath);

    rmSync(join(fixture, '.claude/skills/del-a.md'));
    rmSync(join(fixture, '.claude/skills/del-b.md'));
    writeFile(fixture, '.claude/skills/new-a.md',
      ['---', 'name: different-fm', 'metadata:', '  version: 1.0.0', '---', 'Body X.'].join('\n'),
    );
    writeFile(fixture, '.claude/skills/new-b.md',
      ['---', 'name: shared-fm', 'metadata:', '  version: 1.0.0', '---', 'Body Q.'].join('\n'),
    );

    const second = await persistAndReload(fixture, dbPath, prior);
    const ops = second.renameOps.map((o) => ({ from: o.from, to: o.to, confidence: o.confidence }));
    // High wins for the body-X pair; medium claims the remaining fm-Y pair.
    deepStrictEqual(ops, [
      { from: '.claude/skills/del-a.md', to: '.claude/skills/new-a.md', confidence: 'high' },
      { from: '.claude/skills/del-b.md', to: '.claude/skills/new-b.md', confidence: 'medium' },
    ]);
  });

  it('1-to-1 matching: a single deletion does not claim multiple new paths', async () => {
    // One deletion, two news with identical body. Lex-asc order: the
    // smaller-named newPath claims the deletion; the other becomes a
    // brand-new node (no rename).
    const fixture = freshFixture('one-to-one');
    const dbPath = freshDbPath('one-to-one');

    writeFile(fixture, '.claude/skills/orig.md',
      ['---', 'name: o', 'metadata:', '  version: 1.0.0', '---', 'IDENTICAL.'].join('\n'),
    );
    await persistAndReload(fixture, dbPath);
    const prior = await loadFromDb(dbPath);

    rmSync(join(fixture, '.claude/skills/orig.md'));
    writeFile(fixture, '.claude/skills/aaa.md',
      ['---', 'name: o', 'metadata:', '  version: 1.0.0', '---', 'IDENTICAL.'].join('\n'),
    );
    writeFile(fixture, '.claude/skills/zzz.md',
      ['---', 'name: o', 'metadata:', '  version: 1.0.0', '---', 'IDENTICAL.'].join('\n'),
    );

    const second = await persistAndReload(fixture, dbPath, prior);
    strictEqual(second.renameOps.length, 1);
    // newPath iterated lex-asc: aaa wins.
    strictEqual(second.renameOps[0]!.to, '.claude/skills/aaa.md');
    strictEqual(second.renameOps[0]!.confidence, 'high');
  });
});

// ---------------------------------------------------------------------------

async function loadFromDb(dbPath: string): Promise<import('../kernel/index.js').ScanResult> {
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    return await loadScanResult(adapter.db);
  } finally {
    await adapter.close();
  }
}
