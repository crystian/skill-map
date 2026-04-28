/**
 * Step 9.3 unit tests for the per-kind context factories.
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import {
  detectContextFromBody,
  makeDetectContext,
  makeRenderContext,
  makeRuleContext,
} from '../src/context.js';
import { issue, link, node } from '../src/builders.js';

describe('makeDetectContext', () => {
  it('defaults to placeholder node + empty body + empty frontmatter', () => {
    const ctx = makeDetectContext();
    strictEqual(typeof ctx.node.path, 'string');
    strictEqual(ctx.body, '');
    deepStrictEqual(ctx.frontmatter, {});
  });

  it('overrides win', () => {
    const ctx = makeDetectContext({
      node: node({ kind: 'agent' }),
      body: 'hello',
      frontmatter: { name: 'foo' },
    });
    strictEqual(ctx.node.kind, 'agent');
    strictEqual(ctx.body, 'hello');
    deepStrictEqual(ctx.frontmatter, { name: 'foo' });
  });
});

describe('detectContextFromBody', () => {
  it('builds a context from a body string', () => {
    const ctx = detectContextFromBody('Run /deploy now.');
    strictEqual(ctx.body, 'Run /deploy now.');
  });
});

describe('makeRuleContext', () => {
  it('defaults to empty arrays', () => {
    const ctx = makeRuleContext();
    deepStrictEqual(ctx.nodes, []);
    deepStrictEqual(ctx.links, []);
  });

  it('accepts a populated graph', () => {
    const ctx = makeRuleContext({
      nodes: [node({ path: 'a.md' })],
      links: [link({ source: 'a.md', target: 'b.md' })],
    });
    strictEqual(ctx.nodes.length, 1);
    strictEqual(ctx.links.length, 1);
  });
});

describe('makeRenderContext', () => {
  it('exposes nodes / links / issues as empty arrays by default', () => {
    const ctx = makeRenderContext();
    deepStrictEqual(ctx.nodes, []);
    deepStrictEqual(ctx.links, []);
    deepStrictEqual(ctx.issues, []);
  });

  it('forwards populated arrays', () => {
    const ctx = makeRenderContext({
      nodes: [node()],
      links: [link()],
      issues: [issue({ severity: 'error' })],
    });
    strictEqual(ctx.issues[0]!.severity, 'error');
  });
});
