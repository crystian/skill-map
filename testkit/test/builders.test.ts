/**
 * Step 9.3 unit tests for the testkit builders. The builders are pure;
 * tests check that defaults are spec-shaped and that overrides win.
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';

import { issue, link, node, scanResult } from '../src/builders.js';

describe('node()', () => {
  it('produces a spec-shaped node with sensible defaults', () => {
    const n = node();
    strictEqual(typeof n.path, 'string');
    strictEqual(n.kind, 'skill');
    strictEqual(n.adapter, 'claude');
    deepStrictEqual(n.bytes, { frontmatter: 0, body: 0, total: 0 });
    strictEqual(n.linksOutCount, 0);
    strictEqual(n.linksInCount, 0);
    strictEqual(n.externalRefsCount, 0);
    // Optional fields are omitted unless overridden — no `title: undefined`.
    strictEqual('title' in n, false, 'title should be absent when not provided');
  });

  it('overrides win over defaults', () => {
    const n = node({ kind: 'agent', path: 'a.md', linksInCount: 7 });
    strictEqual(n.kind, 'agent');
    strictEqual(n.path, 'a.md');
    strictEqual(n.linksInCount, 7);
  });

  it('attaches optional fields when overridden', () => {
    const n = node({ title: 'Architect', frontmatter: { name: 'architect' } });
    strictEqual(n.title, 'Architect');
    deepStrictEqual(n.frontmatter, { name: 'architect' });
  });
});

describe('link()', () => {
  it('produces a spec-shaped link with sensible defaults', () => {
    const l = link();
    strictEqual(l.kind, 'references');
    strictEqual(l.confidence, 'high');
    deepStrictEqual(l.sources, ['testkit']);
  });

  it('overrides win', () => {
    const l = link({ kind: 'invokes', confidence: 'low', sources: ['my-detector'] });
    strictEqual(l.kind, 'invokes');
    strictEqual(l.confidence, 'low');
    deepStrictEqual(l.sources, ['my-detector']);
  });

  it('omits optional fields by default', () => {
    const l = link();
    strictEqual('trigger' in l, false);
    strictEqual('location' in l, false);
  });
});

describe('issue()', () => {
  it('defaults to warn / testkit / empty nodeIds', () => {
    const i = issue();
    strictEqual(i.severity, 'warn');
    strictEqual(i.ruleId, 'testkit');
    deepStrictEqual(i.nodeIds, []);
  });

  it('overrides win', () => {
    const i = issue({ severity: 'error', ruleId: 'broken-ref', nodeIds: ['a.md'] });
    strictEqual(i.severity, 'error');
    strictEqual(i.ruleId, 'broken-ref');
    deepStrictEqual(i.nodeIds, ['a.md']);
  });
});

describe('scanResult()', () => {
  it('builds an internally consistent envelope', () => {
    const sr = scanResult({
      nodes: [node({ path: 'a.md' }), node({ path: 'b.md' })],
      links: [link()],
      issues: [issue()],
    });
    strictEqual(sr.stats.nodesCount, 2);
    strictEqual(sr.stats.linksCount, 1);
    strictEqual(sr.stats.issuesCount, 1);
    strictEqual(sr.scope, 'project');
    deepStrictEqual(sr.adapters, ['claude']);
    ok(sr.scannedBy?.name.includes('testkit'));
  });

  it('explicit stats override the derived defaults', () => {
    const sr = scanResult({ nodes: [node()], stats: { nodesCount: 99, linksCount: 0, issuesCount: 0, durationMs: 0, filesWalked: 99, filesSkipped: 0 } });
    strictEqual(sr.stats.nodesCount, 99);
  });
});
