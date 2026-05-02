/**
 * `IDataSourcePort` — the abstract data-source contract every concrete
 * implementation must satisfy. Mirrors the BFF surface (Step 14.2):
 * `/api/health`, `/api/scan`, `/api/nodes`, `/api/nodes/:pathB64`,
 * `/api/links`, `/api/issues`, `/api/graph`, `/api/config`,
 * `/api/plugins`.
 *
 * The SPA depends on this port; the factory (`data-source.factory.ts`)
 * picks an implementation based on the runtime mode token. Today only
 * `RestDataSource` (live mode) ships; `StaticDataSource` (demo mode)
 * lands at Step 14.3.b.
 *
 * Type names use `*Port` for the abstract contract and `I*` prefix for
 * option bags, per the project's type naming convention (AGENTS.md).
 */

import { InjectionToken } from '@angular/core';
import type { Observable } from 'rxjs';

import type {
  IHealthResponseApi,
  IIssueApi,
  ILinkApi,
  IListEnvelopeApi,
  INodeApi,
  INodeDetailApi,
  IProjectConfigApi,
  IScanResultApi,
} from '../../models/api';

/**
 * `/api/nodes` query bag. Lists are comma-joined when serialized to
 * URL params. Booleans are stringified `true`/`false`. Empty / null
 * values are omitted from the query.
 */
export interface INodesQuery {
  kind?: string[];
  hasIssues?: boolean;
  /** Glob-style path filter — see `src/server/query-adapter.ts`. */
  path?: string;
  limit?: number;
  offset?: number;
}

/**
 * `/api/links` query bag. `from` and `to` are exact `node.path` matches.
 */
export interface ILinksQuery {
  kind?: string[];
  from?: string;
  to?: string;
}

/**
 * `/api/issues` query bag. `node` is an exact `node.path` match.
 */
export interface IIssuesQuery {
  severity?: 'error' | 'warn' | 'info';
  ruleId?: string;
  node?: string;
}

/**
 * Output format for `/api/graph`. The endpoint defaults to `ascii`
 * (text/plain). Other formats are reserved for the formatter catalog.
 */
export type TGraphFormat = 'ascii' | 'json' | 'md';

/**
 * Plugin item shape is left as `unknown` for 14.3.a — the manifest
 * surface is finalized at Step 14.5 alongside the full Plugins view.
 */
export type TPluginItem = unknown;

export interface IDataSourcePort {
  /** Liveness + version probe. Returns the BFF's health payload. */
  health(): Promise<IHealthResponseApi>;

  /** Full `ScanResult` (1:1 with `scan-result.schema.json`). */
  loadScan(): Promise<IScanResultApi>;

  /** Paginated, filtered list of persisted nodes. */
  listNodes(q?: INodesQuery): Promise<IListEnvelopeApi<INodeApi>>;

  /**
   * Single-node detail bundle. Returns `null` when the BFF responds
   * 404 (no such node) — callers branch on the null instead of catching.
   */
  getNode(path: string): Promise<INodeDetailApi | null>;

  /** Filtered list of persisted links. */
  listLinks(q?: ILinksQuery): Promise<IListEnvelopeApi<ILinkApi>>;

  /** Filtered list of persisted issues. */
  listIssues(q?: IIssuesQuery): Promise<IListEnvelopeApi<IIssueApi>>;

  /**
   * Rendered graph in the requested format. Defaults to `ascii`
   * (text/plain). Returns the formatter's verbatim output.
   */
  loadGraph(format?: TGraphFormat): Promise<string>;

  /** Project configuration as the BFF resolved it. */
  loadConfig(): Promise<IProjectConfigApi>;

  /** List of registered plugins. Item shape finalized at Step 14.5. */
  listPlugins(): Promise<IListEnvelopeApi<TPluginItem>>;

  /**
   * WebSocket-backed event stream. Returns `EMPTY` at 14.3.a (no
   * broadcaster yet); 14.4 swaps in the real impl.
   */
  events(): Observable<unknown>;
}

/**
 * Injection token consumers use to resolve the active `IDataSourcePort`.
 * The factory (`dataSourceFactory`) provides this in `app.config.ts`.
 */
export const DATA_SOURCE = new InjectionToken<IDataSourcePort>('DATA_SOURCE');

/**
 * Error thrown by the data-source layer when the BFF returns an error
 * envelope (`{ ok: false, error: { code, message } }`) or when the
 * transport itself fails. The `code` mirrors the BFF's envelope code
 * so callers can branch on it.
 */
export class DataSourceError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'DataSourceError';
    this.code = code;
    this.details = details;
  }
}
