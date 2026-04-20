import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  createKernel,
  DuplicateExtensionError,
  EXTENSION_KINDS,
  Registry,
  runScan,
} from '../kernel/index.ts';

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
    r.register({ id: 'claude', kind: 'adapter' });
    r.register({ id: 'frontmatter', kind: 'detector' });
    assert.equal(r.totalCount(), 2);
    assert.equal(r.count('adapter'), 1);
    assert.equal(r.all('adapter')[0]?.id, 'claude');
  });

  it('rejects duplicate registration within a kind', () => {
    const r = new Registry();
    r.register({ id: 'claude', kind: 'adapter' });
    assert.throws(
      () => r.register({ id: 'claude', kind: 'adapter' }),
      DuplicateExtensionError,
    );
  });

  it('allows the same id across different kinds', () => {
    const r = new Registry();
    r.register({ id: 'validate-all', kind: 'audit' });
    r.register({ id: 'validate-all', kind: 'action' });
    assert.equal(r.totalCount(), 2);
  });
});

describe('createKernel', () => {
  it('returns a kernel with an empty registry', () => {
    const k = createKernel();
    assert.equal(k.registry.totalCount(), 0);
  });
});

describe('runScan (stub)', () => {
  it('produces a zero-filled ScanResult for empty roots', async () => {
    const k = createKernel();
    const result = await runScan(k, { roots: [] });
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.nodes.length, 0);
    assert.equal(result.links.length, 0);
    assert.equal(result.issues.length, 0);
    assert.equal(result.stats.nodesCount, 0);
    assert.equal(result.stats.linksCount, 0);
    assert.equal(result.stats.issuesCount, 0);
  });

  it('preserves roots in the result', async () => {
    const k = createKernel();
    const result = await runScan(k, { roots: ['./a', './b'] });
    assert.deepEqual(result.roots, ['./a', './b']);
  });

  it('emits an ISO-8601 timestamp', async () => {
    const k = createKernel();
    const result = await runScan(createKernel(), { roots: [] });
    void k;
    assert.match(result.scannedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
