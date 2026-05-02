/**
 * `CollectionLoaderService` — top-level node store for the SPA.
 *
 * Step 14.3.a refactor: the service no longer fetches a runtime corpus
 * directly. It delegates to the injected `IDataSourcePort` (which talks
 * to the BFF in live mode, or to a precomputed bundle in demo mode at
 * 14.3.b). The exposed signals (`nodes`, `loading`, `error`, `count`,
 * `byKind`) keep their pre-refactor surface so list / graph / inspector
 * views consume them unchanged.
 *
 * The full `IScanResultApi` is also exposed via `scan()` so consumers
 * that need `links` / `issues` / `stats` (graph-view today; future
 * inspector cards) can read them without a second round-trip.
 *
 * Projection from `INodeApi` to the legacy `INodeView` shape:
 *   - `path`, `kind`, `frontmatter` come straight from the BFF row.
 *   - `body` and `raw` are left empty. The BFF doesn't ship raw bodies
 *     (Step 14 deliberately excluded body content from `/api/scan` to
 *     keep payloads small). Components that need body content read it
 *     via a future `/api/nodes/:pathB64?include=body` once that endpoint
 *     ships; today nothing in the SPA depends on it (mock-links and
 *     mock-summary, which were the only body consumers, were removed
 *     in the same change).
 *   - `mockSummary` derives from `description` / `title`; the kernel's
 *     real summarizer (Step 9+) will replace this entirely.
 */

import { Injectable, computed, inject, signal } from '@angular/core';

import type {
  INodeView,
  TFrontmatter,
  TNodeKind,
} from '../models/node';
import type { INodeApi, IScanResultApi } from '../models/api';
import { DATA_SOURCE, type IDataSourcePort } from './data-source/data-source.port';

const KNOWN_KINDS: ReadonlySet<TNodeKind> = new Set([
  'skill',
  'agent',
  'command',
  'hook',
  'note',
]);

@Injectable({ providedIn: 'root' })
export class CollectionLoaderService {
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);

  private readonly _nodes = signal<INodeView[]>([]);
  private readonly _scan = signal<IScanResultApi | null>(null);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  readonly nodes = this._nodes.asReadonly();
  readonly scan = this._scan.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly count = computed(() => this._nodes().length);
  readonly byKind = computed(() => {
    const buckets: Record<TNodeKind, INodeView[]> = {
      skill: [],
      agent: [],
      command: [],
      hook: [],
      note: [],
    };
    for (const node of this._nodes()) {
      buckets[node.kind].push(node);
    }
    return buckets;
  });

  async load(): Promise<void> {
    if (this._loading()) return;
    this._loading.set(true);
    this._error.set(null);
    try {
      const scan = await this.dataSource.loadScan();
      this._scan.set(scan);
      this._nodes.set(scan.nodes.map(projectNode));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._error.set(msg);
    } finally {
      this._loading.set(false);
    }
  }
}

/**
 * Project a `INodeApi` (BFF / spec shape) into the legacy `INodeView`
 * shape consumed by list / graph / inspector views. Lossy: `body` and
 * `raw` are empty because the BFF doesn't ship them.
 */
function projectNode(api: INodeApi): INodeView {
  const kind = normalizeKind(api.kind);
  const frontmatter = (api.frontmatter ?? {}) as Partial<TFrontmatter>;
  // The spec keeps `frontmatter.metadata` optional; the legacy view
  // assumes a defined object so existing template bindings (`meta?.tags`
  // etc.) keep working without optional chaining changes everywhere.
  const fm: TFrontmatter = {
    name: typeof frontmatter.name === 'string' ? frontmatter.name : api.title ?? '',
    description:
      typeof frontmatter.description === 'string'
        ? frontmatter.description
        : api.description ?? '',
    metadata: {
      version: api.version ?? '',
      stability: api.stability ?? undefined,
      ...((frontmatter.metadata ?? {}) as Record<string, unknown>),
    },
    ...(frontmatter as Record<string, unknown>),
  } as TFrontmatter;
  // Re-overlay metadata so the spread above doesn't drop the
  // synthesised version / stability when the source frontmatter omits them.
  fm.metadata = {
    ...fm.metadata,
    ...((frontmatter.metadata ?? {}) as Record<string, unknown>),
  } as TFrontmatter['metadata'];
  if (!fm.metadata.version) fm.metadata.version = api.version ?? '';
  if (!fm.metadata.stability && api.stability) fm.metadata.stability = api.stability;

  return {
    path: api.path,
    kind,
    frontmatter: fm,
    body: '',
    raw: '',
    mockSummary: deriveSummary(api),
  };
}

function normalizeKind(raw: string): TNodeKind {
  return KNOWN_KINDS.has(raw as TNodeKind) ? (raw as TNodeKind) : 'note';
}

function deriveSummary(api: INodeApi): string | null {
  if (api.description && api.description.trim().length > 0) return api.description.trim();
  if (api.title && api.title.trim().length > 0) return api.title.trim();
  return null;
}
