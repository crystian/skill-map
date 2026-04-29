/**
 * `sm list [--kind <k>] [--issue] [--sort-by ...] [--limit N] [--json]`
 *
 * Tabular listing of nodes from the persisted snapshot. `--json` emits an
 * array conforming to `spec/schemas/node.schema.json` (one Node per row,
 * no envelope).
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  ok (including empty result)
 *   2  bad flag (unknown --sort-by, non-numeric --limit)
 *   5  DB file missing — run `sm scan` first
 */

import { Command, Option } from 'clipanion';
import { sql } from 'kysely';

import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import { rowToNode } from '../../kernel/adapters/sqlite/scan-load.js';
import { assertDbExists, resolveDbPath } from '../util/db-path.js';
import { ExitCode } from '../util/exit-codes.js';
import { withSqlite } from '../util/with-sqlite.js';

// Whitelist of sortable columns. NEVER interpolate user input into SQL —
// `--sort-by` is rejected with exit 2 if it isn't in this map. Each entry
// pairs the camelCase Kysely column name (CamelCasePlugin rewrites to
// snake_case for SQL) with a sensible default direction: ASC for textual
// columns (alphabetic browsing), DESC for numeric columns (largest /
// most-active first, which is the obvious "show me what matters" intent
// when a user pairs --sort-by bytes_total with --limit N).
const SORT_BY: Record<string, { column: string; direction: 'asc' | 'desc' }> = {
  path: { column: 'path', direction: 'asc' },
  kind: { column: 'kind', direction: 'asc' },
  bytes_total: { column: 'bytesTotal', direction: 'desc' },
  links_out_count: { column: 'linksOutCount', direction: 'desc' },
  links_in_count: { column: 'linksInCount', direction: 'desc' },
  external_refs_count: { column: 'externalRefsCount', direction: 'desc' },
};

const PATH_COL_WIDTH = 50;

export class ListCommand extends Command {
  static override paths = [['list']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Tabular listing of nodes. --json emits an array conforming to node.schema.json.',
    details: `
      Reads from the persisted scan snapshot (scan_nodes). Filters:
      --kind <k> restricts to one node kind; --issue keeps only nodes
      that touch at least one current issue.

      --sort-by accepts: path, kind, bytes_total, links_out_count,
      links_in_count, external_refs_count. Default: path. --limit N caps
      the result; default is no limit.

      Run \`sm scan\` first to populate the DB.
    `,
    examples: [
      ['List every node', '$0 list'],
      ['List only agents', '$0 list --kind agent'],
      ['Top 5 by total bytes', '$0 list --sort-by bytes_total --limit 5'],
      ['Only nodes with issues, machine-readable', '$0 list --issue --json'],
    ],
  });

  global = Option.Boolean('-g,--global', false);
  db = Option.String('--db', { required: false });
  kind = Option.String('--kind', { required: false });
  issue = Option.Boolean('--issue', false);
  sortBy = Option.String('--sort-by', { required: false });
  limit = Option.String('--limit', { required: false });
  json = Option.Boolean('--json', false);

  async execute(): Promise<number> {
    // --- flag validation ---------------------------------------------------
    let sortColumn = 'path';
    let sortDirection: 'asc' | 'desc' = 'asc';
    if (this.sortBy !== undefined) {
      const resolved = SORT_BY[this.sortBy];
      if (!resolved) {
        this.context.stderr.write(
          `--sort-by: invalid sort field "${this.sortBy}". Allowed: ${Object.keys(SORT_BY).join(', ')}.\n`,
        );
        return ExitCode.Error;
      }
      sortColumn = resolved.column;
      sortDirection = resolved.direction;
    }

    let limitValue: number | undefined;
    if (this.limit !== undefined) {
      const parsed = Number.parseInt(this.limit, 10);
      if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== this.limit.trim()) {
        this.context.stderr.write(
          `--limit: expected a positive integer, got "${this.limit}".\n`,
        );
        return ExitCode.Error;
      }
      limitValue = parsed;
    }

    // --- DB ----------------------------------------------------------------
    const dbPath = resolveDbPath({ global: this.global, db: this.db });
    if (!assertDbExists(dbPath, this.context.stderr)) return ExitCode.NotFound;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      let query = adapter.db.selectFrom('scan_nodes').selectAll();
      if (this.kind !== undefined) {
        // Cast through unknown — the column is the union NodeKind, but we
        // accept any string from the CLI and let the WHERE filter match
        // (or not) without throwing on unknown kinds. An unknown kind
        // simply yields zero rows.
        query = query.where('kind', '=', this.kind as never);
      }
      if (this.issue) {
        // Subquery: keep only nodes whose path is referenced by any
        // scan_issue's nodeIdsJson array. node:sqlite ships JSON1 enabled,
        // so json_each is available everywhere we run.
        query = query.where(({ exists, selectFrom, ref }) =>
          exists(
            selectFrom(sql<{ value: string }>`json_each(scan_issues.node_ids_json)`.as('je'))
              .innerJoin('scan_issues', (j) => j.onTrue())
              .select(sql<number>`1`.as('one'))
              .whereRef(sql.ref('je.value'), '=', ref('scan_nodes.path')),
          ),
        );
      }
      query = query.orderBy(sortColumn as never, sortDirection);
      if (limitValue !== undefined) query = query.limit(limitValue);

      const rows = await query.execute();
      const nodes = rows.map(rowToNode);

      // Per-row issue count (used by both renderers). Keep it cheap by
      // computing once for every node returned rather than joining in SQL.
      const issuesByNode = await this.#countIssuesPerNode(adapter, nodes.map((n) => n.path));

      if (this.json) {
        this.context.stdout.write(JSON.stringify(nodes) + '\n');
        return ExitCode.Ok;
      }

      if (nodes.length === 0) {
        this.context.stdout.write('No nodes found.\n');
        return ExitCode.Ok;
      }

      this.context.stdout.write(renderTable(nodes, issuesByNode));
      return ExitCode.Ok;
    });
  }

  async #countIssuesPerNode(
    adapter: SqliteStorageAdapter,
    paths: string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (paths.length === 0) return out;

    // Pull every issue's nodeIdsJson and tally locally. Dataset is small
    // (issue counts are O(nodes), not O(N*M)) and avoids per-row subqueries.
    const issueRows = await adapter.db
      .selectFrom('scan_issues')
      .select(['nodeIdsJson'])
      .execute();
    const wanted = new Set(paths);
    for (const row of issueRows) {
      let ids: unknown;
      try {
        ids = JSON.parse(row.nodeIdsJson);
      } catch {
        continue;
      }
      if (!Array.isArray(ids)) continue;
      for (const id of ids) {
        if (typeof id !== 'string' || !wanted.has(id)) continue;
        out.set(id, (out.get(id) ?? 0) + 1);
      }
    }
    return out;
  }
}

// --- human renderer -------------------------------------------------------

function renderTable(
  nodes: ReturnType<typeof rowToNode>[],
  issuesByNode: Map<string, number>,
): string {
  // Fixed-width columns. The path column truncates with an ellipsis to
  // keep the table readable on standard 100-column terminals; the JSON
  // mode preserves full paths.
  const header = formatRow('PATH', 'KIND', 'OUT', 'IN', 'EXT', 'ISSUES', 'BYTES');
  const sep = '-'.repeat(header.length);
  const lines = [header, sep];
  for (const node of nodes) {
    lines.push(
      formatRow(
        truncate(node.path, PATH_COL_WIDTH),
        node.kind,
        String(node.linksOutCount),
        String(node.linksInCount),
        String(node.externalRefsCount),
        String(issuesByNode.get(node.path) ?? 0),
        String(node.bytes.total),
      ),
    );
  }
  return lines.join('\n') + '\n';
}

function formatRow(
  path: string,
  kind: string,
  out: string,
  inCount: string,
  ext: string,
  issues: string,
  bytes: string,
): string {
  return [
    path.padEnd(PATH_COL_WIDTH),
    kind.padEnd(8),
    out.padStart(4),
    inCount.padStart(4),
    ext.padStart(4),
    issues.padStart(7),
    bytes.padStart(8),
  ].join('  ');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return '…' + s.slice(s.length - max + 1);
}
