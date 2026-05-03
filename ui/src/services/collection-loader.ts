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
 * Step 14.4.b reactive refresh: in live mode, the loader subscribes to
 * `dataSource.events()` and re-runs `load()` whenever a `scan.completed`
 * event lands. List / graph / inspector views re-render automatically
 * because they read from the `nodes()` / `scan()` signals.
 *
 * Concurrency: a refresh that arrives while one is already in flight
 * coalesces — `pending = true` is set, and the in-flight resolution
 * triggers a single follow-up. This avoids the "every event fires a new
 * `loadScan`" pile-up during a large workspace scan that emits multiple
 * `scan.completed` envelopes (single-node scans, in-flight reconnect
 * replays, etc.).
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

import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';

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
  private readonly destroyRef = inject(DestroyRef);

  private readonly _nodes = signal<INodeView[]>([]);
  private readonly _scan = signal<IScanResultApi | null>(null);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  /**
   * Coalesce flag: set to `true` when a refresh arrives mid-flight. The
   * in-flight `load()` checks the flag in its `finally` and fires
   * exactly one follow-up regardless of how many events came in.
   */
  private pendingRefresh = false;

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

  constructor() {
    // Live-mode reactive refresh: every `scan.completed` event triggers
    // a re-fetch. Demo mode's `events()` is `EMPTY` so the subscription
    // immediately completes and never fires.
    //
    // We DON'T filter on `extractor.completed` / `rule.completed` /
    // `scan.progress` — re-fetching mid-scan would thrash the views
    // for no perceived benefit (the next `scan.completed` carries the
    // settled snapshot). Future work: per-Issue incremental updates
    // via `issue.added` / `issue.resolved` once the BFF emits them.
    this.dataSource
      .events()
      .pipe(
        filter((event) => event.type === 'scan.completed'),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        // Fire-and-forget — load() handles its own errors via the
        // `error()` signal. We don't await here because the subject's
        // `next` is synchronous and we don't want to block its dispatch
        // on a network round-trip.
        void this.load();
      });
  }

  async load(): Promise<void> {
    if (this._loading()) {
      // A refresh is in flight. Mark as pending so the in-flight load's
      // `finally` fires exactly one follow-up. This collapses N
      // back-to-back `scan.completed` events into at most one extra
      // round-trip per in-flight load.
      this.pendingRefresh = true;
      return;
    }
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
      if (this.pendingRefresh) {
        this.pendingRefresh = false;
        // Defer to a microtask so the loading/false notification flushes
        // through any sync subscribers before the next `load()` flips
        // it back to true.
        queueMicrotask(() => {
          void this.load();
        });
      }
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
