import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { EMPTY, Subject } from 'rxjs';

import { EventLog, __testHooks } from './event-log';
import { DATA_SOURCE, type IDataSourcePort } from '../../../services/data-source/data-source.port';
import { SKILL_MAP_MODE } from '../../../services/data-source/runtime-mode';
import type { IWsEvent } from '../../../models/ws-event';

/**
 * Type-safe-ish stub: see `collection-loader.spec.ts` for the same
 * pattern. `type` instead of `interface extends` avoids the Mock/Method
 * signature mismatch.
 */
type IStubDataSource = IDataSourcePort & {
  events: ReturnType<typeof vi.fn>;
};

function makeStub(events$: ReturnType<typeof Subject.prototype.asObservable>): IStubDataSource {
  return {
    health: vi.fn(),
    loadScan: vi.fn(),
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

function bootstrap(stub: IStubDataSource, mode: 'live' | 'demo' = 'live'): EventLog {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: DATA_SOURCE, useValue: stub },
      { provide: SKILL_MAP_MODE, useValue: mode },
    ],
  });
  const fixture = TestBed.createComponent(EventLog);
  fixture.detectChanges();
  return fixture.componentInstance;
}

describe('EventLog — subscription + ring', () => {
  let stub: IStubDataSource;
  let events$: Subject<IWsEvent>;

  beforeEach(() => {
    events$ = new Subject<IWsEvent>();
    stub = makeStub(events$.asObservable());
  });

  afterEach(() => {
    events$.complete();
  });

  it('starts with an empty event list', () => {
    const cmp = bootstrap(stub);
    expect(cmp.events()).toEqual([]);
    expect(cmp.count()).toBe(0);
  });

  it('appends new events to the ring on subscription', () => {
    const cmp = bootstrap(stub);
    events$.next({
      type: 'scan.started',
      timestamp: Date.UTC(2026, 0, 1, 10, 30, 0),
      runId: 'r-1',
      jobId: null,
      data: { mode: 'full', target: null, rootsCount: 1 },
    });
    events$.next({
      type: 'scan.completed',
      timestamp: Date.UTC(2026, 0, 1, 10, 30, 1),
      runId: 'r-1',
      jobId: null,
      data: { nodes: 5, links: 3, issues: 0, durationMs: 12 },
    });
    expect(cmp.events()).toHaveLength(2);
    expect(cmp.events()[0]!.type).toBe('scan.started');
    expect(cmp.events()[1]!.type).toBe('scan.completed');
    expect(cmp.events()[1]!.digest).toBe('nodes=5 links=3 issues=0 (12ms)');
  });

  it('handles kernel-current scan.completed shape (data.stats wrapper)', () => {
    const cmp = bootstrap(stub);
    events$.next({
      type: 'scan.completed',
      timestamp: 0,
      jobId: null,
      data: {
        stats: {
          filesWalked: 23,
          filesSkipped: 0,
          nodesCount: 23,
          linksCount: 58,
          issuesCount: 4,
          durationMs: 877,
        },
      },
    });
    expect(cmp.events()[0]!.digest).toBe('nodes=23 links=58 issues=4 (877ms)');
  });

  it('caps the ring at 50 entries (FIFO)', () => {
    const cmp = bootstrap(stub);
    for (let i = 0; i < 60; i += 1) {
      events$.next({
        type: 'scan.progress',
        timestamp: 1_000 + i,
        jobId: null,
        data: { filesProcessed: i, filesSeen: 100 },
      });
    }
    expect(cmp.events()).toHaveLength(50);
    // First retained row corresponds to i=10 (60 minus 50). The key
    // counter started at 1 and the 11th event has key 11.
    expect(cmp.events()[0]!.key).toBe(11);
  });

  it('renders unknown event types with empty digest (forward-compat)', () => {
    const cmp = bootstrap(stub);
    events$.next({
      type: 'future.brand.new.event',
      timestamp: 1,
      jobId: null,
      data: { whatever: true },
    });
    expect(cmp.events()).toHaveLength(1);
    expect(cmp.events()[0]!.type).toBe('future.brand.new.event');
    expect(cmp.events()[0]!.digest).toBe('');
  });

  it('captures stream errors into the streamError signal', () => {
    const cmp = bootstrap(stub);
    events$.error(new Error('lost connection'));
    expect(cmp.streamError()).toBe('lost connection');
  });

  it('does not subscribe to a real WS in demo mode (events stays EMPTY)', () => {
    stub.events.mockReturnValue(EMPTY);
    const cmp = bootstrap(stub, 'demo');
    expect(cmp.events()).toHaveLength(0);
    expect(cmp.isDemo).toBe(true);
  });
});

describe('EventLog — pure helpers', () => {
  it('severityForType buckets known event types', () => {
    expect(__testHooks.severityForType('scan.completed')).toBe('success');
    expect(__testHooks.severityForType('scan.started')).toBe('info');
    expect(__testHooks.severityForType('scan.progress')).toBe('info');
    expect(__testHooks.severityForType('watcher.started')).toBe('success');
    expect(__testHooks.severityForType('watcher.error')).toBe('error');
    expect(__testHooks.severityForType('extension.error')).toBe('error');
    expect(__testHooks.severityForType('totally.unknown')).toBe('info');
  });

  it('formatTime renders HH:MM:SS in the local timezone', () => {
    const ts = new Date(2026, 4, 2, 14, 7, 9).getTime();
    expect(__testHooks.formatTime(ts)).toBe('14:07:09');
  });

  it('digestForEvent picks the right per-type catalog entry', () => {
    const texts = {
      digests: {
        scanStarted: (mode: string | undefined, target: string | null | undefined, roots: string[] | undefined) => {
          if (mode) return target ? `${mode} target=${target}` : mode;
          if (roots && roots.length > 0) return `roots=${roots.join(',')}`;
          return 'started';
        },
        scanProgress: (
          processed: number | undefined,
          seen: number | undefined,
          index: number | undefined,
          path: string | undefined,
        ) => {
          if (processed !== undefined) return `${processed}/${seen}`;
          if (index !== undefined && path) return `#${index} ${path}`;
          return 'progress';
        },
        scanCompleted: (n?: number, l?: number, i?: number, ms?: number) =>
          `n=${n} l=${l} i=${i} ms=${ms}`,
        extractorCompleted: (id?: string) => id ?? 'unknown',
        ruleCompleted: (id?: string) => id ?? 'unknown',
        watcherStarted: (debounceMs?: number) => `debounce=${debounceMs}`,
        watcherError: (m?: string) => m ?? 'unknown',
        extensionError: (id?: string, m?: string) => `${id}:${m}`,
      },
    } as unknown as Parameters<typeof __testHooks.digestForEvent>[1];

    const made = (type: string, data: unknown): IWsEvent => ({
      type,
      timestamp: 0,
      jobId: null,
      data,
    });
    expect(__testHooks.digestForEvent(made('scan.started', { mode: 'full', target: null }), texts)).toBe(
      'full',
    );
    expect(__testHooks.digestForEvent(made('scan.started', { roots: ['.'] }), texts)).toBe('roots=.');
    expect(
      __testHooks.digestForEvent(made('scan.progress', { index: 3, path: 'a.md' }), texts),
    ).toBe('#3 a.md');
    expect(__testHooks.digestForEvent(made('rule.completed', { ruleId: 'core/x' }), texts)).toBe('core/x');
    expect(__testHooks.digestForEvent(made('unknown.type', {}), texts)).toBe('');
  });

  it('readScanCompletedSummary handles both spec and kernel-current shapes', async () => {
    const { readScanCompletedSummary } = await import('../../../models/ws-event');
    expect(readScanCompletedSummary({ nodes: 1, links: 2, issues: 3, durationMs: 4 })).toEqual({
      nodes: 1,
      links: 2,
      issues: 3,
      durationMs: 4,
    });
    expect(
      readScanCompletedSummary({
        stats: { nodesCount: 5, linksCount: 6, issuesCount: 7, durationMs: 8 },
      }),
    ).toEqual({ nodes: 5, links: 6, issues: 7, durationMs: 8 });
    expect(readScanCompletedSummary(null)).toEqual({
      nodes: undefined,
      links: undefined,
      issues: undefined,
      durationMs: undefined,
    });
  });
});
