/**
 * `GET /api/issues?severity=&ruleId=&node=` — filtered list of persisted issues.
 *
 * Filters:
 *
 *   - `severity=error,warn` — comma-separated whitelist (any subset of
 *     `error|warn|info`). Unknown severities yield zero matches.
 *   - `ruleId=core/broken-ref,core/superseded` — comma-separated rule
 *     ids. Match shape mirrors `sm check`'s `--rules`: an entry without
 *     a `/` matches the suffix after `/` so a user can drop the
 *     `<plugin>/` prefix when it's unambiguous.
 *   - `node=<node.path>` — keep issues whose `nodeIds` array includes
 *     the given path.
 *
 * No pagination at 14.2 — see the catalogue note in the brief.
 */

import type { Hono } from 'hono';

import type { Issue } from '../../kernel/index.js';
import { tryWithSqlite } from '../../cli/util/with-sqlite.js';
import { buildListEnvelope } from '../envelope.js';
import type { IRouteDeps } from './deps.js';

export function registerIssuesRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/issues', async (c) => {
    const params = new URL(c.req.url).searchParams;
    const severityFilter = parseCsv(params.get('severity'));
    const ruleFilter = parseRulesFilter(params.get('ruleId'));
    const nodePath = params.get('node');

    const loaded = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      (adapter) => adapter.issues.listAll(),
    );
    const allIssues: Issue[] = loaded ?? [];
    const filtered = allIssues.filter((issue) => {
      if (severityFilter && !severityFilter.includes(issue.severity)) return false;
      if (ruleFilter && !matchesRuleFilter(issue.ruleId, ruleFilter)) return false;
      if (nodePath !== null && !issue.nodeIds.includes(nodePath)) return false;
      return true;
    });

    return c.json(
      buildListEnvelope({
        kind: 'issues',
        items: filtered,
        filters: {
          severity: severityFilter ?? null,
          ruleId: ruleFilter ? [...ruleFilter] : null,
          node: nodePath ?? null,
        },
        total: filtered.length,
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

function parseRulesFilter(raw: string | null): Set<string> | null {
  const list = parseCsv(raw);
  return list ? new Set(list) : null;
}

/** Mirror of `sm check`'s `matchesRuleFilter` — qualified or short suffix match. */
function matchesRuleFilter(ruleId: string, filter: Set<string>): boolean {
  if (filter.has(ruleId)) return true;
  const slashIdx = ruleId.indexOf('/');
  if (slashIdx >= 0) {
    const short = ruleId.slice(slashIdx + 1);
    if (filter.has(short)) return true;
  }
  return false;
}
