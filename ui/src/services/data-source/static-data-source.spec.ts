import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DataSourceError } from './data-source.port';
import {
  StaticDataSource,
  type IDemoMetaPayload,
} from './static-data-source';

const META_FIXTURE: IDemoMetaPayload = {
  schemaVersion: '1',
  health: {
    ok: true,
    schemaVersion: '1',
    specVersion: '0.11.0',
    implVersion: '0.9.0',
    scope: 'project',
    db: 'present',
  },
  nodes: {
    schemaVersion: '1',
    kind: 'nodes',
    items: [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { path: 'a.md', kind: 'note' } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { path: 'b.md', kind: 'agent' } as any,
    ],
    filters: { kind: null, hasIssues: null, path: null },
    counts: { total: 2, returned: 2, page: { offset: 0, limit: 1000 } },
  },
  links: {
    schemaVersion: '1',
    kind: 'links',
    items: [],
    filters: { kind: null, from: null, to: null },
    counts: { total: 0, returned: 0 },
  },
  issues: {
    schemaVersion: '1',
    kind: 'issues',
    items: [],
    filters: { severity: null, ruleId: null, node: null },
    counts: { total: 0, returned: 0 },
  },
  config: {
    schemaVersion: '1',
    kind: 'config',
    value: { tokenizer: 'cl100k_base' },
  },
  plugins: {
    schemaVersion: '1',
    kind: 'plugins',
    items: [],
    filters: {},
    counts: { total: 0, returned: 0 },
  },
  graph: { ascii: 'graph contents' },
};

const SCAN_FIXTURE = {
  schemaVersion: 1,
  scannedAt: 1700000000000,
  scope: 'project' as const,
  roots: ['.'],
  providers: [],
  nodes: [
    { path: 'a.md', kind: 'note', provider: 'claude', linksOutCount: 0, linksInCount: 0, externalRefsCount: 0, bytes: { frontmatter: 0, body: 1, total: 1 }, bodyHash: 'h', frontmatterHash: 'f' },
    { path: 'b.md', kind: 'agent', provider: 'claude', linksOutCount: 1, linksInCount: 0, externalRefsCount: 0, bytes: { frontmatter: 0, body: 1, total: 1 }, bodyHash: 'h', frontmatterHash: 'f' },
    { path: 'c.md', kind: 'agent', provider: 'claude', linksOutCount: 0, linksInCount: 1, externalRefsCount: 0, bytes: { frontmatter: 0, body: 1, total: 1 }, bodyHash: 'h', frontmatterHash: 'f' },
  ],
  links: [
    {
      source: 'b.md',
      target: 'c.md',
      kind: 'invokes',
      confidence: 'high',
      sources: ['frontmatter'],
    },
  ],
  issues: [
    {
      ruleId: 'broken-ref',
      severity: 'warn',
      nodeIds: ['b.md'],
      message: 'broken',
    },
  ],
  stats: {
    filesWalked: 3,
    filesSkipped: 0,
    nodesCount: 3,
    linksCount: 1,
    issuesCount: 1,
    durationMs: 1,
  },
};

function makeFetch(routes: Record<string, unknown>): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = routes[url];
    if (body === undefined) {
      return new Response('{}', { status: 404, statusText: 'Not Found' });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('StaticDataSource', () => {
  let ds: StaticDataSource;

  beforeEach(() => {
    ds = new StaticDataSource(
      makeFetch({ 'data.meta.json': META_FIXTURE, 'data.json': SCAN_FIXTURE }),
    );
  });

  it('health() returns the pre-derived health snapshot from meta', async () => {
    await expect(ds.health()).resolves.toEqual(META_FIXTURE.health);
  });

  it('loadScan() returns the full ScanResult from data.json', async () => {
    await expect(ds.loadScan()).resolves.toEqual(SCAN_FIXTURE);
  });

  it('listNodes() with no filters returns the pre-derived envelope verbatim', async () => {
    await expect(ds.listNodes()).resolves.toEqual(META_FIXTURE.nodes);
  });

  it('listNodes() with kind filter derives a fresh envelope from data.json', async () => {
    const env = await ds.listNodes({ kind: ['agent'] });
    expect(env.kind).toBe('nodes');
    expect(env.items.map((n) => n.path)).toEqual(['b.md', 'c.md']);
    expect(env.counts.total).toBe(2);
  });

  it('listNodes() with hasIssues=true keeps only nodes touching an issue', async () => {
    const env = await ds.listNodes({ hasIssues: true });
    expect(env.items.map((n) => n.path)).toEqual(['b.md']);
  });

  it('listNodes() with hasIssues=false drops nodes touching an issue', async () => {
    const env = await ds.listNodes({ hasIssues: false });
    expect(env.items.map((n) => n.path)).toEqual(['a.md', 'c.md']);
  });

  it('listNodes() respects pagination', async () => {
    const env = await ds.listNodes({ limit: 1, offset: 1 });
    expect(env.items.map((n) => n.path)).toEqual(['b.md']);
    expect(env.counts.total).toBe(3);
    expect(env.counts.returned).toBe(1);
  });

  it('getNode() returns a detail bundle with derived incoming/outgoing links + issues', async () => {
    const detail = await ds.getNode('b.md');
    expect(detail).not.toBeNull();
    expect(detail!.item.path).toBe('b.md');
    expect(detail!.links.outgoing).toHaveLength(1);
    expect(detail!.links.outgoing[0]?.target).toBe('c.md');
    expect(detail!.links.incoming).toHaveLength(0);
    expect(detail!.issues).toHaveLength(1);
  });

  it('getNode() returns null when the path is unknown', async () => {
    await expect(ds.getNode('does-not-exist.md')).resolves.toBeNull();
  });

  it('listLinks() with no filters returns the pre-derived envelope', async () => {
    await expect(ds.listLinks()).resolves.toEqual(META_FIXTURE.links);
  });

  it('listLinks() filters by source/target', async () => {
    const env = await ds.listLinks({ from: 'b.md' });
    expect(env.items).toHaveLength(1);
  });

  it('listIssues() with no filters returns the pre-derived envelope', async () => {
    await expect(ds.listIssues()).resolves.toEqual(META_FIXTURE.issues);
  });

  it('listIssues() filters by node id', async () => {
    const env = await ds.listIssues({ node: 'b.md' });
    expect(env.items).toHaveLength(1);
  });

  it('loadGraph("ascii") returns the pre-derived ASCII art', async () => {
    await expect(ds.loadGraph('ascii')).resolves.toBe('graph contents');
  });

  it('loadGraph() rejects non-ASCII formats', async () => {
    await expect(ds.loadGraph('json')).rejects.toBeInstanceOf(DataSourceError);
  });

  it('loadConfig() unwraps the value envelope from meta', async () => {
    await expect(ds.loadConfig()).resolves.toEqual({ tokenizer: 'cl100k_base' });
  });

  it('listPlugins() returns the pre-derived envelope', async () => {
    await expect(ds.listPlugins()).resolves.toEqual(META_FIXTURE.plugins);
  });

  it('events() emits no values and completes immediately', () => {
    let nextCalled = false;
    let completeCalled = false;
    ds.events().subscribe({
      next: () => {
        nextCalled = true;
      },
      complete: () => {
        completeCalled = true;
      },
    });
    expect(nextCalled).toBe(false);
    expect(completeCalled).toBe(true);
  });

  it('caches data.json + data.meta.json after the first fetch', async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'data.meta.json') {
        return new Response(JSON.stringify(META_FIXTURE), { status: 200 });
      }
      return new Response(JSON.stringify(SCAN_FIXTURE), { status: 200 });
    }) as unknown as typeof fetch;
    const cached = new StaticDataSource(fetchSpy);
    await cached.health();
    await cached.health();
    await cached.listPlugins();
    await cached.loadScan();
    await cached.loadScan();
    expect(fetchSpy).toHaveBeenCalledTimes(2); // once for meta, once for data
  });

  it('wraps a 404 on the asset fetch as a DataSourceError', async () => {
    const broken = new StaticDataSource(makeFetch({}));
    await expect(broken.health()).rejects.toBeInstanceOf(DataSourceError);
  });

  it('wraps a fetch reject as a DataSourceError', async () => {
    const failing = new StaticDataSource(
      vi.fn(async () => {
        throw new Error('boom');
      }) as unknown as typeof fetch,
    );
    await expect(failing.health()).rejects.toMatchObject({
      name: 'DataSourceError',
      code: 'internal',
    });
  });
});
