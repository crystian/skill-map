/**
 * `GET /api/nodes` — paginated, filtered list of persisted nodes.
 * `GET /api/nodes/:pathB64` — single-node detail bundle (mirrors `sm show --json`).
 *
 * **List filtering** funnels through `urlParamsToExportQuery` →
 * `applyExportQuery`, which means `/api/nodes` and `sm export` share
 * one filter grammar. The `hasIssues=false` post-filter handles the
 * one case the kernel grammar can't express (negation).
 *
 * **Pagination** applies only to the list route. Defaults: `offset=0`,
 * `limit=100`. `limit > 1000` rejects with `bad-query` (caps the cost
 * of a single response). `/api/links` and `/api/issues` do NOT
 * paginate at 14.2 — typical scopes have at most a few hundred rows.
 *
 * **Single route** uses base64url-encoded `node.path` as the route
 * param. Malformed pathB64 → `not-found` (treating it as "no such
 * node" is gentler than yelling "bad input"). Missing node → same.
 *
 * **Single route response shape** (Step 14.5.a — locked):
 *
 *   ```
 *   {
 *     schemaVersion: '1',
 *     kind: 'node',
 *     item: Node,                                  // (+ optional `body`)
 *     links: { incoming: Link[], outgoing: Link[] },
 *     issues: Issue[]
 *   }
 *   ```
 *
 *   Pre-14.5.a the handler emitted `{ item: { node, linksOut, linksIn,
 *   issues } }` — the `INodeBundle` shape passed straight through. No
 *   prod consumer ever ran against it (the SPA's `INodeDetailApi`
 *   model already declared the new shape, and the only `getNode`
 *   call sites today are tests and the `StaticDataSource` which
 *   already produces the new shape). The 14.5.a flip is therefore a
 *   bug fix, not a breaking change for any deployed surface.
 *
 * **`?include=body` (Step 14.5.a)** — opt-in flag that adds `item.body`
 * to the response. The body is read from disk on demand (the kernel
 * persists `body_hash` only — see `node-body.ts` for the rationale).
 * Without the flag the handler never touches the filesystem; with it,
 * `body` is the post-frontmatter content as a UTF-8 string, or `null`
 * when the file is missing / unreadable. The Inspector view passes the
 * flag; the auto-rename UI and other future single-node consumers can
 * skip it.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { applyExportQuery } from '../../kernel/index.js';
import { tryWithSqlite } from '../../cli/util/with-sqlite.js';
import { tx } from '../../kernel/util/tx.js';
import { buildListEnvelope, REST_ENVELOPE_SCHEMA_VERSION } from '../envelope.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { readNodeBody } from '../node-body.js';
import { decodeNodePath, PathCodecError } from '../path-codec.js';
import {
  filterNodesWithoutIssues,
  urlParamsToExportQuery,
} from '../query-adapter.js';
import type { IRouteDeps } from './deps.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export function registerNodesRoutes(app: Hono, deps: IRouteDeps): void {
  // Single-node route registered FIRST so the `:pathB64` segment doesn't
  // get shadowed by the literal `/api/nodes` prefix.
  app.get('/api/nodes/:pathB64', async (c) => {
    const pathB64 = c.req.param('pathB64');
    let nodePath: string;
    try {
      nodePath = decodeNodePath(pathB64);
    } catch (err) {
      // Malformed pathB64 surfaces as 404 — from the client's view there's
      // no such node either way. The thrown error message is logged via
      // `formatErrorMessage` in `app.onError`.
      if (err instanceof PathCodecError) {
        throw new HTTPException(404, { message: SERVER_TEXTS.pathB64Malformed });
      }
      throw err;
    }
    const bundle = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      (adapter) => adapter.scans.findNode(nodePath),
    );
    if (!bundle) {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.nodeNotFound, { path: nodePath }),
      });
    }
    const includes = parseIncludes(new URL(c.req.url).searchParams.get('include'));
    const item = includes.has('body')
      ? { ...bundle.node, body: await readNodeBody(deps.runtimeContext.cwd, nodePath) }
      : bundle.node;
    return c.json({
      schemaVersion: REST_ENVELOPE_SCHEMA_VERSION,
      kind: 'node' as const,
      item,
      links: { incoming: bundle.linksIn, outgoing: bundle.linksOut },
      issues: bundle.issues,
      kindRegistry: deps.kindRegistry,
    });
  });

  app.get('/api/nodes', async (c) => {
    const params = new URL(c.req.url).searchParams;
    const { query, filters } = urlParamsToExportQuery(params);
    const { offset, limit } = parsePagination(params);

    const loaded = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      (adapter) => adapter.scans.load(),
    );
    const scan = loaded ?? { nodes: [], links: [], issues: [] };
    const subset = applyExportQuery(scan, query);

    // hasIssues=false is the one filter the kernel grammar can't carry —
    // applied here as a post-filter against the already-narrowed subset.
    let nodes = subset.nodes;
    if (filters.hasIssues === false) {
      nodes = filterNodesWithoutIssues(nodes, scan.issues);
    }

    const total = nodes.length;
    const items = nodes.slice(offset, offset + limit);

    return c.json(
      buildListEnvelope({
        kind: 'nodes',
        items,
        filters: {
          kind: filters.kinds ?? null,
          hasIssues: filters.hasIssues ?? null,
          path: filters.pathGlobs ?? null,
        },
        total,
        page: { offset, limit },
        kindRegistry: deps.kindRegistry,
      }),
    );
  });
}

interface IPagination {
  offset: number;
  limit: number;
}

function parsePagination(params: URLSearchParams): IPagination {
  const offset = parseNonNegativeInt(params.get('offset'), 'offset', 0);
  const limit = parseNonNegativeInt(params.get('limit'), 'limit', DEFAULT_LIMIT);
  if (limit > MAX_LIMIT) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.paginationLimitTooLarge, { value: limit, max: MAX_LIMIT }),
    });
  }
  return { offset, limit };
}

function parseNonNegativeInt(
  raw: string | null,
  name: string,
  fallback: number,
): number {
  if (raw === null || raw.length === 0) return fallback;
  const trimmed = raw.trim();
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== trimmed) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.paginationInvalidInteger, { name, value: raw }),
    });
  }
  return parsed;
}

/**
 * Parse the comma-separated `?include=` query param into a set of
 * include flags. Unknown values are silently ignored — callers branch
 * on `set.has('body')`, etc., so a future `?include=summary,body`
 * value lands without churning every existing call site. An absent /
 * empty param resolves to an empty set.
 */
function parseIncludes(raw: string | null): ReadonlySet<string> {
  if (raw === null || raw.length === 0) return new Set();
  return new Set(raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0));
}
