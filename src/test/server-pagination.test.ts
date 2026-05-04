/**
 * Step 14.2 — pagination contract tests for `/api/nodes`.
 *
 * Asserts:
 *
 *   - Default `limit=100`, `offset=0`.
 *   - `limit=N` caps the page size.
 *   - `offset=N` skips the first N rows.
 *   - `total` and `returned` track the unpaginated vs. paginated count.
 *   - `limit=1001` rejects (over MAX_LIMIT).
 *   - `limit=foo` / negative offset / non-integer offset all reject.
 *
 * Drives the route directly via `createServer` + `fetch`. Uses a
 * synthetic prebuilt fixture with > 100 nodes so the paging boundaries
 * are observable.
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

const PAGE_FIXTURE_NODE_COUNT = 120; // > MAX defaults so paging is observable

let tmpRoot: string;
let dbPath: string;

before(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-server-pagination-'));
  const fixtureDir = mkdtempSync(join(tmpRoot, 'fixture-'));
  plantManyNodes(fixtureDir, PAGE_FIXTURE_NODE_COUNT);
  dbPath = join(tmpRoot, 'paginate.db');
  await primeDb(fixtureDir, dbPath);
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function plantManyNodes(dir: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const idx = String(i).padStart(3, '0');
    const rel = `.claude/notes/note-${idx}.md`;
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(
      abs,
      [
        '---',
        `name: note-${idx}`,
        `description: Note ${idx}.`,
        '---',
        `Body of note ${idx}.`,
      ].join('\n'),
    );
  }
}

async function primeDb(fixtureDir: string, db: string): Promise<void> {
  const kernel = createKernel();
  for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
  const result = await runScan(kernel, {
    roots: [fixtureDir],
    extensions: builtIns(),
  });
  const adapter = new SqliteStorageAdapter({ databasePath: db, autoBackup: false });
  await adapter.init();
  try {
    await persistScanResult(adapter.db, result);
  } finally {
    await adapter.close();
  }
}

function defaultOptions(overrides: Partial<IServerOptions> = {}): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    scope: 'project',
    dbPath,
    uiDist: null,
    noUi: false,
    noBuiltIns: false,
    noPlugins: true,
    open: false,
    devCors: false,
    noWatcher: true,
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

interface IListEnvelope<T> {
  items: T[];
  counts: { total: number; returned: number; page?: { offset: number; limit: number } };
}

function url(handle: ServerHandle, path: string): string {
  return `http://127.0.0.1:${handle.address.port}${path}`;
}

describe('/api/nodes — pagination boundaries', () => {
  it('default page caps at limit=100', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/nodes'));
      const env = (await res.json()) as IListEnvelope<unknown>;
      assert.equal(env.items.length, 100);
      assert.equal(env.counts.returned, 100);
      assert.equal(env.counts.total, PAGE_FIXTURE_NODE_COUNT);
      assert.deepEqual(env.counts.page, { offset: 0, limit: 100 });
    });
  });

  it('?limit=10 returns 10 items', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/nodes?limit=10'));
      const env = (await res.json()) as IListEnvelope<unknown>;
      assert.equal(env.items.length, 10);
      assert.equal(env.counts.returned, 10);
      assert.equal(env.counts.total, PAGE_FIXTURE_NODE_COUNT);
      assert.deepEqual(env.counts.page, { offset: 0, limit: 10 });
    });
  });

  it('?limit=10&offset=5 skips the first 5 rows', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res1 = await fetch(url(handle, '/api/nodes?limit=10&offset=0'));
      const res2 = await fetch(url(handle, '/api/nodes?limit=10&offset=5'));
      const env1 = (await res1.json()) as IListEnvelope<{ path: string }>;
      const env2 = (await res2.json()) as IListEnvelope<{ path: string }>;
      assert.equal(env1.items.length, 10);
      assert.equal(env2.items.length, 10);
      // The `offset=5` page must start where the `offset=0` page's 6th
      // item (index 5) lives — paging is order-stable.
      assert.equal(env2.items[0]!.path, env1.items[5]!.path);
    });
  });

  it('?limit=1000 (= MAX) is accepted', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/nodes?limit=1000'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IListEnvelope<unknown>;
      // Total items are < 1000 in this fixture, so returned == total.
      assert.equal(env.items.length, PAGE_FIXTURE_NODE_COUNT);
      assert.equal(env.counts.page!.limit, 1000);
    });
  });

  it('?limit=1001 (> MAX) rejects with 400 bad-query', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/nodes?limit=1001'));
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      assert.equal(body.error.code, 'bad-query');
      assert.match(body.error.message, /1000/);
    });
  });

  it('?limit=-1 rejects with 400 bad-query', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/nodes?limit=-1'));
      assert.equal(res.status, 400);
    });
  });

  it('?offset=-1 rejects with 400 bad-query', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/nodes?offset=-1'));
      assert.equal(res.status, 400);
    });
  });

  it('?offset=foo rejects with 400 bad-query', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/nodes?offset=foo'));
      assert.equal(res.status, 400);
    });
  });

  it('?offset=0&limit=0 returns zero items but reports the total', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/nodes?offset=0&limit=0'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IListEnvelope<unknown>;
      assert.equal(env.items.length, 0);
      assert.equal(env.counts.total, PAGE_FIXTURE_NODE_COUNT);
    });
  });

  it('offset past total returns empty items but preserves total', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, `/api/nodes?offset=${PAGE_FIXTURE_NODE_COUNT + 50}&limit=10`));
      const env = (await res.json()) as IListEnvelope<unknown>;
      assert.equal(env.items.length, 0);
      assert.equal(env.counts.total, PAGE_FIXTURE_NODE_COUNT);
    });
  });
});
