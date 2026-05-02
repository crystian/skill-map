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

import type { StoragePort } from '../../kernel/ports/storage.js';
import type { Node } from '../../kernel/types.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { LIST_TEXTS } from '../i18n/list.texts.js';
import { assertDbExists, resolveDbPath } from '../util/db-path.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { ExitCode } from '../util/exit-codes.js';
import { truncateTail } from '../util/text.js';
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
          tx(LIST_TEXTS.invalidSortBy, {
            value: this.sortBy,
            allowed: Object.keys(SORT_BY).join(', '),
          }),
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
        this.context.stderr.write(tx(LIST_TEXTS.invalidLimit, { value: this.limit }));
        return ExitCode.Error;
      }
      limitValue = parsed;
    }

    // --- DB ----------------------------------------------------------------
    const dbPath = resolveDbPath({ global: this.global, db: this.db, ...defaultRuntimeContext() });
    if (!assertDbExists(dbPath, this.context.stderr)) return ExitCode.NotFound;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const filter: { kind?: string; hasIssues?: boolean; sortBy: string; sortDirection: 'asc' | 'desc'; limit?: number } = {
        sortBy: sortColumn,
        sortDirection,
      };
      if (this.kind !== undefined) filter.kind = this.kind;
      if (this.issue) filter.hasIssues = true;
      if (limitValue !== undefined) filter.limit = limitValue;
      const nodes = await adapter.scans.findNodes(filter);

      // Per-row issue count (used by both renderers). Keep it cheap by
      // computing once for every node returned rather than joining in SQL.
      const issuesByNode = await this.#countIssuesPerNode(adapter, nodes.map((n) => n.path));

      if (this.json) {
        this.context.stdout.write(JSON.stringify(nodes) + '\n');
        return ExitCode.Ok;
      }

      if (nodes.length === 0) {
        this.context.stdout.write(LIST_TEXTS.noNodesFound);
        return ExitCode.Ok;
      }

      this.context.stdout.write(renderTable(nodes, issuesByNode));
      return ExitCode.Ok;
    });
  }

  async #countIssuesPerNode(
    adapter: StoragePort,
    paths: string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (paths.length === 0) return out;

    // Pull every issue and tally locally. Dataset is small (issue
    // counts are O(nodes), not O(N*M)) and avoids per-row subqueries.
    const issues = await adapter.issues.listAll();
    const wanted = new Set(paths);
    for (const issue of issues) {
      for (const id of issue.nodeIds) {
        if (!wanted.has(id)) continue;
        out.set(id, (out.get(id) ?? 0) + 1);
      }
    }
    return out;
  }
}

// --- human renderer -------------------------------------------------------

function renderTable(
  nodes: Node[],
  issuesByNode: Map<string, number>,
): string {
  // Fixed-width columns. The path column truncates with an ellipsis to
  // keep the table readable on standard 100-column terminals; the JSON
  // mode preserves full paths.
  const header = formatRow(
    LIST_TEXTS.tableHeaderPath,
    LIST_TEXTS.tableHeaderKind,
    LIST_TEXTS.tableHeaderOut,
    LIST_TEXTS.tableHeaderIn,
    LIST_TEXTS.tableHeaderExt,
    LIST_TEXTS.tableHeaderIssues,
    LIST_TEXTS.tableHeaderBytes,
  );
  const sep = '-'.repeat(header.length);
  const lines = [header, sep];
  for (const node of nodes) {
    // Defence in depth: `path` and `kind` originate from extension code
    // (Provider classification) and persisted SQLite rows. Sanitize
    // before rendering so a hostile Provider cannot slip ANSI / C0
    // bytes through `sm list`.
    lines.push(
      formatRow(
        truncateTail(sanitizeForTerminal(node.path), PATH_COL_WIDTH),
        sanitizeForTerminal(node.kind),
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

