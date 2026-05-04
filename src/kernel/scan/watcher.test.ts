/**
 * Chokidar watcher unit tests.
 *
 * Real filesystem (mkdtemp) and real chokidar — the wrapper logic
 * (debounce, batch coalescing, ignore-filter integration, clean
 * teardown) doesn't lend itself to mocks. Each test creates its own
 * temp directory and tears the watcher down explicitly.
 *
 * Timing is the touchy part: chokidar emits events asynchronously,
 * and the debounce window collapses bursts. The tests use small
 * windows (50–80ms) and `waitForBatch` helpers that resolve as soon
 * as the wrapper invokes `onBatch`.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createChokidarWatcher } from './watcher.js';
import type { IFsWatcher, IWatchBatch } from './watcher.js';
import { buildIgnoreFilter } from './ignore.js';

let root: string;
let counter = 0;

function freshScope(label: string): string {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface IBatchCollector {
  batches: IWatchBatch[];
  next(): Promise<IWatchBatch>;
}

function makeCollector(): { collector: IBatchCollector; onBatch: (b: IWatchBatch) => void } {
  const batches: IWatchBatch[] = [];
  const waiters: Array<(b: IWatchBatch) => void> = [];
  const onBatch = (batch: IWatchBatch): void => {
    if (waiters.length > 0) {
      const w = waiters.shift();
      w?.(batch);
    } else {
      batches.push(batch);
    }
  };
  const next = (): Promise<IWatchBatch> => {
    const b = batches.shift();
    if (b !== undefined) return Promise.resolve(b);
    return new Promise((r) => waiters.push(r));
  };
  return { collector: { batches, next }, onBatch };
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-watcher-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('createChokidarWatcher', () => {
  it('coalesces a burst of writes into a single debounced batch', async () => {
    const dir = freshScope('debounce');
    const { collector, onBatch } = makeCollector();
    const watcher: IFsWatcher = createChokidarWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 80,
      onBatch,
    });
    try {
      await watcher.ready;
      writeFileSync(join(dir, 'a.md'), '# a');
      writeFileSync(join(dir, 'b.md'), '# b');
      writeFileSync(join(dir, 'c.md'), '# c');
      const batch = await collector.next();
      assert.equal(batch.paths.length, 3, 'three distinct paths in the batch');
      assert.deepEqual(
        batch.paths.map((p) => p.split('/').pop()).sort(),
        ['a.md', 'b.md', 'c.md'],
      );
      // No leftover batches after the burst settles.
      await delay(150);
      assert.equal(collector.batches.length, 0, 'no follow-up batch');
    } finally {
      await watcher.close();
    }
  });

  it('produces a second batch when changes arrive after the first', async () => {
    const dir = freshScope('multi-batch');
    const { collector, onBatch } = makeCollector();
    const watcher = createChokidarWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 60,
      onBatch,
    });
    try {
      await watcher.ready;
      writeFileSync(join(dir, 'first.md'), '# first');
      const first = await collector.next();
      assert.equal(first.paths.length, 1);

      writeFileSync(join(dir, 'second.md'), '# second');
      const second = await collector.next();
      assert.equal(second.paths.length, 1);
      assert.match(second.paths[0]!, /second\.md$/);
    } finally {
      await watcher.close();
    }
  });

  it('respects the ignoreFilter — ignored paths never fire onBatch', async () => {
    const dir = freshScope('ignore');
    const ignoreFilter = buildIgnoreFilter({
      includeDefaults: false,
      configIgnore: ['*.tmp'],
    });
    const { collector, onBatch } = makeCollector();
    const watcher = createChokidarWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 60,
      ignoreFilter,
      onBatch,
    });
    try {
      await watcher.ready;
      writeFileSync(join(dir, 'kept.md'), 'x');
      writeFileSync(join(dir, 'noise.tmp'), 'x');
      writeFileSync(join(dir, 'also-kept.md'), 'x');
      const batch = await collector.next();
      const names = batch.paths.map((p) => p.split('/').pop()).sort();
      assert.deepEqual(names, ['also-kept.md', 'kept.md']);
      await delay(120);
      assert.equal(collector.batches.length, 0, 'noise.tmp never fires a batch');
    } finally {
      await watcher.close();
    }
  });

  it('respects a getter ignoreFilter — swapping the filter at runtime updates ignored paths', async () => {
    // Pin for the BFF live-rebuild flow: the meta-file watcher in
    // `src/server/watcher.ts` swaps the ignore filter when the user
    // edits `.skill-mapignore`, and chokidar's `ignored` predicate must
    // pick up the new filter on the very next event without tearing the
    // watcher down. Static `IIgnoreFilter` captures by reference at
    // construction; the getter form re-evaluates per call.
    const dir = freshScope('ignore-getter');
    let activeFilter = buildIgnoreFilter({
      includeDefaults: false,
      configIgnore: [],
    });
    const { collector, onBatch } = makeCollector();
    const watcher = createChokidarWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 60,
      ignoreFilter: (): ReturnType<typeof buildIgnoreFilter> => activeFilter,
      onBatch,
    });
    try {
      await watcher.ready;

      // 1. Initial filter excludes nothing → a.md fires a batch.
      writeFileSync(join(dir, 'a.md'), 'x');
      const first = await collector.next();
      assert.deepEqual(
        first.paths.map((p) => p.split('/').pop()).sort(),
        ['a.md'],
      );

      // 2. Swap the active filter to exclude *.tmp at runtime.
      activeFilter = buildIgnoreFilter({
        includeDefaults: false,
        configIgnore: ['*.tmp'],
      });

      // 3. After the swap, *.tmp must not fire while *.md still does.
      writeFileSync(join(dir, 'noise.tmp'), 'x');
      writeFileSync(join(dir, 'b.md'), 'x');
      const second = await collector.next();
      assert.deepEqual(
        second.paths.map((p) => p.split('/').pop()).sort(),
        ['b.md'],
      );
      await delay(120);
      assert.equal(
        collector.batches.length,
        0,
        'noise.tmp filtered by the swapped getter result',
      );
    } finally {
      await watcher.close();
    }
  });

  it('treats a getter that returns undefined as no filter (everything fires)', async () => {
    const dir = freshScope('ignore-getter-undefined');
    const { collector, onBatch } = makeCollector();
    const watcher = createChokidarWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 60,
      ignoreFilter: () => undefined,
      onBatch,
    });
    try {
      await watcher.ready;
      writeFileSync(join(dir, 'a.tmp'), 'x');
      writeFileSync(join(dir, 'b.md'), 'x');
      const batch = await collector.next();
      assert.deepEqual(
        batch.paths.map((p) => p.split('/').pop()).sort(),
        ['a.tmp', 'b.md'],
      );
    } finally {
      await watcher.close();
    }
  });

  it('deduplicates repeated events on the same path within one batch', async () => {
    const dir = freshScope('dedupe');
    const { collector, onBatch } = makeCollector();
    const watcher = createChokidarWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 80,
      onBatch,
    });
    try {
      await watcher.ready;
      const file = join(dir, 'churn.md');
      writeFileSync(file, '1');
      writeFileSync(file, '2');
      writeFileSync(file, '3');
      const batch = await collector.next();
      assert.equal(batch.paths.length, 1, 'only one unique path');
      assert.ok(batch.events.length >= 1, 'at least one event recorded');
      assert.match(batch.paths[0]!, /churn\.md$/);
    } finally {
      await watcher.close();
    }
  });

  it('captures unlink events for files added after the watcher was ready', async () => {
    const dir = freshScope('unlink');
    const { collector, onBatch } = makeCollector();
    const watcher = createChokidarWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 60,
      onBatch,
    });
    try {
      await watcher.ready;
      // Create the file post-ready so chokidar definitively tracks it
      // before we delete it. (Pre-ready files plus `ignoreInitial:
      // true` is platform-flaky on inotify — the file is registered
      // but native unlink events may race the watch handle install.)
      writeFileSync(join(dir, 'transient.md'), 'seed');
      const addBatch = await collector.next();
      assert.equal(addBatch.events.length, 1);
      assert.equal(addBatch.events[0]!.kind, 'add');

      unlinkSync(join(dir, 'transient.md'));
      const unlinkBatch = await collector.next();
      const kinds = unlinkBatch.events.map((e) => e.kind);
      assert.ok(kinds.includes('unlink'), `expected unlink, got ${kinds.join(',')}`);
    } finally {
      await watcher.close();
    }
  });

  it('close() drops pending events without firing onBatch', async () => {
    const dir = freshScope('close-pending');
    const { collector, onBatch } = makeCollector();
    const watcher = createChokidarWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 200,
      onBatch,
    });
    await watcher.ready;
    writeFileSync(join(dir, 'late.md'), '# late');
    // Close before the debounce window expires.
    await watcher.close();
    await delay(300);
    assert.equal(collector.batches.length, 0, 'no batch after close');
  });

  it('debounceMs: 0 fires onBatch on every tick', async () => {
    const dir = freshScope('zero-debounce');
    const { collector, onBatch } = makeCollector();
    const watcher = createChokidarWatcher({
      cwd: root,
      roots: [dir],
      debounceMs: 0,
      onBatch,
    });
    try {
      await watcher.ready;
      writeFileSync(join(dir, 'a.md'), 'a');
      const first = await collector.next();
      assert.equal(first.paths.length, 1);
      // Give the loop a moment, then write again.
      await delay(20);
      writeFileSync(join(dir, 'b.md'), 'b');
      const second = await collector.next();
      assert.equal(second.paths.length, 1);
      assert.notEqual(first.paths[0], second.paths[0], 'two separate batches');
    } finally {
      await watcher.close();
    }
  });
});
