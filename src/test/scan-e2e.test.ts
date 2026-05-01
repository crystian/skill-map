/**
 * End-to-end scan test. Proves the orchestrator + claude provider + the
 * three extractors + the three rules work together on a realistic
 * fixture. Hits the orchestrator directly (not through the CLI) so the
 * assertions can inspect intermediate state the CLI only exposes as JSON.
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKernel, runScan } from '../kernel/index.js';
import { builtIns, listBuiltIns } from '../built-in-plugins/built-ins.js';

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
      strictEqual(node.provider, 'claude');
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

  it('computes token counts by default', async () => {
    const kernel = createKernel();
    for (const manifest of listBuiltIns()) kernel.registry.register(manifest);

    const result = await runScan(kernel, {
      roots: [fixture],
      extensions: builtIns(),
    });

    strictEqual(result.nodes.length > 0, true);
    for (const node of result.nodes) {
      ok(node.tokens, `node ${node.path} missing tokens`);
      const { frontmatter, body, total } = node.tokens;
      ok(Number.isInteger(frontmatter) && frontmatter >= 0, 'frontmatter token count is a non-negative integer');
      ok(Number.isInteger(body) && body >= 0, 'body token count is a non-negative integer');
      ok(Number.isInteger(total) && total >= 0, 'total token count is a non-negative integer');
      strictEqual(total, frontmatter + body);
      // Every fixture has both a frontmatter block and a body, so both
      // token counts must be strictly positive.
      ok(frontmatter > 0, `node ${node.path} expected frontmatter tokens > 0`);
      ok(body > 0, `node ${node.path} expected body tokens > 0`);
    }
  });

  it('skips tokenization with `tokenize: false`', async () => {
    const kernel = createKernel();
    for (const manifest of listBuiltIns()) kernel.registry.register(manifest);

    const result = await runScan(kernel, {
      roots: [fixture],
      extensions: builtIns(),
      tokenize: false,
    });

    strictEqual(result.nodes.length > 0, true);
    for (const node of result.nodes) {
      strictEqual(node.tokens, undefined, `node ${node.path} should not have tokens`);
    }
  });

  it('counts external URLs into externalRefsCount and strips pseudo-links from result.links', async () => {
    // Isolated fixture so the per-node counts in this test don't depend
    // on the shared one above.
    const local = mkdtempSync(join(tmpdir(), 'skill-map-e2e-urls-'));
    try {
      const writeLocal = (rel: string, content: string) => {
        const abs = join(local, rel);
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, content);
      };
      // Two distinct URLs (https://example.com and https://example.com/path)
      // + one duplicate of the first + one syntactically invalid URL that
      // `new URL()` rejects. Expected externalRefsCount: 2.
      writeLocal(
        '.claude/agents/links.md',
        [
          '---',
          'name: links',
          'description: Has external URLs',
          '---',
          '',
          'See https://example.com for the docs.',
          'Also [more](https://example.com/path).',
          'Already mentioned https://example.com above.',
          'Bad: https://[bad here.',
        ].join('\n'),
      );

      const kernel = createKernel();
      for (const manifest of listBuiltIns()) kernel.registry.register(manifest);

      const result = await runScan(kernel, {
        roots: [local],
        extensions: builtIns(),
      });

      const links = result.nodes.find((n) => n.path === '.claude/agents/links.md');
      ok(links, 'links node was scanned');
      strictEqual(links!.externalRefsCount, 2, 'two distinct normalized URLs counted');
      // No external pseudo-link survives in result.links.
      const externalSurvivors = result.links.filter(
        (l) => l.target.startsWith('http://') || l.target.startsWith('https://'),
      );
      strictEqual(externalSurvivors.length, 0, 'external pseudo-links were stripped');
      // linksOutCount reflects ONLY internal extractors (frontmatter + slash + at).
      // This fixture has no frontmatter references, no slash commands, no @handles —
      // so linksOutCount must be 0, untouched by the URL counter.
      strictEqual(links!.linksOutCount, 0, 'URL counter does not inflate linksOutCount');
    } finally {
      rmSync(local, { recursive: true, force: true });
    }
  });
});
