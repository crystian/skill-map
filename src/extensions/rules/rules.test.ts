import { describe, it } from 'node:test';
import { strictEqual, ok } from 'node:assert';

import { triggerCollisionRule } from './trigger-collision/index.js';
import { brokenRefRule } from './broken-ref/index.js';
import { supersededRule } from './superseded/index.js';
import type { Issue, Link, Node } from '../../kernel/types.js';

function mockNode(path: string, name?: string, extraMeta: Record<string, unknown> = {}): Node {
  return {
    path,
    kind: 'note',
    adapter: 'claude',
    bodyHash: 'x'.repeat(64),
    frontmatterHash: 'y'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    frontmatter: { name, metadata: extraMeta },
  };
}

function invocation(source: string, target: string, normalized: string, kind: 'invokes' | 'mentions' = 'invokes'): Link {
  return {
    source,
    target,
    kind,
    confidence: 'medium',
    sources: ['slash'],
    trigger: { originalTrigger: target, normalizedTrigger: normalized },
  };
}

// Rules' evaluate() returns Issue[] | Promise<Issue[]>. Await resolves both
// shapes uniformly and keeps each test's assertions typed as Issue[].
async function run(rule: typeof triggerCollisionRule, ctx: { nodes: Node[]; links: Link[] }): Promise<Issue[]> {
  return await rule.evaluate(ctx);
}

describe('trigger-collision rule', () => {
  it('emits nothing when every trigger is distinct', async () => {
    const links = [
      invocation('a.md', '/deploy', '/deploy'),
      invocation('b.md', '/rollback', '/rollback'),
    ];
    const issues = await run(triggerCollisionRule, { nodes: [], links });
    strictEqual(issues.length, 0);
  });

  it('flags two distinct targets sharing a trigger', async () => {
    const links = [
      invocation('a.md', '/deploy', '/deploy'),
      invocation('b.md', '/Deploy', '/deploy'), // same normalized, different original/target
    ];
    const issues = await run(triggerCollisionRule, { nodes: [], links });
    strictEqual(issues.length, 1);
    strictEqual(issues[0]?.severity, 'error');
    strictEqual(issues[0]?.ruleId, 'trigger-collision');
    ok(issues[0]?.message.includes('/deploy'));
  });

  it('ignores duplicates where multiple links point to the same target', async () => {
    const links = [
      invocation('a.md', '/deploy', '/deploy'),
      invocation('b.md', '/deploy', '/deploy'),
    ];
    const issues = await run(triggerCollisionRule, { nodes: [], links });
    strictEqual(issues.length, 0);
  });

  it('skips links without a trigger block', async () => {
    const links: Link[] = [
      { source: 'a.md', target: 'b.md', kind: 'references', confidence: 'high', sources: ['frontmatter'] },
    ];
    const issues = await run(triggerCollisionRule, { nodes: [], links });
    strictEqual(issues.length, 0);
  });
});

describe('broken-ref rule', () => {
  it('resolves path-style targets against node.path', async () => {
    const nodes = [mockNode('a.md'), mockNode('b.md')];
    const links: Link[] = [
      { source: 'a.md', target: 'b.md', kind: 'references', confidence: 'high', sources: ['frontmatter'] },
      { source: 'a.md', target: 'ghost.md', kind: 'references', confidence: 'high', sources: ['frontmatter'] },
    ];
    const issues = await run(brokenRefRule, { nodes, links });
    strictEqual(issues.length, 1);
    strictEqual(issues[0]?.ruleId, 'broken-ref');
    strictEqual(issues[0]?.severity, 'warn');
    ok(issues[0]?.message.includes('ghost.md'));
  });

  it('resolves trigger-style targets against frontmatter.name', async () => {
    const nodes = [mockNode('cmd/deploy.md', 'deploy')];
    const links = [
      invocation('a.md', '/deploy', '/deploy'),
      invocation('a.md', '/unknown', '/unknown'),
    ];
    const issues = await run(brokenRefRule, { nodes, links });
    strictEqual(issues.length, 1);
    strictEqual(issues[0]?.message.includes('/unknown'), true);
  });

  it('strips the sigil + normalises before matching names', async () => {
    const nodes = [mockNode('agents/backend.md', 'Backend-Architect')];
    // Detector output: @backend-architect normalizes to "@backend architect"
    // (hyphen → space, @ preserved); rule strips the @ and matches the
    // node whose name normalises to "backend architect".
    const links = [invocation('note.md', '@backend-architect', '@backend architect', 'mentions')];
    const issues = await run(brokenRefRule, { nodes, links });
    strictEqual(issues.length, 0);
  });
});

describe('superseded rule', () => {
  it('emits info per node declaring supersededBy', async () => {
    const nodes = [
      mockNode('old.md', 'old', { supersededBy: 'new.md' }),
      mockNode('new.md', 'new'),
      mockNode('other.md', 'other'),
    ];
    const issues = await run(supersededRule, { nodes, links: [] });
    strictEqual(issues.length, 1);
    strictEqual(issues[0]?.nodeIds[0], 'old.md');
    strictEqual(issues[0]?.severity, 'info');
    ok(issues[0]?.message.includes('new.md'));
  });

  it('ignores nodes with no metadata block', async () => {
    const node = mockNode('a.md', 'a');
    node.frontmatter = {}; // no metadata key
    const issues = await run(supersededRule, { nodes: [node], links: [] });
    strictEqual(issues.length, 0);
  });

  it('ignores non-string supersededBy values', async () => {
    const nodes = [mockNode('a.md', 'a', { supersededBy: '' }), mockNode('b.md', 'b', { supersededBy: 42 })];
    const issues = await run(supersededRule, { nodes, links: [] });
    strictEqual(issues.length, 0);
  });
});
