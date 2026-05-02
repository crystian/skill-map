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

import type { Issue, Link, Node } from '../../kernel/types.js';
import { assertDbExists, resolveDbPath } from '../util/db-path.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { ExitCode } from '../util/exit-codes.js';
import { withSqlite } from '../util/with-sqlite.js';
import { tx } from '../../kernel/util/tx.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { SHOW_TEXTS } from '../i18n/show.texts.js';

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
    const dbPath = resolveDbPath({ global: this.global, db: this.db, ...defaultRuntimeContext() });
    if (!assertDbExists(dbPath, this.context.stderr)) return ExitCode.NotFound;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const bundle = await adapter.scans.findNode(this.nodePath);
      if (!bundle) {
        this.context.stderr.write(tx(SHOW_TEXTS.nodeNotFound, { nodePath: this.nodePath }));
        return ExitCode.NotFound;
      }

      const doc: IShowDocument = {
        node: bundle.node,
        linksOut: bundle.linksOut,
        linksIn: bundle.linksIn,
        issues: bundle.issues,
        findings: [],
        summary: null,
      };

      if (this.json) {
        this.context.stdout.write(JSON.stringify(doc) + '\n');
        return ExitCode.Ok;
      }

      this.context.stdout.write(renderHuman(doc));
      return ExitCode.Ok;
    });
  }
}

// --- human renderer -------------------------------------------------------

/**
 * Render one "Links out" / "Links in" section: aggregated count
 * header, `(none)` placeholder, or one line per grouped link with the
 * directional arrow. Used for both directions in `renderHuman`.
 */
function renderLinksSection(
  label: string,
  links: Link[],
  projectField: 'target' | 'source',
  arrow: '→' | '←',
): string[] {
  const aggregated = aggregateLinks(links, projectField);
  const lines: string[] = [
    '',
    tx(SHOW_TEXTS.sectionHeader, { label, count: links.length, unique: aggregated.length }),
  ];
  if (aggregated.length === 0) {
    lines.push(SHOW_TEXTS.placeholderNone);
  } else {
    for (const grp of aggregated) lines.push(formatGroupedLink(arrow, grp));
  }
  return lines;
}

function renderHuman(doc: IShowDocument): string {
  const { node, linksOut, linksIn, issues } = doc;
  const out: string[] = [];
  out.push(...renderNodeHeader(node));
  out.push('', SHOW_TEXTS.sectionFrontmatter);
  out.push(indent(JSON.stringify(node.frontmatter ?? {}, null, 2), 2));
  out.push(...renderLinksSection(SHOW_TEXTS.sectionLinksOut, linksOut, 'target', '→'));
  out.push(...renderLinksSection(SHOW_TEXTS.sectionLinksIn, linksIn, 'source', '←'));
  out.push(...renderIssuesSection(issues));
  // findings + summary intentionally omitted until the Step 10 / 11
  // features land — keeping an empty section header would mislead.
  return out.join('\n') + '\n';
}

/**
 * Header block: id line + each present optional field on its own row +
 * weight + token line + external refs counter. Optional fields are
 * gated individually so missing ones don't render as empty rows.
 */
function renderNodeHeader(node: Node): string[] {
  const lines: string[] = [];
  lines.push(
    tx(SHOW_TEXTS.nodeIdentity, {
      path: sanitizeForTerminal(node.path),
      kind: sanitizeForTerminal(node.kind),
      provider: sanitizeForTerminal(node.provider),
    }),
  );
  if (node.title) lines.push(tx(SHOW_TEXTS.nodeFieldTitle, { value: sanitizeForTerminal(node.title) }));
  if (node.description) lines.push(tx(SHOW_TEXTS.nodeFieldDescription, { value: sanitizeForTerminal(node.description) }));
  if (node.stability) lines.push(tx(SHOW_TEXTS.nodeFieldStability, { value: sanitizeForTerminal(node.stability) }));
  if (node.version) lines.push(tx(SHOW_TEXTS.nodeFieldVersion, { value: sanitizeForTerminal(node.version) }));
  if (node.author) lines.push(tx(SHOW_TEXTS.nodeFieldAuthor, { value: sanitizeForTerminal(node.author) }));
  const b = node.bytes;
  lines.push(tx(SHOW_TEXTS.nodeWeight, { total: b.total, frontmatter: b.frontmatter, body: b.body }));
  if (node.tokens) {
    const t = node.tokens;
    lines.push(tx(SHOW_TEXTS.nodeTokens, { total: t.total, frontmatter: t.frontmatter, body: t.body }));
  }
  // Render even when 0 — "External refs: 0" is information, not noise.
  lines.push(tx(SHOW_TEXTS.nodeExternalRefs, { count: node.externalRefsCount }));
  return lines;
}

/** Issues block: header line + `(none)` placeholder or one bullet per issue. */
function renderIssuesSection(issues: Issue[]): string[] {
  const lines: string[] = ['', tx(SHOW_TEXTS.issuesHeader, { count: issues.length })];
  if (issues.length === 0) {
    lines.push(SHOW_TEXTS.placeholderNone);
  } else {
    for (const issue of issues) {
      lines.push(
        tx(SHOW_TEXTS.issueRow, {
          severity: issue.severity,
          ruleId: sanitizeForTerminal(issue.ruleId),
          message: sanitizeForTerminal(issue.message),
        }),
      );
    }
  }
  return lines;
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
  /** Union of all extractor ids that emitted any row in the group, sorted. */
  sources: string[];
  /** Original row count — informational, mirrors what `linksOut.length` showed before grouping. */
  rowCount: number;
  /** Trigger normalized form, when every row in the group agrees on it. `null` when the trigger is absent or differs. */
  normalizedTrigger: string | null;
}

/**
 * Group a flat link array by `(endpoint, kind, normalizedTrigger or null)`.
 * Used by the human renderer to collapse rows emitted by multiple
 * extractors for the same conceptual link into a single line. Storage
 * keeps the raw rows; `--json` emits them unchanged.
 *
 * `endpointSide` picks which end of the link is the "other" node:
 * `'target'` for outgoing links, `'source'` for incoming.
 */
// eslint-disable-next-line complexity
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
  const dup = grp.rowCount > 1
    ? tx(SHOW_TEXTS.groupedLinkDup, { count: grp.rowCount })
    : '';
  const sources = grp.sources.length > 0
    ? tx(SHOW_TEXTS.groupedLinkSources, {
        values: grp.sources.map(sanitizeForTerminal).join(', '),
      })
    : '';
  return tx(SHOW_TEXTS.groupedLinkHead, {
    kind: sanitizeForTerminal(grp.kind),
    confidence: grp.confidence,
    arrow,
    endpoint: sanitizeForTerminal(grp.endpoint),
    dup,
    sources,
  });
}

const CONFIDENCE_RANK: Record<Link['confidence'], number> = {
  high: 2,
  medium: 1,
  low: 0,
};

function rankConfidenceForGrouping(c: Link['confidence']): number {
  return CONFIDENCE_RANK[c];
}
