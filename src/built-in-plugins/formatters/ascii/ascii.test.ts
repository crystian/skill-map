import { describe, it } from 'node:test';
import { match, ok } from 'node:assert';

import { asciiFormatter } from './index.js';
import type { Issue, Link, Node } from '../../../kernel/types.js';

function node(path: string, kind: Node['kind'], name?: string): Node {
  return {
    path,
    kind,
    provider: 'claude',
    bodyHash: 'x'.repeat(64),
    frontmatterHash: 'y'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    frontmatter: name ? { name } : {},
  };
}

describe('ascii formatter', () => {
  it('renders an empty graph with header-only content', () => {
    const out = asciiFormatter.format({ nodes: [], links: [], issues: [] });
    match(out, /skill-map graph — 0 nodes, 0 links, 0 issues/);
  });

  it('groups nodes by kind with titles from frontmatter.name', () => {
    const nodes = [
      node('agents/a.md', 'agent', 'Architect'),
      node('commands/b.md', 'command', 'Build'),
      node('agents/z.md', 'agent'),
    ];
    const out = asciiFormatter.format({ nodes, links: [], issues: [] });
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
    const out = asciiFormatter.format({ nodes: [], links: [link], issues: [] });
    match(out, /a\.md --references--> b\.md\s+\[high\]/);
  });

  it('renders issues as [severity] ruleId: message', () => {
    const issue: Issue = {
      ruleId: 'broken-ref',
      severity: 'warn',
      nodeIds: ['a.md'],
      message: 'Broken reference',
    };
    const out = asciiFormatter.format({ nodes: [], links: [], issues: [issue] });
    match(out, /\[warn\] broken-ref: Broken reference/);
  });

  it('omits empty kind groups', () => {
    const out = asciiFormatter.format({
      nodes: [node('a.md', 'note')],
      links: [],
      issues: [],
    });
    ok(!out.includes('## agent'));
    match(out, /## note \(1\)/);
  });

  // Audit L8 — `ruleId` is regex-validated at extension registration
  // (matches `[a-z0-9-]+`) but the formatter wraps it in
  // `sanitizeForTerminal` for defence in depth: a future loosening of
  // the registry validator MUST NOT be the only barrier between a
  // hostile rule's id and the user's terminal. Pin the gate so a
  // refactor that drops the wrap surfaces here.
  it('sanitizes ruleId in the issue bullet (defence-in-depth)', () => {
    const issue: Issue = {
      ruleId: '\x1b[2Jevil',
      severity: 'warn',
      nodeIds: ['a.md'],
      message: 'Hostile rule id should not repaint the terminal.',
    };
    const out = asciiFormatter.format({ nodes: [], links: [], issues: [issue] });
    ok(!out.includes('\x1b'), `expected no ESC byte; got ${JSON.stringify(out)}`);
    ok(out.includes('evil'), 'visible portion of ruleId survives sanitization');
  });
});
