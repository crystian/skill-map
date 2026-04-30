/**
 * Step 9.3 integration tests for the `runExtractorOnFixture`,
 * `runRuleOnGraph`, and `runFormatterOnGraph` helpers.
 *
 * Each test plants a trivial extension instance, runs the helper, and
 * asserts on the output. The helpers have no DB / FS dependency — pure
 * function-call wiring with the testkit's context factories.
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import type { IExtractor, IFormatter, IRule } from '@skill-map/cli';

import { issue, link, node } from '../src/builders.js';
import {
  runExtractorOnFixture,
  runFormatterOnGraph,
  runRuleOnGraph,
} from '../src/run.js';

describe('runExtractorOnFixture', () => {
  it('runs a deterministic extractor and returns links emitted via ctx.emitLink', async () => {
    const extractor: IExtractor = {
      id: 'fixture-extractor',
      pluginId: 'testkit',
      kind: 'extractor',
      version: '1.0.0',
      emitsLinkKinds: ['references'],
      defaultConfidence: 'high',
      scope: 'body',
      extract(ctx) {
        ctx.emitLink(
          link({
            source: ctx.node.path,
            target: 'target.md',
            kind: 'references',
            sources: ['fixture-extractor'],
          }),
        );
      },
    };
    const { links } = await runExtractorOnFixture(extractor, {
      body: 'see [target.md]',
    });
    strictEqual(links.length, 1);
    strictEqual(links[0]!.target, 'target.md');
    deepStrictEqual(links[0]!.sources, ['fixture-extractor']);
  });

  it('forwards body, frontmatter, and node overrides via context', async () => {
    const seen: { body: string; frontmatter: Record<string, unknown>; nodePath: string } = {
      body: '',
      frontmatter: {},
      nodePath: '',
    };
    const extractor: IExtractor = {
      id: 'spy',
      pluginId: 'testkit',
      kind: 'extractor',
      version: '1.0.0',
      emitsLinkKinds: ['references'],
      defaultConfidence: 'low',
      scope: 'both',
      extract(ctx) {
        seen.body = ctx.body;
        seen.frontmatter = ctx.frontmatter;
        seen.nodePath = ctx.node.path;
      },
    };
    await runExtractorOnFixture(extractor, {
      body: 'inspect me',
      frontmatter: { tag: 'a' },
      context: { node: node({ path: 'overridden.md' }) },
    });
    strictEqual(seen.body, 'inspect me');
    deepStrictEqual(seen.frontmatter, { tag: 'a' });
    strictEqual(seen.nodePath, 'overridden.md');
  });

  it('captures ctx.enrichNode calls into the enrichments array', async () => {
    const extractor: IExtractor = {
      id: 'enricher',
      pluginId: 'testkit',
      kind: 'extractor',
      version: '1.0.0',
      emitsLinkKinds: ['references'],
      defaultConfidence: 'low',
      scope: 'both',
      extract(ctx) {
        ctx.enrichNode({ title: 'Computed title' });
        ctx.enrichNode({ description: 'Computed description' });
      },
    };
    const { links, enrichments } = await runExtractorOnFixture(extractor);
    strictEqual(links.length, 0);
    strictEqual(enrichments.length, 2);
    strictEqual(enrichments[0]?.title, 'Computed title');
    strictEqual(enrichments[1]?.description, 'Computed description');
  });
});

describe('runRuleOnGraph', () => {
  it('runs a rule against a populated graph and returns its issues', async () => {
    const rule: IRule = {
      id: 'fixture-rule',
      pluginId: 'testkit',
      kind: 'rule',
      version: '1.0.0',
      evaluate(ctx) {
        if (ctx.nodes.length === 0) return [];
        return [
          issue({
            ruleId: 'fixture-rule',
            severity: 'info',
            message: `${ctx.nodes.length} node(s) seen`,
            nodeIds: ctx.nodes.map((n) => n.path),
          }),
        ];
      },
    };
    const issues = await runRuleOnGraph(rule, {
      context: { nodes: [node({ path: 'a.md' }), node({ path: 'b.md' })] },
    });
    strictEqual(issues.length, 1);
    strictEqual(issues[0]!.message, '2 node(s) seen');
    deepStrictEqual(issues[0]!.nodeIds, ['a.md', 'b.md']);
  });

  it('runs against an empty graph by default', async () => {
    const rule: IRule = {
      id: 'noisy',
      pluginId: 'testkit',
      kind: 'rule',
      version: '1.0.0',
      evaluate(ctx) {
        return [issue({ message: `nodes=${ctx.nodes.length}` })];
      },
    };
    const issues = await runRuleOnGraph(rule);
    strictEqual(issues.length, 1);
    strictEqual(issues[0]!.message, 'nodes=0');
  });
});

describe('runFormatterOnGraph', () => {
  it('formats a graph and returns the string output', () => {
    const formatter: IFormatter = {
      id: 'fixture-formatter',
      pluginId: 'testkit',
      kind: 'formatter',
      version: '1.0.0',
      formatId: 'fixture',
      format(ctx) {
        return `nodes=${ctx.nodes.length} links=${ctx.links.length} issues=${ctx.issues.length}`;
      },
    };
    const out = runFormatterOnGraph(formatter, {
      context: {
        nodes: [node()],
        links: [link()],
        issues: [issue(), issue()],
      },
    });
    strictEqual(out, 'nodes=1 links=1 issues=2');
  });
});
