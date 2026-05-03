/**
 * `GET /api/links?kind=&from=&to=` — filtered list of persisted links.
 *
 * Reads `loadScanResult().links`, then drops rows that don't match the
 * URL filters:
 *
 *   - `kind=invokes,references` — comma-separated whitelist matched against
 *     `link.kind`. Unknown values yield zero matches (no validation against
 *     the spec enum here — `parseExportQuery`-style permissiveness so a
 *     plugin extending the link kind catalog doesn't need a server edit).
 *   - `from=<node.path>` — exact match on `link.source`.
 *   - `to=<node.path>` — exact match on `link.target`.
 *
 * No pagination — typical scopes have at most a few hundred links; the
 * brief explicitly defers paging to 14.5 if it becomes a problem.
 */

import type { Hono } from 'hono';

import type { Link } from '../../kernel/index.js';
import { tryWithSqlite } from '../../cli/util/with-sqlite.js';
import { buildListEnvelope } from '../envelope.js';
import type { IRouteDeps } from './deps.js';

export function registerLinksRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/links', async (c) => {
    const params = new URL(c.req.url).searchParams;
    const kindFilter = parseCsv(params.get('kind'));
    const from = params.get('from');
    const to = params.get('to');

    const loaded = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      (adapter) => adapter.scans.load(),
    );
    const allLinks: Link[] = loaded?.links ?? [];
    const filtered = allLinks.filter((link) => {
      if (kindFilter && !kindFilter.includes(link.kind)) return false;
      if (from !== null && link.source !== from) return false;
      if (to !== null && link.target !== to) return false;
      return true;
    });

    return c.json(
      buildListEnvelope({
        kind: 'links',
        items: filtered,
        filters: {
          kind: kindFilter ?? null,
          from: from ?? null,
          to: to ?? null,
        },
        total: filtered.length,
        kindRegistry: deps.kindRegistry,
      }),
    );
  });
}

function parseCsv(raw: string | null): string[] | null {
  if (raw === null) return null;
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return list.length > 0 ? list : null;
}
