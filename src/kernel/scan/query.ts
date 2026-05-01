/**
 * Export query — minimal filter language for `sm export <query>` (Step 8.3).
 *
 * Spec contract: `spec/cli-contract.md` line 190 says "Query syntax is
 * implementation-defined pre-1.0". This module defines the v0.5.0 syntax.
 *
 * **Grammar** (BNF-ish, intentionally tiny):
 *
 *   query     := token (WS+ token)*
 *   token     := key "=" value-list
 *   key       := "kind" | "has" | "path"
 *   value-list := value ("," value)*
 *   value     := non-comma, non-whitespace string
 *
 * Tokens AND together; values within one token OR. An empty / whitespace-only
 * query is valid and matches every node ("export everything").
 *
 * **Filters**:
 *
 *   - `kind=skill` / `kind=skill,agent` — node kind whitelist.
 *   - `has=issues` — node must appear in some issue's `nodeIds`. (Future
 *     expansion: `has=findings` / `has=summary` once Step 10 / 11 land.
 *     Unknown values are a parse error today; we'll ratchet up the
 *     accepted set additively.)
 *   - `path=foo/*` / `path=.claude/agents/**` — POSIX glob over `node.path`.
 *     Supports `*` (any chars except `/`) and `**` (any chars including `/`).
 *
 * **Subset semantics** (`applyExportQuery`):
 *
 *   - Nodes pass when every specified filter matches (AND across keys,
 *     OR within values).
 *   - Links survive only when BOTH endpoints (`source` + `target`) belong
 *     to the filtered node set. A subset that includes "edges out to
 *     unfiltered nodes" would be confusing — the user asked for a focused
 *     subgraph, not its boundary. External-URL pseudo-links are already
 *     stripped by the orchestrator and never reach this layer.
 *   - Issues survive when ANY of the issue's `nodeIds` is in the filtered
 *     set. Issues span multiple nodes (e.g. `trigger-collision` over two
 *     advertisers); dropping an issue when one of its nodes is outside
 *     would hide cross-cutting problems the user is investigating.
 *
 * Pure: no IO, no DB, no FS.
 */

import type { Issue, Link, Node } from '../types.js';
import { QUERY_TEXTS } from '../i18n/storage.texts.js';
import { tx } from '../util/tx.js';

const HAS_VALUES = new Set(['issues']);

export interface IExportQuery {
  /** Original query string echoed back so consumers can render the header. */
  raw: string;
  /**
   * Whitelist of node kinds (`node.kind` is open string — built-in
   * Claude catalog `skill` / `agent` / `command` / `hook` / `note`,
   * plus whatever external Providers declare). The query parser does
   * not validate values against a closed enum; an unknown kind simply
   * yields zero matches at filter time.
   */
  kinds?: string[];
  hasIssues?: boolean;
  pathGlobs?: string[];
}

export interface IExportSubset {
  query: IExportQuery;
  nodes: Node[];
  links: Link[];
  issues: Issue[];
}

export class ExportQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportQueryError';
  }
}

// Token-by-token parser with switch over keys + per-key validators.
// Branching is intrinsic to the multi-key query grammar.
// eslint-disable-next-line complexity
export function parseExportQuery(raw: string): IExportQuery {
  const trimmed = raw.trim();
  const out: IExportQuery = { raw: trimmed };
  if (trimmed.length === 0) return out;

  // Tokens are whitespace-separated key=value pairs. Values within one
  // token are comma-separated (multi-value OR). Keys repeated across
  // tokens are an error — the user should comma-separate within one
  // token instead, which is the documented form.
  const seen = new Set<string>();
  for (const token of trimmed.split(/\s+/)) {
    const eq = token.indexOf('=');
    if (eq <= 0 || eq === token.length - 1) {
      throw new ExportQueryError(
        tx(QUERY_TEXTS.exportQueryInvalidToken, { token }),
      );
    }
    const key = token.slice(0, eq).toLowerCase();
    const valuePart = token.slice(eq + 1);
    if (seen.has(key)) {
      throw new ExportQueryError(
        tx(QUERY_TEXTS.exportQueryDuplicateKey, { key }),
      );
    }
    seen.add(key);

    const values = valuePart.split(',').map((v) => v.trim()).filter((v) => v.length > 0);
    if (values.length === 0) {
      throw new ExportQueryError(tx(QUERY_TEXTS.exportQueryEmptyValues, { key }));
    }

    switch (key) {
      case 'kind':
        out.kinds = parseKindValues(values);
        break;
      case 'has':
        if (parseHasValues(values)) out.hasIssues = true;
        break;
      case 'path':
        out.pathGlobs = values;
        break;
      default:
        throw new ExportQueryError(
          tx(QUERY_TEXTS.exportQueryUnknownKey, { key }),
        );
    }
  }

  return out;
}

/**
 * Validate every token of a `kind=...` clause. Per
 * `node.schema.json#/properties/kind`, kinds are an open string — any
 * non-empty value is structurally valid. We still reject empty tokens
 * (a typo like `kind=,skill` shouldn't silently match every node).
 * Unknown-but-non-empty kinds simply yield zero matches at filter time.
 */
function parseKindValues(values: string[]): string[] {
  for (const v of values) {
    if (v.length === 0) {
      throw new ExportQueryError(QUERY_TEXTS.exportQueryEmptyKind);
    }
  }
  return values;
}

/** Validate every token of a `has=...` clause; returns true iff `issues` is present. */
function parseHasValues(values: string[]): boolean {
  for (const v of values) {
    if (!HAS_VALUES.has(v)) {
      throw new ExportQueryError(
        tx(QUERY_TEXTS.exportQueryUnsupportedHas, {
          value: v,
          allowed: [...HAS_VALUES].join(', '),
        }),
      );
    }
  }
  return values.includes('issues');
}

export function applyExportQuery(
  scan: { nodes: Node[]; links: Link[]; issues: Issue[] },
  query: IExportQuery,
): IExportSubset {
  const nodesWithIssues = query.hasIssues
    ? collectNodesWithIssues(scan.issues)
    : null;
  const compiledGlobs = query.pathGlobs
    ? query.pathGlobs.map(compileGlob)
    : null;

  const filteredNodes = scan.nodes.filter((node) => {
    if (query.kinds && !query.kinds.includes(node.kind)) return false;
    if (nodesWithIssues && !nodesWithIssues.has(node.path)) return false;
    if (compiledGlobs && !compiledGlobs.some((re) => re.test(node.path))) return false;
    return true;
  });

  const survivingPaths = new Set(filteredNodes.map((n) => n.path));

  // Links: both endpoints must survive. See module-level commentary on
  // why we close the subgraph instead of carrying boundary edges.
  const filteredLinks = scan.links.filter(
    (link) => survivingPaths.has(link.source) && survivingPaths.has(link.target),
  );

  // Issues: any node in the issue's nodeIds being in scope keeps the
  // issue. See module-level commentary on why we don't require all.
  const filteredIssues = scan.issues.filter((issue) =>
    issue.nodeIds.some((id) => survivingPaths.has(id)),
  );

  return {
    query,
    nodes: filteredNodes,
    links: filteredLinks,
    issues: filteredIssues,
  };
}

function collectNodesWithIssues(issues: Issue[]): Set<string> {
  const out = new Set<string>();
  for (const issue of issues) {
    for (const nodeId of issue.nodeIds) out.add(nodeId);
  }
  return out;
}

/**
 * Compile a minimal POSIX glob into a RegExp. Supports:
 *
 *   - `*`  — any sequence of chars except `/` (single segment wildcard).
 *   - `**` — any sequence of chars including `/` (cross-segment wildcard).
 *   - everything else is literal (regex metacharacters escaped).
 *
 * No `?`, no `[abc]`, no brace expansion. The grammar is explicitly
 * minimal so the spec doesn't bind us to a specific glob library before
 * v1.0; we can grow this when consumers ask for it.
 */
function compileGlob(pattern: string): RegExp {
  // First escape every regex metachar EXCEPT `*` (which we'll process
  // in a second pass). A negated character class is the cleanest way
  // to enumerate "everything that needs escaping in a path glob".
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  // `**` first so the `*` pass below doesn't double-process it. Use a
  // sentinel that can't appear in user input post-escape.
  const withDouble = escaped.replace(/\*\*/g, ' DOUBLESTAR ');
  const withSingle = withDouble.replace(/\*/g, '[^/]*');
  // Null-byte sentinel is intentional — guarantees the marker can't
  // collide with anything in user-supplied glob patterns post-escape.
  // eslint-disable-next-line no-control-regex
  const final = withSingle.replace(/ DOUBLESTAR /g, '.*');
  return new RegExp(`^${final}$`);
}
