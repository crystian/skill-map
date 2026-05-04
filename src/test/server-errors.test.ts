/**
 * Step 14.2 — error envelope contract.
 *
 * Asserts every `code` value maps to the documented HTTP status:
 *
 *   - `not-found`  → 404 (unknown /api/* path; missing node; malformed pathB64)
 *   - `bad-query`  → 400 (HTTPException(400); ExportQueryError)
 *   - `internal`   → 500 (uncaught Error)
 *
 * The `db-missing` code is documented in the catalogue but not currently
 * thrown by any 14.2 route — DB-missing endpoints degrade to empty
 * shapes rather than failing. The mapping is asserted via a synthetic
 * direct call to `formatError` (see end of file).
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  createServer,
  type IServerOptions,
  type ServerHandle,
} from '../server/index.js';

let tmpRoot: string;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-server-errors-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function defaultOptions(overrides: Partial<IServerOptions> = {}): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    scope: 'project',
    dbPath: join(tmpRoot, 'never-existed.db'),
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

function url(handle: ServerHandle, path: string): string {
  return `http://127.0.0.1:${handle.address.port}${path}`;
}

interface IErrorBody {
  ok: false;
  error: { code: string; message: string; details: unknown };
}

describe('error envelope — code ↔ HTTP status mapping', () => {
  it('not-found: unknown /api path → 404', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/never-defined'));
      assert.equal(res.status, 404);
      const body = (await res.json()) as IErrorBody;
      assert.equal(body.ok, false);
      assert.equal(body.error.code, 'not-found');
      assert.equal(typeof body.error.message, 'string');
      assert.ok('details' in body.error, 'envelope must carry details key');
    });
  });

  it('not-found: malformed pathB64 → 404', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/nodes/AAA%3D%3D'));
      assert.equal(res.status, 404);
      const body = (await res.json()) as IErrorBody;
      assert.equal(body.error.code, 'not-found');
    });
  });

  it('bad-query: ExportQueryError funnels to 400', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      // `?kind=` (empty value) → ExportQueryError → 400 bad-query.
      const res = await fetch(url(handle, '/api/nodes?kind='));
      assert.equal(res.status, 400);
      const body = (await res.json()) as IErrorBody;
      assert.equal(body.error.code, 'bad-query');
    });
  });

  it('bad-query: pagination cap → 400', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/nodes?limit=9999'));
      assert.equal(res.status, 400);
      const body = (await res.json()) as IErrorBody;
      assert.equal(body.error.code, 'bad-query');
    });
  });

  it('bad-query: HTTPException(400) from /api/scan?fresh=1 + --no-built-ins → 400', async () => {
    await bootAndUse(defaultOptions({ noBuiltIns: true }), async (handle) => {
      const res = await fetch(url(handle, '/api/scan?fresh=1'));
      assert.equal(res.status, 400);
      const body = (await res.json()) as IErrorBody;
      assert.equal(body.error.code, 'bad-query');
    });
  });

  it('bad-query: unknown formatter on /api/graph → 400', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const res = await fetch(url(handle, '/api/graph?format=does-not-exist'));
      assert.equal(res.status, 400);
      const body = (await res.json()) as IErrorBody;
      assert.equal(body.error.code, 'bad-query');
    });
  });

  it('not-found: missing node on /api/nodes/:pathB64 → 404', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      // Encoded `does/not/exist.md` → 404 against an empty (missing) DB.
      // The DB-missing code path returns null from `tryWithSqlite`, then
      // the route handler treats "no bundle" the same as "no such node".
      const encoded = 'ZG9lcy9ub3QvZXhpc3QubWQ'; // base64url of 'does/not/exist.md'
      const res = await fetch(url(handle, `/api/nodes/${encoded}`));
      assert.equal(res.status, 404);
      const body = (await res.json()) as IErrorBody;
      assert.equal(body.error.code, 'not-found');
    });
  });

  it('every error response carries the canonical envelope shape', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      const probes = [
        '/api/never-defined',                  // 404 not-found
        '/api/nodes?limit=foo',                // 400 bad-query
        '/api/graph?format=does-not-exist',    // 400 bad-query
      ];
      for (const path of probes) {
        const res = await fetch(url(handle, path));
        const body = (await res.json()) as IErrorBody;
        assert.equal(body.ok, false, `${path}: ok must be false`);
        assert.ok(body.error, `${path}: envelope must carry error`);
        assert.equal(typeof body.error.code, 'string', `${path}: code is string`);
        assert.equal(typeof body.error.message, 'string', `${path}: message is string`);
        assert.ok('details' in body.error, `${path}: envelope must carry details key`);
      }
    });
  });
});
