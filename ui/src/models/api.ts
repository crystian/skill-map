/**
 * Local TypeScript mirrors of the JSON shapes returned by the BFF
 * (`src/server/routes/*`) and persisted by `@skill-map/spec`.
 *
 * Temporary. The canonical sources of truth are:
 *   - `spec/schemas/scan-result.schema.json`
 *   - `spec/schemas/node.schema.json`
 *   - `spec/schemas/link.schema.json`
 *   - `spec/schemas/issue.schema.json`
 *   - `spec/schemas/project-config.schema.json`
 *   - `src/server/envelope.ts` (REST envelope shapes)
 *
 * These mirrors live in the UI only until ROADMAP §DTO gap (Step 1b/2)
 * lands a typed bridge from `@skill-map/spec`. Drift risk is accepted for
 * Step 14.3.a; the BFF is the authoritative producer and any mismatch
 * surfaces immediately at fetch-time during integration smoke tests.
 *
 * DO NOT extend with UI-specific fields. Compose UI state separately
 * (see `models/node.ts:INodeView` for the equivalent pattern).
 */

import type { TStability, TFrontmatter } from './node';

/**
 * `Node` from `node.schema.json`. Persisted shape returned by the BFF
 * over `/api/scan`, `/api/nodes`, and `/api/nodes/:pathB64`.
 *
 * `body` is opt-in: present only on `/api/nodes/:pathB64?include=body`
 * (Step 14.5.a). The body is read from disk on demand because the
 * kernel persists `bodyHash` only — see `src/server/node-body.ts`.
 * `null` means the file disappeared from disk between the last scan
 * and this request; `undefined` means the caller did not opt in.
 */
export interface INodeApi {
  path: string;
  kind: string;
  provider: string;
  title?: string | null;
  description?: string | null;
  stability?: TStability | null;
  version?: string | null;
  author?: string | null;
  frontmatter?: TFrontmatter;
  bodyHash: string;
  frontmatterHash: string;
  bytes: ITripleSplit;
  tokens?: ITripleSplit;
  linksOutCount: number;
  linksInCount: number;
  externalRefsCount: number;
  body?: string | null;
}

export interface ITripleSplit {
  frontmatter: number;
  body: number;
  total: number;
}

/**
 * `Link` from `link.schema.json`. Persisted shape returned over `/api/scan`,
 * `/api/links`, and the `links` payload of `/api/nodes/:pathB64`.
 */
export type TLinkKindApi = 'invokes' | 'references' | 'mentions' | 'supersedes';
export type TLinkConfidenceApi = 'high' | 'medium' | 'low';

export interface ILinkApi {
  source: string;
  target: string;
  kind: TLinkKindApi;
  confidence: TLinkConfidenceApi;
  sources: string[];
  trigger?: { originalTrigger: string; normalizedTrigger: string } | null;
  location?: { line: number; column?: number; offset?: number } | null;
  raw?: string | null;
}

/**
 * `Issue` from `issue.schema.json`.
 */
export type TIssueSeverityApi = 'error' | 'warn' | 'info';

export interface IIssueApi {
  ruleId: string;
  severity: TIssueSeverityApi;
  nodeIds: string[];
  linkIndices?: number[];
  message: string;
  detail?: string | null;
  fix?: { summary?: string; autofixable?: boolean } | null;
  data?: Record<string, unknown>;
}

/**
 * `ScanResult` from `scan-result.schema.json`. 1:1 with the BFF
 * `/api/scan` response (no envelope wrap).
 */
export interface IScanResultApi {
  schemaVersion: 1;
  scannedAt: number;
  scannedBy?: { name?: string; version?: string; specVersion?: string } | null;
  scope: 'project' | 'global';
  roots: string[];
  providers?: string[];
  nodes: INodeApi[];
  links: ILinkApi[];
  issues: IIssueApi[];
  stats: {
    filesWalked: number;
    filesSkipped: number;
    nodesCount: number;
    linksCount: number;
    issuesCount: number;
    durationMs: number;
  };
}

/**
 * `ProjectConfig` from `project-config.schema.json`. Shape is open at the
 * UI boundary today — the SPA reads only the fields it needs and treats
 * unknowns as inert.
 */
export interface IProjectConfigApi {
  schemaVersion?: number;
  autoMigrate?: boolean;
  tokenizer?: string;
  providers?: string[];
  roots?: string[];
  ignore?: string[];
  scan?: Record<string, unknown>;
  [extra: string]: unknown;
}

/**
 * REST envelope shapes mirroring `src/server/envelope.ts`.
 */
export const REST_ENVELOPE_SCHEMA_VERSION = '1';

export type TEnvelopeKindApi =
  | 'nodes'
  | 'links'
  | 'issues'
  | 'plugins'
  | 'config'
  | 'graph'
  | 'node'
  | 'health'
  | 'scan';

export interface IPageInfoApi {
  offset: number;
  limit: number;
}

export interface IEnvelopeCountsApi {
  total: number;
  returned: number;
  page?: IPageInfoApi;
}

export interface IListEnvelopeApi<TItem> {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: TEnvelopeKindApi;
  items: TItem[];
  filters: Record<string, unknown>;
  counts: IEnvelopeCountsApi;
}

export interface ISingleEnvelopeApi<TItem> {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: TEnvelopeKindApi;
  item: TItem;
}

export interface IValueEnvelopeApi<TValue> {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: TEnvelopeKindApi;
  value: TValue;
}

/**
 * `/api/nodes/:pathB64` response — single envelope augmented with a
 * `links` bundle and `issues` array for the inspector view.
 */
export interface INodeDetailApi {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: 'node';
  item: INodeApi;
  links: { incoming: ILinkApi[]; outgoing: ILinkApi[] };
  issues: IIssueApi[];
}

/**
 * `/api/health` response (mirrors `src/server/health.ts:IHealthResponse`).
 */
export interface IHealthResponseApi {
  ok: true;
  schemaVersion: string;
  specVersion: string;
  implVersion: string;
  scope: 'project' | 'global';
  db: 'present' | 'missing' | 'error';
}

/**
 * BFF error envelope shape returned on any 4xx/5xx.
 */
export type TErrorCodeApi =
  | 'not-found'
  | 'bad-query'
  | 'db-missing'
  | 'internal'
  | string;

export interface IErrorEnvelopeApi {
  ok: false;
  error: {
    code: TErrorCodeApi;
    message: string;
    details?: unknown;
  };
}
