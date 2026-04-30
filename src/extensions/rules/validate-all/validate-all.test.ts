import { describe, it } from 'node:test';
import { strictEqual, ok } from 'node:assert';

import { validateAllRule } from './index.js';
import type { Link, Node } from '../../../kernel/types.js';

function validNode(): Node {
  return {
    path: 'agents/ok.md',
    kind: 'agent',
    provider: 'claude',
    bodyHash: 'a'.repeat(64),
    frontmatterHash: 'b'.repeat(64),
    bytes: { frontmatter: 10, body: 100, total: 110 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    frontmatter: {
      name: 'ok-agent',
      description: 'An agent',
      metadata: { version: '1.0.0' },
    },
  };
}

describe('validate-all rule', () => {
  it('emits no issues on an empty graph', async () => {
    const issues = await validateAllRule.evaluate({ nodes: [], links: [] });
    strictEqual(issues.length, 0);
  });

  it('emits no issues on a graph with a well-formed node + link', async () => {
    const node = validNode();
    const link: Link = {
      source: 'agents/ok.md',
      target: 'agents/ok2.md',
      kind: 'references',
      confidence: 'high',
      sources: ['frontmatter'],
    };
    const issues = await validateAllRule.evaluate({ nodes: [node], links: [link] });
    strictEqual(issues.length, 0);
  });

  it('emits an error issue when a link has an invalid kind', async () => {
    const bad: Link = {
      source: 'a.md',
      target: 'b.md',
      // @ts-expect-error deliberately invalid kind
      kind: 'nonsense',
      confidence: 'high',
      sources: ['x'],
    };
    const issues = await validateAllRule.evaluate({ nodes: [], links: [bad] });
    strictEqual(issues.length, 1);
    strictEqual(issues[0]?.severity, 'error');
    strictEqual(issues[0]?.ruleId, 'validate-all');
    ok(issues[0]?.message.includes('nonsense') || issues[0]?.message.includes('Link'));
  });

  it('emits an issue per malformed node', async () => {
    // A node missing the required `provider` field (the schema mandates it
    // post-Phase-2b). The exact `as unknown as Node` cast is the test's
    // shortcut for "skip the type system; we want to feed bad data".
    const bad = {
      path: 'oops.md',
      kind: 'agent',
      bodyHash: 'a'.repeat(64),
      frontmatterHash: 'b'.repeat(64),
      bytes: { frontmatter: 0, body: 0, total: 0 },
      linksOutCount: 0,
      linksInCount: 0,
      externalRefsCount: 0,
    } as unknown as Node;
    const issues = await validateAllRule.evaluate({ nodes: [bad], links: [] });
    ok(issues.length >= 1);
    strictEqual(issues[0]?.ruleId, 'validate-all');
  });
});
