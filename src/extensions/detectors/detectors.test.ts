import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';

import { frontmatterDetector } from './frontmatter/index.js';
import { slashDetector } from './slash/index.js';
import { atDirectiveDetector } from './at-directive/index.js';
import type { IDetectContext, IDetector } from '../../kernel/extensions/index.js';
import type { Link, Node } from '../../kernel/types.js';

function mockNode(path: string): Node {
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
  };
}

function ctx(path: string, body: string, frontmatter: Record<string, unknown> = {}): IDetectContext {
  return { node: mockNode(path), body, frontmatter };
}

// Detectors' detect() returns Link[] | Promise<Link[]>. Await resolves both
// uniformly and keeps each test's assertions typed as Link[].
async function detect(detector: IDetector, context: IDetectContext): Promise<Link[]> {
  return await detector.detect(context);
}

describe('frontmatter detector', () => {
  it('emits supersedes links from metadata.supersedes[]', async () => {
    const links = await detect(frontmatterDetector, ctx(
      'a.md',
      '',
      { metadata: { supersedes: ['b.md', 'c.md'] } },
    ));
    deepStrictEqual(
      links.map((l) => ({ s: l.source, t: l.target, k: l.kind })),
      [{ s: 'a.md', t: 'b.md', k: 'supersedes' }, { s: 'a.md', t: 'c.md', k: 'supersedes' }],
    );
  });

  it('inverts supersededBy so the edge points from the new node', async () => {
    const links = await detect(frontmatterDetector, ctx(
      'old.md',
      '',
      { metadata: { supersededBy: 'new.md' } },
    ));
    strictEqual(links.length, 1);
    strictEqual(links[0]?.source, 'new.md');
    strictEqual(links[0]?.target, 'old.md');
    strictEqual(links[0]?.kind, 'supersedes');
  });

  it('emits references for requires + related', async () => {
    const links = await detect(frontmatterDetector, ctx(
      'a.md',
      '',
      { metadata: { requires: ['b.md'], related: ['c.md'] } },
    ));
    strictEqual(links.length, 2);
    strictEqual(links.every((l) => l.kind === 'references'), true);
  });

  it('returns [] when metadata is absent', async () => {
    const links = await detect(frontmatterDetector, ctx('a.md', '', {}));
    deepStrictEqual(links, []);
  });

  it('filters out non-string entries silently', async () => {
    const links = await detect(frontmatterDetector, ctx(
      'a.md',
      '',
      { metadata: { requires: ['b.md', 42, null, ''] } },
    ));
    strictEqual(links.length, 1);
    strictEqual(links[0]?.target, 'b.md');
  });
});

describe('slash detector', () => {
  it('extracts /command tokens from body', async () => {
    const links = await detect(slashDetector, ctx('a.md', 'Run /deploy or /rollback when ready.'));
    strictEqual(links.length, 2);
    const targets = links.map((l) => l.trigger?.normalizedTrigger).sort();
    deepStrictEqual(targets, ['/deploy', '/rollback']);
  });

  it('dedupes repeated invocations', async () => {
    const links = await detect(slashDetector, ctx('a.md', '/deploy then /deploy again.'));
    strictEqual(links.length, 1);
  });

  it('does not match mid-word slashes (paths)', async () => {
    const links = await detect(slashDetector, ctx('a.md', 'See src/cli/entry.ts for details.'));
    strictEqual(links.length, 0);
  });

  it('supports namespaced commands (/ns:verb)', async () => {
    const links = await detect(slashDetector, ctx('a.md', 'Run /skill-map:explore please.'));
    strictEqual(links.length, 1);
    strictEqual(links[0]?.trigger?.originalTrigger, '/skill-map:explore');
  });

  it('normalizes case + hyphens for collision detection', async () => {
    const links = await detect(slashDetector, ctx('a.md', 'Try /My-Command here.'));
    strictEqual(links[0]?.trigger?.normalizedTrigger, '/my command');
  });

  it('emits the right manifest shape', () => {
    strictEqual(slashDetector.emitsLinkKinds[0], 'invokes');
    strictEqual(slashDetector.defaultConfidence, 'medium');
    strictEqual(slashDetector.scope, 'body');
  });
});

describe('at-directive detector', () => {
  it('extracts @handle tokens', async () => {
    const links = await detect(atDirectiveDetector, ctx('a.md', 'Ask @backend-architect and @security-auditor.'));
    strictEqual(links.length, 2);
  });

  it('does not match email addresses', async () => {
    const links = await detect(atDirectiveDetector, ctx('a.md', 'Contact foo@bar.com if needed.'));
    strictEqual(links.length, 0);
  });

  it('supports namespaced handles (@scope/name and @ns:verb)', async () => {
    const slash = await detect(atDirectiveDetector, ctx('a.md', 'Via @my-plugin/foo-detector.'));
    strictEqual(slash[0]?.trigger?.originalTrigger, '@my-plugin/foo-detector');
    const colon = await detect(atDirectiveDetector, ctx('a.md', 'Or @skill-map:explore works too.'));
    strictEqual(colon[0]?.trigger?.originalTrigger, '@skill-map:explore');
  });

  it('dedupes on normalized trigger', async () => {
    const links = await detect(atDirectiveDetector, ctx('a.md', '@Agent and @AGENT and @agent.'));
    strictEqual(links.length, 1);
  });

  it('emits the right manifest shape', () => {
    ok(atDirectiveDetector.emitsLinkKinds.includes('mentions'));
    strictEqual(atDirectiveDetector.defaultConfidence, 'medium');
    strictEqual(atDirectiveDetector.scope, 'body');
  });
});
