/**
 * End-to-end scan test. Proves the orchestrator + claude adapter + the
 * three detectors + the three rules work together on a realistic
 * fixture. Hits the orchestrator directly (not through the CLI) so the
 * assertions can inspect intermediate state the CLI only exposes as JSON.
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKernel, runScan } from '../kernel/index.js';
import { builtIns, listBuiltIns } from '../extensions/built-ins.js';

let fixture: string;

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-e2e-'));
  const write = (rel: string, content: string) => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };

  write(
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
  write(
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
  // Note: .claude/commands/deploy-v2.md intentionally absent so the
  // supersedes edge from frontmatter.supersededBy is a known "broken
  // target" candidate — except that broken-ref doesn't fire on
  // `supersedes` because the rule treats the inverted edge as
  // authoritative (source is the new file, which doesn't yet exist).
  // The superseded rule still fires on the old node.
  write(
    '.claude/commands/rollback.md',
    ['---', 'name: Rollback', '---', 'Rollback body.'].join('\n'),
  );
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe('scan end-to-end', () => {
  it('produces nodes, links, and issues from the full pipeline', async () => {
    const kernel = createKernel();
    for (const manifest of listBuiltIns()) kernel.registry.register(manifest);

    const result = await runScan(kernel, {
      roots: [fixture],
      extensions: builtIns(),
    });

    strictEqual(result.schemaVersion, 1);
    strictEqual(result.stats.nodesCount, 3);

    const pathsByKind = result.nodes
      .map((n) => ({ path: n.path, kind: n.kind }))
      .sort((a, b) => a.path.localeCompare(b.path));
    deepStrictEqual(pathsByKind, [
      { path: '.claude/agents/architect.md', kind: 'agent' },
      { path: '.claude/commands/deploy.md', kind: 'command' },
      { path: '.claude/commands/rollback.md', kind: 'command' },
    ]);

    // Every node has sha256 hashes and triple-split bytes.
    for (const node of result.nodes) {
      strictEqual(node.bodyHash.length, 64);
      strictEqual(node.frontmatterHash.length, 64);
      ok(node.bytes.total === node.bytes.frontmatter + node.bytes.body);
      strictEqual(node.adapter, 'claude');
    }

    // Links: frontmatter.related + slash /deploy + slash /unknown + at @backend-lead
    //      + supersededBy inversion (deploy-v2 → deploy).
    const linkSummaries = result.links.map((l) => `${l.source}|${l.kind}|${l.target}`).sort();
    ok(linkSummaries.includes('.claude/agents/architect.md|references|.claude/commands/deploy.md'));
    ok(linkSummaries.some((s) => s.startsWith('.claude/agents/architect.md|invokes|/deploy')));
    ok(linkSummaries.some((s) => s.startsWith('.claude/agents/architect.md|invokes|/unknown')));
    ok(linkSummaries.some((s) => s.startsWith('.claude/agents/architect.md|mentions|@backend-lead')));
    ok(linkSummaries.some((s) => s.endsWith('|supersedes|.claude/commands/deploy.md')));

    // Issues: broken-ref for /unknown + @backend-lead (deploy-v2 target
    // isn't covered because the inversion points AT deploy.md, not FROM
    // deploy-v2.md — the link source is what broken-ref checks).
    const issueIds = result.issues.map((i) => i.ruleId).sort();
    ok(issueIds.includes('broken-ref'));
    ok(issueIds.includes('superseded'));

    // Link counts denormalised onto nodes.
    const architect = result.nodes.find((n) => n.path === '.claude/agents/architect.md');
    ok(architect);
    ok((architect?.linksOutCount ?? 0) >= 3, 'architect emits ≥3 outbound links');
    const deploy = result.nodes.find((n) => n.path === '.claude/commands/deploy.md');
    ok(deploy);
    ok((deploy?.linksInCount ?? 0) >= 2, 'deploy receives related + supersedes edges');
  });

  it('produces zero-filled result with --no-built-ins parity (empty extensions)', async () => {
    const kernel = createKernel();
    const result = await runScan(kernel, { roots: [fixture] });
    strictEqual(result.stats.nodesCount, 0);
    strictEqual(result.stats.linksCount, 0);
    strictEqual(result.stats.issuesCount, 0);
  });
});
