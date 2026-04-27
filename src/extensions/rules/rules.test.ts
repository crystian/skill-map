import { describe, it } from 'node:test';
import { strictEqual, ok } from 'node:assert';

import { triggerCollisionRule } from './trigger-collision/index.js';
import { brokenRefRule } from './broken-ref/index.js';
import { supersededRule } from './superseded/index.js';
import { linkConflictRule } from './link-conflict/index.js';
import type { Confidence, Issue, Link, LinkKind, Node, NodeKind } from '../../kernel/types.js';

function mockNode(
  path: string,
  name?: string,
  extraMeta: Record<string, unknown> = {},
  kind: NodeKind = 'note',
): Node {
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
    frontmatter: { name, metadata: extraMeta },
  };
}

function invocation(source: string, target: string, normalized: string, kind: 'invokes' | 'mentions' = 'invokes'): Link {
  return {
    source,
    target,
    kind,
    confidence: 'medium',
    sources: ['slash'],
    trigger: { originalTrigger: target, normalizedTrigger: normalized },
  };
}

// Rules' evaluate() returns Issue[] | Promise<Issue[]>. Await resolves both
// shapes uniformly and keeps each test's assertions typed as Issue[].
async function run(rule: typeof triggerCollisionRule, ctx: { nodes: Node[]; links: Link[] }): Promise<Issue[]> {
  return await rule.evaluate(ctx);
}

describe('trigger-collision rule', () => {
  it('emits nothing when every trigger is distinct', async () => {
    const links = [
      invocation('a.md', '/deploy', '/deploy'),
      invocation('b.md', '/rollback', '/rollback'),
    ];
    const issues = await run(triggerCollisionRule, { nodes: [], links });
    strictEqual(issues.length, 0);
  });

  it('flags two distinct targets sharing a trigger', async () => {
    const links = [
      invocation('a.md', '/deploy', '/deploy'),
      invocation('b.md', '/Deploy', '/deploy'), // same normalized, different original/target
    ];
    const issues = await run(triggerCollisionRule, { nodes: [], links });
    strictEqual(issues.length, 1);
    strictEqual(issues[0]?.severity, 'error');
    strictEqual(issues[0]?.ruleId, 'trigger-collision');
    ok(issues[0]?.message.includes('/deploy'));
  });

  it('ignores duplicates where multiple links point to the same target', async () => {
    const links = [
      invocation('a.md', '/deploy', '/deploy'),
      invocation('b.md', '/deploy', '/deploy'),
    ];
    const issues = await run(triggerCollisionRule, { nodes: [], links });
    strictEqual(issues.length, 0);
  });

  it('skips links without a trigger block', async () => {
    const links: Link[] = [
      { source: 'a.md', target: 'b.md', kind: 'references', confidence: 'high', sources: ['frontmatter'] },
    ];
    const issues = await run(triggerCollisionRule, { nodes: [], links });
    strictEqual(issues.length, 0);
  });

  it('flags two advertisers of the same name (no invocations)', async () => {
    // Canonical example from the rule's doc: two commands declaring
    // `name: deploy` from different files compete for `/deploy`. Before
    // the Step 4.9 fix this slipped silently because the rule only
    // looked at links.
    const nodes = [
      mockNode('.claude/commands/deploy.md', 'deploy', {}, 'command'),
      mockNode('.claude/commands/deploy-v2.md', 'deploy', {}, 'command'),
    ];
    const issues = await run(triggerCollisionRule, { nodes, links: [] });
    strictEqual(issues.length, 1);
    strictEqual(issues[0]?.severity, 'error');
    strictEqual(issues[0]?.ruleId, 'trigger-collision');
    ok(issues[0]?.message.includes('/deploy'));
    ok(issues[0]?.message.includes('.claude/commands/deploy.md'));
    ok(issues[0]?.message.includes('.claude/commands/deploy-v2.md'));
    const data = issues[0]!.data as { advertiserPaths: string[]; invocationTargets: string[] };
    strictEqual(data.advertiserPaths.length, 2);
    strictEqual(data.invocationTargets.length, 0);
    // Both advertising node paths show up in nodeIds.
    ok(issues[0]!.nodeIds.includes('.claude/commands/deploy.md'));
    ok(issues[0]!.nodeIds.includes('.claude/commands/deploy-v2.md'));
  });

  it('mixes claim kinds: one advertiser + one different-cased invocation → collision', async () => {
    // The advertised path is `.claude/commands/deploy.md` (token A); the
    // invocation target is `/Deploy` (token B). Both normalize to
    // `/deploy`, two distinct claim tokens, rule fires.
    const nodes = [mockNode('.claude/commands/deploy.md', 'deploy', {}, 'command')];
    const links = [invocation('a.md', '/Deploy', '/deploy')];
    const issues = await run(triggerCollisionRule, { nodes, links });
    strictEqual(issues.length, 1);
    strictEqual(issues[0]?.severity, 'error');
    const data = issues[0]!.data as { advertiserPaths: string[]; invocationTargets: string[] };
    ok(data.advertiserPaths.includes('.claude/commands/deploy.md'));
    ok(data.invocationTargets.includes('/Deploy'));
  });

  it('does not fire when one advertiser is invoked by its canonical form', async () => {
    // `name: deploy` advertised + `/deploy` invoked is the normal flow:
    // the invocation's raw target equals the bucket-key (the normalized
    // trigger), so it's the canonical form of the advertised name.
    // Same logical claim, no ambiguity, no issue.
    const nodes = [mockNode('.claude/commands/deploy.md', 'deploy', {}, 'command')];
    const links = [
      invocation('a.md', '/deploy', '/deploy'),
      invocation('b.md', '/deploy', '/deploy'),
      invocation('c.md', '/deploy', '/deploy'),
    ];
    const issues = await run(triggerCollisionRule, { nodes, links });
    strictEqual(issues.length, 0);
  });

  it('ignores frontmatter.name on non-advertising kinds (note)', async () => {
    // A `note` happening to carry `name: deploy` doesn't compete for
    // `/deploy`. Only `command`, `skill`, `agent` advertise.
    const nodes = [
      mockNode('a.md', 'deploy', {}, 'note'),
      mockNode('b.md', 'deploy', {}, 'note'),
    ];
    const issues = await run(triggerCollisionRule, { nodes, links: [] });
    strictEqual(issues.length, 0);
  });
});

describe('broken-ref rule', () => {
  it('resolves path-style targets against node.path', async () => {
    const nodes = [mockNode('a.md'), mockNode('b.md')];
    const links: Link[] = [
      { source: 'a.md', target: 'b.md', kind: 'references', confidence: 'high', sources: ['frontmatter'] },
      { source: 'a.md', target: 'ghost.md', kind: 'references', confidence: 'high', sources: ['frontmatter'] },
    ];
    const issues = await run(brokenRefRule, { nodes, links });
    strictEqual(issues.length, 1);
    strictEqual(issues[0]?.ruleId, 'broken-ref');
    strictEqual(issues[0]?.severity, 'warn');
    ok(issues[0]?.message.includes('ghost.md'));
  });

  it('resolves trigger-style targets against frontmatter.name', async () => {
    const nodes = [mockNode('cmd/deploy.md', 'deploy')];
    const links = [
      invocation('a.md', '/deploy', '/deploy'),
      invocation('a.md', '/unknown', '/unknown'),
    ];
    const issues = await run(brokenRefRule, { nodes, links });
    strictEqual(issues.length, 1);
    strictEqual(issues[0]?.message.includes('/unknown'), true);
  });

  it('strips the sigil + normalises before matching names', async () => {
    const nodes = [mockNode('agents/backend.md', 'Backend-Architect')];
    // Detector output: @backend-architect normalizes to "@backend architect"
    // (hyphen → space, @ preserved); rule strips the @ and matches the
    // node whose name normalises to "backend architect".
    const links = [invocation('note.md', '@backend-architect', '@backend architect', 'mentions')];
    const issues = await run(brokenRefRule, { nodes, links });
    strictEqual(issues.length, 0);
  });
});

describe('superseded rule', () => {
  it('emits info per node declaring supersededBy', async () => {
    const nodes = [
      mockNode('old.md', 'old', { supersededBy: 'new.md' }),
      mockNode('new.md', 'new'),
      mockNode('other.md', 'other'),
    ];
    const issues = await run(supersededRule, { nodes, links: [] });
    strictEqual(issues.length, 1);
    strictEqual(issues[0]?.nodeIds[0], 'old.md');
    strictEqual(issues[0]?.severity, 'info');
    ok(issues[0]?.message.includes('new.md'));
  });

  it('ignores nodes with no metadata block', async () => {
    const node = mockNode('a.md', 'a');
    node.frontmatter = {}; // no metadata key
    const issues = await run(supersededRule, { nodes: [node], links: [] });
    strictEqual(issues.length, 0);
  });

  it('ignores non-string supersededBy values', async () => {
    const nodes = [mockNode('a.md', 'a', { supersededBy: '' }), mockNode('b.md', 'b', { supersededBy: 42 })];
    const issues = await run(supersededRule, { nodes, links: [] });
    strictEqual(issues.length, 0);
  });
});

// ---------------------------------------------------------------------------
// link-conflict
// ---------------------------------------------------------------------------

function rawLink(
  source: string,
  target: string,
  kind: LinkKind,
  detector: string,
  confidence: Confidence = 'medium',
): Link {
  return {
    source,
    target,
    kind,
    confidence,
    sources: [detector],
  };
}

describe('link-conflict rule', () => {
  it('emits nothing for an empty graph', async () => {
    const issues = await run(linkConflictRule, { nodes: [], links: [] });
    strictEqual(issues.length, 0);
  });

  it('stays silent when only one detector emits the pair', async () => {
    const links = [rawLink('a.md', 'b.md', 'invokes', 'slash')];
    const issues = await run(linkConflictRule, { nodes: [], links });
    strictEqual(issues.length, 0);
  });

  it('stays silent when two detectors agree on kind (happy path)', async () => {
    const links = [
      rawLink('audit-flow', 'security-scanner', 'references', 'frontmatter'),
      rawLink('audit-flow', 'security-scanner', 'references', 'slash'),
    ];
    const issues = await run(linkConflictRule, { nodes: [], links });
    strictEqual(issues.length, 0, 'agreement on kind must not emit findings');
  });

  it('emits one warn when detectors disagree on kind', async () => {
    const links = [
      rawLink('audit-flow', 'security-scanner', 'references', 'frontmatter'),
      rawLink('audit-flow', 'security-scanner', 'invokes', 'slash'),
    ];
    const issues = await run(linkConflictRule, { nodes: [], links });
    strictEqual(issues.length, 1);
    const issue = issues[0]!;
    strictEqual(issue.ruleId, 'link-conflict');
    strictEqual(issue.severity, 'warn');
    strictEqual(issue.nodeIds.length, 2);
    strictEqual(issue.nodeIds[0], 'audit-flow');
    strictEqual(issue.nodeIds[1], 'security-scanner');
    ok(issue.message.includes('audit-flow'));
    ok(issue.message.includes('security-scanner'));
    ok(issue.message.includes('invokes'));
    ok(issue.message.includes('references'));
    const data = issue.data as { variants: Array<{ kind: string; sources: string[] }> };
    strictEqual(data.variants.length, 2);
    // Variants are sorted alphabetically by kind for determinism.
    strictEqual(data.variants[0]!.kind, 'invokes');
    strictEqual(data.variants[0]!.sources[0], 'slash');
    strictEqual(data.variants[1]!.kind, 'references');
    strictEqual(data.variants[1]!.sources[0], 'frontmatter');
  });

  it('groups multiple sources of the same kind into one variant', async () => {
    // Three rows, two kinds. References has 2 detectors (frontmatter +
    // mentions), invokes has 1 (slash). After grouping: 2 variants.
    const links = [
      rawLink('a.md', 'b.md', 'references', 'frontmatter'),
      rawLink('a.md', 'b.md', 'references', 'at-directive'),
      rawLink('a.md', 'b.md', 'invokes', 'slash'),
    ];
    const issues = await run(linkConflictRule, { nodes: [], links });
    strictEqual(issues.length, 1);
    const data = issues[0]!.data as { variants: Array<{ kind: string; sources: string[] }> };
    strictEqual(data.variants.length, 2);
    const refs = data.variants.find((v) => v.kind === 'references')!;
    // Sources are deduped, sorted, and unioned across rows of the same kind.
    strictEqual(refs.sources.length, 2);
    strictEqual(refs.sources[0], 'at-directive');
    strictEqual(refs.sources[1], 'frontmatter');
  });

  it('keeps the highest-confidence value across rows of the same kind', async () => {
    const links = [
      rawLink('a.md', 'b.md', 'references', 'frontmatter', 'low'),
      rawLink('a.md', 'b.md', 'references', 'slash', 'high'),
      rawLink('a.md', 'b.md', 'invokes', 'at-directive', 'medium'),
    ];
    const issues = await run(linkConflictRule, { nodes: [], links });
    strictEqual(issues.length, 1);
    const data = issues[0]!.data as { variants: Array<{ kind: string; confidence: string }> };
    const refs = data.variants.find((v) => v.kind === 'references')!;
    strictEqual(refs.confidence, 'high', 'highest confidence wins per variant');
  });

  it('emits one issue per disagreeing pair', async () => {
    const links = [
      rawLink('a.md', 'b.md', 'invokes', 'slash'),
      rawLink('a.md', 'b.md', 'references', 'frontmatter'),
      rawLink('c.md', 'd.md', 'invokes', 'slash'),
      rawLink('c.md', 'd.md', 'mentions', 'at-directive'),
    ];
    const issues = await run(linkConflictRule, { nodes: [], links });
    strictEqual(issues.length, 2);
    const pairs = issues.map((i) => i.nodeIds.join('->')).sort();
    strictEqual(pairs[0], 'a.md->b.md');
    strictEqual(pairs[1], 'c.md->d.md');
  });

  it('does not confuse pairs with shared source or target', async () => {
    // (a → b, invokes) and (a → c, references) share `a` but are different
    // pairs. No conflict.
    const links = [
      rawLink('a.md', 'b.md', 'invokes', 'slash'),
      rawLink('a.md', 'c.md', 'references', 'frontmatter'),
    ];
    const issues = await run(linkConflictRule, { nodes: [], links });
    strictEqual(issues.length, 0);
  });
});
