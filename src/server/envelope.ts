/**
 * REST envelope shapes for `/api/*` responses.
 *
 * Two response shapes coexist:
 *
 *   1. **List envelope** — used by `/api/nodes`, `/api/links`, `/api/issues`,
 *      `/api/plugins`. Carries an `items` array, the `filters` echoed back
 *      to help the client correlate the response with the request, and
 *      `counts` for pagination / totals.
 *
 *   2. **Single-resource envelope** — used by `/api/nodes/:pathB64` and
 *      `/api/config`. Carries either `item` (the resource) or `value`
 *      (a config object).
 *
 * The `/api/scan` response is exempt — it returns a `ScanResult` shape
 * 1:1 with `scan-result.schema.json` (byte-equal to `sm scan --json`).
 * Wrapping it in an envelope would break that contract. The `/api/graph`
 * response is also exempt — it returns the formatter's native output
 * directly (text/plain or text/markdown), with the JSON formatter shape
 * left to the formatter itself.
 *
 * `schemaVersion` is hardcoded to `'1'` and tracks the spec's
 * `rest-envelope.schema.json#/properties/schemaVersion/const`. Bumped
 * only on a breaking envelope change.
 */

export const REST_ENVELOPE_SCHEMA_VERSION = '1';

/**
 * `kind` discriminator. Each route picks the kind matching its resource
 * shape so the SPA can branch on a single field instead of inferring
 * from URL or HTTP status.
 */
export type TEnvelopeKind =
  | 'nodes'
  | 'links'
  | 'issues'
  | 'plugins'
  | 'config'
  | 'graph'
  | 'node'
  | 'health'
  | 'scan';

export interface IPageInfo {
  offset: number;
  limit: number;
}

export interface IEnvelopeCounts {
  /** Total rows after filtering, before pagination is applied. */
  total: number;
  /** Rows actually carried in `items` (≤ `limit`). */
  returned: number;
  /** Pagination window. Present only when the endpoint paginates. */
  page?: IPageInfo;
}

export interface IListEnvelope<TItem> {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: TEnvelopeKind;
  items: TItem[];
  /** Echo of the filters the server applied (URL params normalized). */
  filters: Record<string, unknown>;
  counts: IEnvelopeCounts;
}

export interface ISingleEnvelope<TItem> {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: TEnvelopeKind;
  item: TItem;
}

export interface IValueEnvelope<TValue> {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: TEnvelopeKind;
  value: TValue;
}

export interface IBuildListEnvelopeOpts<TItem> {
  kind: TEnvelopeKind;
  items: TItem[];
  filters: Record<string, unknown>;
  /**
   * Total rows after filtering, before pagination is applied. When the
   * endpoint does NOT paginate, callers pass `items.length` here — the
   * `counts.total` field stays meaningful in both modes.
   */
  total: number;
  /** Pagination window. Omit when the endpoint does not paginate. */
  page?: IPageInfo;
}

/**
 * Build the canonical list envelope for `/api/{nodes,links,issues,plugins}`.
 * `counts.returned` is derived from `items.length` so a caller can't drift
 * the two values apart by accident.
 */
export function buildListEnvelope<TItem>(opts: IBuildListEnvelopeOpts<TItem>): IListEnvelope<TItem> {
  const counts: IEnvelopeCounts = {
    total: opts.total,
    returned: opts.items.length,
  };
  if (opts.page) counts.page = opts.page;
  return {
    schemaVersion: REST_ENVELOPE_SCHEMA_VERSION,
    kind: opts.kind,
    items: opts.items,
    filters: opts.filters,
    counts,
  };
}

/**
 * Build a single-resource envelope. Used for `/api/nodes/:pathB64`
 * (kind: `'node'`).
 */
export function buildSingleEnvelope<TItem>(
  kind: TEnvelopeKind,
  item: TItem,
): ISingleEnvelope<TItem> {
  return {
    schemaVersion: REST_ENVELOPE_SCHEMA_VERSION,
    kind,
    item,
  };
}

/**
 * Build a value envelope (object payload, no `item` semantics). Used for
 * `/api/config` where the resource is the config object itself.
 */
export function buildValueEnvelope<TValue>(
  kind: TEnvelopeKind,
  value: TValue,
): IValueEnvelope<TValue> {
  return {
    schemaVersion: REST_ENVELOPE_SCHEMA_VERSION,
    kind,
    value,
  };
}
