/**
 * Step 9.3 unit tests for the per-kind context factories.
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import {
  extractorContextFromBody,
  makeExtractorContext,
  makeFormatterContext,
  makeRuleContext,
} from '../src/context.js';
import { issue, link, node } from '../src/builders.js';

describe('makeExtractorContext', () => {
  it('defaults to placeholder node + empty body + empty frontmatter + no-op callbacks', () => {
    const ctx = makeExtractorContext();
    strictEqual(typeof ctx.node.path, 'string');
    strictEqual(ctx.body, '');
    deepStrictEqual(ctx.frontmatter, {});
    strictEqual(typeof ctx.emitLink, 'function');
    strictEqual(typeof ctx.enrichNode, 'function');
  });

  it('overrides win', () => {
    const ctx = makeExtractorContext({
      node: node({ kind: 'agent' }),
      body: 'hello',
      frontmatter: { name: 'foo' },
    });
    strictEqual(ctx.node.kind, 'agent');
    strictEqual(ctx.body, 'hello');
    deepStrictEqual(ctx.frontmatter, { name: 'foo' });
  });

  it('passes through caller-supplied callbacks', () => {
    const seenLinks: number[] = [];
    const seenEnrichments: number[] = [];
    const ctx = makeExtractorContext({
      emitLink: () => seenLinks.push(1),
      enrichNode: () => seenEnrichments.push(1),
    });
    ctx.emitLink(link());
    ctx.enrichNode({ title: 'x' });
    strictEqual(seenLinks.length, 1);
    strictEqual(seenEnrichments.length, 1);
  });
});

describe('extractorContextFromBody', () => {
  it('builds a context from a body string', () => {
    const ctx = extractorContextFromBody('Run /deploy now.');
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

describe('makeFormatterContext', () => {
  it('exposes nodes / links / issues as empty arrays by default', () => {
    const ctx = makeFormatterContext();
    deepStrictEqual(ctx.nodes, []);
    deepStrictEqual(ctx.links, []);
    deepStrictEqual(ctx.issues, []);
  });

  it('forwards populated arrays', () => {
    const ctx = makeFormatterContext({
      nodes: [node()],
      links: [link()],
      issues: [issue({ severity: 'error' })],
    });
    strictEqual(ctx.issues[0]!.severity, 'error');
  });
});
