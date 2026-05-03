/**
 * `StaticDataSource` — `IDataSourcePort` implementation that reads a
 * pre-baked snapshot bundled with the SPA (`web/demo/data.json` +
 * `web/demo/data.meta.json`). Wired by the factory when the runtime mode
 * is `'demo'`.
 *
 * Two assets are fetched lazily on first request:
 *
 *   - `data.json`       — full `ScanResult` (1:1 with `scan-result.schema.json`).
 *                         Used for `loadScan()`, `getNode()`, and on-the-fly
 *                         filtering when a list query carries non-default filters.
 *   - `data.meta.json`  — pre-derived per-endpoint envelopes mirroring the
 *                         BFF route shapes (`nodes`/`links`/`issues`/`config`/
 *                         `plugins` list envelopes, `health` snapshot, ASCII
 *                         graph). The fast path: list queries with no filters
 *                         return the pre-derived envelope verbatim — no
 *                         re-running of the kernel filter grammar in the browser.
 *
 * Both files are fetched relative to the document base href (Angular's
 * `<base href="/demo/">` in the demo build), via a global `fetch()` so
 * the data layer doesn't depend on Angular's `HttpClient` interceptor
 * stack — the static demo never goes through `/api/*` in the first place.
 *
 * **Filter semantics**:
 *   - "No filters" list queries return the pre-derived envelope verbatim.
 *   - "Filtered" list queries derive a fresh envelope from `data.json`
 *     in the browser. The fixture is small (a few dozen nodes), so the
 *     cost is negligible. We deliberately do NOT re-implement the full
 *     kernel filter grammar (`parseExportQuery`) here; the supported
 *     filters cover what `RestDataSource` exposes via its query bags.
 *
 * **`events()`** returns `EMPTY` — the static bundle has no live changes,
 * mirroring the demo-mode contract documented on `IDataSourcePort`.
 */

import { EMPTY, type Observable } from 'rxjs';

import { DATA_SOURCE_TEXTS } from '../../i18n/data-source.texts';
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
import type { IWsEvent } from '../../models/ws-event';
import {
  DataSourceError,
  type IDataSourcePort,
  type IIssuesQuery,
  type ILinksQuery,
  type INodesQuery,
  type TGraphFormat,
  type TPluginItem,
} from './data-source.port';

/**
 * Asset paths — relative to the document base. `data.json` and
 * `data.meta.json` sit next to `index.html` in the demo bundle.
 */
const DATA_JSON = 'data.json';
const META_JSON = 'data.meta.json';

/**
 * Shape of `data.meta.json`. Keys mirror the BFF route surface so the
 * derivation script + the consumer share one vocabulary.
 */
export interface IDemoMetaPayload {
  schemaVersion: '1';
  health: IHealthResponseApi;
  nodes: IListEnvelopeApi<INodeApi>;
  links: IListEnvelopeApi<ILinkApi>;
  issues: IListEnvelopeApi<IIssueApi>;
  config: { schemaVersion: '1'; kind: 'config'; value: IProjectConfigApi };
  plugins: IListEnvelopeApi<TPluginItem>;
  graph: { ascii: string };
}

export class StaticDataSource implements IDataSourcePort {
  private metaPromise: Promise<IDemoMetaPayload> | null = null;
  private dataPromise: Promise<IScanResultApi> | null = null;

  /**
   * Optional fetch override — exposed for tests so spec files can swap a
   * stub `fetch` without touching the global. Production code never sets
   * this; it falls back to the platform `fetch`.
   */
  constructor(private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  async health(): Promise<IHealthResponseApi> {
    const meta = await this.loadMeta();
    return meta.health;
  }

  async loadScan(): Promise<IScanResultApi> {
    return this.loadData();
  }

  async listNodes(q: INodesQuery = {}): Promise<IListEnvelopeApi<INodeApi>> {
    if (isEmptyNodesQuery(q)) {
      const meta = await this.loadMeta();
      return meta.nodes;
    }
    const scan = await this.loadData();
    const issues = scan.issues;
    let items = scan.nodes;
    if (q.kind && q.kind.length > 0) {
      const allowed = new Set(q.kind);
      items = items.filter((n) => allowed.has(n.kind));
    }
    if (q.path) {
      const re = globToRegExp(q.path);
      items = items.filter((n) => re.test(n.path));
    }
    if (q.hasIssues === true) {
      const withIssues = collectNodePathsWithIssues(issues);
      items = items.filter((n) => withIssues.has(n.path));
    } else if (q.hasIssues === false) {
      const withIssues = collectNodePathsWithIssues(issues);
      items = items.filter((n) => !withIssues.has(n.path));
    }
    const total = items.length;
    const offset = q.offset ?? 0;
    const limit = q.limit ?? 1000;
    const sliced = items.slice(offset, offset + limit);
    return {
      schemaVersion: '1',
      kind: 'nodes',
      items: sliced,
      filters: {
        kind: q.kind ?? null,
        hasIssues: q.hasIssues ?? null,
        path: q.path ? [q.path] : null,
      },
      counts: {
        total,
        returned: sliced.length,
        page: { offset, limit },
      },
    };
  }

  async getNode(path: string): Promise<INodeDetailApi | null> {
    const scan = await this.loadData();
    const node = scan.nodes.find((n) => n.path === path);
    if (!node) return null;
    const incoming = scan.links.filter((l) => l.target === path);
    const outgoing = scan.links.filter((l) => l.source === path);
    const issues = scan.issues.filter((i) => i.nodeIds.includes(path));
    return {
      schemaVersion: '1',
      kind: 'node',
      item: node,
      links: { incoming, outgoing },
      issues,
    };
  }

  async listLinks(q: ILinksQuery = {}): Promise<IListEnvelopeApi<ILinkApi>> {
    if (isEmptyLinksQuery(q)) {
      const meta = await this.loadMeta();
      return meta.links;
    }
    const scan = await this.loadData();
    let items = scan.links;
    if (q.kind && q.kind.length > 0) {
      const allowed = new Set(q.kind);
      items = items.filter((l) => allowed.has(l.kind));
    }
    if (q.from) items = items.filter((l) => l.source === q.from);
    if (q.to) items = items.filter((l) => l.target === q.to);
    return {
      schemaVersion: '1',
      kind: 'links',
      items,
      filters: { kind: q.kind ?? null, from: q.from ?? null, to: q.to ?? null },
      counts: { total: items.length, returned: items.length },
    };
  }

  async listIssues(q: IIssuesQuery = {}): Promise<IListEnvelopeApi<IIssueApi>> {
    if (isEmptyIssuesQuery(q)) {
      const meta = await this.loadMeta();
      return meta.issues;
    }
    const scan = await this.loadData();
    let items = scan.issues;
    if (q.severity) items = items.filter((i) => i.severity === q.severity);
    if (q.ruleId) items = items.filter((i) => i.ruleId === q.ruleId);
    if (q.node) items = items.filter((i) => i.nodeIds.includes(q.node!));
    return {
      schemaVersion: '1',
      kind: 'issues',
      items,
      filters: {
        severity: q.severity ?? null,
        ruleId: q.ruleId ?? null,
        node: q.node ?? null,
      },
      counts: { total: items.length, returned: items.length },
    };
  }

  async loadGraph(format: TGraphFormat = 'ascii'): Promise<string> {
    if (format !== 'ascii') {
      throw new DataSourceError(
        'bad-query',
        DATA_SOURCE_TEXTS.errors.graphFormatNotInDemo(format),
      );
    }
    const meta = await this.loadMeta();
    return meta.graph.ascii;
  }

  async loadConfig(): Promise<IProjectConfigApi> {
    const meta = await this.loadMeta();
    return meta.config.value;
  }

  async listPlugins(): Promise<IListEnvelopeApi<TPluginItem>> {
    const meta = await this.loadMeta();
    return meta.plugins;
  }

  events(): Observable<IWsEvent> {
    return EMPTY;
  }

  private loadMeta(): Promise<IDemoMetaPayload> {
    if (!this.metaPromise) {
      this.metaPromise = this.fetchJson<IDemoMetaPayload>(META_JSON);
    }
    return this.metaPromise;
  }

  private loadData(): Promise<IScanResultApi> {
    if (!this.dataPromise) {
      this.dataPromise = this.fetchJson<IScanResultApi>(DATA_JSON);
    }
    return this.dataPromise;
  }

  private async fetchJson<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new DataSourceError(
        'internal',
        DATA_SOURCE_TEXTS.errors.demoFetchFailed(path, msg),
      );
    }
    if (!res.ok) {
      throw new DataSourceError(
        'internal',
        DATA_SOURCE_TEXTS.errors.demoFetchFailed(path, `HTTP ${res.status}`),
      );
    }
    try {
      return (await res.json()) as T;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new DataSourceError(
        'internal',
        DATA_SOURCE_TEXTS.errors.demoParseFailed(path, msg),
      );
    }
  }
}

function isEmptyNodesQuery(q: INodesQuery): boolean {
  if (q.kind && q.kind.length > 0) return false;
  if (q.hasIssues !== undefined) return false;
  if (q.path) return false;
  if (q.offset !== undefined && q.offset !== 0) return false;
  if (q.limit !== undefined) return false;
  return true;
}

function isEmptyLinksQuery(q: ILinksQuery): boolean {
  if (q.kind && q.kind.length > 0) return false;
  if (q.from) return false;
  if (q.to) return false;
  return true;
}

function isEmptyIssuesQuery(q: IIssuesQuery): boolean {
  if (q.severity) return false;
  if (q.ruleId) return false;
  if (q.node) return false;
  return true;
}

function collectNodePathsWithIssues(issues: IIssueApi[]): Set<string> {
  const out = new Set<string>();
  for (const i of issues) {
    for (const id of i.nodeIds) out.add(id);
  }
  return out;
}

/**
 * Translate a tiny subset of the kernel's path glob grammar (`*` → any
 * characters, `?` → single character) into a `RegExp`. Anchored end-to-
 * end so a glob without wildcards matches by exact equality. Used by
 * the demo-mode `listNodes` filter — the BFF goes through `applyExportQuery`
 * which understands a richer grammar; the demo only needs the basics.
 */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${pattern}$`);
}
