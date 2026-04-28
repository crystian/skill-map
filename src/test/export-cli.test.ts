/**
 * Step 8.3 acceptance tests for `sm export <query> --format <json|md|mermaid>`.
 *
 * Mirrors the per-handler pattern in `scan-readers.test.ts` and
 * `graph-cli.test.ts`. Two suites:
 *
 *   1. **`parseExportQuery` unit tests** — pure parsing, no fixtures.
 *      Cheaper to run + tighter feedback when grammar errors regress.
 *   2. **CLI handler tests** — fixture + DB + ExportCommand.execute().
 *      Cover format dispatch, filter semantics on real scan output,
 *      and exit-code contract.
 */

import { after, before, describe, it } from 'node:test';
import { deepStrictEqual, match, ok, strictEqual, throws } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BaseContext } from 'clipanion';

import { ExportCommand } from '../cli/commands/export.js';
import { applyExportQuery, ExportQueryError, parseExportQuery } from '../kernel/scan/query.js';
import { createKernel, runScan } from '../kernel/index.js';
import type { Issue, Link, Node, NodeKind } from '../kernel/types.js';
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

function plantMixedFixture(root: string): void {
  writeFixtureFile(
    root,
    '.claude/agents/architect.md',
    [
      '---',
      'name: architect',
      'description: The architect',
      '---',
      'Run /deploy or /unknown.',
    ].join('\n'),
  );
  writeFixtureFile(
    root,
    '.claude/commands/deploy.md',
    [
      '---',
      'name: deploy',
      'description: Deploy command',
      '---',
      'Deploy body.',
    ].join('\n'),
  );
  writeFixtureFile(
    root,
    '.claude/commands/rollback.md',
    [
      '---',
      'name: rollback',
      'description: Rollback command',
      '---',
      'See @architect.',
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

interface IExportOverrides {
  query: string;
  format?: string | undefined;
  db?: string | undefined;
  global?: boolean;
}

function buildExport(overrides: IExportOverrides): ExportCommand {
  const cmd = new ExportCommand();
  cmd.query = overrides.query;
  cmd.format = overrides.format;
  cmd.global = overrides.global ?? false;
  cmd.db = overrides.db;
  return cmd;
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-export-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ===========================================================================
// 1. parseExportQuery + applyExportQuery (pure, no IO)
// ===========================================================================

describe('parseExportQuery', () => {
  it('empty / whitespace-only query → no filters', () => {
    deepStrictEqual(parseExportQuery(''), { raw: '' });
    deepStrictEqual(parseExportQuery('   '), { raw: '' });
  });

  it('parses kind=skill', () => {
    const q = parseExportQuery('kind=skill');
    deepStrictEqual(q, { raw: 'kind=skill', kinds: ['skill'] });
  });

  it('parses kind=skill,agent (multi-value OR)', () => {
    const q = parseExportQuery('kind=skill,agent');
    deepStrictEqual(q.kinds, ['skill', 'agent']);
  });

  it('parses has=issues', () => {
    const q = parseExportQuery('has=issues');
    strictEqual(q.hasIssues, true);
  });

  it('parses path globs', () => {
    const q = parseExportQuery('path=.claude/commands/**');
    deepStrictEqual(q.pathGlobs, ['.claude/commands/**']);
  });

  it('combines multiple keys (whitespace-separated)', () => {
    const q = parseExportQuery('kind=skill,agent has=issues path=foo/*');
    deepStrictEqual(q.kinds, ['skill', 'agent']);
    strictEqual(q.hasIssues, true);
    deepStrictEqual(q.pathGlobs, ['foo/*']);
  });

  it('rejects unknown key', () => {
    throws(() => parseExportQuery('weight>5'), ExportQueryError);
    throws(() => parseExportQuery('confidence=high'), /unknown key "confidence"/);
  });

  it('rejects unknown kind value', () => {
    throws(() => parseExportQuery('kind=widget'), /not a valid node kind/);
  });

  it('rejects unknown has value', () => {
    throws(() => parseExportQuery('has=findings'), /has="findings" is not supported/);
  });

  it('rejects malformed token (no =)', () => {
    throws(() => parseExportQuery('skill'), /expected key=value/);
  });

  it('rejects empty value list (key=)', () => {
    throws(() => parseExportQuery('kind='), /expected key=value/);
  });

  it('rejects duplicate key', () => {
    throws(() => parseExportQuery('kind=skill kind=agent'), /appears more than once/);
  });
});

describe('applyExportQuery', () => {
  // Synthetic mini-graph; faster than spinning up runScan for the
  // semantic tests where we just need predictable shapes.
  const nodes: Node[] = [
    mkNode('a/skill1.md', 'skill'),
    mkNode('a/skill2.md', 'skill'),
    mkNode('b/agent1.md', 'agent'),
    mkNode('c/cmd1.md', 'command'),
  ];
  const links: Link[] = [
    mkLink('a/skill1.md', 'b/agent1.md', 'mentions'),
    mkLink('a/skill1.md', 'c/cmd1.md', 'invokes'),
    mkLink('b/agent1.md', 'c/cmd1.md', 'invokes'),
  ];
  const issues: Issue[] = [
    mkIssue('rule-x', ['a/skill1.md']),
    mkIssue('rule-y', ['c/cmd1.md', 'b/agent1.md']),
  ];

  it('empty query → all nodes / links / issues', () => {
    const out = applyExportQuery({ nodes, links, issues }, parseExportQuery(''));
    strictEqual(out.nodes.length, 4);
    strictEqual(out.links.length, 3);
    strictEqual(out.issues.length, 2);
  });

  it('kind=skill → only skill nodes; links restricted to closed subgraph', () => {
    const out = applyExportQuery({ nodes, links, issues }, parseExportQuery('kind=skill'));
    deepStrictEqual(
      out.nodes.map((n) => n.path).sort(),
      ['a/skill1.md', 'a/skill2.md'],
    );
    // Both endpoints must be in the filtered set; no link between two skills exists → 0.
    strictEqual(out.links.length, 0);
    // Issue with rule-x touches a/skill1.md → kept.
    strictEqual(out.issues.length, 1);
    strictEqual(out.issues[0]!.ruleId, 'rule-x');
  });

  it('has=issues → only nodes that appear in some issue', () => {
    const out = applyExportQuery({ nodes, links, issues }, parseExportQuery('has=issues'));
    deepStrictEqual(
      out.nodes.map((n) => n.path).sort(),
      ['a/skill1.md', 'b/agent1.md', 'c/cmd1.md'],
    );
  });

  it('path=a/* → only top-level under a/', () => {
    const out = applyExportQuery({ nodes, links, issues }, parseExportQuery('path=a/*'));
    deepStrictEqual(
      out.nodes.map((n) => n.path).sort(),
      ['a/skill1.md', 'a/skill2.md'],
    );
  });

  it('path=a/** matches the same as a/* when no nested files exist', () => {
    const out = applyExportQuery({ nodes, links, issues }, parseExportQuery('path=a/**'));
    deepStrictEqual(out.nodes.map((n) => n.path).sort(), ['a/skill1.md', 'a/skill2.md']);
  });

  it('kind=skill has=issues → AND across keys', () => {
    const out = applyExportQuery({ nodes, links, issues }, parseExportQuery('kind=skill has=issues'));
    deepStrictEqual(out.nodes.map((n) => n.path), ['a/skill1.md']);
  });

  it('issues survive when ANY of their nodeIds is in scope', () => {
    // rule-y touches c/cmd1.md AND b/agent1.md. Filter to just b/* — issue
    // should still appear because b/agent1.md is in scope.
    const out = applyExportQuery({ nodes, links, issues }, parseExportQuery('path=b/*'));
    strictEqual(out.nodes.length, 1);
    const ruleIds = out.issues.map((i) => i.ruleId).sort();
    deepStrictEqual(ruleIds, ['rule-y']);
  });
});

// ===========================================================================
// 2. ExportCommand handler tests (fixture + DB)
// ===========================================================================

describe('sm export', () => {
  it('default --format json on empty query exports the whole graph', async () => {
    const fixture = freshFixture('export-json-all');
    plantMixedFixture(fixture);
    const dbPath = freshDbPath('export-json-all');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildExport({ query: '', db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    const payload = JSON.parse(cap.stdout()) as Record<string, unknown>;
    strictEqual(payload['query'], '');
    const counts = payload['counts'] as Record<string, number>;
    strictEqual(counts['nodes'], 3);
    ok(Array.isArray(payload['nodes']));
    ok(Array.isArray(payload['links']));
    ok(Array.isArray(payload['issues']));
  });

  it('--format json + kind=command filters to commands only', async () => {
    const fixture = freshFixture('export-cmd');
    plantMixedFixture(fixture);
    const dbPath = freshDbPath('export-cmd');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildExport({ query: 'kind=command', db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0);
    const payload = JSON.parse(cap.stdout()) as { nodes: Node[]; counts: { nodes: number } };
    strictEqual(payload.counts.nodes, 2);
    ok(payload.nodes.every((n) => n.kind === 'command'));
  });

  it('--format md renders a markdown report', async () => {
    const fixture = freshFixture('export-md');
    plantMixedFixture(fixture);
    const dbPath = freshDbPath('export-md');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildExport({ query: 'kind=command', format: 'md', db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0);
    const out = cap.stdout();
    match(out, /^# skill-map export/);
    match(out, /Query: `kind=command`/);
    match(out, /## command \(2\)/);
    match(out, /\.claude\/commands\/deploy\.md/);
  });

  it('--format mermaid → exit 5 with Step 12 pointer', async () => {
    const fixture = freshFixture('export-mermaid');
    plantMixedFixture(fixture);
    const dbPath = freshDbPath('export-mermaid');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildExport({ query: '', format: 'mermaid', db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 5);
    match(cap.stderr(), /format=mermaid not yet implemented/);
    match(cap.stderr(), /Step 12/);
  });

  it('unsupported format → exit 5 with available list', async () => {
    const fixture = freshFixture('export-bogus-format');
    plantMixedFixture(fixture);
    const dbPath = freshDbPath('export-bogus-format');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildExport({ query: '', format: 'xml', db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 5);
    match(cap.stderr(), /Unsupported format: xml/);
    match(cap.stderr(), /Supported: json, md/);
  });

  it('invalid query → exit 5 with parser hint', async () => {
    const fixture = freshFixture('export-bad-query');
    plantMixedFixture(fixture);
    const dbPath = freshDbPath('export-bad-query');
    await primeDb(fixture, dbPath);

    const cap = captureContext();
    const cmd = buildExport({ query: 'kind=widget', db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 5);
    match(cap.stderr(), /not a valid node kind/);
  });

  it('missing DB → exit 5', async () => {
    const dbPath = freshDbPath('export-missing');

    const cap = captureContext();
    const cmd = buildExport({ query: '', db: dbPath });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 5);
    match(cap.stderr(), /DB not found/);
  });
});

// --- helpers ---------------------------------------------------------------

function mkNode(path: string, kind: NodeKind): Node {
  return {
    path,
    kind,
    adapter: 'claude',
    bodyHash: 'b',
    frontmatterHash: 'f',
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

function mkLink(source: string, target: string, kind: Link['kind']): Link {
  return {
    source,
    target,
    kind,
    confidence: 'high',
    sources: ['test'],
  };
}

function mkIssue(ruleId: string, nodeIds: string[]): Issue {
  return {
    ruleId,
    severity: 'warn',
    nodeIds,
    message: `${ruleId} on ${nodeIds.join(',')}`,
  };
}
