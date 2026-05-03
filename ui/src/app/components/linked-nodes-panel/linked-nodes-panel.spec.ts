import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { LinkedNodesPanel } from './linked-nodes-panel';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../services/data-source/data-source.port';
import type { ILinkApi, IListEnvelopeApi } from '../../../models/api';
import type { IWsEvent } from '../../../models/ws-event';

/**
 * `LinkedNodesPanel` spec — covers the panel's full lifecycle:
 * empty path (no fetch), parallel fetch wiring, ready/empty/error
 * states, manual refresh, scan.completed reactive refresh, token
 * guard for rapid path changes.
 */

type IStubDataSource = IDataSourcePort & {
  listLinks: ReturnType<typeof vi.fn>;
  events: ReturnType<typeof vi.fn>;
};

function makeLink(overrides: Partial<ILinkApi> = {}): ILinkApi {
  return {
    source: 'a.md',
    target: 'b.md',
    kind: 'references',
    confidence: 'high',
    sources: ['claude/at-directive'],
    ...overrides,
  };
}

function envelope(items: ILinkApi[]): IListEnvelopeApi<ILinkApi> {
  return {
    schemaVersion: '1',
    kind: 'links',
    items,
    filters: { kind: null, from: null, to: null },
    counts: { total: items.length, returned: items.length },
  };
}

function makeStub(events$: Subject<IWsEvent>): IStubDataSource {
  return {
    health: vi.fn(),
    loadScan: vi.fn(),
    listNodes: vi.fn(),
    getNode: vi.fn(),
    listLinks: vi.fn().mockResolvedValue(envelope([])),
    listIssues: vi.fn(),
    loadGraph: vi.fn(),
    loadConfig: vi.fn(),
    listPlugins: vi.fn(),
    events: vi.fn().mockReturnValue(events$.asObservable()),
  } as unknown as IStubDataSource;
}

function bootstrap(stub: IStubDataSource): {
  fixture: ComponentFixture<LinkedNodesPanel>;
  cmp: LinkedNodesPanel;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: DATA_SOURCE, useValue: stub }],
  });
  const fixture = TestBed.createComponent(LinkedNodesPanel);
  return { fixture, cmp: fixture.componentInstance };
}

async function flush(fixture: ComponentFixture<LinkedNodesPanel>): Promise<void> {
  fixture.detectChanges();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

describe('LinkedNodesPanel', () => {
  let events$: Subject<IWsEvent>;
  let stub: IStubDataSource;

  beforeEach(() => {
    events$ = new Subject<IWsEvent>();
    stub = makeStub(events$);
  });

  afterEach(() => {
    events$.complete();
  });

  it('renders nothing when no path is set', async () => {
    const { fixture } = bootstrap(stub);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="linked-nodes-panel"]')).toBeNull();
    expect(stub.listLinks).not.toHaveBeenCalled();
  });

  it('fires listLinks twice (outgoing+incoming) when a path lands', async () => {
    const { fixture } = bootstrap(stub);
    fixture.componentRef.setInput('path', 'a.md');
    await flush(fixture);
    expect(stub.listLinks).toHaveBeenCalledTimes(2);
    expect(stub.listLinks).toHaveBeenCalledWith({ from: 'a.md' });
    expect(stub.listLinks).toHaveBeenCalledWith({ to: 'a.md' });
  });

  it('renders empty-state messages for both lists when nothing comes back', async () => {
    const { fixture } = bootstrap(stub);
    fixture.componentRef.setInput('path', 'a.md');
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="linked-nodes-outgoing-empty"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="linked-nodes-incoming-empty"]')).not.toBeNull();
  });

  it('renders outgoing + incoming rows when both lists have data', async () => {
    stub.listLinks.mockImplementation((q: { from?: string; to?: string }) => {
      if (q.from === 'center.md') {
        return Promise.resolve(
          envelope([
            makeLink({ source: 'center.md', target: 'out-1.md', kind: 'invokes' }),
            makeLink({ source: 'center.md', target: 'out-2.md', kind: 'references' }),
          ]),
        );
      }
      if (q.to === 'center.md') {
        return Promise.resolve(envelope([makeLink({ source: 'in-1.md', target: 'center.md' })]));
      }
      return Promise.resolve(envelope([]));
    });

    const { fixture } = bootstrap(stub);
    fixture.componentRef.setInput('path', 'center.md');
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;

    expect(dom.querySelector('[data-testid="linked-nodes-outgoing-row-out-1.md"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="linked-nodes-outgoing-row-out-2.md"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="linked-nodes-incoming-row-in-1.md"]')).not.toBeNull();
  });

  it('emits openPath when a row link is clicked', async () => {
    stub.listLinks.mockImplementation((q: { from?: string }) =>
      Promise.resolve(
        q.from
          ? envelope([makeLink({ source: 'a.md', target: 'b.md' })])
          : envelope([]),
      ),
    );

    const { fixture, cmp } = bootstrap(stub);
    const opened: string[] = [];
    cmp.openPath.subscribe((p: string) => opened.push(p));

    fixture.componentRef.setInput('path', 'a.md');
    await flush(fixture);

    const link = fixture.nativeElement.querySelector(
      '[data-testid="linked-nodes-outgoing-link-b.md"]',
    ) as HTMLButtonElement;
    link.click();

    expect(opened).toEqual(['b.md']);
  });

  it('shows the error state when a list-links call rejects', async () => {
    stub.listLinks.mockRejectedValue(new Error('boom'));
    const { fixture } = bootstrap(stub);
    fixture.componentRef.setInput('path', 'a.md');
    await flush(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="linked-nodes-error"]')).not.toBeNull();
  });

  it('refreshes when the user clicks the refresh button', async () => {
    const { fixture } = bootstrap(stub);
    fixture.componentRef.setInput('path', 'a.md');
    await flush(fixture);
    expect(stub.listLinks).toHaveBeenCalledTimes(2);

    const refresh = fixture.nativeElement.querySelector(
      '[data-testid="linked-nodes-refresh"] button',
    ) as HTMLButtonElement;
    refresh.click();
    await flush(fixture);
    expect(stub.listLinks).toHaveBeenCalledTimes(4);
  });

  it('refreshes on a scan.completed WS event', async () => {
    const { fixture } = bootstrap(stub);
    fixture.componentRef.setInput('path', 'a.md');
    await flush(fixture);
    expect(stub.listLinks).toHaveBeenCalledTimes(2);

    events$.next({
      type: 'scan.completed',
      timestamp: 0,
      jobId: null,
      data: { nodes: 0, links: 0, issues: 0, durationMs: 1 },
    });
    await flush(fixture);
    expect(stub.listLinks).toHaveBeenCalledTimes(4);
  });

  it('does NOT refresh on non-scan.completed events', async () => {
    const { fixture } = bootstrap(stub);
    fixture.componentRef.setInput('path', 'a.md');
    await flush(fixture);
    expect(stub.listLinks).toHaveBeenCalledTimes(2);

    events$.next({
      type: 'scan.progress',
      timestamp: 0,
      jobId: null,
      data: { filesSeen: 1, filesProcessed: 1, filesSkipped: 0 },
    });
    await flush(fixture);
    expect(stub.listLinks).toHaveBeenCalledTimes(2);
  });

  it('drops a stale resolution when path changes mid-fetch (token guard)', async () => {
    let resolveA!: (env: IListEnvelopeApi<ILinkApi>) => void;
    const pendingA = new Promise<IListEnvelopeApi<ILinkApi>>((res) => {
      resolveA = res;
    });
    stub.listLinks.mockImplementation((q: { from?: string; to?: string }) => {
      if (q.from === 'a.md') return pendingA;
      if (q.to === 'a.md') return pendingA;
      // b.md fetches resolve immediately with a known sentinel.
      return Promise.resolve(envelope([makeLink({ source: 'b.md', target: 'b-out.md' })]));
    });

    const { fixture } = bootstrap(stub);
    fixture.componentRef.setInput('path', 'a.md');
    await flush(fixture);
    fixture.componentRef.setInput('path', 'b.md');
    await flush(fixture);
    // a.md's late resolution must be ignored — we should see b's row.
    resolveA(envelope([makeLink({ source: 'a.md', target: 'a-late.md' })]));
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="linked-nodes-outgoing-row-b-out.md"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="linked-nodes-outgoing-row-a-late.md"]')).toBeNull();
  });
});
