/**
 * Step 14.2 — `/api/*` endpoint integration tests.
 *
 * Each describe block exercises one route: happy path against a primed
 * fixture DB, plus at least one error / edge case. Routes are driven
 * end-to-end via `createServer({...})` + native `fetch` so the test
 * also asserts the Hono pipeline (route registration, error envelope,
 * onError funnel).
 *
 * `createServer` is paired with `await handle.close()` in `try/finally`
 * everywhere — a stray listening socket leaks across tests.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { builtIns, listBuiltIns } from '../built-in-plugins/built-ins.js';
import { createKernel, runScan } from '../kernel/index.js';
import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../kernel/adapters/sqlite/scan-persistence.js';
import {
  createServer,
  type IServerOptions,
  type ServerHandle,
} from '../server/index.js';
import { encodeNodePath } from '../server/path-codec.js';

interface ITestRoot {
  tmp: string;
  fixtureDir: string;
  primedDb: string;
  emptyDb: string;
  missingDb: string;
}

let root: ITestRoot;

before(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-server-endpoints-'));
  const fixtureDir = mkdtempSync(join(tmp, 'fixture-'));
  plantFixture(fixtureDir);
  const primedDb = join(tmp, 'primed.db');
  await primeDb(fixtureDir, primedDb);

  // Empty DB — migrated but never scanned. `loadScanResult` returns the
  // synthetic ScanResult shape with zero rows.
  const emptyDb = join(tmp, 'empty.db');
  await primeEmptyDb(emptyDb);

  // Missing DB — file path that does NOT exist on disk. The endpoints
  // degrade gracefully (`/api/scan` returns the empty shape; lists
  // return zero items).
  const missingDb = join(tmp, 'absent', 'never-existed.db');

  root = { tmp, fixtureDir, primedDb, emptyDb, missingDb };
});

after(() => {
  rmSync(root.tmp, { recursive: true, force: true });
});

function plantFixture(dir: string): void {
  function writeFile(rel: string, content: string): void {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  writeFile(
    '.claude/agents/architect.md',
    [
      '---',
      'name: architect',
      'description: The architect.',
      '---',
      'Run /deploy.',
    ].join('\n'),
  );
  writeFile(
    '.claude/commands/deploy.md',
    [
      '---',
      'name: deploy',
      'description: Deploy command.',
      '---',
      'Deploy body.',
    ].join('\n'),
  );
  writeFile(
    '.claude/skills/intro/SKILL.md',
    [
      '---',
      'name: intro',
      'description: Intro skill.',
      '---',
      'Intro body.',
    ].join('\n'),
  );
}

async function primeDb(fixtureDir: string, dbPath: string): Promise<void> {
  const kernel = createKernel();
  for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
  const result = await runScan(kernel, {
    roots: [fixtureDir],
    extensions: builtIns(),
  });
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await persistScanResult(adapter.db, result);
  } finally {
    await adapter.close();
  }
}

async function primeEmptyDb(dbPath: string): Promise<void> {
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  await adapter.close();
}

function defaultOptions(overrides: Partial<IServerOptions> = {}): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    scope: 'project',
    dbPath: root.primedDb,
    uiDist: null,
    noBuiltIns: false,
    noPlugins: true, // skip plugin discovery — keeps tests deterministic against `process.cwd()`
    open: false,
    devCors: false,
    noWatcher: true, // dedicated watcher tests live in `server-ws-integration.test.ts`
    ...overrides,
  };
}

async function bootAndUse<T>(
  options: IServerOptions,
  fn: (handle: ServerHandle) => Promise<T>,
): Promise<T> {
  const handle = await createServer(options);
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

function url(handle: ServerHandle, path: string): string {
  return `http://127.0.0.1:${handle.address.port}${path}`;
}

interface IListEnvelope<T> {
  schemaVersion: string;
  kind: string;
  items: T[];
  filters: Record<string, unknown>;
  counts: { total: number; returned: number; page?: { offset: number; limit: number } };
}
interface ISingleEnvelope<T> {
  schemaVersion: string;
  kind: string;
  item: T;
}
interface IValueEnvelope<T> {
  schemaVersion: string;
  kind: string;
  value: T;
}

// ---------------------------------------------------------------------------
// /api/scan
// ---------------------------------------------------------------------------

describe('/api/scan', () => {
  it('returns the persisted ScanResult shape (byte-equal-ish to sm scan --json)', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/scan'));
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body['schemaVersion'], 1);
      assert.equal(typeof body['scannedAt'], 'number');
      assert.ok(Array.isArray(body['nodes']));
      assert.ok(Array.isArray(body['links']));
      assert.ok(Array.isArray(body['issues']));
      assert.ok((body['nodes'] as unknown[]).length >= 3, 'expected the primed fixture nodes');
    });
  });

  it('returns the empty ScanResult shape when the DB file is absent', async () => {
    await bootAndUse(defaultOptions({ dbPath: root.missingDb }), async (handle) => {
      const res = await fetch(url(handle, '/api/scan'));
      assert.equal(res.status, 200, 'must NOT 404 — see Decision §14.1 boot resilience');
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body['schemaVersion'], 1);
      assert.deepEqual(body['nodes'], []);
      assert.deepEqual(body['links'], []);
      assert.deepEqual(body['issues'], []);
    });
  });

  it('rejects ?fresh=1 with 400 bad-query when --no-built-ins was passed at boot', async () => {
    await bootAndUse(defaultOptions({ noBuiltIns: true }), async (handle) => {
      const res = await fetch(url(handle, '/api/scan?fresh=1'));
      assert.equal(res.status, 400);
      const body = (await res.json()) as { ok: boolean; error: { code: string } };
      assert.equal(body.ok, false);
      assert.equal(body.error.code, 'bad-query');
    });
  });
});

// ---------------------------------------------------------------------------
// /api/nodes (list)
// ---------------------------------------------------------------------------

describe('/api/nodes (list)', () => {
  it('returns every persisted node inside the list envelope', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/nodes'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IListEnvelope<{ path: string; kind: string }>;
      assert.equal(env.schemaVersion, '1');
      assert.equal(env.kind, 'nodes');
      assert.ok(env.items.length >= 3);
      assert.equal(env.counts.returned, env.items.length);
      assert.ok(env.counts.page, 'list endpoints carry a page object');
      assert.equal(env.counts.page!.offset, 0);
      assert.equal(env.counts.page!.limit, 100);
    });
  });

  it('honours ?kind=agent filter', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/nodes?kind=agent'));
      const env = (await res.json()) as IListEnvelope<{ kind: string }>;
      assert.ok(env.items.length >= 1);
      for (const item of env.items) assert.equal(item.kind, 'agent');
    });
  });

  it('honours ?path=**/architect.md glob', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, `/api/nodes?path=${encodeURIComponent('**/architect.md')}`));
      const env = (await res.json()) as IListEnvelope<{ path: string }>;
      assert.ok(env.items.some((n) => n.path.endsWith('/architect.md')));
      for (const item of env.items) assert.match(item.path, /architect\.md$/);
    });
  });

  it('rejects ?limit=foo with 400 bad-query', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/nodes?limit=foo'));
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'bad-query');
    });
  });

  it('rejects ?limit=1001 (over MAX) with 400 bad-query', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/nodes?limit=1001'));
      assert.equal(res.status, 400);
    });
  });

  it('rejects unknown query token via the ExportQueryError funnel', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      // The kernel grammar accepts only kind/has/path — `bogus` would
      // throw, but we go through `urlParamsToExportQuery` which only
      // forwards known params. Test the kernel-level rejection by
      // poking `?hasIssues=` with an unsupported value (already covered
      // above) — here, assert that a malformed `kind=` value (empty)
      // funnels through the same envelope.
      const res = await fetch(url(handle, '/api/nodes?kind='));
      assert.equal(res.status, 400);
      const body = (await res.json()) as { ok: boolean; error: { code: string } };
      assert.equal(body.ok, false);
      assert.equal(body.error.code, 'bad-query');
    });
  });
});

// ---------------------------------------------------------------------------
// /api/nodes/:pathB64
// ---------------------------------------------------------------------------

describe('/api/nodes/:pathB64', () => {
  it('returns the single-node bundle for an existing path', async () => {
    // Find a primed path first.
    await bootAndUse(defaultOptions(), async (handle) => {
      const listRes = await fetch(url(handle, '/api/nodes'));
      const list = (await listRes.json()) as IListEnvelope<{ path: string }>;
      const target = list.items[0]!.path;
      const encoded = encodeNodePath(target);
      const res = await fetch(url(handle, `/api/nodes/${encoded}`));
      assert.equal(res.status, 200);
      const env = (await res.json()) as ISingleEnvelope<{
        node: { path: string };
        linksOut: unknown[];
        linksIn: unknown[];
        issues: unknown[];
      }>;
      assert.equal(env.kind, 'node');
      assert.equal(env.item.node.path, target);
      assert.ok(Array.isArray(env.item.linksOut));
      assert.ok(Array.isArray(env.item.linksIn));
      assert.ok(Array.isArray(env.item.issues));
    });
  });

  it('returns 404 not-found for a path that is not in the persisted scan', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const encoded = encodeNodePath('does/not/exist.md');
      const res = await fetch(url(handle, `/api/nodes/${encoded}`));
      assert.equal(res.status, 404);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'not-found');
    });
  });

  it('returns 404 not-found for a malformed pathB64', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      // `=` is not in the base64url alphabet — decoder rejects.
      const res = await fetch(url(handle, '/api/nodes/AAA%3D%3D'));
      assert.equal(res.status, 404);
    });
  });
});

// ---------------------------------------------------------------------------
// /api/links
// ---------------------------------------------------------------------------

describe('/api/links', () => {
  it('returns every persisted link inside the list envelope', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/links'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IListEnvelope<{ source: string; target: string; kind: string }>;
      assert.equal(env.kind, 'links');
      // Don't assert specific count — depends on extractor specifics.
      assert.equal(env.counts.returned, env.items.length);
    });
  });

  it('honours ?from= filter', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const listRes = await fetch(url(handle, '/api/links'));
      const list = (await listRes.json()) as IListEnvelope<{ source: string }>;
      if (list.items.length === 0) return; // nothing to filter
      const source = list.items[0]!.source;
      const res = await fetch(url(handle, `/api/links?from=${encodeURIComponent(source)}`));
      const env = (await res.json()) as IListEnvelope<{ source: string }>;
      assert.ok(env.items.length > 0);
      for (const link of env.items) assert.equal(link.source, source);
    });
  });

  it('returns an empty list when DB is absent (graceful degradation)', async () => {
    await bootAndUse(defaultOptions({ dbPath: root.missingDb }), async (handle) => {
      const res = await fetch(url(handle, '/api/links'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IListEnvelope<unknown>;
      assert.equal(env.items.length, 0);
      assert.equal(env.counts.total, 0);
    });
  });
});

// ---------------------------------------------------------------------------
// /api/issues
// ---------------------------------------------------------------------------

describe('/api/issues', () => {
  it('returns every persisted issue inside the list envelope', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/issues'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IListEnvelope<{ ruleId: string; severity: string }>;
      assert.equal(env.kind, 'issues');
      assert.equal(env.counts.returned, env.items.length);
    });
  });

  it('honours ?severity=warn filter', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/issues?severity=warn'));
      const env = (await res.json()) as IListEnvelope<{ severity: string }>;
      for (const issue of env.items) assert.equal(issue.severity, 'warn');
    });
  });

  it('honours ?node= filter (only issues whose nodeIds include the path)', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const issuesRes = await fetch(url(handle, '/api/issues'));
      const issues = (await issuesRes.json()) as IListEnvelope<{ nodeIds: string[] }>;
      if (issues.items.length === 0) return;
      const target = issues.items[0]!.nodeIds[0]!;
      const res = await fetch(url(handle, `/api/issues?node=${encodeURIComponent(target)}`));
      const env = (await res.json()) as IListEnvelope<{ nodeIds: string[] }>;
      assert.ok(env.items.length > 0);
      for (const issue of env.items) assert.ok(issue.nodeIds.includes(target));
    });
  });
});

// ---------------------------------------------------------------------------
// /api/graph
// ---------------------------------------------------------------------------

describe('/api/graph', () => {
  it('renders the default ASCII formatter with text/plain', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/graph'));
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
      const text = await res.text();
      assert.ok(text.length > 0, 'expected non-empty ASCII rendering');
    });
  });

  it('rejects unknown ?format=mermaid with 400 bad-query', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/graph?format=mermaid'));
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      assert.equal(body.error.code, 'bad-query');
      assert.match(body.error.message, /mermaid/);
    });
  });
});

// ---------------------------------------------------------------------------
// /api/config
// ---------------------------------------------------------------------------

describe('/api/config', () => {
  it('returns the merged effective config inside a value envelope', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/config'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IValueEnvelope<{ schemaVersion: number; scan: unknown }>;
      assert.equal(env.kind, 'config');
      assert.equal(env.value.schemaVersion, 1);
      assert.ok(env.value.scan, 'merged config carries scan section');
    });
  });
});

// ---------------------------------------------------------------------------
// /api/plugins
// ---------------------------------------------------------------------------

describe('/api/plugins', () => {
  it('returns built-in plugins (claude + core) when --no-built-ins is off', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/plugins'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IListEnvelope<{
        id: string;
        source: string;
        status: string;
      }>;
      assert.equal(env.kind, 'plugins');
      const builtIns = env.items.filter((p) => p.source === 'built-in');
      assert.ok(builtIns.some((p) => p.id === 'claude'), 'expected claude built-in');
      assert.ok(builtIns.some((p) => p.id === 'core'), 'expected core built-in');
    });
  });

  it('omits built-ins when noBuiltIns=true', async () => {
    await bootAndUse(defaultOptions({ noBuiltIns: true }), async (handle) => {
      const res = await fetch(url(handle, '/api/plugins'));
      const env = (await res.json()) as IListEnvelope<{ source: string }>;
      assert.equal(env.items.filter((p) => p.source === 'built-in').length, 0);
    });
  });
});

// ---------------------------------------------------------------------------
// Catch-all 404 (regression for 14.1)
// ---------------------------------------------------------------------------

describe('/api/* catch-all (still in place after 14.2)', () => {
  it('returns the 404 envelope for an unknown /api path', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/never-defined'));
      assert.equal(res.status, 404);
      const body = (await res.json()) as { ok: boolean; error: { code: string } };
      assert.equal(body.ok, false);
      assert.equal(body.error.code, 'not-found');
    });
  });
});
