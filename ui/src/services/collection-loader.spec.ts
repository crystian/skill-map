import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { EMPTY, Subject } from 'rxjs';

import { CollectionLoaderService } from './collection-loader';
import { DATA_SOURCE, type IDataSourcePort } from './data-source/data-source.port';
import type { IWsEvent } from '../models/ws-event';
import type { IScanResultApi } from '../models/api';

function emptyScan(extra?: Partial<IScanResultApi>): IScanResultApi {
  return {
    schemaVersion: 1,
    scannedAt: 0,
    scope: 'project',
    roots: ['.'],
    providers: [],
    nodes: [],
    links: [],
    issues: [],
    stats: {
      filesWalked: 0,
      filesSkipped: 0,
      nodesCount: 0,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
    ...extra,
  };
}

/**
 * Type-safe-ish stub: every method is a `vi.fn` so tests can assert
 * call counts and inject custom resolvers. Using a `type` (not an
 * `interface extends`) sidesteps the `Mock<...>` vs the original method
 * signature mismatch — the cast in `makeStub` is the only place we
 * cross the type boundary.
 */
type IStubDataSource = IDataSourcePort & {
  loadScan: ReturnType<typeof vi.fn>;
  events: ReturnType<typeof vi.fn>;
};

function makeStub(events$: ReturnType<typeof Subject.prototype.asObservable>): IStubDataSource {
  return {
    health: vi.fn(),
    loadScan: vi.fn().mockResolvedValue(emptyScan()),
    listNodes: vi.fn(),
    getNode: vi.fn(),
    listLinks: vi.fn(),
    listIssues: vi.fn(),
    loadGraph: vi.fn(),
    loadConfig: vi.fn(),
    listPlugins: vi.fn(),
    events: vi.fn().mockReturnValue(events$),
  } as unknown as IStubDataSource;
}

function bootstrap(stub: IStubDataSource): CollectionLoaderService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: DATA_SOURCE, useValue: stub }],
  });
  return TestBed.inject(CollectionLoaderService);
}

describe('CollectionLoaderService', () => {
  let stub: IStubDataSource;
  let events$: Subject<IWsEvent>;

  beforeEach(() => {
    events$ = new Subject<IWsEvent>();
    stub = makeStub(events$.asObservable());
  });

  afterEach(() => {
    events$.complete();
  });

  it('exposes empty signals before load() resolves', () => {
    const svc = bootstrap(stub);
    expect(svc.nodes()).toEqual([]);
    expect(svc.scan()).toBeNull();
    expect(svc.loading()).toBe(false);
    expect(svc.error()).toBeNull();
  });

  it('populates signals from loadScan() on explicit load()', async () => {
    stub.loadScan.mockResolvedValue(
      emptyScan({
        nodes: [
          { path: 'a.md', kind: 'agent', frontmatter: {} },
          { path: 'b.md', kind: 'note', frontmatter: {} },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any,
      }),
    );
    const svc = bootstrap(stub);
    await svc.load();
    expect(svc.nodes()).toHaveLength(2);
    expect(svc.count()).toBe(2);
  });

  it('re-fetches on scan.completed event from the data source', async () => {
    const svc = bootstrap(stub);
    await svc.load();
    expect(stub.loadScan).toHaveBeenCalledTimes(1);

    events$.next({
      type: 'scan.completed',
      timestamp: 100,
      runId: 'r-1',
      jobId: null,
      data: { nodes: 1, links: 0, issues: 0, durationMs: 1 },
    });

    // The reactive refresh kicks an async load(); flush the microtask
    // queue + a tick to let the awaited loadScan resolve.
    await Promise.resolve();
    await Promise.resolve();
    expect(stub.loadScan).toHaveBeenCalledTimes(2);
  });

  it('ignores non-scan.completed events (no thrash on scan.progress)', async () => {
    const svc = bootstrap(stub);
    await svc.load();
    expect(stub.loadScan).toHaveBeenCalledTimes(1);

    for (const type of [
      'scan.started',
      'scan.progress',
      'extractor.completed',
      'rule.completed',
      'watcher.started',
      'watcher.error',
    ]) {
      events$.next({ type, timestamp: 0, jobId: null, data: {} });
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(stub.loadScan).toHaveBeenCalledTimes(1);
  });

  it('ignores unknown event types silently (forward-compat)', async () => {
    const svc = bootstrap(stub);
    await svc.load();
    events$.next({
      type: 'future.event.we.do.not.know',
      timestamp: 0,
      jobId: null,
      data: { whatever: true },
    });
    await Promise.resolve();
    expect(stub.loadScan).toHaveBeenCalledTimes(1);
  });

  it('coalesces a refresh that arrives while load() is in flight', async () => {
    let resolveFirst: (() => void) | undefined;
    stub.loadScan.mockImplementation(
      () =>
        new Promise<IScanResultApi>((resolve) => {
          resolveFirst = () => resolve(emptyScan());
        }),
    );
    const svc = bootstrap(stub);
    const inflight = svc.load();
    expect(svc.loading()).toBe(true);

    // Three rapid-fire events arrive mid-flight. With coalescing they
    // should result in ONE follow-up, not three.
    events$.next({ type: 'scan.completed', timestamp: 1, jobId: null, data: {} });
    events$.next({ type: 'scan.completed', timestamp: 2, jobId: null, data: {} });
    events$.next({ type: 'scan.completed', timestamp: 3, jobId: null, data: {} });

    // Now release the in-flight load. Switch the stub to a resolved
    // Promise so the follow-up settles synchronously.
    stub.loadScan.mockResolvedValue(emptyScan());
    resolveFirst!();
    await inflight;
    // Flush the microtask that schedules the coalesced follow-up.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(stub.loadScan).toHaveBeenCalledTimes(2);
  });

  it('captures a load() error in the error() signal without re-throwing', async () => {
    stub.loadScan.mockRejectedValue(new Error('network boom'));
    const svc = bootstrap(stub);
    await svc.load();
    expect(svc.error()).toBe('network boom');
    expect(svc.loading()).toBe(false);
  });

  it('does not subscribe to events when EMPTY (demo mode)', async () => {
    stub.events.mockReturnValue(EMPTY);
    const svc = bootstrap(stub);
    await svc.load();
    expect(stub.loadScan).toHaveBeenCalledTimes(1);
    // No events to fire — the subscription completed at construction.
    expect(stub.events).toHaveBeenCalled();
  });
});
