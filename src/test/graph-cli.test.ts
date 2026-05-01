/**
 * Step 8.1 acceptance tests for `sm graph`. Mirrors the per-handler
 * pattern in `scan-readers.test.ts`: instantiate the Command class,
 * stub Clipanion's context, call `execute()` directly. Each test builds
 * a fresh fixture + DB via `mkdtempSync` (no `:memory:` — see
 * `feedback_sqlite_in_memory_workaround.md`).
 *
 * Coverage:
 *   - default `--format ascii` renders the persisted graph (happy path).
 *   - explicit `--format ascii` matches the same output as the default.
 *   - unknown `--format mermaid` exits 2 with a clear stderr listing
 *     the available formats.
 *   - missing DB exits 5 (delegated to `assertDbExists`).
 *   - empty DB (migrated but never scanned) renders the zero-graph and
 *     exits 0 — graph is a read-side reporter, not a guard.
 */

import { after, before, describe, it } from 'node:test';
import { match, ok, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BaseContext } from 'clipanion';

import { GraphCommand } from '../cli/commands/graph.js';
import { createKernel, runScan } from '../kernel/index.js';
import { builtIns, listBuiltIns } from '../extensions/built-ins.js';
import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../kernel/adapters/sqlite/scan-persistence.js';

// --- shared scaffolding ----------------------------------------------------

let tmpRoot: string;
let counter = 0;

function freshDbPath(label: string): string {
  counter += 1;
  return join(tmpRoot, `${label}-${counter}.db`);
}

function freshFixture(label: string): string {
  counter += 1;
  return mkdtempSync(join(tmpRoot, `${label}-${counter}-`));
}

function writeFixtureFile(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

function plantTinyFixture(root: string): void {
  writeFixtureFile(
    root,
    '.claude/agents/architect.md',
    [
      '---',
      'name: architect',
      'description: The architect',
      '---',
      'Run /deploy.',
    ].join('\n'),
  );
  writeFixtureFile(
    root,
    '.claude/commands/deploy.md',
    [
      '---',
      'name: deploy',
      'description: Deploy command.',
      '---',
      'Deploy body.',
    ].join('\n'),
  );
}

async function primeDb(fixture: string, dbPath: string): Promise<void> {
  const kernel = createKernel();
  for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
  const result = await runScan(kernel, {
    roots: [fixture],
    extensions: builtIns(),
  });
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await persistScanResult(adapter.db, result);
  } finally {
    await adapter.close();
  }
}

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

interface IGraphOverrides {
  format?: string;
  db?: string | undefined;
  global?: boolean;
}

function buildGraph(overrides: IGraphOverrides = {}): GraphCommand {
  const cmd = new GraphCommand();
  cmd.format = overrides.format ?? 'ascii';
  cmd.global = overrides.global ?? false;
  cmd.db = overrides.db;
  return cmd;
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-graph-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// --- happy paths -----------------------------------------------------------

describe('sm graph', () => {
  it('default --format ascii renders the persisted graph (happy path)', async () => {
    const fixture = freshFixture('graph-ascii');
    plantTinyFixture(fixture);
    const dbPath = freshDbPath('graph-ascii');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildGraph({ db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    const out = cap.stdout();
    match(out, /skill-map graph — 2 nodes, \d+ links, \d+ issues/);
    ok(out.includes('## agent (1)'), `agent section missing:\n${out}`);
    ok(out.includes('## command (1)'), `command section missing:\n${out}`);
    ok(out.includes('.claude/agents/architect.md'));
    ok(out.includes('.claude/commands/deploy.md'));
    // Trailing newline normalisation: the verb appends \n if the formatter
    // didn't, so output is always newline-terminated for safe piping.
    ok(out.endsWith('\n'), `output should end with \\n, got: ${JSON.stringify(out.slice(-3))}`);
  });

  it('explicit --format ascii matches the default', async () => {
    const fixture = freshFixture('graph-ascii-explicit');
    plantTinyFixture(fixture);
    const dbPath = freshDbPath('graph-ascii-explicit');
    await primeDb(fixture, dbPath);

    const capDefault = captureContext();
    const cmdDefault = buildGraph({ db: dbPath });
    cmdDefault.context = capDefault.context;
    await cmdDefault.execute();

    const capExplicit = captureContext();
    const cmdExplicit = buildGraph({ db: dbPath, format: 'ascii' });
    cmdExplicit.context = capExplicit.context;
    await cmdExplicit.execute();

    strictEqual(capDefault.stdout(), capExplicit.stdout(), 'default and explicit ascii must produce identical output');
  });

  // --- error paths ---------------------------------------------------------

  it('unknown --format mermaid exits 2 with a clear hint', async () => {
    const fixture = freshFixture('graph-unknown');
    plantTinyFixture(fixture);
    const dbPath = freshDbPath('graph-unknown');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildGraph({ db: dbPath, format: 'mermaid' });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 2, `unexpected exit ${code}; stdout=${cap.stdout()}`);
    match(cap.stderr(), /No formatter registered for format=mermaid/);
    match(cap.stderr(), /Available: ascii/);
  });

  it('missing DB exits 5 with the standard "DB not found" hint', async () => {
    const dbPath = freshDbPath('graph-missing');
    // Intentionally do NOT prime the DB.

    const cap = captureContext();
    const cmd = buildGraph({ db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 5);
    match(cap.stderr(), /DB not found/);
  });

  it('empty DB (migrated but never scanned) renders zero-graph and exits 0', async () => {
    const dbPath = freshDbPath('graph-empty');
    // Migrate but leave scan_* empty.
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    await adapter.close();

    const cap = captureContext();
    const cmd = buildGraph({ db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    match(cap.stdout(), /skill-map graph — 0 nodes, 0 links, 0 issues/);
  });
});
