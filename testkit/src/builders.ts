/**
 * Domain-object builders. Each one fills sensible defaults so plugin
 * authors only override the fields a given test cares about.
 *
 * The defaults are deliberately uninteresting (placeholder names, all
 * counts zero, deterministic stable hashes) so a builder used in
 * isolation produces a spec-conforming object that is easy to assert
 * over. Anything you don't pass is documented in the comment above
 * the field.
 */

import type {
  Confidence,
  Issue,
  Link,
  LinkKind,
  Node,
  NodeKind,
  ScanResult,
  ScanStats,
  Severity,
  TripleSplit,
} from '@skill-map/cli';

/** Stable placeholder hash — identical bytes for any two builders called without overrides. */
const PLACEHOLDER_HASH = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';

const ZERO_BYTES: TripleSplit = { frontmatter: 0, body: 0, total: 0 };

/**
 * Build a `Node` with sensible defaults. Override any field by passing
 * it in `overrides`. Required-by-spec fields all have placeholder
 * defaults so the result is always spec-valid even with `node()` alone.
 *
 * Default kind: `skill`. Default adapter id: `claude` (the only
 * built-in adapter today). Default counts: zero.
 */
export function node(overrides: Partial<Node> = {}): Node {
  const base: Node = {
    path: overrides.path ?? '.claude/skills/example.md',
    kind: overrides.kind ?? ('skill' as NodeKind),
    adapter: overrides.adapter ?? 'claude',
    bodyHash: overrides.bodyHash ?? PLACEHOLDER_HASH,
    frontmatterHash: overrides.frontmatterHash ?? PLACEHOLDER_HASH,
    bytes: overrides.bytes ?? ZERO_BYTES,
    linksOutCount: overrides.linksOutCount ?? 0,
    linksInCount: overrides.linksInCount ?? 0,
    externalRefsCount: overrides.externalRefsCount ?? 0,
  };
  // Optional fields are only attached when overridden so the produced
  // object stays minimal (and `JSON.stringify` doesn't emit ` "title": undefined`).
  if (overrides.title !== undefined) base.title = overrides.title;
  if (overrides.description !== undefined) base.description = overrides.description;
  if (overrides.stability !== undefined) base.stability = overrides.stability;
  if (overrides.version !== undefined) base.version = overrides.version;
  if (overrides.author !== undefined) base.author = overrides.author;
  if (overrides.frontmatter !== undefined) base.frontmatter = overrides.frontmatter;
  if (overrides.tokens !== undefined) base.tokens = overrides.tokens;
  return base;
}

/**
 * Build a `Link` with sensible defaults. The default detector id in
 * `sources` is `'testkit'`; override when you want to assert "this
 * detector emitted this link".
 */
export function link(overrides: Partial<Link> = {}): Link {
  const base: Link = {
    source: overrides.source ?? '.claude/skills/example.md',
    target: overrides.target ?? '.claude/agents/architect.md',
    kind: overrides.kind ?? ('references' as LinkKind),
    confidence: overrides.confidence ?? ('high' as Confidence),
    sources: overrides.sources ?? ['testkit'],
  };
  if (overrides.trigger !== undefined) base.trigger = overrides.trigger;
  if (overrides.location !== undefined) base.location = overrides.location;
  return base;
}

/**
 * Build an `Issue` with sensible defaults. Default rule id is `'testkit'`,
 * default severity is `'warn'`. Pass `nodeIds` to attach the issue to
 * specific nodes; defaults to an empty array (graph-level issue).
 */
export function issue(overrides: Partial<Issue> = {}): Issue {
  const base: Issue = {
    ruleId: overrides.ruleId ?? 'testkit',
    severity: overrides.severity ?? ('warn' as Severity),
    message: overrides.message ?? 'testkit issue',
    nodeIds: overrides.nodeIds ?? [],
  };
  if (overrides.fix !== undefined) base.fix = overrides.fix;
  return base;
}

/**
 * Build a `ScanResult` envelope with sensible defaults. Use this when
 * a helper expects a full scan dump (e.g. testing a renderer that
 * consumes nodes + links + issues, or asserting `runScan` semantics
 * end-to-end without spinning up the orchestrator).
 *
 * Stats are derived from the supplied collections so the envelope is
 * internally consistent without extra work from the caller.
 */
export function scanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  const nodes = overrides.nodes ?? [];
  const links = overrides.links ?? [];
  const issues = overrides.issues ?? [];
  const stats: ScanStats = overrides.stats ?? {
    nodesCount: nodes.length,
    linksCount: links.length,
    issuesCount: issues.length,
    durationMs: 0,
    filesWalked: nodes.length,
    filesSkipped: 0,
  };
  return {
    schemaVersion: overrides.schemaVersion ?? 1,
    scope: overrides.scope ?? 'project',
    roots: overrides.roots ?? ['.'],
    adapters: overrides.adapters ?? ['claude'],
    scannedAt: overrides.scannedAt ?? 0,
    scannedBy: overrides.scannedBy ?? {
      name: 'skill-map-testkit',
      version: '0.0.0',
      specVersion: '0.0.0',
    },
    stats,
    nodes,
    links,
    issues,
  };
}
