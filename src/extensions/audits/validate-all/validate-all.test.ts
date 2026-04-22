import { describe, it } from 'node:test';
import { strictEqual, ok } from 'node:assert';

import { validateAllAudit } from './index.js';
import type { Issue, Link, Node } from '../../../kernel/types.js';

function validNode(): Node {
  return {
    path: 'agents/ok.md',
    kind: 'agent',
    adapter: 'claude',
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

describe('validate-all audit', () => {
  it('passes an empty graph', async () => {
    const report = await validateAllAudit.run({ nodes: [], links: [], issues: [] });
    strictEqual(report.status, 'pass');
    strictEqual(report.findings.length, 0);
  });

  it('passes a graph with a well-formed node + link', async () => {
    const node = validNode();
    const link: Link = {
      source: 'agents/ok.md',
      target: 'agents/ok2.md',
      kind: 'references',
      confidence: 'high',
      sources: ['frontmatter'],
    };
    const report = await validateAllAudit.run({ nodes: [node], links: [link], issues: [] });
    strictEqual(report.status, 'pass');
  });

  it('fails when a link has an invalid kind', async () => {
    const bad: Link = {
      source: 'a.md',
      target: 'b.md',
      // @ts-expect-error deliberately invalid kind
      kind: 'nonsense',
      confidence: 'high',
      sources: ['x'],
    };
    const report = await validateAllAudit.run({ nodes: [], links: [bad], issues: [] });
    strictEqual(report.status, 'fail');
    strictEqual(report.findings.length, 1);
    ok(report.findings[0]?.message.includes('nonsense') || report.findings[0]?.message.includes('Link'));
  });

  it('fails when an issue has an invalid severity', async () => {
    const bad: Issue = {
      ruleId: 'x',
      // @ts-expect-error deliberately invalid
      severity: 'boom',
      nodeIds: ['a.md'],
      message: 'whatever',
    };
    const report = await validateAllAudit.run({ nodes: [], links: [], issues: [bad] });
    strictEqual(report.status, 'fail');
    strictEqual(report.findings[0]?.ruleId, 'validate-all');
  });
});
