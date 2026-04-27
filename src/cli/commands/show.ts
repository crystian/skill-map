/**
 * `sm show <node.path> [--json]`
 *
 * Detail view for a single node: weight (bytes/tokens triple-split),
 * frontmatter, links in/out, current issues. `--json` emits a detail
 * object with `node`, `linksOut`, `linksIn`, `issues`, plus the future
 * `findings` (Step 10) and `summary` (Step 11) slots reserved as
 * `[]` / `null` so consumers don't break when those land.
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  ok
 *   2  bad flag
 *   5  node not found in scan_nodes (or the DB file is missing)
 */

import { Command, Option } from 'clipanion';

import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import {
  rowToIssue,
  rowToLink,
  rowToNode,
} from '../../kernel/adapters/sqlite/scan-load.js';
import type { Issue, Link, Node } from '../../kernel/types.js';
import { assertDbExists, resolveDbPath } from '../util/db-path.js';

interface IShowDocument {
  node: Node;
  linksOut: Link[];
  linksIn: Link[];
  issues: Issue[];
  // TODO Step 10: populate from `state_findings` once the table lands.
  findings: never[];
  // TODO Step 11: populate from `state_summaries` once summarisers ship.
  summary: null;
}

export class ShowCommand extends Command {
  static override paths = [['show']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Node detail: weight, frontmatter, links, issues, findings, summary.',
    details: `
      Loads a single node from the persisted snapshot, plus every link
      (in and out) and every current issue touching it. Findings and
      summaries are reserved slots and remain empty / null until the
      Step 10 / Step 11 features land.

      Run \`sm scan\` first to populate the DB.
    `,
    examples: [
      ['Show a single node', '$0 show .claude/agents/architect.md'],
      ['Machine-readable detail', '$0 show .claude/agents/architect.md --json'],
    ],
  });

  nodePath = Option.String({ required: true });
  global = Option.Boolean('-g,--global', false);
  db = Option.String('--db', { required: false });
  json = Option.Boolean('--json', false);

  async execute(): Promise<number> {
    const dbPath = resolveDbPath({ global: this.global, db: this.db });
    if (!assertDbExists(dbPath, this.context.stderr)) return 5;

    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      const nodeRow = await adapter.db
        .selectFrom('scan_nodes')
        .selectAll()
        .where('path', '=', this.nodePath)
        .executeTakeFirst();
      if (!nodeRow) {
        this.context.stderr.write(`Node not found: ${this.nodePath}\n`);
        return 5;
      }

      const [outRows, inRows, issueRows] = await Promise.all([
        adapter.db
          .selectFrom('scan_links')
          .selectAll()
          .where('sourcePath', '=', this.nodePath)
          .execute(),
        adapter.db
          .selectFrom('scan_links')
          .selectAll()
          .where('targetPath', '=', this.nodePath)
          .execute(),
        // No json_each on the LHS of `=` here — pull every issue, decode
        // its node_ids_json client-side, keep the ones that touch this
        // node. Issue counts are small; this is cheaper than wiring a
        // raw json_each subquery in Kysely.
        adapter.db.selectFrom('scan_issues').selectAll().execute(),
      ]);

      const node = rowToNode(nodeRow);
      const linksOut = outRows.map(rowToLink);
      const linksIn = inRows.map(rowToLink);
      const issues = issueRows
        .map(rowToIssue)
        .filter((i) => i.nodeIds.includes(this.nodePath));

      const doc: IShowDocument = {
        node,
        linksOut,
        linksIn,
        issues,
        findings: [],
        summary: null,
      };

      if (this.json) {
        this.context.stdout.write(JSON.stringify(doc) + '\n');
        return 0;
      }

      this.context.stdout.write(renderHuman(doc));
      return 0;
    } finally {
      await adapter.close();
    }
  }
}

// --- human renderer -------------------------------------------------------

function renderHuman(doc: IShowDocument): string {
  const { node, linksOut, linksIn, issues } = doc;
  const out: string[] = [];

  out.push(`${node.path} [${node.kind}] (adapter: ${node.adapter})`);
  if (node.title) out.push(`title:        ${node.title}`);
  if (node.description) out.push(`description:  ${node.description}`);
  if (node.stability) out.push(`stability:    ${node.stability}`);
  if (node.version) out.push(`version:      ${node.version}`);
  if (node.author) out.push(`author:       ${node.author}`);

  const b = node.bytes;
  out.push(
    `Weight: bytes ${b.total} total / ${b.frontmatter} frontmatter / ${b.body} body`,
  );
  if (node.tokens) {
    const t = node.tokens;
    out.push(
      `        tokens ${t.total} total / ${t.frontmatter} frontmatter / ${t.body} body`,
    );
  }
  // Render even when 0 — "External refs: 0" is information, not noise, and
  // mirrors the `--json` output which exposes `node.externalRefsCount`
  // unconditionally.
  out.push(`External refs: ${node.externalRefsCount}`);

  out.push('', 'Frontmatter:');
  out.push(indent(JSON.stringify(node.frontmatter ?? {}, null, 2), 2));

  // Per Step 7.2 + Decision #90: storage keeps one row per detector
  // (no merge), but the human view groups identical-shape links so a
  // skill detected by both the frontmatter and slash detector renders
  // as one line with `sources: frontmatter, slash` instead of two
  // duplicated rows. The total row count is preserved in the header
  // so authors notice when N detectors emit the same link. `--json`
  // output stays raw for machines (no behavioural change).
  const aggregatedOut = aggregateLinks(linksOut, 'target');
  out.push('', `Links out (${linksOut.length}, ${aggregatedOut.length} unique):`);
  if (aggregatedOut.length === 0) {
    out.push('  (none)');
  } else {
    for (const grp of aggregatedOut) {
      out.push(formatGroupedLink('→', grp));
    }
  }

  const aggregatedIn = aggregateLinks(linksIn, 'source');
  out.push('', `Links in (${linksIn.length}, ${aggregatedIn.length} unique):`);
  if (aggregatedIn.length === 0) {
    out.push('  (none)');
  } else {
    for (const grp of aggregatedIn) {
      out.push(formatGroupedLink('←', grp));
    }
  }

  out.push('', `Issues (${issues.length}):`);
  if (issues.length === 0) {
    out.push('  (none)');
  } else {
    for (const issue of issues) {
      out.push(`  - [${issue.severity}] ${issue.ruleId}: ${issue.message}`);
    }
  }

  // findings + summary intentionally omitted from human output until the
  // Step 10 / 11 features land — keeping the section header would suggest
  // an empty result rather than an unimplemented feature.

  return out.join('\n') + '\n';
}

function indent(s: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return s
    .split('\n')
    .map((line) => (line.length > 0 ? pad + line : line))
    .join('\n');
}

interface IGroupedLink {
  /** The "other end" path: target for outgoing groups, source for incoming. */
  endpoint: string;
  kind: Link['kind'];
  /** Highest confidence across the group (rank: high > medium > low). */
  confidence: Link['confidence'];
  /** Union of all detector ids that emitted any row in the group, sorted. */
  sources: string[];
  /** Original row count — informational, mirrors what `linksOut.length` showed before grouping. */
  rowCount: number;
  /** Trigger normalized form, when every row in the group agrees on it. `null` when the trigger is absent or differs. */
  normalizedTrigger: string | null;
}

/**
 * Group a flat link array by `(endpoint, kind, normalizedTrigger or null)`.
 * Used by the human renderer to collapse rows emitted by multiple
 * detectors for the same conceptual link into a single line. Storage
 * keeps the raw rows; `--json` emits them unchanged.
 *
 * `endpointSide` picks which end of the link is the "other" node:
 * `'target'` for outgoing links, `'source'` for incoming.
 */
function aggregateLinks(links: Link[], endpointSide: 'target' | 'source'): IGroupedLink[] {
  const groups = new Map<string, IGroupedLink>();
  for (const link of links) {
    const endpoint = endpointSide === 'target' ? link.target : link.source;
    const trigger = link.trigger?.normalizedTrigger ?? null;
    // NUL separator — collision-free against any path (POSIX paths
    // cannot contain NUL) or trigger string. The null-trigger case
    // gets its own bucket key via the empty trailing component.
    const key = `${endpoint}\x00${link.kind}\x00${trigger ?? ''}`;
    const existing = groups.get(key);
    if (existing) {
      for (const src of link.sources) {
        if (!existing.sources.includes(src)) existing.sources.push(src);
      }
      if (rankConfidenceForGrouping(link.confidence) > rankConfidenceForGrouping(existing.confidence)) {
        existing.confidence = link.confidence;
      }
      existing.rowCount += 1;
    } else {
      groups.set(key, {
        endpoint,
        kind: link.kind,
        confidence: link.confidence,
        sources: [...link.sources],
        rowCount: 1,
        normalizedTrigger: trigger,
      });
    }
  }
  // Deterministic order: by endpoint, then kind. Sources inside each
  // group are sorted at the moment we render so additions during
  // grouping don't pay a sort per insert.
  for (const grp of groups.values()) grp.sources.sort();
  return [...groups.values()].sort((a, b) => {
    if (a.endpoint !== b.endpoint) return a.endpoint.localeCompare(b.endpoint);
    return a.kind.localeCompare(b.kind);
  });
}

function formatGroupedLink(arrow: '→' | '←', grp: IGroupedLink): string {
  const head = `  - [${grp.kind}/${grp.confidence}] ${arrow} ${grp.endpoint}`;
  const sources = grp.sources.length > 0 ? `  sources: ${grp.sources.join(', ')}` : '';
  const dup = grp.rowCount > 1 ? ` (×${grp.rowCount})` : '';
  return `${head}${dup}${sources}`;
}

function rankConfidenceForGrouping(c: Link['confidence']): number {
  switch (c) {
    case 'high':
      return 2;
    case 'medium':
      return 1;
    case 'low':
      return 0;
  }
}
