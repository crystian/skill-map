/**
 * Tests for the graph-view layout cache and projection helpers. The
 * cache behaviour drives the WS-driven "graph stays put on update" fix:
 * a topology fingerprint over (paths + edges) controls whether d3-force
 * re-runs or whether cached positions are reused.
 */

import { describe, expect, it } from 'vitest';

import {
  createLayoutComputer,
  projectVisible,
  topologyFingerprint,
  type IFullLayout,
  type IGraphEdge,
} from './graph-layout';
import type { INodeView } from '../../../models/node';
import type { ILinkApi, INodeApi, IScanResultApi } from '../../../models/api';

// ---------------------------------------------------------------------------
// Fixture builders — keep them tiny + literal so the tests double as docs.
// ---------------------------------------------------------------------------

function nodeView(path: string, frontmatterDescription = ''): INodeView {
  return {
    path,
    kind: 'note',
    frontmatter: {
      name: path,
      description: frontmatterDescription,
      metadata: { version: '0.0.1' },
    },
  };
}

function apiNode(path: string, bytesTotal = 100): INodeApi {
  return {
    path,
    kind: 'note',
    provider: 'claude',
    bodyHash: 'a'.repeat(64),
    frontmatterHash: 'b'.repeat(64),
    bytes: { frontmatter: 10, body: bytesTotal - 10, total: bytesTotal },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

function link(source: string, target: string, kind: ILinkApi['kind'] = 'invokes'): ILinkApi {
  return {
    source,
    target,
    kind,
    confidence: 'high',
    sources: ['ext'],
  };
}

function scan(nodes: INodeApi[], links: ILinkApi[]): IScanResultApi {
  return {
    schemaVersion: 1,
    scannedAt: 0,
    scope: 'project',
    roots: ['/tmp/x'],
    nodes,
    links,
    issues: [],
    stats: {
      filesWalked: nodes.length,
      filesSkipped: 0,
      nodesCount: nodes.length,
      linksCount: links.length,
      issuesCount: 0,
      durationMs: 0,
    },
  };
}

function positionsEqual(a: Map<string, { x: number; y: number }>, b: Map<string, { x: number; y: number }>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (!w || w.x !== v.x || w.y !== v.y) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// topologyFingerprint
// ---------------------------------------------------------------------------

describe('topologyFingerprint', () => {
  it('is stable under permutation of nodes and edges', () => {
    const e: IGraphEdge[] = [
      { id: 'invokes:a::b', from: 'a', to: 'b', kind: 'invokes' },
      { id: 'invokes:c::d', from: 'c', to: 'd', kind: 'invokes' },
    ];
    const nodesA = [nodeView('a'), nodeView('b'), nodeView('c'), nodeView('d')];
    const nodesB = [nodeView('d'), nodeView('a'), nodeView('c'), nodeView('b')];
    const edgesReversed = [...e].reverse();
    expect(topologyFingerprint(nodesA, e)).toBe(topologyFingerprint(nodesB, edgesReversed));
  });

  it('changes when a node is added', () => {
    const e: IGraphEdge[] = [];
    const before = topologyFingerprint([nodeView('a'), nodeView('b')], e);
    const after = topologyFingerprint([nodeView('a'), nodeView('b'), nodeView('c')], e);
    expect(before).not.toBe(after);
  });

  it('changes when an edge is added', () => {
    const nodes = [nodeView('a'), nodeView('b')];
    const before = topologyFingerprint(nodes, []);
    const after = topologyFingerprint(nodes, [
      { id: 'invokes:a::b', from: 'a', to: 'b', kind: 'invokes' },
    ]);
    expect(before).not.toBe(after);
  });

  it('does NOT change when only frontmatter content differs', () => {
    const e: IGraphEdge[] = [];
    const before = topologyFingerprint([nodeView('a', 'old'), nodeView('b', 'old')], e);
    const after = topologyFingerprint([nodeView('a', 'NEW'), nodeView('b', 'NEW')], e);
    expect(before).toBe(after);
  });
});

// ---------------------------------------------------------------------------
// createLayoutComputer — the cache contract that fixes the WS bug
// ---------------------------------------------------------------------------

describe('createLayoutComputer', () => {
  it('returns identical positions and computedAt on cache HIT (same topology)', () => {
    const compute = createLayoutComputer();
    const nodes = [nodeView('a'), nodeView('b'), nodeView('c')];
    const s = scan([apiNode('a'), apiNode('b'), apiNode('c')], [link('a', 'b'), link('b', 'c')]);

    const first = compute(nodes, s);
    const second = compute(nodes, s);

    expect(positionsEqual(first.positions, second.positions)).toBe(true);
    // Identity equality — same Map reference, no copy:
    expect(second.positions).toBe(first.positions);
    expect(second.edges).toBe(first.edges);
    expect(second.computedAt).toBe(first.computedAt);
  });

  it('preserves positions but refreshes nodesByPath when ONLY frontmatter changes', () => {
    const compute = createLayoutComputer();
    const beforeNodes = [nodeView('a', 'old'), nodeView('b', 'old')];
    const afterNodes = [nodeView('a', 'NEW'), nodeView('b', 'NEW')];
    const s = scan([apiNode('a'), apiNode('b')], [link('a', 'b')]);

    const before = compute(beforeNodes, s);
    const after = compute(afterNodes, s);

    // Cache hit — positions reused.
    expect(after.positions).toBe(before.positions);
    expect(after.computedAt).toBe(before.computedAt);
    // But the nodesByPath map carries the NEW frontmatter.
    expect(after.nodesByPath.get('a')?.frontmatter.description).toBe('NEW');
    expect(after.nodesByPath.get('b')?.frontmatter.description).toBe('NEW');
  });

  it('refreshes apiNodesByPath when ONLY persisted byte counts change', () => {
    const compute = createLayoutComputer();
    const nodes = [nodeView('a'), nodeView('b')];
    const before = compute(nodes, scan([apiNode('a', 100), apiNode('b', 100)], [link('a', 'b')]));
    const after = compute(nodes, scan([apiNode('a', 555), apiNode('b', 555)], [link('a', 'b')]));

    // Cache hit on positions/edges, but the apiNodesByPath rebuild surfaces the new bytes.
    expect(after.positions).toBe(before.positions);
    expect(after.apiNodesByPath.get('a')?.bytes.total).toBe(555);
  });

  it('cache MISS — recomputes positions when a node is added', async () => {
    const compute = createLayoutComputer();
    const before = compute(
      [nodeView('a'), nodeView('b')],
      scan([apiNode('a'), apiNode('b')], [link('a', 'b')]),
    );
    // Ensure performance.now() advances at least 1ms.
    await new Promise((r) => setTimeout(r, 2));
    const after = compute(
      [nodeView('a'), nodeView('b'), nodeView('c')],
      scan([apiNode('a'), apiNode('b'), apiNode('c')], [link('a', 'b')]),
    );

    expect(after.positions).not.toBe(before.positions);
    expect(after.computedAt).toBeGreaterThan(before.computedAt);
    expect(after.positions.has('c')).toBe(true);
  });

  it('cache MISS — recomputes positions when a node is removed', async () => {
    const compute = createLayoutComputer();
    const before = compute(
      [nodeView('a'), nodeView('b'), nodeView('c')],
      scan([apiNode('a'), apiNode('b'), apiNode('c')], [link('a', 'b')]),
    );
    await new Promise((r) => setTimeout(r, 2));
    const after = compute(
      [nodeView('a'), nodeView('b')],
      scan([apiNode('a'), apiNode('b')], [link('a', 'b')]),
    );

    expect(after.positions).not.toBe(before.positions);
    expect(after.computedAt).toBeGreaterThan(before.computedAt);
    expect(after.positions.has('c')).toBe(false);
  });

  it('cache MISS — recomputes positions when an edge is added', async () => {
    const compute = createLayoutComputer();
    const nodes = [nodeView('a'), nodeView('b'), nodeView('c')];
    const before = compute(nodes, scan([apiNode('a'), apiNode('b'), apiNode('c')], [link('a', 'b')]));
    await new Promise((r) => setTimeout(r, 2));
    const after = compute(
      nodes,
      scan([apiNode('a'), apiNode('b'), apiNode('c')], [link('a', 'b'), link('b', 'c')]),
    );

    expect(after.positions).not.toBe(before.positions);
    expect(after.computedAt).toBeGreaterThan(before.computedAt);
    expect(after.edges).toHaveLength(2);
  });

  it('cache MISS — recomputes positions when an edge is removed', async () => {
    const compute = createLayoutComputer();
    const nodes = [nodeView('a'), nodeView('b'), nodeView('c')];
    const before = compute(
      nodes,
      scan([apiNode('a'), apiNode('b'), apiNode('c')], [link('a', 'b'), link('b', 'c')]),
    );
    await new Promise((r) => setTimeout(r, 2));
    const after = compute(nodes, scan([apiNode('a'), apiNode('b'), apiNode('c')], [link('a', 'b')]));

    expect(after.positions).not.toBe(before.positions);
    expect(after.computedAt).toBeGreaterThan(before.computedAt);
    expect(after.edges).toHaveLength(1);
  });

  it('treats different cache instances as independent', () => {
    const computeA = createLayoutComputer();
    const computeB = createLayoutComputer();
    const nodes = [nodeView('a'), nodeView('b')];
    const s = scan([apiNode('a'), apiNode('b')], [link('a', 'b')]);

    const fromA = computeA(nodes, s);
    const fromB = computeB(nodes, s);

    // Same input on different instances → equal positions but different Map identities.
    expect(positionsEqual(fromA.positions, fromB.positions)).toBe(true);
    expect(fromA.positions).not.toBe(fromB.positions);
  });

  it('handles a null scan (no edges)', () => {
    const compute = createLayoutComputer();
    const result = compute([nodeView('a'), nodeView('b')], null);
    expect(result.edges).toHaveLength(0);
    expect(result.positions.size).toBe(2);
  });

  it('drops links pointing to unknown paths', () => {
    const compute = createLayoutComputer();
    const result = compute(
      [nodeView('a'), nodeView('b')],
      scan([apiNode('a'), apiNode('b')], [link('a', 'b'), link('a', 'GHOST')]),
    );
    expect(result.edges).toHaveLength(1);
  });

  it('dedupes links of the same kind between the same pair (any direction)', () => {
    const compute = createLayoutComputer();
    const result = compute(
      [nodeView('a'), nodeView('b')],
      scan(
        [apiNode('a'), apiNode('b')],
        // edgeId() sorts endpoints, so a→b and b→a collapse to the same id under the same kind.
        [link('a', 'b', 'invokes'), link('b', 'a', 'invokes')],
      ),
    );
    expect(result.edges).toHaveLength(1);
  });

  it('drops self-links (source === target)', () => {
    const compute = createLayoutComputer();
    const result = compute(
      [nodeView('a')],
      scan([apiNode('a')], [link('a', 'a')]),
    );
    expect(result.edges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// projectVisible — filter projection on top of the cached layout
// ---------------------------------------------------------------------------

describe('projectVisible', () => {
  function buildLayout(
    paths: string[],
    edges: IGraphEdge[],
    positions: Record<string, { x: number; y: number }>,
  ): IFullLayout {
    const nodesByPath = new Map<string, INodeView>();
    const apiNodesByPath = new Map<string, INodeApi>();
    for (const p of paths) {
      nodesByPath.set(p, nodeView(p));
      apiNodesByPath.set(p, apiNode(p));
    }
    const positionsMap = new Map<string, { x: number; y: number }>();
    for (const [k, v] of Object.entries(positions)) positionsMap.set(k, v);
    return { nodesByPath, apiNodesByPath, edges, positions: positionsMap, computedAt: 0 };
  }

  it('renders only nodes in visibleIds', () => {
    const layout = buildLayout(
      ['a', 'b', 'c'],
      [],
      { a: { x: 0, y: 0 }, b: { x: 10, y: 10 }, c: { x: 20, y: 20 } },
    );
    const result = projectVisible(layout, new Set(['a', 'c']), {});
    expect(result.nodes.map((n) => n.id).sort()).toEqual(['a', 'c']);
  });

  it('filters edges to those with both endpoints visible', () => {
    const layout = buildLayout(
      ['a', 'b', 'c'],
      [
        { id: 'invokes:a::b', from: 'a', to: 'b', kind: 'invokes' },
        { id: 'invokes:b::c', from: 'b', to: 'c', kind: 'invokes' },
      ],
      { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, c: { x: 0, y: 0 } },
    );
    const result = projectVisible(layout, new Set(['a', 'b']), {});
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.id).toBe('invokes:a::b');
  });

  it('counts visible-only edges in linksIn / linksOut', () => {
    const layout = buildLayout(
      ['a', 'b', 'c'],
      [
        { id: 'invokes:a::b', from: 'a', to: 'b', kind: 'invokes' },
        { id: 'invokes:b::c', from: 'b', to: 'c', kind: 'invokes' },
      ],
      { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, c: { x: 0, y: 0 } },
    );
    // Only a + b visible → b has linksIn=1 from a, linksOut=0 (b→c is hidden).
    const result = projectVisible(layout, new Set(['a', 'b']), {});
    const b = result.nodes.find((n) => n.id === 'b');
    expect(b?.stats.linksIn).toBe(1);
    expect(b?.stats.linksOut).toBe(0);
  });

  it('drag-override position wins over cached force-layout position', () => {
    const layout = buildLayout(['a'], [], { a: { x: 100, y: 100 } });
    const result = projectVisible(layout, new Set(['a']), { a: { x: 999, y: 888 } });
    expect(result.nodes[0]?.position).toEqual({ x: 999, y: 888 });
  });

  it('falls back to (0,0) when a visible id has no cached position', () => {
    const layout = buildLayout(['a'], [], {});
    const result = projectVisible(layout, new Set(['a']), {});
    expect(result.nodes[0]?.position).toEqual({ x: 0, y: 0 });
  });
});
