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
 *   2  bad flag / unhandled error
 *   5  DB missing OR unsupported format OR invalid query
 *
 * **Format support at v0.5.0**: `json` and `md` are real; `mermaid`
 * exits 5 with a clear pointer to Step 12, when the mermaid renderer
 * lands as a built-in. Wiring the format here ahead of the renderer
 * would require a synthesis layer this verb shouldn't carry.
 */

import { Command, Option } from 'clipanion';

import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import { loadScanResult } from '../../kernel/adapters/sqlite/scan-load.js';
import {
  applyExportQuery,
  ExportQueryError,
  parseExportQuery,
} from '../../kernel/scan/query.js';
import type { IExportSubset } from '../../kernel/scan/query.js';
import type { Issue, Link, Node, NodeKind } from '../../kernel/types.js';
import { assertDbExists, resolveDbPath } from '../util/db-path.js';

const KIND_ORDER: NodeKind[] = ['agent', 'command', 'hook', 'skill', 'note'];
const SUPPORTED_FORMATS = ['json', 'md'] as const;
const DEFERRED_FORMATS: Record<string, string> = {
  mermaid: 'lands at Step 12 with the mermaid renderer',
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
        `format=${format} not yet implemented (${DEFERRED_FORMATS[format]}).\n`,
      );
      return 5;
    }
    if (!(SUPPORTED_FORMATS as readonly string[]).includes(format)) {
      this.context.stderr.write(
        `Unsupported format: ${format}. Supported: ${SUPPORTED_FORMATS.join(', ')}. ` +
          `Deferred: ${Object.keys(DEFERRED_FORMATS).join(', ')}.\n`,
      );
      return 5;
    }

    let parsedQuery;
    try {
      parsedQuery = parseExportQuery(this.query);
    } catch (err) {
      if (err instanceof ExportQueryError) {
        this.context.stderr.write(`sm export: ${err.message}\n`);
        return 5;
      }
      throw err;
    }

    const dbPath = resolveDbPath({ global: this.global, db: this.db });
    if (!assertDbExists(dbPath, this.context.stderr)) return 5;

    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      const scan = await loadScanResult(adapter.db);
      const subset = applyExportQuery(
        { nodes: scan.nodes, links: scan.links, issues: scan.issues },
        parsedQuery,
      );

      if (format === 'json') {
        this.context.stdout.write(JSON.stringify(serialiseSubset(subset)) + '\n');
        return 0;
      }
      // format === 'md'
      this.context.stdout.write(renderMarkdown(subset));
      return 0;
    } finally {
      await adapter.close();
    }
  }
}

function serialiseSubset(subset: IExportSubset): {
  query: string;
  filters: { kinds?: NodeKind[]; hasIssues?: boolean; pathGlobs?: string[] };
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

  // Issues per node, indexed for the per-kind section. We only count
  // here; full issue detail goes into its own section below.
  const issuesPerNode = new Map<string, number>();
  for (const issue of subset.issues) {
    for (const id of issue.nodeIds) {
      issuesPerNode.set(id, (issuesPerNode.get(id) ?? 0) + 1);
    }
  }

  // Group nodes by kind for readability — same ordering as the ascii
  // renderer so a md export looks familiar to anyone who's seen `sm graph`.
  const byKind = new Map<NodeKind, Node[]>();
  for (const node of subset.nodes) {
    if (!byKind.has(node.kind)) byKind.set(node.kind, []);
    byKind.get(node.kind)!.push(node);
  }

  for (const kind of KIND_ORDER) {
    const group = byKind.get(kind);
    if (!group || group.length === 0) continue;
    const sorted = [...group].sort((a, b) => a.path.localeCompare(b.path));
    out.push(`## ${kind} (${sorted.length})`);
    out.push('');
    for (const node of sorted) {
      const title = pickTitle(node);
      const issueCount = issuesPerNode.get(node.path) ?? 0;
      const issueSuffix = issueCount > 0 ? ` — ${issueCount} issue${issueCount === 1 ? '' : 's'}` : '';
      out.push(`- \`${node.path}\`${title ? ` — "${title}"` : ''}${issueSuffix}`);
    }
    out.push('');
  }

  if (subset.links.length > 0) {
    out.push(`## links (${subset.links.length})`);
    out.push('');
    const sorted = [...subset.links].sort((a, b) => {
      const aKey = `${a.source}\x00${a.kind}\x00${a.target}`;
      const bKey = `${b.source}\x00${b.kind}\x00${b.target}`;
      return aKey.localeCompare(bKey);
    });
    for (const link of sorted) {
      out.push(`- \`${link.source}\` --${link.kind}--> \`${link.target}\` _[${link.confidence}]_`);
    }
    out.push('');
  }

  if (subset.issues.length > 0) {
    out.push(`## issues (${subset.issues.length})`);
    out.push('');
    for (const issue of subset.issues) {
      out.push(`- **[${issue.severity}]** \`${issue.ruleId}\`: ${issue.message}`);
    }
    out.push('');
  }

  return out.join('\n');
}

function pickTitle(node: Node): string | null {
  if (node.title) return node.title;
  const name = node.frontmatter?.['name'];
  return typeof name === 'string' ? name : null;
}
