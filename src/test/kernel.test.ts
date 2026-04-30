import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  createKernel,
  DuplicateExtensionError,
  EXTENSION_KINDS,
  InMemoryProgressEmitter,
  Registry,
  runScan,
} from '../kernel/index.js';
import type { ProgressEvent } from '../kernel/ports/progress-emitter.js';

describe('Registry', () => {
  it('boots empty with all six kinds', () => {
    const r = new Registry();
    assert.equal(r.totalCount(), 0);
    for (const kind of EXTENSION_KINDS) {
      assert.equal(r.count(kind), 0);
      assert.deepEqual(r.all(kind), []);
    }
  });

  it('registers and retrieves extensions by kind', () => {
    const r = new Registry();
    r.register({ id: 'claude', pluginId: 'claude', kind: 'provider', version: '1.0.0' });
    r.register({ id: 'frontmatter', pluginId: 'claude', kind: 'extractor', version: '1.0.0' });
    assert.equal(r.totalCount(), 2);
    assert.equal(r.count('provider'), 1);
    assert.equal(r.all('provider')[0]?.id, 'claude');
    assert.equal(r.all('provider')[0]?.pluginId, 'claude');
    assert.equal(r.all('provider')[0]?.version, '1.0.0');
  });

  it('rejects duplicate registration within a kind (same qualified id)', () => {
    const r = new Registry();
    r.register({ id: 'claude', pluginId: 'claude', kind: 'provider', version: '1.0.0' });
    assert.throws(
      () => r.register({ id: 'claude', pluginId: 'claude', kind: 'provider', version: '1.0.1' }),
      DuplicateExtensionError,
    );
  });

  it('allows the same short id under different plugin namespaces (qualified id differs)', () => {
    const r = new Registry();
    r.register({ id: 'foo', pluginId: 'core', kind: 'extractor', version: '1.0.0' });
    r.register({ id: 'foo', pluginId: 'plugin-a', kind: 'extractor', version: '1.0.0' });
    assert.equal(r.totalCount(), 2);
    assert.equal(r.count('extractor'), 2);
  });

  it('allows the same id across different kinds', () => {
    const r = new Registry();
    r.register({ id: 'validate-all', pluginId: 'core', kind: 'rule', version: '1.0.0' });
    r.register({ id: 'validate-all', pluginId: 'core', kind: 'action', version: '1.0.0' });
    assert.equal(r.totalCount(), 2);
  });

  it('looks up extensions by qualified id via get()', () => {
    const r = new Registry();
    r.register({ id: 'broken-ref', pluginId: 'core', kind: 'rule', version: '1.0.0' });
    const found = r.get('rule', 'core/broken-ref');
    assert.ok(found, 'expected to resolve qualified id');
    assert.equal(found?.id, 'broken-ref');
    assert.equal(found?.pluginId, 'core');
    assert.equal(r.get('rule', 'unknown/missing'), undefined);
  });

  it('find() composes the qualified id from pluginId + id', () => {
    const r = new Registry();
    r.register({ id: 'slash', pluginId: 'claude', kind: 'extractor', version: '1.0.0' });
    const found = r.find('extractor', 'claude', 'slash');
    assert.ok(found, 'expected to resolve via find()');
    assert.equal(found?.id, 'slash');
  });

  it('register throws when pluginId is missing or empty', () => {
    const r = new Registry();
    assert.throws(
      () =>
        r.register({
          // intentional cast — runtime guard verifies the contract
          id: 'oops',
          kind: 'extractor',
          version: '1.0.0',
        } as unknown as Parameters<Registry['register']>[0]),
      /pluginId/,
    );
  });
});

describe('createKernel', () => {
  it('returns a kernel with an empty registry', () => {
    const k = createKernel();
    assert.equal(k.registry.totalCount(), 0);
  });
});

// Shared scratch for runScan tests that need real on-disk roots (the
// orchestrator validates every root exists as a directory up front).
let runScanTmpRoot: string;

before(() => {
  runScanTmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-kernel-'));
});

after(() => {
  rmSync(runScanTmpRoot, { recursive: true, force: true });
});

describe('runScan', () => {
  it('produces a zero-filled ScanResult for a single root with no extensions', async () => {
    // Spec requires `roots: minItems: 1`; runScan throws on an empty
    // array. Use `['.']` with no extensions to exercise the
    // kernel-empty-boot path while staying spec-conformant.
    const result = await runScan(createKernel(), { roots: ['.'] });
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.scope, 'project');
    assert.deepEqual(result.providers, []);
    assert.equal(result.nodes.length, 0);
    assert.equal(result.links.length, 0);
    assert.equal(result.issues.length, 0);
    assert.equal(result.stats.filesWalked, 0);
    assert.equal(result.stats.filesSkipped, 0);
    assert.equal(result.stats.nodesCount, 0);
    assert.equal(result.stats.linksCount, 0);
    assert.equal(result.stats.issuesCount, 0);
  });

  it('throws on empty roots (spec requires minItems: 1)', async () => {
    await assert.rejects(
      () => runScan(createKernel(), { roots: [] }),
      /at least one path/i,
    );
  });

  it('preserves roots in the result', async () => {
    // Use two real on-disk directories — the orchestrator now validates
    // each root exists as a directory before walking, so synthetic
    // paths like `./a` no longer fly. The walk yields zero files (the
    // dirs are empty) which keeps this test focused on roots-passthrough.
    const a = mkdtempSync(join(runScanTmpRoot, 'roots-a-'));
    const b = mkdtempSync(join(runScanTmpRoot, 'roots-b-'));
    const result = await runScan(createKernel(), { roots: [a, b] });
    assert.deepEqual(result.roots, [a, b]);
  });

  it('throws on a non-existent root path (the path appears in the error)', async () => {
    const missing = join(runScanTmpRoot, 'definitely-not-here');
    await assert.rejects(
      () => runScan(createKernel(), { roots: [missing] }),
      (err: Error) =>
        err instanceof Error &&
        err.message.includes(missing) &&
        /does not exist or is not a directory/.test(err.message),
    );
  });

  it('throws on a root that is a file, not a directory', async () => {
    // The validator must distinguish "exists but not a directory" from
    // "missing entirely" — both share the same error wording, but the
    // path that gets named must be the file we created.
    const filePath = join(runScanTmpRoot, 'i-am-a-file.txt');
    writeFileSync(filePath, 'not a directory\n');
    await assert.rejects(
      () => runScan(createKernel(), { roots: [filePath] }),
      (err: Error) =>
        err instanceof Error &&
        err.message.includes(filePath) &&
        /does not exist or is not a directory/.test(err.message),
    );
  });

  it('emits a positive integer Unix-ms timestamp', async () => {
    const before = Date.now();
    const result = await runScan(createKernel(), { roots: ['.'] });
    const after = Date.now();
    assert.ok(Number.isInteger(result.scannedAt), 'scannedAt is an integer');
    assert.ok(result.scannedAt >= before && result.scannedAt <= after, 'scannedAt within wall-clock window');
  });

  it('honours options.scope (defaults to project, override with global)', async () => {
    const dflt = await runScan(createKernel(), { roots: ['.'] });
    assert.equal(dflt.scope, 'project');
    const explicit = await runScan(createKernel(), { roots: ['.'], scope: 'global' });
    assert.equal(explicit.scope, 'global');
  });

  it('embeds scannedBy { name, version, specVersion } for self-describing output', async () => {
    const result = await runScan(createKernel(), { roots: ['.'] });
    assert.ok(result.scannedBy, 'scannedBy is populated');
    assert.equal(result.scannedBy.name, 'skill-map');
    assert.match(result.scannedBy.version, /^\d+\.\d+\.\d+/);
    assert.equal(typeof result.scannedBy.specVersion, 'string');
  });

  it('emits scan.started and scan.completed in canonical order', async () => {
    const emitter = new InMemoryProgressEmitter();
    const events: ProgressEvent[] = [];
    emitter.subscribe((e) => events.push(e));

    await runScan(createKernel(), { roots: ['.'], emitter });

    assert.equal(events.length, 2);
    assert.equal(events[0]?.type, 'scan.started');
    assert.equal(events[1]?.type, 'scan.completed');
    assert.deepEqual((events[0]?.data as { roots: string[] }).roots, ['.']);
    assert.ok((events[1]?.data as { stats: { durationMs: number } }).stats.durationMs >= 0);
  });

  it('iterates registered extensions without breaking the empty-registry contract', async () => {
    // Adding a registered provider / extractor / rule must NOT change the
    // result shape when those extensions don't have runtime methods yet.
    // Kernel-empty-boot still passes even after registration.
    const kernel = createKernel();
    kernel.registry.register({ id: 'claude', pluginId: 'claude', kind: 'provider', version: '1.0.0' });
    kernel.registry.register({ id: 'frontmatter', pluginId: 'claude', kind: 'extractor', version: '1.0.0' });
    kernel.registry.register({ id: 'trigger-collision', pluginId: 'core', kind: 'rule', version: '1.0.0' });

    const result = await runScan(kernel, { roots: ['.'] });
    assert.equal(result.stats.nodesCount, 0);
    assert.equal(result.stats.linksCount, 0);
    assert.equal(result.stats.issuesCount, 0);
  });
});

describe('InMemoryProgressEmitter', () => {
  it('fans out events to every subscriber', () => {
    const emitter = new InMemoryProgressEmitter();
    const a: string[] = [];
    const b: string[] = [];
    emitter.subscribe((e) => a.push(e.type));
    emitter.subscribe((e) => b.push(e.type));
    emitter.emit({ type: 'x', timestamp: 'now' });
    assert.deepEqual(a, ['x']);
    assert.deepEqual(b, ['x']);
  });

  it('unsubscribe stops future events', () => {
    const emitter = new InMemoryProgressEmitter();
    const seen: string[] = [];
    const off = emitter.subscribe((e) => seen.push(e.type));
    emitter.emit({ type: 'first', timestamp: 'now' });
    off();
    emitter.emit({ type: 'second', timestamp: 'now' });
    assert.deepEqual(seen, ['first']);
  });
});
