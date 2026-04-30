import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';

import { frontmatterExtractor } from './frontmatter/index.js';
import { slashExtractor } from './slash/index.js';
import { atDirectiveExtractor } from './at-directive/index.js';
import type { IExtractorContext, IExtractor } from '../../kernel/extensions/index.js';
import type { Link, Node } from '../../kernel/types.js';

function mockNode(path: string): Node {
  return {
    path,
    kind: 'note',
    provider: 'claude',
    bodyHash: 'x'.repeat(64),
    frontmatterHash: 'y'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

/**
 * Build a context plus a captured-links array. Mirrors what the
 * orchestrator does at runtime: the extractor emits via `ctx.emitLink`
 * and `ctx.enrichNode`, both of which the test captures into local
 * arrays for inspection.
 */
function ctx(
  path: string,
  body: string,
  frontmatter: Record<string, unknown> = {},
): { ctx: IExtractorContext; links: Link[]; enrichments: Partial<Node>[] } {
  const links: Link[] = [];
  const enrichments: Partial<Node>[] = [];
  const context: IExtractorContext = {
    node: mockNode(path),
    body,
    frontmatter,
    emitLink: (l) => links.push(l),
    enrichNode: (p) => enrichments.push(p),
  };
  return { ctx: context, links, enrichments };
}

// Extractors' `extract()` returns `void | Promise<void>`. Await resolves
// both uniformly and lets the test continue on the captured `links` array.
async function extract(extractor: IExtractor, context: IExtractorContext): Promise<void> {
  await extractor.extract(context);
}

describe('frontmatter extractor', () => {
  it('emits supersedes links from metadata.supersedes[]', async () => {
    const { ctx: context, links } = ctx(
      'a.md',
      '',
      { metadata: { supersedes: ['b.md', 'c.md'] } },
    );
    await extract(frontmatterExtractor, context);
    deepStrictEqual(
      links.map((l) => ({ s: l.source, t: l.target, k: l.kind })),
      [{ s: 'a.md', t: 'b.md', k: 'supersedes' }, { s: 'a.md', t: 'c.md', k: 'supersedes' }],
    );
  });

  it('inverts supersededBy so the edge points from the new node', async () => {
    const { ctx: context, links } = ctx(
      'old.md',
      '',
      { metadata: { supersededBy: 'new.md' } },
    );
    await extract(frontmatterExtractor, context);
    strictEqual(links.length, 1);
    strictEqual(links[0]?.source, 'new.md');
    strictEqual(links[0]?.target, 'old.md');
    strictEqual(links[0]?.kind, 'supersedes');
  });

  it('emits references for requires + related', async () => {
    const { ctx: context, links } = ctx(
      'a.md',
      '',
      { metadata: { requires: ['b.md'], related: ['c.md'] } },
    );
    await extract(frontmatterExtractor, context);
    strictEqual(links.length, 2);
    strictEqual(links.every((l) => l.kind === 'references'), true);
  });

  it('emits nothing when metadata is absent', async () => {
    const { ctx: context, links } = ctx('a.md', '', {});
    await extract(frontmatterExtractor, context);
    deepStrictEqual(links, []);
  });

  it('filters out non-string entries silently', async () => {
    const { ctx: context, links } = ctx(
      'a.md',
      '',
      { metadata: { requires: ['b.md', 42, null, ''] } },
    );
    await extract(frontmatterExtractor, context);
    strictEqual(links.length, 1);
    strictEqual(links[0]?.target, 'b.md');
  });
});

describe('slash extractor', () => {
  it('extracts /command tokens from body', async () => {
    const { ctx: context, links } = ctx('a.md', 'Run /deploy or /rollback when ready.');
    await extract(slashExtractor, context);
    strictEqual(links.length, 2);
    const targets = links.map((l) => l.trigger?.normalizedTrigger).sort();
    deepStrictEqual(targets, ['/deploy', '/rollback']);
  });

  it('dedupes repeated invocations', async () => {
    const { ctx: context, links } = ctx('a.md', '/deploy then /deploy again.');
    await extract(slashExtractor, context);
    strictEqual(links.length, 1);
  });

  it('does not match mid-word slashes (paths)', async () => {
    const { ctx: context, links } = ctx('a.md', 'See src/cli/entry.ts for details.');
    await extract(slashExtractor, context);
    strictEqual(links.length, 0);
  });

  it('supports namespaced commands (/ns:verb)', async () => {
    const { ctx: context, links } = ctx('a.md', 'Run /skill-map:explore please.');
    await extract(slashExtractor, context);
    strictEqual(links.length, 1);
    strictEqual(links[0]?.trigger?.originalTrigger, '/skill-map:explore');
  });

  it('normalizes case + hyphens for collision detection', async () => {
    const { ctx: context, links } = ctx('a.md', 'Try /My-Command here.');
    await extract(slashExtractor, context);
    strictEqual(links[0]?.trigger?.normalizedTrigger, '/my command');
  });

  it('emits the right manifest shape', () => {
    strictEqual(slashExtractor.emitsLinkKinds[0], 'invokes');
    strictEqual(slashExtractor.defaultConfidence, 'medium');
    strictEqual(slashExtractor.scope, 'body');
  });
});

describe('at-directive extractor', () => {
  it('extracts @handle tokens', async () => {
    const { ctx: context, links } = ctx('a.md', 'Ask @backend-architect and @security-auditor.');
    await extract(atDirectiveExtractor, context);
    strictEqual(links.length, 2);
  });

  it('does not match email addresses', async () => {
    const { ctx: context, links } = ctx('a.md', 'Contact foo@bar.com if needed.');
    await extract(atDirectiveExtractor, context);
    strictEqual(links.length, 0);
  });

  it('supports namespaced handles (@scope/name and @ns:verb)', async () => {
    const slash = ctx('a.md', 'Via @my-plugin/foo-extractor.');
    await extract(atDirectiveExtractor, slash.ctx);
    strictEqual(slash.links[0]?.trigger?.originalTrigger, '@my-plugin/foo-extractor');
    const colon = ctx('a.md', 'Or @skill-map:explore works too.');
    await extract(atDirectiveExtractor, colon.ctx);
    strictEqual(colon.links[0]?.trigger?.originalTrigger, '@skill-map:explore');
  });

  it('dedupes on normalized trigger', async () => {
    const { ctx: context, links } = ctx('a.md', '@Agent and @AGENT and @agent.');
    await extract(atDirectiveExtractor, context);
    strictEqual(links.length, 1);
  });

  it('emits the right manifest shape', () => {
    ok(atDirectiveExtractor.emitsLinkKinds.includes('mentions'));
    strictEqual(atDirectiveExtractor.defaultConfidence, 'medium');
    strictEqual(atDirectiveExtractor.scope, 'body');
  });
});
