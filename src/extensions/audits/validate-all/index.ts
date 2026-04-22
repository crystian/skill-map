/**
 * `validate-all` audit. Post-scan consistency check. Runs the current
 * ScanResult back through AJV against the authoritative schemas:
 *
 *   - Every Node's parsed frontmatter against `frontmatter/<kind>.schema.json`.
 *   - Every Link against `link.schema.json` (except the id/location
 *     numeric fields that only exist on the DB row).
 *   - Every Issue against `issue.schema.json`.
 *
 * Failures become findings on the returned audit report. `status: 'pass'`
 * only when every item validates; otherwise `'fail'`. Exit handling is
 * the CLI's concern (`sm audit run` returns exit 1 on fail, per
 * cli-contract.md §Audits).
 *
 * Manifest validation for registered extensions is already enforced at
 * load time by the PluginLoader — there's no need to redo it here. This
 * audit focuses on user content that the scan produced.
 */

import type { IAudit, IAuditContext, TAuditReport } from '../../../kernel/extensions/index.js';
import type { Issue, Link, Node, NodeKind } from '../../../kernel/types.js';
import { loadSchemaValidators, type ISchemaValidators, type TSchemaName } from '../../../kernel/adapters/schema-validators.js';

const ID = 'validate-all';

const FRONTMATTER_BY_KIND: Record<NodeKind, TSchemaName | null> = {
  // Frontmatter schemas ship under frontmatter/<kind>.schema.json but
  // they are not top-level (they're referenced from node.schema.json).
  // The schema-validators loader pre-registers them as supporting
  // schemas, so AJV resolves $refs — but the loader doesn't expose them
  // as stand-alone named validators. We validate against `node` for the
  // body of the node record; the per-kind frontmatter schema is reached
  // transitively. Keeping this map in place so the wire for per-kind
  // strictness lands cleanly when the loader surfaces frontmatter keys.
  skill: null,
  agent: null,
  command: null,
  hook: null,
  note: null,
};

export const validateAllAudit: IAudit = {
  id: ID,
  kind: 'audit',
  version: '1.0.0',
  description: 'Validates every scanned node / link / issue against the authoritative @skill-map/spec schemas.',
  stability: 'stable',

  run(ctx: IAuditContext): TAuditReport {
    const validators = loadSchemaValidators();
    const findings: Issue[] = [];

    for (const node of ctx.nodes) {
      collectNodeFindings(validators, node, findings);
    }
    for (const link of ctx.links) {
      collectLinkFindings(validators, link, findings);
    }
    for (const issue of ctx.issues) {
      collectIssueFindings(validators, issue, findings);
    }

    return {
      auditId: ID,
      status: findings.length === 0 ? 'pass' : 'fail',
      findings,
      summary: findings.length === 0
        ? `Validated ${ctx.nodes.length} nodes / ${ctx.links.length} links / ${ctx.issues.length} issues — all ok.`
        : `Found ${findings.length} validation issue(s).`,
    };
  },
};

function collectNodeFindings(v: ISchemaValidators, node: Node, out: Issue[]): void {
  const result = v.validate('node', toNodeForSchema(node));
  if (result.ok) return;
  out.push({
    ruleId: ID,
    severity: 'error',
    nodeIds: [node.path],
    message: `Node ${node.path} failed schema validation: ${result.errors}`,
    data: { target: 'node', path: node.path },
  });
  // Suppress-unused warning. The per-kind routing lands when the
  // validators expose frontmatter schemas as top-level names.
  void FRONTMATTER_BY_KIND;
}

function collectLinkFindings(v: ISchemaValidators, link: Link, out: Issue[]): void {
  const result = v.validate('link', toLinkForSchema(link));
  if (result.ok) return;
  out.push({
    ruleId: ID,
    severity: 'error',
    nodeIds: [link.source],
    message: `Link ${link.source} → ${link.target} failed schema validation: ${result.errors}`,
    data: { target: 'link', source: link.source, to: link.target },
  });
}

function collectIssueFindings(v: ISchemaValidators, issue: Issue, out: Issue[]): void {
  const result = v.validate('issue', toIssueForSchema(issue));
  if (result.ok) return;
  out.push({
    ruleId: ID,
    severity: 'error',
    nodeIds: issue.nodeIds,
    message: `Issue ${issue.ruleId} failed schema validation: ${result.errors}`,
    data: { target: 'issue', ruleId: issue.ruleId },
  });
}

// The runtime TypeScript types carry a convenience shape (e.g. bytes as
// a triple-split object); the spec schemas use slightly different field
// layouts. These adapters bridge the two without leaking the DB-internal
// fields (id, `data_json`, etc.).
function toNodeForSchema(node: Node): unknown {
  return {
    path: node.path,
    kind: node.kind,
    adapter: node.adapter,
    title: node.title ?? undefined,
    description: node.description ?? undefined,
    stability: node.stability ?? undefined,
    version: node.version ?? undefined,
    author: node.author ?? undefined,
    bodyHash: node.bodyHash,
    frontmatterHash: node.frontmatterHash,
    bytes: node.bytes,
    tokens: node.tokens ?? undefined,
    linksOutCount: node.linksOutCount,
    linksInCount: node.linksInCount,
    externalRefsCount: node.externalRefsCount,
    frontmatter: node.frontmatter ?? {},
  };
}

function toLinkForSchema(link: Link): unknown {
  return {
    source: link.source,
    target: link.target,
    kind: link.kind,
    confidence: link.confidence,
    sources: link.sources,
    trigger: link.trigger ?? undefined,
    location: link.location ?? undefined,
    raw: link.raw ?? undefined,
  };
}

function toIssueForSchema(issue: Issue): unknown {
  return {
    ruleId: issue.ruleId,
    severity: issue.severity,
    nodeIds: issue.nodeIds,
    linkIndices: issue.linkIndices,
    message: issue.message,
    detail: issue.detail ?? undefined,
    fix: issue.fix ?? undefined,
    data: issue.data ?? undefined,
  };
}
