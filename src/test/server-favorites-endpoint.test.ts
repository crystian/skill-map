/**
 * `PUT/DELETE /api/favorites/:pathB64` integration tests.
 *
 * Each test boots a real `createServer()` against a primed-DB tempdir,
 * fires `fetch()` against the endpoint, and asserts on the HTTP status
 * + the persisted `state_node_favorites` row.
 *
 * Coverage:
 *   - 204: PUT marks an existing path as favorited.
 *   - 404: PUT against an unknown path → `not-found` envelope.
 *   - 204: PUT is idempotent (second call refreshes timestamp, no error).
 *   - 204: DELETE drops the row.
 *   - 204: DELETE is idempotent (no row → still 204, no error).
 *   - GET /api/nodes decorates `isFavorite: true` on the listed item.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {afterAll as after,beforeAll as before, beforeEach, describe, it } from 'bun:test';

import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../kernel/adapters/sqlite/scan-persistence.js';
import type { Node, ScanResult } from '../kernel/types.js';
import { encodeNodePath } from '../server/path-codec.js';
import {
  createServer,
  type IServerOptions,
  type ServerHandle,
} from '../server/index.js';

const HASH_BODY = 'a'.repeat(64);
const HASH_FRONTMATTER = 'b'.repeat(64);

interface ITestRoot {
  tmp: string;
  fixtureRoot: string;
  dbPath: string;
}

let root: ITestRoot;

before(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-fav-endpoint-'));
  const fixtureRoot = join(tmp, 'fixture');
  const dbPath = join(tmp, 'primed.db');
  root = { tmp, fixtureRoot, dbPath };
});

after(() => {
  rmSync(root.tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  rmSync(root.dbPath, { force: true });
  await primeFixture();
});

async function primeFixture(): Promise<void> {
  const result: ScanResult = {
    schemaVersion: 1,
    scannedAt: Date.now(),
    scope: 'project',
    roots: [root.fixtureRoot],
    providers: ['claude'],
    nodes: [makeNode('skills/foo.md'), makeNode('agents/bar.md')],
    links: [],
    issues: [],
    stats: {
      filesWalked: 2,
      filesSkipped: 0,
      nodesCount: 2,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
  };
  const adapter = new SqliteStorageAdapter({
    databasePath: root.dbPath,
    autoBackup: false,
  });
  await adapter.init();
  try {
    await persistScanResult(adapter.db, result);
  } finally {
    await adapter.close();
  }
}

function makeNode(path: string): Node {
  return {
    path,
    kind: 'skill',
    provider: 'claude',
    bodyHash: HASH_BODY,
    frontmatterHash: HASH_FRONTMATTER,
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

function defaultOptions(): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    scope: 'project',
    dbPath: root.dbPath,
    uiDist: null,
    noUi: false,
    noBuiltIns: false,
    noPlugins: true,
    open: false,
    devCors: false,
    noWatcher: true,
  };
}

async function bootAndUse<T>(
  fn: (handle: ServerHandle) => Promise<T>,
): Promise<T> {
  const handle = await createServer(defaultOptions(), {
    runtimeContext: { cwd: root.fixtureRoot, homedir: tmpdir() },
  });
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

function url(handle: ServerHandle, path: string): string {
  return `http://127.0.0.1:${handle.address.port}${path}`;
}

async function readFavoritePaths(): Promise<Set<string>> {
  const adapter = new SqliteStorageAdapter({
    databasePath: root.dbPath,
    autoBackup: false,
  });
  await adapter.init();
  try {
    return await adapter.favorites.listPaths();
  } finally {
    await adapter.close();
  }
}

describe('PUT /api/favorites/:pathB64', () => {
  it('204: marks an existing path as favorited', async () => {
    await bootAndUse(async (handle) => {
      const b64 = encodeNodePath('skills/foo.md');
      const res = await fetch(url(handle, `/api/favorites/${b64}`), {
        method: 'PUT',
      });
      assert.equal(res.status, 204);
      const persisted = await readFavoritePaths();
      assert.ok(persisted.has('skills/foo.md'));
    });
  });

  it('404: unknown nodePath → not-found envelope', async () => {
    await bootAndUse(async (handle) => {
      const b64 = encodeNodePath('skills/never.md');
      const res = await fetch(url(handle, `/api/favorites/${b64}`), {
        method: 'PUT',
      });
      assert.equal(res.status, 404);
      const body = (await res.json()) as { ok: boolean; error: { code: string } };
      assert.equal(body.ok, false);
      assert.equal(body.error.code, 'not-found');
      const persisted = await readFavoritePaths();
      assert.equal(persisted.size, 0);
    });
  });

  it('idempotent: second PUT refreshes timestamp, no error', async () => {
    await bootAndUse(async (handle) => {
      const b64 = encodeNodePath('skills/foo.md');
      const r1 = await fetch(url(handle, `/api/favorites/${b64}`), { method: 'PUT' });
      assert.equal(r1.status, 204);
      const r2 = await fetch(url(handle, `/api/favorites/${b64}`), { method: 'PUT' });
      assert.equal(r2.status, 204);
      const persisted = await readFavoritePaths();
      assert.equal(persisted.size, 1);
    });
  });

  it('404: malformed pathB64 → not-found', async () => {
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/favorites/!!!not-base64!!!'), {
        method: 'PUT',
      });
      assert.equal(res.status, 404);
    });
  });
});

describe('DELETE /api/favorites/:pathB64', () => {
  it('204: drops the row', async () => {
    await bootAndUse(async (handle) => {
      const b64 = encodeNodePath('skills/foo.md');
      // Set first.
      await fetch(url(handle, `/api/favorites/${b64}`), { method: 'PUT' });
      // Then unset.
      const res = await fetch(url(handle, `/api/favorites/${b64}`), {
        method: 'DELETE',
      });
      assert.equal(res.status, 204);
      const persisted = await readFavoritePaths();
      assert.equal(persisted.size, 0);
    });
  });

  it('idempotent: DELETE on a path with no favorite row → 204', async () => {
    await bootAndUse(async (handle) => {
      const b64 = encodeNodePath('skills/foo.md');
      const res = await fetch(url(handle, `/api/favorites/${b64}`), {
        method: 'DELETE',
      });
      assert.equal(res.status, 204);
    });
  });

  it('idempotent: DELETE on an unknown path → 204 (no existence check)', async () => {
    await bootAndUse(async (handle) => {
      const b64 = encodeNodePath('skills/never.md');
      const res = await fetch(url(handle, `/api/favorites/${b64}`), {
        method: 'DELETE',
      });
      assert.equal(res.status, 204);
    });
  });
});

describe('GET /api/nodes — isFavorite decoration', () => {
  it('decorates isFavorite=true on favorited paths and false on others', async () => {
    await bootAndUse(async (handle) => {
      const b64 = encodeNodePath('skills/foo.md');
      await fetch(url(handle, `/api/favorites/${b64}`), { method: 'PUT' });

      const res = await fetch(url(handle, '/api/nodes'));
      assert.equal(res.status, 200);
      const body = (await res.json()) as { items: Array<{ path: string; isFavorite?: boolean }> };
      const foo = body.items.find((n) => n.path === 'skills/foo.md');
      const bar = body.items.find((n) => n.path === 'agents/bar.md');
      assert.ok(foo);
      assert.ok(bar);
      assert.equal(foo.isFavorite, true);
      assert.equal(bar.isFavorite, false);
    });
  });

  it('decorates isFavorite on the single-node route too', async () => {
    await bootAndUse(async (handle) => {
      const b64 = encodeNodePath('skills/foo.md');
      await fetch(url(handle, `/api/favorites/${b64}`), { method: 'PUT' });
      const res = await fetch(url(handle, `/api/nodes/${b64}`));
      assert.equal(res.status, 200);
      const body = (await res.json()) as { item: { path: string; isFavorite?: boolean } };
      assert.equal(body.item.isFavorite, true);
    });
  });

  it('decorates isFavorite on /api/scan (the SPA cold-boot endpoint)', async () => {
    await bootAndUse(async (handle) => {
      const b64 = encodeNodePath('skills/foo.md');
      await fetch(url(handle, `/api/favorites/${b64}`), { method: 'PUT' });
      // /api/scan is the endpoint CollectionLoaderService hits on F5 /
      // cold boot. Without isFavorite decoration here, the filter-bar
      // toggle stays hidden after page reload because hasAnyFavorites
      // computes off the loaded snapshot.
      const res = await fetch(url(handle, '/api/scan'));
      assert.equal(res.status, 200);
      const body = (await res.json()) as { nodes: Array<{ path: string; isFavorite?: boolean }> };
      const foo = body.nodes.find((n) => n.path === 'skills/foo.md');
      const bar = body.nodes.find((n) => n.path === 'agents/bar.md');
      assert.ok(foo);
      assert.ok(bar);
      assert.equal(foo.isFavorite, true);
      assert.equal(bar.isFavorite, false);
    });
  });
});
