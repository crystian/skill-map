import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

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
    r.register({ id: 'claude', kind: 'adapter', version: '1.0.0' });
    r.register({ id: 'frontmatter', kind: 'detector', version: '1.0.0' });
    assert.equal(r.totalCount(), 2);
    assert.equal(r.count('adapter'), 1);
    assert.equal(r.all('adapter')[0]?.id, 'claude');
    assert.equal(r.all('adapter')[0]?.version, '1.0.0');
  });

  it('rejects duplicate registration within a kind', () => {
    const r = new Registry();
    r.register({ id: 'claude', kind: 'adapter', version: '1.0.0' });
    assert.throws(
      () => r.register({ id: 'claude', kind: 'adapter', version: '1.0.1' }),
      DuplicateExtensionError,
    );
  });

  it('allows the same id across different kinds', () => {
    const r = new Registry();
    r.register({ id: 'validate-all', kind: 'audit', version: '1.0.0' });
    r.register({ id: 'validate-all', kind: 'action', version: '1.0.0' });
    assert.equal(r.totalCount(), 2);
  });
});

describe('createKernel', () => {
  it('returns a kernel with an empty registry', () => {
    const k = createKernel();
    assert.equal(k.registry.totalCount(), 0);
  });
});

describe('runScan', () => {
  it('produces a zero-filled ScanResult for empty roots', async () => {
    const result = await runScan(createKernel(), { roots: [] });
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.nodes.length, 0);
    assert.equal(result.links.length, 0);
    assert.equal(result.issues.length, 0);
    assert.equal(result.stats.nodesCount, 0);
    assert.equal(result.stats.linksCount, 0);
    assert.equal(result.stats.issuesCount, 0);
  });

  it('preserves roots in the result', async () => {
    const result = await runScan(createKernel(), { roots: ['./a', './b'] });
    assert.deepEqual(result.roots, ['./a', './b']);
  });

  it('emits an ISO-8601 timestamp', async () => {
    const result = await runScan(createKernel(), { roots: [] });
    assert.match(result.scannedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
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
    // Adding a registered adapter / detector / rule must NOT change the
    // result shape when those extensions don't have runtime methods yet.
    // Kernel-empty-boot still passes even after registration.
    const kernel = createKernel();
    kernel.registry.register({ id: 'claude', kind: 'adapter', version: '1.0.0' });
    kernel.registry.register({ id: 'frontmatter', kind: 'detector', version: '1.0.0' });
    kernel.registry.register({ id: 'trigger-collision', kind: 'rule', version: '1.0.0' });

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
