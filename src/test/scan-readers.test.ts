/**
 * Step 4.5 acceptance tests for `sm list`, `sm show`, `sm check` — the
 * read-side commands that query the persisted scan snapshot.
 *
 * Tests instantiate each Command class directly and call `execute()` with
 * a mocked Clipanion-like context, mirroring the pattern used by
 * `cli.test.ts` for `sm scan`. We avoid spawning child processes here —
 * the real-CLI integration is exercised by the existing `cli.test.ts`
 * file; this test focuses on handler behavior at the per-flag level.
 *
 * Each `it` builds a fresh fixture + DB via `mkdtempSync` (no `:memory:`
 * — see `feedback_sqlite_in_memory_workaround.md`) and primes the DB by
 * driving the orchestrator + `persistScanResult`, the exact path the
 * real `sm scan` takes.
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, deepStrictEqual, match } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BaseContext } from 'clipanion';

import { CheckCommand } from '../cli/commands/check.js';
import { ListCommand } from '../cli/commands/list.js';
import { ScanCommand } from '../cli/commands/scan.js';
import { ShowCommand } from '../cli/commands/show.js';
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

function plantClaudeFixture(root: string): void {
  // Same shape as scan-e2e.test.ts — three nodes, multiple link kinds,
  // broken-ref + superseded issues. Keeps the surface representative
  // without inventing new edge cases the rest of the suite already covers.
  writeFixtureFile(
    root,
    '.claude/agents/architect.md',
    [
      '---',
      'name: architect',
      'description: The architect',
      'metadata:',
      '  version: 1.0.0',
      '  related:',
      '    - .claude/commands/deploy.md',
      '---',
      '',
      'Run /deploy or /unknown, consult @backend-lead.',
    ].join('\n'),
  );
  writeFixtureFile(
    root,
    '.claude/commands/deploy.md',
    [
      '---',
      'name: deploy',
      'description: Deploy',
      'metadata:',
      '  version: 1.0.0',
      '  supersededBy: .claude/commands/deploy-v2.md',
      '---',
      'Deploy body.',
    ].join('\n'),
  );
  writeFixtureFile(
    root,
    '.claude/commands/rollback.md',
    ['---', 'name: Rollback', '---', 'Rollback body.'].join('\n'),
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

/**
 * Reset every Clipanion `Option.*` field on a freshly-instantiated Command
 * to its at-rest default. Without this, the bare property holds an
 * internal Option descriptor (Clipanion only resolves it during
 * `cli.run()`); calling `execute()` directly then sees the descriptor
 * and the `--sort-by`-validation path treats it as an invalid value.
 */

interface IListOverrides {
  db?: string | undefined;
  global?: boolean;
  kind?: string | undefined;
  issue?: boolean;
  sortBy?: string | undefined;
  limit?: string | undefined;
  json?: boolean;
}

function buildList(overrides: IListOverrides = {}): ListCommand {
  const cmd = new ListCommand();
  cmd.global = overrides.global ?? false;
  cmd.db = overrides.db;
  cmd.kind = overrides.kind;
  cmd.issue = overrides.issue ?? false;
  cmd.sortBy = overrides.sortBy;
  cmd.limit = overrides.limit;
  cmd.json = overrides.json ?? false;
  return cmd;
}

interface IShowOverrides {
  nodePath: string;
  db?: string | undefined;
  global?: boolean;
  json?: boolean;
}

function buildShow(overrides: IShowOverrides): ShowCommand {
  const cmd = new ShowCommand();
  cmd.global = overrides.global ?? false;
  cmd.db = overrides.db;
  cmd.json = overrides.json ?? false;
  cmd.nodePath = overrides.nodePath;
  return cmd;
}

interface ICheckOverrides {
  db?: string | undefined;
  global?: boolean;
  json?: boolean;
}

function buildCheck(overrides: ICheckOverrides = {}): CheckCommand {
  const cmd = new CheckCommand();
  cmd.global = overrides.global ?? false;
  cmd.db = overrides.db;
  cmd.json = overrides.json ?? false;
  return cmd;
}

interface IScanOverrides {
  roots?: string[];
  json?: boolean;
  noBuiltIns?: boolean;
  noTokens?: boolean;
  dryRun?: boolean;
  changed?: boolean;
}

function buildScan(overrides: IScanOverrides = {}): ScanCommand {
  const cmd = new ScanCommand();
  cmd.roots = overrides.roots ?? [];
  cmd.json = overrides.json ?? false;
  cmd.noBuiltIns = overrides.noBuiltIns ?? false;
  cmd.noTokens = overrides.noTokens ?? false;
  cmd.dryRun = overrides.dryRun ?? false;
  cmd.changed = overrides.changed ?? false;
  return cmd;
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-readers-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// --- list ------------------------------------------------------------------

describe('sm list', () => {
  it('empty DB → exit 0, prints "No nodes found." (human)', async () => {
    const dbPath = freshDbPath('list-empty');
    // Migrate but leave scan_* empty.
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    await adapter.close();

    const cap = captureContext();
    const cmd = buildList({ db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    match(cap.stdout(), /No nodes found\./);
  });

  it('3 nodes → table has 3 data rows', async () => {
    const fixture = freshFixture('list-three');
    plantClaudeFixture(fixture);
    const dbPath = freshDbPath('list-three');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildList({ db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    const lines = cap.stdout().trimEnd().split('\n');
    // header + separator + 3 data rows
    strictEqual(lines.length, 5, `expected 5 lines, got ${lines.length}: ${cap.stdout()}`);
    ok(lines[0]!.includes('PATH'));
    ok(cap.stdout().includes('.claude/agents/architect.md'));
    ok(cap.stdout().includes('.claude/commands/deploy.md'));
    ok(cap.stdout().includes('.claude/commands/rollback.md'));
  });

  it('--kind agent → only agent rows', async () => {
    const fixture = freshFixture('list-kind');
    plantClaudeFixture(fixture);
    const dbPath = freshDbPath('list-kind');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildList({ db: dbPath, kind: 'agent' });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    const lines = cap.stdout().trimEnd().split('\n');
    strictEqual(lines.length, 3, `expected 3 lines (header + sep + 1 row), got: ${cap.stdout()}`);
    ok(cap.stdout().includes('.claude/agents/architect.md'));
    ok(!cap.stdout().includes('.claude/commands/deploy.md'));
  });

  it('--issue → only nodes touched by an issue', async () => {
    const fixture = freshFixture('list-issue');
    plantClaudeFixture(fixture);
    const dbPath = freshDbPath('list-issue');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildList({ db: dbPath, issue: true });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    // architect (broken-ref ×2) and deploy (superseded). rollback has no issues.
    ok(cap.stdout().includes('.claude/agents/architect.md'));
    ok(cap.stdout().includes('.claude/commands/deploy.md'));
    ok(!cap.stdout().includes('.claude/commands/rollback.md'));
  });

  it('--sort-by bytes_total --limit 1 → 1 row, the largest', async () => {
    const fixture = freshFixture('list-sort');
    plantClaudeFixture(fixture);
    const dbPath = freshDbPath('list-sort');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildList({ db: dbPath, sortBy: 'bytes_total', limit: '1' });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    const lines = cap.stdout().trimEnd().split('\n');
    strictEqual(lines.length, 3, `expected 3 lines (header + sep + 1 row), got: ${cap.stdout()}`);
    // Architect is the largest fixture (162 bytes vs 118 vs 29).
    ok(cap.stdout().includes('.claude/agents/architect.md'));
    ok(!cap.stdout().includes('.claude/commands/rollback.md'));
  });

  it('--sort-by malicious-string → exit 2, stderr names the field', async () => {
    const dbPath = freshDbPath('list-sort-bad');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    await adapter.close();

    const cap = captureContext();
    const cmd = buildList({ db: dbPath, sortBy: 'malicious; DROP TABLE' });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 2);
    match(cap.stderr(), /invalid sort field/);
    match(cap.stderr(), /malicious/);
  });

  it('--json → array of nodes whose length matches the row count', async () => {
    const fixture = freshFixture('list-json');
    plantClaudeFixture(fixture);
    const dbPath = freshDbPath('list-json');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildList({ db: dbPath, json: true });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    const parsed = JSON.parse(cap.stdout()) as Array<{ path: string; kind: string }>;
    ok(Array.isArray(parsed));
    strictEqual(parsed.length, 3);
    const paths = parsed.map((n) => n.path).sort();
    deepStrictEqual(paths, [
      '.claude/agents/architect.md',
      '.claude/commands/deploy.md',
      '.claude/commands/rollback.md',
    ]);
  });
});

// --- show ------------------------------------------------------------------

describe('sm show', () => {
  it('existing path → human output covers kind, links, issues sections', async () => {
    const fixture = freshFixture('show-existing');
    plantClaudeFixture(fixture);
    const dbPath = freshDbPath('show-existing');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildShow({ db: dbPath, nodePath: '.claude/agents/architect.md' });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    const out = cap.stdout();
    match(out, /\[agent\]/);
    match(out, /Weight: bytes/);
    match(out, /Links out \(\d+\)/);
    match(out, /Links in \(\d+\)/);
    match(out, /Issues \(\d+\)/);
    // architect emits ≥3 outbound links (frontmatter related + slash + at).
    ok(out.includes('.claude/commands/deploy.md'), 'frontmatter related shown');
    ok(out.includes('@backend-lead'), 'at-handle mention shown');
    ok(out.includes('broken-ref'), 'broken-ref issue shown');
  });

  it('missing path → exit 5, stderr "Node not found: <path>"', async () => {
    const fixture = freshFixture('show-missing');
    plantClaudeFixture(fixture);
    const dbPath = freshDbPath('show-missing');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildShow({ db: dbPath, nodePath: 'does/not/exist.md' });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 5);
    match(cap.stderr(), /Node not found: does\/not\/exist\.md/);
  });

  it('human output reports External refs > 0 after the Weight section', async () => {
    // A node with an http(s) link in its body raises externalRefsCount.
    // The Weight section is followed by the new "External refs: <N>" line.
    const fixture = freshFixture('show-ext');
    writeFixtureFile(
      fixture,
      '.claude/agents/links.md',
      [
        '---',
        'name: links',
        '---',
        '',
        'See https://example.com and https://example.com/path.',
      ].join('\n'),
    );
    const dbPath = freshDbPath('show-ext');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildShow({ db: dbPath, nodePath: '.claude/agents/links.md' });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    match(cap.stdout(), /External refs: 2/);
  });

  it('human output reports External refs: 0 honestly (no body links)', async () => {
    const fixture = freshFixture('show-ext-zero');
    writeFixtureFile(
      fixture,
      '.claude/agents/quiet.md',
      ['---', 'name: quiet', '---', '', 'No external links here.'].join('\n'),
    );
    const dbPath = freshDbPath('show-ext-zero');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildShow({ db: dbPath, nodePath: '.claude/agents/quiet.md' });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    match(cap.stdout(), /External refs: 0/);
  });

  it('--json → object with node/linksOut/linksIn/issues, findings:[] summary:null', async () => {
    const fixture = freshFixture('show-json');
    plantClaudeFixture(fixture);
    const dbPath = freshDbPath('show-json');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildShow({ db: dbPath, json: true, nodePath: '.claude/agents/architect.md' });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    const parsed = JSON.parse(cap.stdout()) as Record<string, unknown>;
    ok(parsed['node'], 'node present');
    ok(Array.isArray(parsed['linksOut']), 'linksOut is array');
    ok(Array.isArray(parsed['linksIn']), 'linksIn is array');
    ok(Array.isArray(parsed['issues']), 'issues is array');
    deepStrictEqual(parsed['findings'], [], 'findings reserved as []');
    strictEqual(parsed['summary'], null, 'summary reserved as null');
  });
});

// --- scan ------------------------------------------------------------------
//
// Exit-code contract for `sm scan` (per spec/cli-contract.md §Exit codes,
// mirrored from `sm check`): exit 1 only when an issue at severity `error`
// exists; warns / infos do not fail the verb.

describe('sm scan exit code', () => {
  it('warn / info issues only → exit 0', async () => {
    // The default fixture only emits warn (broken-ref) and info (superseded)
    // issues — exactly the case where the OLD `issuesCount > 0` rule
    // incorrectly returned 1.
    const fixture = freshFixture('scan-warns');
    plantClaudeFixture(fixture);

    const cap = captureContext();
    const cmd = buildScan({ roots: [fixture], dryRun: true, json: true });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `expected exit 0 with no error-severity issues, got ${code}; stderr=${cap.stderr()}`);
    const result = JSON.parse(cap.stdout()) as { issues: Array<{ severity: string }> };
    ok(result.issues.length > 0, 'fixture should yield at least one warn/info issue');
    ok(
      !result.issues.some((i) => i.severity === 'error'),
      'precondition: no error-severity issues in this fixture',
    );
  });

  it('error-severity issue present → exit 1', async () => {
    // Two nodes both invoke a slash trigger that normalises to the same
    // command but with different `target` (`/Foo` vs `/foo`). The
    // trigger-collision rule fires at severity `error`.
    const fixture = freshFixture('scan-error');
    writeFixtureFile(
      fixture,
      '.claude/agents/a.md',
      ['---', 'name: a', '---', '', 'Run /Foo here.'].join('\n'),
    );
    writeFixtureFile(
      fixture,
      '.claude/agents/b.md',
      ['---', 'name: b', '---', '', 'Run /foo here.'].join('\n'),
    );

    const cap = captureContext();
    const cmd = buildScan({ roots: [fixture], dryRun: true, json: true });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 1, `expected exit 1 with error-severity issue, got ${code}; stderr=${cap.stderr()}`);
    const result = JSON.parse(cap.stdout()) as { issues: Array<{ severity: string; ruleId: string }> };
    ok(
      result.issues.some((i) => i.severity === 'error' && i.ruleId === 'trigger-collision'),
      'fixture must yield trigger-collision at error severity',
    );
  });
});

// --- check -----------------------------------------------------------------

describe('sm check', () => {
  it('empty DB → exit 0, "No issues."', async () => {
    const dbPath = freshDbPath('check-empty');
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    await adapter.close();

    const cap = captureContext();
    const cmd = buildCheck({ db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    match(cap.stdout(), /No issues\./);
  });

  it('mixed-severity issues with no error-severity → exit 0', async () => {
    // The built-in fixture only emits warn + info severities (broken-ref +
    // superseded). Confirm the verb returns 0 in that case.
    const fixture = freshFixture('check-warns');
    plantClaudeFixture(fixture);
    const dbPath = freshDbPath('check-warns');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildCheck({ db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `expected exit 0 with no error-severity issues, got ${code}`);
    match(cap.stdout(), /\[warn\] broken-ref/);
  });

  it('error-severity issue present → exit 1', async () => {
    // Manufacture an error-severity issue via direct insert. The built-in
    // rules in this Step never emit `error`, so we synthesise one to
    // exercise the contract boundary explicitly.
    const fixture = freshFixture('check-error');
    plantClaudeFixture(fixture);
    const dbPath = freshDbPath('check-error');
    await primeDb(fixture, dbPath);

    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      await adapter.db
        .insertInto('scan_issues')
        .values({
          ruleId: 'synthetic-error',
          severity: 'error',
          nodeIdsJson: JSON.stringify(['.claude/agents/architect.md']),
          linkIndicesJson: null,
          message: 'Synthetic error for the check exit-code test.',
          detail: null,
          fixJson: null,
          dataJson: null,
        })
        .execute();
    } finally {
      await adapter.close();
    }

    const cap = captureContext();
    const cmd = buildCheck({ db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 1);
    match(cap.stdout(), /\[error\] synthetic-error/);
  });

  it('--json → array of Issue objects with the right keys', async () => {
    const fixture = freshFixture('check-json');
    plantClaudeFixture(fixture);
    const dbPath = freshDbPath('check-json');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildCheck({ db: dbPath, json: true });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    const parsed = JSON.parse(cap.stdout()) as Array<Record<string, unknown>>;
    ok(Array.isArray(parsed));
    ok(parsed.length > 0, 'fixture should yield at least one issue');
    for (const issue of parsed) {
      ok('ruleId' in issue);
      ok('severity' in issue);
      ok('nodeIds' in issue);
      ok('message' in issue);
    }
  });
});
