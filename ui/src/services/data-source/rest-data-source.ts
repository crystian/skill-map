/**
 * `RestDataSource` — `IDataSourcePort` implementation that talks to the
 * BFF (`src/server/`) over HTTP using Angular's `HttpClient`.
 *
 * URLs are relative (`/api/...`) so they resolve against the page origin.
 * The BFF and SPA ship on the same port (`sm serve` mandates single-port),
 * so cross-origin concerns don't apply.
 *
 * Errors:
 *   - 4xx / 5xx with the BFF's error envelope → `DataSourceError`
 *     carrying the envelope's `code` + `message`.
 *   - Transport failure (network down, JSON parse error) → `DataSourceError`
 *     with `code = 'internal'`.
 *   - 404 on `getNode` → returns `null` (not-found is a normal value).
 *
 * Promise-style API matches the existing `CollectionLoaderService` (uses
 * `firstValueFrom`); rxjs Observables are reserved for `events()` (lands
 * at 14.4 with the WS broadcaster).
 */

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { type Observable, firstValueFrom } from 'rxjs';

import { DATA_SOURCE_TEXTS } from '../../i18n/data-source.texts';
import type {
  IErrorEnvelopeApi,
  IHealthResponseApi,
  IIssueApi,
  ILinkApi,
  IListEnvelopeApi,
  INodeApi,
  INodeDetailApi,
  IProjectConfigApi,
  IScanResultApi,
  IValueEnvelopeApi,
} from '../../models/api';
import type { IWsEvent } from '../../models/ws-event';
import { WsEventStreamService } from '../ws-event-stream';
import { encodeNodePath } from './path-codec';
import {
  DataSourceError,
  type IDataSourcePort,
  type IIssuesQuery,
  type ILinksQuery,
  type INodesQuery,
  type TGraphFormat,
  type TPluginItem,
} from './data-source.port';

const BASE = '/api';

@Injectable({ providedIn: 'root' })
export class RestDataSource implements IDataSourcePort {
  private readonly http: HttpClient;
  private readonly ws: WsEventStreamService;

  constructor(http?: HttpClient, ws?: WsEventStreamService) {
    // The factory passes `HttpClient` + `WsEventStreamService`
    // explicitly; the `@Injectable` path uses Angular DI. Both call
    // sites resolve to the same singleton — keep the constructor
    // flexible to support manual `new RestDataSource(http, ws)` for
    // tests / factory wiring.
    this.http = http ?? inject(HttpClient);
    this.ws = ws ?? inject(WsEventStreamService);
  }

  async health(): Promise<IHealthResponseApi> {
    return this.getJson<IHealthResponseApi>(`${BASE}/health`);
  }

  async loadScan(): Promise<IScanResultApi> {
    return this.getJson<IScanResultApi>(`${BASE}/scan`);
  }

  async listNodes(q: INodesQuery = {}): Promise<IListEnvelopeApi<INodeApi>> {
    const params = buildNodesQueryString(q);
    return this.getJson<IListEnvelopeApi<INodeApi>>(`${BASE}/nodes${params}`);
  }

  async getNode(path: string): Promise<INodeDetailApi | null> {
    const encoded = encodeNodePath(path);
    try {
      return await this.getJson<INodeDetailApi>(`${BASE}/nodes/${encoded}`);
    } catch (err) {
      if (err instanceof DataSourceError && err.code === 'not-found') return null;
      throw err;
    }
  }

  async listLinks(q: ILinksQuery = {}): Promise<IListEnvelopeApi<ILinkApi>> {
    const params = buildLinksQueryString(q);
    return this.getJson<IListEnvelopeApi<ILinkApi>>(`${BASE}/links${params}`);
  }

  async listIssues(q: IIssuesQuery = {}): Promise<IListEnvelopeApi<IIssueApi>> {
    const params = buildIssuesQueryString(q);
    return this.getJson<IListEnvelopeApi<IIssueApi>>(`${BASE}/issues${params}`);
  }

  async loadGraph(format: TGraphFormat = 'ascii'): Promise<string> {
    const url = `${BASE}/graph?format=${encodeURIComponent(format)}`;
    try {
      return await firstValueFrom(
        this.http.get(url, { responseType: 'text' }),
      );
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async loadConfig(): Promise<IProjectConfigApi> {
    const envelope = await this.getJson<IValueEnvelopeApi<IProjectConfigApi>>(
      `${BASE}/config`,
    );
    return envelope.value;
  }

  async listPlugins(): Promise<IListEnvelopeApi<TPluginItem>> {
    return this.getJson<IListEnvelopeApi<TPluginItem>>(`${BASE}/plugins`);
  }

  /**
   * Live event stream from the BFF's `/ws` channel. Multicast — every
   * subscriber receives every frame while the socket stays open. The
   * underlying `WsEventStreamService` opens the socket lazily on first
   * subscribe and reconnects with exponential backoff on abnormal close.
   */
  events(): Observable<IWsEvent> {
    return this.ws.events$;
  }

  private async getJson<T>(url: string): Promise<T> {
    try {
      return await firstValueFrom(this.http.get<T>(url));
    } catch (err) {
      throw this.translateError(err);
    }
  }

  /**
   * Translate an `HttpErrorResponse` (or unknown thrown value) into a
   * `DataSourceError` with the BFF envelope's `code` + `message` when
   * available. Falls back to `internal` for transport / parse failures.
   */
  private translateError(err: unknown): DataSourceError {
    if (err instanceof DataSourceError) return err;
    if (err instanceof HttpErrorResponse) {
      const envelope = parseErrorEnvelope(err.error);
      if (envelope) {
        return new DataSourceError(
          envelope.error.code,
          envelope.error.message,
          envelope.error.details,
        );
      }
      return new DataSourceError(
        'internal',
        err.message || DATA_SOURCE_TEXTS.errors.malformedResponse,
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return new DataSourceError('internal', message);
  }
}

/**
 * Build the query-string suffix (including the leading `?` when any
 * params present) for `/api/nodes`.
 */
function buildNodesQueryString(q: INodesQuery): string {
  const params = new URLSearchParams();
  if (q.kind && q.kind.length > 0) params.set('kind', q.kind.join(','));
  if (q.hasIssues !== undefined) params.set('hasIssues', String(q.hasIssues));
  if (q.path) params.set('path', q.path);
  if (q.limit !== undefined) params.set('limit', String(q.limit));
  if (q.offset !== undefined) params.set('offset', String(q.offset));
  const s = params.toString();
  return s ? `?${s}` : '';
}

function buildLinksQueryString(q: ILinksQuery): string {
  const params = new URLSearchParams();
  if (q.kind && q.kind.length > 0) params.set('kind', q.kind.join(','));
  if (q.from) params.set('from', q.from);
  if (q.to) params.set('to', q.to);
  const s = params.toString();
  return s ? `?${s}` : '';
}

function buildIssuesQueryString(q: IIssuesQuery): string {
  const params = new URLSearchParams();
  if (q.severity) params.set('severity', q.severity);
  if (q.ruleId) params.set('ruleId', q.ruleId);
  if (q.node) params.set('node', q.node);
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * Type-guard for the BFF error envelope. Accepts only the documented
 * shape; anything else returns `null` so the caller falls back to a
 * generic `internal` error.
 */
function parseErrorEnvelope(value: unknown): IErrorEnvelopeApi | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v['ok'] !== false) return null;
  const err = v['error'];
  if (typeof err !== 'object' || err === null) return null;
  const e = err as Record<string, unknown>;
  if (typeof e['code'] !== 'string' || typeof e['message'] !== 'string') return null;
  return {
    ok: false,
    error: {
      code: e['code'],
      message: e['message'],
      details: e['details'],
    },
  };
}

/**
 * Exposed for unit tests — covers the small URL-encoding helpers
 * without going through `firstValueFrom` indirection.
 */
export const __testHooks = {
  buildNodesQueryString,
  buildLinksQueryString,
  buildIssuesQueryString,
  parseErrorEnvelope,
};
