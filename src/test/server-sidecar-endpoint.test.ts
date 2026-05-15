/**
 * Step 9.6.5 (BFF half) — `POST /api/sidecar/bump` integration tests.
 *
 * Mirrors `server-endpoints.test.ts` shape. Each test boots a real
 * `createServer()` instance against a primed-DB tempdir + matching `.md`
 * / `.sm` fixtures, fires a `fetch()` against the endpoint, and asserts
 * on the REST envelope, the on-disk sidecar contents, and (where
 * relevant) the broadcaster receipt.
 *
 * Coverage:
 *
 *   - 200: stale node → version increments, status `fresh`, broadcaster
 *     receives the `sidecar.bumped` event.
 *   - 409: fresh node + no force → `sidecar-fresh` envelope, NO broadcast.
 *   - 200: fresh node + force=true → silent no-op (per Action spec),
 *     200 envelope with the existing version, NO broadcast (decision:
 *     no-op = no event; documented in `routes/sidecar.ts` header).
 *   - 404: unknown nodePath → not-found envelope, NO broadcast.
 *   - 400: malformed body (missing nodePath / wrong types) → bad-query.
 *
 * Broadcaster receipts are observed by registering a fake
 * `IBroadcasterClient` directly on `handle.broadcaster` BEFORE issuing
 * the HTTP request. The fake records every `send()` call. Same pattern
 * as `server-ws-broadcaster.test.ts` — no real `ws` client needed for
 * the assertion.
 */

import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {afterAll as after,beforeAll as before, beforeEach, describe, it } from 'bun:test';

import { Ajv2020 } from 'ajv/dist/2020.js';
import yaml from 'js-yaml';

import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../kernel/adapters/sqlite/scan-persistence.js';
import { _resetSidecarStoreValidatorCacheForTests } from '../kernel/sidecar/store.js';
import type { Node, ScanResult, SidecarStatus } from '../kernel/types.js';
import {
  createServer,
  type IBroadcasterClient,
  type IServerOptions,
  type ServerHandle,
} from '../server/index.js';

const HASH_LIVE_BODY = 'a'.repeat(64);
const HASH_LIVE_FRONTMATTER = 'b'.repeat(64);
// `for` hashes captured by an earlier bump. For the stale fixture the
// body hash differs (we mutate the body after the bump), so the kernel
// computes status: 'stale-body'. For the fresh fixture both match.
const HASH_OLD_BODY = 'c'.repeat(64);

interface ITestRoot {
  tmp: string;
  fixtureRoot: string;
  dbPath: string;
}

let root: ITestRoot;

before(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-sidecar-endpoint-'));
  const fixtureRoot = mkdtempSync(join(tmp, 'fixture-'));
  const dbPath = join(tmp, 'primed.db');
  root = { tmp, fixtureRoot, dbPath };
});

after(() => {
  rmSync(root.tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  // Re-prime the DB + fixtures from scratch on every test so a previous
  // test's sidecar mutation doesn't leak into the next one.
  _resetSidecarStoreValidatorCacheForTests();
  rmSync(root.fixtureRoot, { recursive: true, force: true });
  mkdirSync(root.fixtureRoot, { recursive: true });
  rmSync(root.dbPath, { force: true });
  await primeFixture();
});

/**
 * Plant two `.md` nodes (one stale, one fresh) and persist them with
 * matching sidecar overlays into a fresh SQLite DB. Plant the
 * accompanying `.sm` files on disk so the bump Action's writes land on
 * a real file the test can re-read.
 */
async function primeFixture(): Promise<void> {
  // --- stale node ---------------------------------------------------------
  const stalePath = 'docs/stale.md';
  writeFile(stalePath, '---\nname: stale\n---\nlive body content\n');
  writeFile('docs/stale.sm', yaml.dump({
    for: {
      path: stalePath,
      // OLD body hash (≠ HASH_LIVE_BODY) → status: 'stale-body'.
      bodyHash: HASH_OLD_BODY,
      frontmatterHash: HASH_LIVE_FRONTMATTER,
    },
    annotations: { version: 3 },
  }));

  // --- fresh node ---------------------------------------------------------
  const freshPath = 'docs/fresh.md';
  writeFile(freshPath, '---\nname: fresh\n---\nlive body content\n');
  writeFile('docs/fresh.sm', yaml.dump({
    for: {
      path: freshPath,
      bodyHash: HASH_LIVE_BODY,
      frontmatterHash: HASH_LIVE_FRONTMATTER,
    },
    annotations: { version: 7 },
  }));

  const result: ScanResult = {
    schemaVersion: 1,
    scannedAt: Date.now(),
    scope: 'project',
    roots: [root.fixtureRoot],
    providers: ['claude'],
    nodes: [
      makeNode(stalePath, 'stale-body', 3),
      makeNode(freshPath, 'fresh', 7),
    ],
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

function makeNode(
  nodePath: string,
  status: SidecarStatus,
  version: number,
): Node {
  return {
    path: nodePath,
    kind: 'agent',
    provider: 'claude',
    bodyHash: HASH_LIVE_BODY,
    frontmatterHash: HASH_LIVE_FRONTMATTER,
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    sidecar: {
      present: true,
      status,
      annotations: { version },
    },
  };
}

function writeFile(rel: string, content: string): void {
  const abs = join(root.fixtureRoot, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
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

interface IFakeClient extends IBroadcasterClient {
  sent: string[];
}

function makeFakeClient(): IFakeClient {
  const sent: string[] = [];
  return {
    sent,
    bufferedAmount: 0,
    readyState: 1,
    send(data: string): void {
      sent.push(data);
    },
    close(): void { /* no-op */ },
  };
}

interface ISidecarBumpedEnvelope {
  schemaVersion: string;
  kind: string;
  value: { nodePath: string; version: number | null; status: string };
  elapsedMs: number;
}

describe('POST /api/sidecar/bump', () => {
  it('200: stale node → version increments, broadcaster receives sidecar.bumped', async () => {
    await bootAndUse(async (handle) => {
      const client = makeFakeClient();
      handle.broadcaster.register(client);

      const res = await fetch(url(handle, '/api/sidecar/bump'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodePath: 'docs/stale.md' }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as ISidecarBumpedEnvelope;
      assert.equal(env.schemaVersion, '1');
      assert.equal(env.kind, 'sidecar.bumped');
      assert.equal(env.value.nodePath, 'docs/stale.md');
      assert.equal(env.value.version, 4); // 3 → 4
      assert.equal(env.value.status, 'fresh');
      assert.ok(typeof env.elapsedMs === 'number');

      // On-disk sidecar reflects the new version.
      const sidecarRaw = readFileSync(
        join(root.fixtureRoot, 'docs/stale.sm'),
        'utf8',
      );
      const parsed = yaml.load(sidecarRaw) as Record<string, unknown>;
      const annotations = parsed['annotations'] as Record<string, unknown>;
      assert.equal(annotations['version'], 4);
      const audit = parsed['audit'] as Record<string, unknown>;
      assert.equal(audit['lastBumpedBy'], 'ui');

      // Broadcaster fan-out — canonical `{ type, timestamp, data }`
      // envelope (R9 closed at 9.6.7). Mirrors the shape every kernel→
      // broadcaster bridge in `server/watcher.ts` already produces.
      assert.equal(client.sent.length, 1);
      const event = JSON.parse(client.sent[0]!) as Record<string, unknown>;
      assert.equal(event['type'], 'sidecar.bumped');
      assert.equal(typeof event['timestamp'], 'string');
      // Kernel orchestrator + this route both serialise via
      // `new Date().toISOString()` — assert the canonical ISO 8601
      // shape so a regression to unix-ms surfaces immediately.
      assert.match(
        event['timestamp'] as string,
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
      const data = event['data'] as Record<string, unknown>;
      assert.equal(typeof data, 'object');
      assert.equal(data['nodePath'], 'docs/stale.md');
      assert.equal(data['version'], 4);
      assert.equal(data['status'], 'fresh');
      // No flat siblings on the envelope itself — payload lives only
      // under `data` (R9 enforces a single shape).
      assert.equal(event['nodePath'], undefined);
      assert.equal(event['version'], undefined);
      assert.equal(event['status'], undefined);
    });
  });

  it('409: fresh node + no force → sidecar-fresh, NO broadcast', async () => {
    await bootAndUse(async (handle) => {
      const client = makeFakeClient();
      handle.broadcaster.register(client);

      const res = await fetch(url(handle, '/api/sidecar/bump'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodePath: 'docs/fresh.md' }),
      });
      assert.equal(res.status, 409);
      const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
      assert.equal(body.ok, false);
      assert.equal(body.error.code, 'sidecar-fresh');
      assert.match(body.error.message, /sidecar-fresh/);

      // Sidecar untouched.
      const parsed = yaml.load(
        readFileSync(join(root.fixtureRoot, 'docs/fresh.sm'), 'utf8'),
      ) as Record<string, unknown>;
      const annotations = parsed['annotations'] as Record<string, unknown>;
      assert.equal(annotations['version'], 7);
      assert.equal(parsed['audit'], undefined);

      // No broadcast on refusal.
      assert.equal(client.sent.length, 0);
    });
  });

  it('200: fresh node + force=true → silent no-op, NO broadcast (decision: no-op = no event)', async () => {
    await bootAndUse(async (handle) => {
      const client = makeFakeClient();
      handle.broadcaster.register(client);

      const res = await fetch(url(handle, '/api/sidecar/bump'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodePath: 'docs/fresh.md', force: true }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as ISidecarBumpedEnvelope;
      assert.equal(env.kind, 'sidecar.bumped');
      // Existing version, unchanged.
      assert.equal(env.value.version, 7);
      assert.equal(env.value.status, 'fresh');

      // Sidecar untouched on disk.
      const parsed = yaml.load(
        readFileSync(join(root.fixtureRoot, 'docs/fresh.sm'), 'utf8'),
      ) as Record<string, unknown>;
      const annotations = parsed['annotations'] as Record<string, unknown>;
      assert.equal(annotations['version'], 7);
      assert.equal(parsed['audit'], undefined, 'force-on-fresh is a no-op; audit MUST NOT be stamped');

      // No broadcast on no-op (decision: no-op = no event).
      assert.equal(client.sent.length, 0);
    });
  });

  it('404: unknown nodePath → not-found, NO broadcast', async () => {
    await bootAndUse(async (handle) => {
      const client = makeFakeClient();
      handle.broadcaster.register(client);

      const res = await fetch(url(handle, '/api/sidecar/bump'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodePath: 'docs/never-existed.md' }),
      });
      assert.equal(res.status, 404);
      const body = (await res.json()) as { ok: boolean; error: { code: string } };
      assert.equal(body.ok, false);
      assert.equal(body.error.code, 'not-found');
      assert.equal(client.sent.length, 0);
    });
  });

  it('400: missing nodePath → bad-query', async () => {
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/sidecar/bump'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'bad-query');
    });
  });

  it('400: wrong types (force as string) → bad-query', async () => {
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/sidecar/bump'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodePath: 'docs/stale.md', force: 'yes' }),
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'bad-query');
    });
  });

  it('400: malformed JSON body → bad-query', async () => {
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/sidecar/bump'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      });
      assert.equal(res.status, 400);
    });
  });

  it('reuses the on-disk .sm file the CLI bump verb would produce (round-trip parity)', async () => {
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/sidecar/bump'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodePath: 'docs/stale.md' }),
      });
      assert.equal(res.status, 200);
      const sidecarPath = join(root.fixtureRoot, 'docs/stale.sm');
      assert.ok(existsSync(sidecarPath));
      const parsed = yaml.load(readFileSync(sidecarPath, 'utf8')) as Record<string, unknown>;
      const audit = parsed['audit'] as Record<string, unknown>;
      assert.equal(audit['lastBumpedBy'], 'ui');
      assert.ok(typeof audit['lastBumpedAt'] === 'string');
    });
  });

  it('200 envelope validates against rest-envelope.schema.json (R7 closed)', async () => {
    // Cross-cutting check that the route's wire shape conforms to the
    // canonical `rest-envelope.schema.json`. Mirrors the pattern in
    // `plugin-store-output-schema.test.ts` (Ajv2020 + draft-2020-12).
    // Any future drift in the route or the schema fails here.
    const validate = compileEnvelopeValidator();
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/sidecar/bump'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodePath: 'docs/stale.md' }),
      });
      assert.equal(res.status, 200);
      const env = await res.json();
      const ok = validate(env);
      assert.equal(
        ok,
        true,
        `envelope must validate: ${JSON.stringify(validate.errors)}`,
      );
    });
  });
});

/**
 * Resolve and AJV-compile `spec/schemas/api/rest-envelope.schema.json`.
 * Mirrors the require.resolve dance used by the unknown-field rule
 * (`built-in-plugins/rules/unknown-field/index.ts:getKnownAnnotationKeys`).
 */
function compileEnvelopeValidator(): ReturnType<Ajv2020['compile']> {
  const require = createRequire(import.meta.url);
  const indexPath = require.resolve('@skill-map/spec/index.json');
  const specRoot = dirname(indexPath);
  const schemaPath = resolve(specRoot, 'schemas/api/rest-envelope.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  return ajv.compile(schema);
}
