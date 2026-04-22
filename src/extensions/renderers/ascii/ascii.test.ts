import { describe, it } from 'node:test';
import { match, ok } from 'node:assert';

import { asciiRenderer } from './index.js';
import type { Issue, Link, Node } from '../../../kernel/types.js';

function node(path: string, kind: Node['kind'], name?: string): Node {
  return {
    path,
    kind,
    adapter: 'claude',
    bodyHash: 'x'.repeat(64),
    frontmatterHash: 'y'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    frontmatter: name ? { name } : {},
  };
}

describe('ascii renderer', () => {
  it('renders an empty graph with header-only content', () => {
    const out = asciiRenderer.render({ nodes: [], links: [], issues: [] });
    match(out, /skill-map graph — 0 nodes, 0 links, 0 issues/);
  });

  it('groups nodes by kind with titles from frontmatter.name', () => {
    const nodes = [
      node('agents/a.md', 'agent', 'Architect'),
      node('commands/b.md', 'command', 'Build'),
      node('agents/z.md', 'agent'),
    ];
    const out = asciiRenderer.render({ nodes, links: [], issues: [] });
    match(out, /## agent \(2\)/);
    match(out, /agents\/a.md — "Architect"/);
    match(out, /agents\/z.md/);
    match(out, /## command \(1\)/);
  });

  it('renders links with source --kind--> target [confidence]', () => {
    const link: Link = {
      source: 'a.md',
      target: 'b.md',
      kind: 'references',
      confidence: 'high',
      sources: ['frontmatter'],
    };
    const out = asciiRenderer.render({ nodes: [], links: [link], issues: [] });
    match(out, /a\.md --references--> b\.md\s+\[high\]/);
  });

  it('renders issues as [severity] ruleId: message', () => {
    const issue: Issue = {
      ruleId: 'broken-ref',
      severity: 'warn',
      nodeIds: ['a.md'],
      message: 'Broken reference',
    };
    const out = asciiRenderer.render({ nodes: [], links: [], issues: [issue] });
    match(out, /\[warn\] broken-ref: Broken reference/);
  });

  it('omits empty kind groups', () => {
    const out = asciiRenderer.render({
      nodes: [node('a.md', 'note')],
      links: [],
      issues: [],
    });
    ok(!out.includes('## agent'));
    match(out, /## note \(1\)/);
  });
});
