/**
 * `validate-all` rule. Cross-graph consistency check that runs alongside
 * the other deterministic rules. Validates the in-flight scan output back
 * through AJV against the authoritative schemas:
 *
 *   - Every Node's record against `node.schema.json`. The per-kind
 *     `frontmatter/<kind>.schema.json` is reached transitively via the
 *     node schema's `$ref`s.
 *   - Every Link against `link.schema.json` (except the id/location
 *     numeric fields that only exist on the DB row).
 *
 * Failures become `Issue[]` like every other rule. The CLI / report
 * formatter wrapping is no longer this extension's concern; consumers
 * surface `validate-all`-emitted issues the same way they surface
 * `broken-ref` / `trigger-collision` / etc.
 *
 * Manifest validation for registered extensions is already enforced at
 * load time by the PluginLoader — there's no need to redo it here. This
 * rule focuses on user content that the scan produced. Cross-rule issue
 * validation (revalidating other rules' `Issue[]` output) is intentionally
 * NOT done here; rules see only the graph (`nodes` + `links`), and the
 * kernel's own `validateIssue()` already gates issues at emit time.
 */

import type { IRule, IRuleContext } from '../../../kernel/extensions/index.js';
import type { Issue, Link, Node } from '../../../kernel/types.js';
import { loadSchemaValidators, type ISchemaValidators } from '../../../kernel/adapters/schema-validators.js';
import { tx } from '../../../kernel/util/tx.js';
import { VALIDATE_ALL_TEXTS } from '../../i18n/validate-all.texts.js';

const ID = 'validate-all';

export const validateAllRule: IRule = {
  id: ID,
  pluginId: 'core',
  kind: 'rule',
  version: '1.0.0',
  description: 'Validates every scanned node / link against the authoritative @skill-map/spec schemas.',
  stability: 'stable',
  mode: 'deterministic',

  evaluate(ctx: IRuleContext): Issue[] {
    const validators = loadSchemaValidators();
    const findings: Issue[] = [];

    for (const node of ctx.nodes) {
      collectNodeFindings(validators, node, findings);
    }
    for (const link of ctx.links) {
      collectLinkFindings(validators, link, findings);
    }

    return findings;
  },
};

function collectNodeFindings(v: ISchemaValidators, node: Node, out: Issue[]): void {
  const result = v.validate('node', toNodeForSchema(node));
  if (result.ok) return;
  out.push({
    ruleId: ID,
    severity: 'error',
    nodeIds: [node.path],
    message: tx(VALIDATE_ALL_TEXTS.nodeFailure, {
      path: node.path,
      errors: result.errors,
    }),
    data: { target: 'node', path: node.path },
  });
}

function collectLinkFindings(v: ISchemaValidators, link: Link, out: Issue[]): void {
  const result = v.validate('link', toLinkForSchema(link));
  if (result.ok) return;
  out.push({
    ruleId: ID,
    severity: 'error',
    nodeIds: [link.source],
    message: tx(VALIDATE_ALL_TEXTS.linkFailure, {
      source: link.source,
      target: link.target,
      errors: result.errors,
    }),
    data: { target: 'link', source: link.source, to: link.target },
  });
}

// The runtime TypeScript types carry a convenience shape (e.g. bytes as
// a triple-split object); the spec schemas use slightly different field
// layouts. These shape transformers bridge the two without leaking the
// DB-internal fields (id, `data_json`, etc.).
function toNodeForSchema(node: Node): unknown {
  return {
    path: node.path,
    kind: node.kind,
    provider: node.provider,
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
