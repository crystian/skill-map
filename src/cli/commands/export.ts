/**
 * `sm export <query> --format <json|md|mermaid>`
 *
 * Filtered export over the persisted graph. Reads the DB, parses the
 * query (see `src/kernel/scan/query.ts` for the grammar), applies the
 * filter, and emits the selected subset in the requested format.
 *
 * Read-only: opens the DB, calls `loadScanResult`, never persists.
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  ok
 *   2  bad flag / unsupported format / invalid query / unhandled error
 *   5  DB missing
 *
 * **Format support at v0.5.0**: `json` and `md` are real; `mermaid`
 * exits 2 with a clear pointer to Step 12, when the mermaid formatter
 * lands as a built-in. Wiring the format here ahead of the formatter
 * would require a synthesis layer this verb shouldn't carry.
 */

import { Command, Option } from 'clipanion';

import {
  applyExportQuery,
  ExportQueryError,
  parseExportQuery,
} from '../../kernel/scan/query.js';
import type { IExportSubset } from '../../kernel/scan/query.js';
import type { Issue, Link, Node } from '../../kernel/types.js';
import { assertDbExists, resolveDbPath } from '../util/db-path.js';
import { ExitCode } from '../util/exit-codes.js';
import { tx } from '../../kernel/util/tx.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { EXPORT_TEXTS } from '../i18n/export.texts.js';
import { withSqlite } from '../util/with-sqlite.js';

// Built-in Claude Provider catalog rendered first, in this canonical
// order. External Providers may emit additional kinds; those are
// rendered after, sorted alphabetically (see `renderNodesByKindSection`).
const KIND_ORDER: readonly string[] = ['agent', 'command', 'hook', 'skill', 'note'];
const SUPPORTED_FORMATS = ['json', 'md'] as const;
const DEFERRED_FORMATS: Record<string, string> = {
  mermaid: 'lands at Step 12 with the mermaid formatter',
};

export class ExportCommand extends Command {
  static override paths = [['export']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Filtered export. Query syntax is implementation-defined pre-1.0.',
    details: `
      Reads the persisted scan, applies the query filter, and emits the
      selected subset.

      Query syntax (v0.5.0): whitespace-separated key=value tokens; AND
      across keys, OR within comma-separated values. Keys: \`kind\`
      (skill / agent / command / hook / note), \`has\` (issues), \`path\`
      (POSIX glob — \`*\` matches a single segment, \`**\` matches across
      segments).

      Pass an empty query (\`""\`) to export every node.

      Run \`sm scan\` first to populate the DB.
    `,
    examples: [
      ['Every command node', '$0 export "kind=command" --format json'],
      ['Skills + agents with issues', '$0 export "kind=skill,agent has=issues" --format md'],
      ['Files under a path glob', '$0 export "path=.claude/commands/**" --format json'],
      ['Whole graph as Markdown', '$0 export "" --format md'],
    ],
  });

  query = Option.String({ required: true });
  format = Option.String('--format', { required: false });
  global = Option.Boolean('-g,--global', false);
  db = Option.String('--db', { required: false });

  async execute(): Promise<number> {
    const format = (this.format ?? 'json').toLowerCase();
    if (DEFERRED_FORMATS[format]) {
      this.context.stderr.write(
        tx(EXPORT_TEXTS.formatNotImplemented, {
          format,
          reason: DEFERRED_FORMATS[format],
        }),
      );
      return ExitCode.Error;
    }
    if (!(SUPPORTED_FORMATS as readonly string[]).includes(format)) {
      this.context.stderr.write(
        tx(EXPORT_TEXTS.formatUnsupported, {
          format,
          supported: SUPPORTED_FORMATS.join(', '),
          deferred: Object.keys(DEFERRED_FORMATS).join(', '),
        }),
      );
      return ExitCode.Error;
    }

    let parsedQuery;
    try {
      parsedQuery = parseExportQuery(this.query);
    } catch (err) {
      if (err instanceof ExportQueryError) {
        this.context.stderr.write(tx(EXPORT_TEXTS.errorPrefix, { message: err.message }));
        return ExitCode.Error;
      }
      throw err;
    }

    const dbPath = resolveDbPath({ global: this.global, db: this.db });
    if (!assertDbExists(dbPath, this.context.stderr)) return ExitCode.NotFound;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const scan = await adapter.scans.load();
      const subset = applyExportQuery(
        { nodes: scan.nodes, links: scan.links, issues: scan.issues },
        parsedQuery,
      );

      if (format === 'json') {
        this.context.stdout.write(JSON.stringify(serialiseSubset(subset)) + '\n');
        return ExitCode.Ok;
      }
      // format === 'md'
      this.context.stdout.write(renderMarkdown(subset));
      return ExitCode.Ok;
    });
  }
}

function serialiseSubset(subset: IExportSubset): {
  query: string;
  filters: { kinds?: string[]; hasIssues?: boolean; pathGlobs?: string[] };
  counts: { nodes: number; links: number; issues: number };
  nodes: Node[];
  links: Link[];
  issues: Issue[];
} {
  const filters: ReturnType<typeof serialiseSubset>['filters'] = {};
  if (subset.query.kinds) filters.kinds = subset.query.kinds;
  if (subset.query.hasIssues) filters.hasIssues = true;
  if (subset.query.pathGlobs) filters.pathGlobs = subset.query.pathGlobs;
  return {
    query: subset.query.raw,
    filters,
    counts: {
      nodes: subset.nodes.length,
      links: subset.links.length,
      issues: subset.issues.length,
    },
    nodes: subset.nodes,
    links: subset.links,
    issues: subset.issues,
  };
}

function renderMarkdown(subset: IExportSubset): string {
  const out: string[] = [];
  out.push(`# skill-map export`);
  out.push('');
  out.push(`Query: \`${subset.query.raw || '(empty — all nodes)'}\``);
  out.push(
    `Counts: ${subset.nodes.length} nodes, ${subset.links.length} links, ${subset.issues.length} issues.`,
  );
  out.push('');

  const issuesPerNode = countIssuesPerNode(subset.issues);
  out.push(...renderNodesByKindSection(subset.nodes, issuesPerNode));

  if (subset.links.length > 0) {
    out.push(`## links (${subset.links.length})`);
    out.push('');
    const sorted = [...subset.links].sort((a, b) => {
      const aKey = `${a.source}\x00${a.kind}\x00${a.target}`;
      const bKey = `${b.source}\x00${b.kind}\x00${b.target}`;
      return aKey.localeCompare(bKey);
    });
    for (const link of sorted) {
      out.push(`- \`${sanitizeForTerminal(link.source)}\` --${sanitizeForTerminal(link.kind)}--> \`${sanitizeForTerminal(link.target)}\` _[${link.confidence}]_`);
    }
    out.push('');
  }

  if (subset.issues.length > 0) {
    out.push(`## issues (${subset.issues.length})`);
    out.push('');
    for (const issue of subset.issues) {
      out.push(`- **[${issue.severity}]** \`${sanitizeForTerminal(issue.ruleId)}\`: ${sanitizeForTerminal(issue.message)}`);
    }
    out.push('');
  }

  return out.join('\n');
}

/** Index issues by node path so the per-kind renderer can show issue counts. */
function countIssuesPerNode(issues: Issue[]): Map<string, number> {
  const issuesPerNode = new Map<string, number>();
  for (const issue of issues) {
    for (const id of issue.nodeIds) {
      issuesPerNode.set(id, (issuesPerNode.get(id) ?? 0) + 1);
    }
  }
  return issuesPerNode;
}

/**
 * Render the nodes-by-kind sections of the markdown export. Groups
 * nodes per kind in `KIND_ORDER`, sorts each group by path, and emits
 * `## <kind> (N)` headers followed by `- \`<path>\` — "<title>" — N
 * issues` bullets.
 */
function renderNodesByKindSection(
  nodes: Node[],
  issuesPerNode: Map<string, number>,
): string[] {
  const byKind = new Map<string, Node[]>();
  for (const node of nodes) {
    if (!byKind.has(node.kind)) byKind.set(node.kind, []);
    byKind.get(node.kind)!.push(node);
  }

  // Built-in Claude catalog first in canonical order; external-Provider
  // kinds appended after, alphabetically sorted, so the output is
  // deterministic across runs even with arbitrary kind sets.
  const lines: string[] = [];
  const renderedKinds = new Set<string>();
  const orderedKinds: string[] = [
    ...KIND_ORDER,
    ...[...byKind.keys()].filter((k) => !KIND_ORDER.includes(k)).sort(),
  ];
  for (const kind of orderedKinds) {
    if (renderedKinds.has(kind)) continue;
    const group = byKind.get(kind);
    if (!group || group.length === 0) continue;
    appendKindSection(lines, kind, group, issuesPerNode);
    renderedKinds.add(kind);
  }
  return lines;
}

function appendKindSection(
  lines: string[],
  kind: string,
  group: Node[],
  issuesPerNode: Map<string, number>,
): void {
  const sorted = [...group].sort((a, b) => a.path.localeCompare(b.path));
  lines.push(`## ${sanitizeForTerminal(kind)} (${sorted.length})`);
  lines.push('');
  for (const node of sorted) lines.push(renderNodeBullet(node, issuesPerNode));
  lines.push('');
}

/** Render one node as a markdown bullet, with optional title + issue count. */
function renderNodeBullet(node: Node, issuesPerNode: Map<string, number>): string {
  const title = pickTitle(node);
  const issueCount = issuesPerNode.get(node.path) ?? 0;
  const issueSuffix = issueCount > 0 ? ` — ${issueCount} issue${issueCount === 1 ? '' : 's'}` : '';
  return `- \`${sanitizeForTerminal(node.path)}\`${title ? ` — "${sanitizeForTerminal(title)}"` : ''}${issueSuffix}`;
}

function pickTitle(node: Node): string | null {
  if (node.title) return node.title;
  const name = node.frontmatter?.['name'];
  return typeof name === 'string' ? name : null;
}
