/**
 * Pollution-defence unit tests for the kernel — covers `mergeNode-
 * WithEnrichments` (audit H3) and the claude provider's
 * `splitFrontmatter` strip (audit L2). Both are pure functions; the
 * tests do not need a DB or a spawned CLI.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { claudeProvider } from '../built-in-plugins/providers/claude/index.js';
import { mergeNodeWithEnrichments, type IPersistedEnrichment } from '../kernel/orchestrator.js';
import type { Node } from '../kernel/types.js';

function fakeNode(frontmatter: Record<string, unknown>): Node {
  return {
    path: 'agents/x.md',
    kind: 'agent',
    provider: 'claude',
    frontmatterHash: 'h',
    bodyHash: 'b',
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    frontmatter,
  } as unknown as Node;
}

function fakeEnrichment(value: Record<string, unknown>, when = 1): IPersistedEnrichment {
  return {
    nodePath: 'agents/x.md',
    extractorId: 'fake',
    bodyHashAtEnrichment: 'h',
    value: value as Partial<Node>,
    stale: false,
    enrichedAt: when,
    isProbabilistic: false,
  };
}

describe('mergeNodeWithEnrichments — pollution defence (audit H3)', () => {
  it('strips __proto__ from node.frontmatter without reshaping the merged prototype', () => {
    const merged = mergeNodeWithEnrichments(
      fakeNode({ name: 'arq', __proto__: { polluted: 'yes' } }),
      [],
    );
    assert.equal(merged['name'], 'arq');
    assert.equal(Object.getPrototypeOf(merged), Object.prototype);
    assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
  });

  it('strips __proto__ from enrichment row.value', () => {
    const merged = mergeNodeWithEnrichments(
      fakeNode({ name: 'arq' }),
      [fakeEnrichment({ description: 'D', __proto__: { leak: 1 } })],
    );
    assert.equal(merged['name'], 'arq');
    assert.equal(merged['description'], 'D');
    assert.equal(Object.getPrototypeOf(merged), Object.prototype);
    assert.equal(({} as Record<string, unknown>)['leak'], undefined);
  });

  it('strips constructor / prototype from row.value', () => {
    const merged = mergeNodeWithEnrichments(
      fakeNode({ name: 'arq' }),
      [fakeEnrichment({ constructor: { hijack: 1 }, prototype: { also: 1 }, ok: 'yes' })],
    );
    assert.equal(merged['ok'], 'yes');
    assert.ok(!Object.prototype.hasOwnProperty.call(merged, 'constructor'));
    assert.ok(!Object.prototype.hasOwnProperty.call(merged, 'prototype'));
  });

  it('preserves last-write-wins semantics under sorted enrichedAt order', () => {
    const merged = mergeNodeWithEnrichments(fakeNode({ field: 'base' }), [
      fakeEnrichment({ field: 'older' }, 1),
      fakeEnrichment({ field: 'newer' }, 2),
    ]);
    assert.equal(merged['field'], 'newer');
  });
});

describe('claude provider walk — pollution defence (audit L2)', () => {
  let root: string;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'sm-pollution-walk-'));
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
    writeFileSync(
      join(root, '.claude', 'agents', 'evil.md'),
      [
        '---',
        'name: evil',
        '__proto__:',
        '  polluted: yes',
        'constructor:',
        '  hijack: 1',
        '---',
        'body',
        '',
      ].join('\n'),
    );
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('strips __proto__ / constructor / prototype from parsed YAML frontmatter', async () => {
    const seen: Array<Record<string, unknown>> = [];
    for await (const raw of claudeProvider.walk([root])) {
      seen.push(raw.frontmatter);
    }
    assert.equal(seen.length, 1);
    const fm = seen[0]!;
    assert.equal(fm['name'], 'evil');
    assert.ok(!Object.prototype.hasOwnProperty.call(fm, '__proto__'));
    assert.ok(!Object.prototype.hasOwnProperty.call(fm, 'constructor'));
    assert.equal(Object.getPrototypeOf(fm), Object.prototype);
    // Object.prototype itself is unchanged.
    assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
    assert.equal(({} as Record<string, unknown>)['hijack'], undefined);
  });
});
