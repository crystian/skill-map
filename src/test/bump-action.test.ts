/**
 * Step 9.6.3 — built-in `bump` Action tests.
 *
 * Action stays pure: `invoke()` is called against synthesised `Node`s
 * with the sidecar overlay set the way the kernel would set it after
 * the 9.6.2 reader runs. The materialisation half (write → file)
 * is exercised end-to-end against `FilesystemSidecarStore` so the
 * round-trip "Action returns a patch → kernel calls store → file on
 * disk holds the expected bytes" is covered.
 */

import { describe, it,beforeAll as before,afterAll as after, beforeEach } from 'bun:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';

import {
  bumpAction,
  type IBumpInput,
  type IBumpReport,
} from '../built-in-plugins/actions/bump/index.js';
import {
  FilesystemSidecarStore,
  _resetSidecarStoreValidatorCacheForTests,
} from '../kernel/sidecar/store.js';
import type { IActionContext, IActionResult } from '../kernel/extensions/index.js';
import type { Node } from '../kernel/types.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);

let tmpRoot: string;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'sm-bump-action-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  _resetSidecarStoreValidatorCacheForTests();
});

function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    path: 'docs/example.md',
    kind: 'agent',
    provider: 'claude',
    bodyHash: HASH_A,
    frontmatterHash: HASH_B,
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    ...overrides,
  };
}

function makeCtx(node: Node, mdAbsPath: string, invoker = 'cli'): IActionContext {
  return {
    node,
    nodeAbsolutePath: mdAbsPath,
    invoker,
    now: () => new Date('2026-05-05T12:00:00.000Z'),
  };
}

function callBump(
  input: IBumpInput,
  ctx: IActionContext,
): IActionResult<IBumpReport> {
  if (!bumpAction.invoke) throw new Error('bumpAction.invoke missing');
  return bumpAction.invoke<IBumpInput, IBumpReport>(input, ctx);
}

describe('built-in bump action — refusal / no-op paths', () => {
  it('refuses on a fresh node when force is not set (no writes)', () => {
    const node = makeNode({
      sidecar: {
        present: true,
        status: 'fresh',
        annotations: { version: 3 },
      },
    });
    const result = callBump({}, makeCtx(node, '/abs/example.md'));

    strictEqual(result.report.ok, false);
    strictEqual(result.report.reason, 'fresh');
    strictEqual(result.writes, undefined);
  });

  it('silent no-op on a fresh node when force is true (no writes)', () => {
    const node = makeNode({
      sidecar: { present: true, status: 'fresh', annotations: { version: 7 } },
    });
    const result = callBump({ force: true }, makeCtx(node, '/abs/example.md'));

    strictEqual(result.report.ok, true);
    strictEqual(result.report.noop, true);
    strictEqual(result.writes, undefined);
  });
});

describe('built-in bump action — stale path produces a patch', () => {
  it('increments version, refreshes hashes, populates audit (existing sidecar)', () => {
    const node = makeNode({
      bodyHash: HASH_C,
      frontmatterHash: HASH_D,
      sidecar: {
        present: true,
        status: 'stale-body',
        annotations: { version: 4 },
      },
    });
    const result = callBump({}, makeCtx(node, '/repo/docs/example.md', 'cli'));

    strictEqual(result.report.ok, true);
    strictEqual(result.report.version, 5);
    // existing sidecar -> no createdSidecar flag
    strictEqual(result.report.createdSidecar, undefined);

    ok(result.writes && result.writes.length === 1);
    const w = result.writes[0]!;
    strictEqual(w.kind, 'sidecar');
    strictEqual(w.path, '/repo/docs/example.sm');
    deepStrictEqual(w.changes['for'], {
      path: 'docs/example.md',
      bodyHash: HASH_C,
      frontmatterHash: HASH_D,
    });
    deepStrictEqual(w.changes['annotations'], { version: 5 });
    const audit = w.changes['audit'] as Record<string, unknown>;
    strictEqual(audit['lastBumpedAt'], '2026-05-05T12:00:00.000Z');
    strictEqual(audit['lastBumpedBy'], 'cli');
    // existing sidecar — no createdAt/createdBy
    strictEqual(audit['createdAt'], undefined);
    strictEqual(audit['createdBy'], undefined);
  });

  it('first-time bump (no sidecar yet) sets createdAt + createdBy', () => {
    const node = makeNode({
      sidecar: { present: false },
    });
    const result = callBump({}, makeCtx(node, '/repo/docs/example.md', 'plugin:foo'));

    strictEqual(result.report.ok, true);
    strictEqual(result.report.version, 1);
    strictEqual(result.report.createdSidecar, true);

    ok(result.writes && result.writes.length === 1);
    const audit = result.writes[0]!.changes['audit'] as Record<string, unknown>;
    strictEqual(audit['createdAt'], '2026-05-05T12:00:00.000Z');
    strictEqual(audit['createdBy'], 'plugin:foo');
    strictEqual(audit['lastBumpedAt'], '2026-05-05T12:00:00.000Z');
    strictEqual(audit['lastBumpedBy'], 'plugin:foo');
  });

  it('also bumps when overlay is missing entirely (no scan ran)', () => {
    const node = makeNode(); // no sidecar overlay at all
    const result = callBump({}, makeCtx(node, '/repo/docs/example.md'));
    strictEqual(result.report.ok, true);
    strictEqual(result.report.version, 1);
    strictEqual(result.report.createdSidecar, true);
  });
});

describe('built-in bump action — round-trip through FilesystemSidecarStore', () => {
  it('preserves a <plugin-id>: namespaced block when the kernel materialises the patch', async () => {
    // Lay out the on-disk sidecar with a plugin namespace block + an
    // older version. The Action will return a patch; the store applies
    // it and the plugin block must survive verbatim.
    const target = join(tmpRoot, 'plugin-merge.sm');
    const seed = {
      for: {
        path: 'docs/example.md',
        bodyHash: HASH_A,
        frontmatterHash: HASH_B,
      },
      annotations: { version: 4, stability: 'stable' },
      'example-plugin': { reviewedBy: 'agent-x', notes: ['ok'] },
    };
    writeFileSync(target, yaml.dump(seed));

    const node = makeNode({
      bodyHash: HASH_C, // body drifted
      frontmatterHash: HASH_B,
      sidecar: {
        present: true,
        status: 'stale-body',
        annotations: { version: 4, stability: 'stable' },
      },
    });
    const result = callBump({}, makeCtx(node, target.replace(/\.sm$/, '.md'), 'cli'));
    ok(result.writes);

    const store = new FilesystemSidecarStore();
    for (const w of result.writes!) {
      if (w.kind === 'sidecar') {
        await store.applyPatch(w.path, w.changes);
      }
    }

    const parsed = yaml.load(readFileSync(target, 'utf8')) as Record<string, unknown>;
    // Version bumped.
    strictEqual((parsed['annotations'] as Record<string, unknown>)['version'], 5);
    // stability survived.
    strictEqual((parsed['annotations'] as Record<string, unknown>)['stability'], 'stable');
    // Plugin namespace fully preserved.
    deepStrictEqual(parsed['example-plugin'], {
      reviewedBy: 'agent-x',
      notes: ['ok'],
    });
    // for.bodyHash refreshed.
    strictEqual((parsed['for'] as Record<string, unknown>)['bodyHash'], HASH_C);
    // audit populated.
    const audit = parsed['audit'] as Record<string, unknown>;
    strictEqual(audit['lastBumpedBy'], 'cli');
  });

  it('first-time bump end-to-end creates the .sm file with audit.createdAt', async () => {
    const target = join(tmpRoot, 'first-time.sm');
    ok(!existsSync(target));

    const node = makeNode({ sidecar: { present: false } });
    const result = callBump({}, makeCtx(node, target.replace(/\.sm$/, '.md'), 'cli'));
    ok(result.writes);

    const store = new FilesystemSidecarStore();
    for (const w of result.writes!) {
      if (w.kind === 'sidecar') await store.applyPatch(w.path, w.changes);
    }

    ok(existsSync(target));
    const parsed = yaml.load(readFileSync(target, 'utf8')) as Record<string, unknown>;
    const audit = parsed['audit'] as Record<string, unknown>;
    strictEqual(audit['createdAt'], '2026-05-05T12:00:00.000Z');
    strictEqual(audit['createdBy'], 'cli');
  });
});
