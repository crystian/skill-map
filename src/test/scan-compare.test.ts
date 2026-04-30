/**
 * Acceptance tests for `sm scan compare-with <dump> [roots...]`.
 *
 * Step 8.2 originally shipped this surface as `sm scan --compare-with
 * <dump>`. M1 (pre-1.0 review) split it out into its own sub-verb
 * (`ScanCompareCommand`); the flag form no longer exists. The tests
 * below were migrated wholesale — the underlying delta logic and exit
 * codes are unchanged, only the harness instantiates
 * `ScanCompareCommand` directly. The three "rejected combos" tests that
 * lived at the bottom of the original suite are gone: those flags are
 * structurally absent on `ScanCompareCommand`, so a flag-clash test is
 * meaningless. Clipanion would reject the unknown option at parse time.
 *
 * Per-handler pattern (mirrors `scan-readers.test.ts` and
 * `graph-cli.test.ts`): each test plants a fixture under `mkdtempSync`,
 * persists a snapshot via `runScan` + `JSON.stringify`, then runs
 * `ScanCompareCommand` directly with `cmd.dump` pointing at that file.
 *
 * Coverage:
 *   - identical fixture vs dump → empty delta, exit 0.
 *   - body-only edit → 1 changed node, reason 'body', exit 1.
 *   - frontmatter-only edit → reason 'frontmatter'.
 *   - new file → 1 added node + at least one added link.
 *   - deleted file → 1 removed node.
 *   - missing dump path → exit 2 with clear stderr.
 *   - dump is not valid JSON → exit 2.
 *   - dump fails schema → exit 2.
 *   - --json shape: `{ comparedWith, nodes, links, issues }`.
 */

import { after, before, describe, it } from 'node:test';
import { match, ok, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BaseContext } from 'clipanion';

import { ScanCompareCommand } from '../cli/commands/scan-compare.js';
import { createKernel, runScan } from '../kernel/index.js';
import { builtIns, listBuiltIns } from '../extensions/built-ins.js';

let tmpRoot: string;
let counter = 0;

function freshFixture(label: string): string {
  counter += 1;
  return mkdtempSync(join(tmpRoot, `${label}-${counter}-`));
}

function freshPath(label: string): string {
  counter += 1;
  return join(tmpRoot, `${label}-${counter}.json`);
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

async function dumpScan(fixture: string, dumpPath: string): Promise<void> {
  const kernel = createKernel();
  for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
  const result = await runScan(kernel, {
    roots: [fixture],
    extensions: builtIns(),
  });
  writeFileSync(dumpPath, JSON.stringify(result));
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

interface IScanCompareOverrides {
  dump: string;
  roots?: string[];
  json?: boolean;
  noTokens?: boolean;
  strict?: boolean;
  noPlugins?: boolean;
}

function buildScanCompare(overrides: IScanCompareOverrides): ScanCompareCommand {
  const cmd = new ScanCompareCommand();
  cmd.dump = overrides.dump;
  cmd.roots = overrides.roots ?? [];
  cmd.json = overrides.json ?? false;
  cmd.noTokens = overrides.noTokens ?? false;
  cmd.strict = overrides.strict ?? false;
  cmd.noPlugins = overrides.noPlugins ?? false;
  return cmd;
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-compare-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('sm scan compare-with', () => {
  it('identical fixture → empty delta, exit 0, "(no differences)" hint', async () => {
    const fixture = freshFixture('compare-identical');
    plantTinyFixture(fixture);
    const dump = freshPath('compare-identical');
    await dumpScan(fixture, dump);

    const cap = captureContext();
    const cmd = buildScanCompare({ dump, roots: [fixture] });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0, `unexpected exit ${code}; stderr=${cap.stderr()}`);
    match(cap.stdout(), /Delta vs .+: 0 nodes added, 0 removed, 0 changed; 0 links added, 0 removed; 0 issues added, 0 removed\./);
    match(cap.stdout(), /\(no differences\)/);
  });

  it('body edit → 1 changed node with reason "body", exit 1', async () => {
    const fixture = freshFixture('compare-body');
    plantTinyFixture(fixture);
    const dump = freshPath('compare-body');
    await dumpScan(fixture, dump);

    // Rewrite the body, leave the frontmatter alone.
    writeFixtureFile(
      fixture,
      '.claude/agents/architect.md',
      [
        '---',
        'name: architect',
        'description: The architect',
        '---',
        'Different body. Run /deploy still.',
      ].join('\n'),
    );

    const cap = captureContext();
    const cmd = buildScanCompare({ dump, roots: [fixture] });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 1, `expected exit 1 on non-empty delta; stderr=${cap.stderr()}`);
    match(cap.stdout(), /1 changed/);
    match(cap.stdout(), /~ \.claude\/agents\/architect\.md \(body changed\)/);
  });

  it('frontmatter edit → reason "frontmatter"', async () => {
    const fixture = freshFixture('compare-fm');
    plantTinyFixture(fixture);
    const dump = freshPath('compare-fm');
    await dumpScan(fixture, dump);

    // Bump description; body stays identical (note: keep "Run /deploy.")
    writeFixtureFile(
      fixture,
      '.claude/agents/architect.md',
      [
        '---',
        'name: architect',
        'description: The architect — updated',
        '---',
        'Run /deploy.',
      ].join('\n'),
    );

    const cap = captureContext();
    const cmd = buildScanCompare({ dump, roots: [fixture] });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 1);
    match(cap.stdout(), /\(frontmatter changed\)/);
  });

  it('new file → added node + added link, exit 1', async () => {
    const fixture = freshFixture('compare-add');
    plantTinyFixture(fixture);
    const dump = freshPath('compare-add');
    await dumpScan(fixture, dump);

    writeFixtureFile(
      fixture,
      '.claude/commands/rollback.md',
      [
        '---',
        'name: rollback',
        'description: Rollback',
        '---',
        'See @architect for context.',
      ].join('\n'),
    );

    const cap = captureContext();
    const cmd = buildScanCompare({ dump, roots: [fixture] });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 1);
    match(cap.stdout(), /1 nodes added/);
    match(cap.stdout(), /\+ \.claude\/commands\/rollback\.md \(command\)/);
    // The new file's body says "@architect" → at-directive extractor emits
    // a `mentions` link, which should land in the delta's added bucket.
    match(cap.stdout(), /\+ \.claude\/commands\/rollback\.md --mentions--> @architect/);
  });

  it('deleted file → removed node, exit 1', async () => {
    const fixture = freshFixture('compare-del');
    plantTinyFixture(fixture);
    const dump = freshPath('compare-del');
    await dumpScan(fixture, dump);

    unlinkSync(join(fixture, '.claude/commands/deploy.md'));

    const cap = captureContext();
    const cmd = buildScanCompare({ dump, roots: [fixture] });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 1);
    match(cap.stdout(), /1 removed/);
    match(cap.stdout(), /- \.claude\/commands\/deploy\.md \(command\)/);
  });

  it('--json emits the delta object with comparedWith / nodes / links / issues keys', async () => {
    const fixture = freshFixture('compare-json');
    plantTinyFixture(fixture);
    const dump = freshPath('compare-json');
    await dumpScan(fixture, dump);

    const cap = captureContext();
    const cmd = buildScanCompare({ dump, roots: [fixture], json: true });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0);
    const payload = JSON.parse(cap.stdout()) as Record<string, unknown>;
    strictEqual(payload['comparedWith'], dump);
    ok(payload['nodes'] && typeof payload['nodes'] === 'object');
    ok(payload['links'] && typeof payload['links'] === 'object');
    ok(payload['issues'] && typeof payload['issues'] === 'object');
    const nodes = payload['nodes'] as Record<string, unknown>;
    ok(Array.isArray(nodes['added']));
    ok(Array.isArray(nodes['removed']));
    ok(Array.isArray(nodes['changed']));
  });

  // --- error paths ---------------------------------------------------------

  it('missing dump path → exit 2 with clear stderr', async () => {
    const fixture = freshFixture('compare-missing');
    plantTinyFixture(fixture);
    const dump = freshPath('compare-missing');
    // Do NOT create the dump file.

    const cap = captureContext();
    const cmd = buildScanCompare({ dump, roots: [fixture] });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 2);
    match(cap.stderr(), /dump file not found/);
  });

  it('dump is not valid JSON → exit 2', async () => {
    const fixture = freshFixture('compare-bad-json');
    plantTinyFixture(fixture);
    const dump = freshPath('compare-bad-json');
    writeFileSync(dump, 'not-json{');

    const cap = captureContext();
    const cmd = buildScanCompare({ dump, roots: [fixture] });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 2);
    match(cap.stderr(), /not valid JSON/);
  });

  it('dump fails scan-result schema → exit 2', async () => {
    const fixture = freshFixture('compare-bad-schema');
    plantTinyFixture(fixture);
    const dump = freshPath('compare-bad-schema');
    // Valid JSON, missing every required ScanResult field.
    writeFileSync(dump, JSON.stringify({ hello: 'world' }));

    const cap = captureContext();
    const cmd = buildScanCompare({ dump, roots: [fixture] });
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 2);
    match(cap.stderr(), /does not conform to scan-result\.schema\.json/);
  });
});
