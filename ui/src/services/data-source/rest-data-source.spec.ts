import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';

import { DataSourceError } from './data-source.port';
import { RestDataSource, __testHooks } from './rest-data-source';
import { encodeNodePath } from './path-codec';
import { WsEventStreamService } from '../ws-event-stream';
import type { IWsEvent } from '../../models/ws-event';

const HEALTH_FIXTURE = {
  ok: true,
  schemaVersion: '1',
  specVersion: '0.11.0',
  implVersion: '0.9.0',
  scope: 'project' as const,
  db: 'present' as const,
};

const SCAN_FIXTURE = {
  schemaVersion: 1,
  scannedAt: 1700000000000,
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
};

const NODES_ENVELOPE = {
  schemaVersion: '1',
  kind: 'nodes',
  items: [{ path: 'a.md' }],
  filters: { kind: null, hasIssues: null, path: null },
  counts: { total: 1, returned: 1, page: { offset: 0, limit: 100 } },
};

const NODE_DETAIL = {
  schemaVersion: '1',
  kind: 'node',
  item: { path: 'a.md' },
  links: { incoming: [], outgoing: [] },
  issues: [],
};

describe('RestDataSource', () => {
  let httpMock: HttpTestingController;
  let ds: RestDataSource;
  let wsSubject: Subject<IWsEvent>;
  let fakeWs: WsEventStreamService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    wsSubject = new Subject<IWsEvent>();
    fakeWs = {
      events$: wsSubject.asObservable(),
      disconnect: vi.fn(),
    } as unknown as WsEventStreamService;
    ds = new RestDataSource(TestBed.inject(HttpClient), fakeWs);
  });

  afterEach(() => {
    httpMock.verify();
    wsSubject.complete();
  });

  it('health() GETs /api/health and returns the body', async () => {
    const promise = ds.health();
    const req = httpMock.expectOne('/api/health');
    expect(req.request.method).toBe('GET');
    req.flush(HEALTH_FIXTURE);
    await expect(promise).resolves.toEqual(HEALTH_FIXTURE);
  });

  it('loadScan() GETs /api/scan and returns the ScanResult', async () => {
    const promise = ds.loadScan();
    const req = httpMock.expectOne('/api/scan');
    req.flush(SCAN_FIXTURE);
    await expect(promise).resolves.toEqual(SCAN_FIXTURE);
  });

  it('listNodes() builds a query string with kinds + hasIssues + pagination', async () => {
    const promise = ds.listNodes({
      kind: ['agent', 'skill'],
      hasIssues: true,
      limit: 50,
      offset: 100,
    });
    const req = httpMock.expectOne(
      '/api/nodes?kind=agent%2Cskill&hasIssues=true&limit=50&offset=100',
    );
    req.flush(NODES_ENVELOPE);
    await expect(promise).resolves.toEqual(NODES_ENVELOPE);
  });

  it('listNodes() omits the query string when no filters are present', async () => {
    const promise = ds.listNodes();
    const req = httpMock.expectOne('/api/nodes');
    req.flush(NODES_ENVELOPE);
    await promise;
  });

  it('getNode() encodes the path and returns the detail bundle', async () => {
    const path = '.claude/agents/foo.md';
    const encoded = encodeNodePath(path);
    const promise = ds.getNode(path);
    const req = httpMock.expectOne(`/api/nodes/${encoded}`);
    req.flush(NODE_DETAIL);
    await expect(promise).resolves.toEqual(NODE_DETAIL);
  });

  it('getNode() returns null on 404 with not-found envelope', async () => {
    const promise = ds.getNode('missing.md');
    const encoded = encodeNodePath('missing.md');
    const req = httpMock.expectOne(`/api/nodes/${encoded}`);
    req.flush(
      { ok: false, error: { code: 'not-found', message: 'no such node' } },
      { status: 404, statusText: 'Not Found' },
    );
    await expect(promise).resolves.toBeNull();
  });

  it('listLinks() builds the kind/from/to query string', async () => {
    const promise = ds.listLinks({ kind: ['invokes'], from: 'a.md', to: 'b.md' });
    const req = httpMock.expectOne('/api/links?kind=invokes&from=a.md&to=b.md');
    req.flush({
      schemaVersion: '1',
      kind: 'links',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0 },
    });
    await promise;
  });

  it('listIssues() forwards severity / ruleId / node filters', async () => {
    const promise = ds.listIssues({
      severity: 'error',
      ruleId: 'broken-ref',
      node: 'a.md',
    });
    const req = httpMock.expectOne(
      '/api/issues?severity=error&ruleId=broken-ref&node=a.md',
    );
    req.flush({
      schemaVersion: '1',
      kind: 'issues',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0 },
    });
    await promise;
  });

  it('loadGraph() requests text/plain ASCII by default', async () => {
    const promise = ds.loadGraph();
    const req = httpMock.expectOne('/api/graph?format=ascii');
    expect(req.request.responseType).toBe('text');
    req.flush('graph contents');
    await expect(promise).resolves.toBe('graph contents');
  });

  it('loadConfig() unwraps the value envelope', async () => {
    const promise = ds.loadConfig();
    const req = httpMock.expectOne('/api/config');
    req.flush({
      schemaVersion: '1',
      kind: 'config',
      value: { tokenizer: 'cl100k_base', autoMigrate: true },
    });
    await expect(promise).resolves.toEqual({
      tokenizer: 'cl100k_base',
      autoMigrate: true,
    });
  });

  it('listPlugins() returns the envelope verbatim', async () => {
    const promise = ds.listPlugins();
    const req = httpMock.expectOne('/api/plugins');
    req.flush({
      schemaVersion: '1',
      kind: 'plugins',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0 },
    });
    await promise;
  });

  it('events() forwards frames from the injected WsEventStreamService', () => {
    const received: IWsEvent[] = [];
    ds.events().subscribe((e) => received.push(e));
    wsSubject.next({
      type: 'scan.completed',
      timestamp: 100,
      runId: 'r-x',
      jobId: null,
      data: { nodes: 1, links: 0, issues: 0, durationMs: 7 },
    });
    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe('scan.completed');
  });

  it('translates 5xx with error envelope into DataSourceError carrying the code', async () => {
    const promise = ds.health();
    const req = httpMock.expectOne('/api/health');
    req.flush(
      { ok: false, error: { code: 'internal', message: 'boom' } },
      { status: 500, statusText: 'Internal Server Error' },
    );
    await expect(promise).rejects.toMatchObject({
      name: 'DataSourceError',
      code: 'internal',
      message: 'boom',
    });
  });

  it('falls back to internal error when the body is not an error envelope', async () => {
    const promise = ds.health();
    const req = httpMock.expectOne('/api/health');
    req.flush('not json', { status: 502, statusText: 'Bad Gateway' });
    await expect(promise).rejects.toBeInstanceOf(DataSourceError);
  });
});

describe('rest-data-source helpers (__testHooks)', () => {
  it('parseErrorEnvelope rejects shapes that do not match', () => {
    expect(__testHooks.parseErrorEnvelope(null)).toBeNull();
    expect(__testHooks.parseErrorEnvelope({ ok: true })).toBeNull();
    expect(__testHooks.parseErrorEnvelope({ ok: false, error: 'oops' })).toBeNull();
    expect(
      __testHooks.parseErrorEnvelope({ ok: false, error: { code: 'x' } }),
    ).toBeNull();
  });

  it('parseErrorEnvelope accepts the full shape and preserves details', () => {
    const env = __testHooks.parseErrorEnvelope({
      ok: false,
      error: { code: 'bad-query', message: 'missing field', details: { field: 'kind' } },
    });
    expect(env).toEqual({
      ok: false,
      error: { code: 'bad-query', message: 'missing field', details: { field: 'kind' } },
    });
  });

  it('buildNodesQueryString omits empty arrays / undefined values', () => {
    expect(__testHooks.buildNodesQueryString({})).toBe('');
    expect(__testHooks.buildNodesQueryString({ kind: [] })).toBe('');
    expect(__testHooks.buildNodesQueryString({ hasIssues: false })).toBe('?hasIssues=false');
  });
});
