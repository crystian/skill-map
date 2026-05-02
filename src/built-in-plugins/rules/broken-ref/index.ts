/**
 * `broken-ref` rule. Emits a `warn` issue for every link whose target
 * cannot be resolved to a node in the current scan:
 *
 * - Path-style targets (frontmatter extractor's output): target must
 *   match some `node.path` verbatim.
 * - Trigger-style targets (slash / at-directive extractors): resolution
 *   matches against `node.frontmatter.name` with the same normalization
 *   the extractor applied. An extractor's `/foo` link resolves to a node
 *   whose `metadata.name` normalizes to `foo`.
 *
 * Rule is advisory — broken refs aren't errors; authors commonly
 * reference external or not-yet-scanned artifacts. Severity stays at
 * `warn`.
 */

import type { IRule, IRuleContext } from '../../../kernel/extensions/index.js';
import type { Issue, Link, Node } from '../../../kernel/types.js';
import { normalizeTrigger } from '../../../kernel/trigger-normalize.js';
import { tx } from '../../../kernel/util/tx.js';
import { BROKEN_REF_TEXTS } from '../../i18n/broken-ref.texts.js';

const ID = 'broken-ref';

export const brokenRefRule: IRule = {
  id: ID,
  pluginId: 'core',
  kind: 'rule',
  version: '1.0.0',
  description: 'Flags links whose target cannot be resolved to a scanned node.',
  stability: 'stable',
  mode: 'deterministic',

  evaluate(ctx: IRuleContext): Issue[] {
    const byPath = new Set(ctx.nodes.map((n) => n.path));
    const byNormalizedName = indexByNormalizedName(ctx.nodes);

    const issues: Issue[] = [];
    for (const link of ctx.links) {
      if (isResolved(link, byPath, byNormalizedName)) continue;
      issues.push({
        ruleId: ID,
        severity: 'warn',
        nodeIds: [link.source],
        message: tx(BROKEN_REF_TEXTS.message, {
          kind: link.kind,
          source: link.source,
          target: link.target,
        }),
        data: {
          target: link.target,
          kind: link.kind,
          trigger: link.trigger?.normalizedTrigger ?? null,
        },
      });
    }
    return issues;
  },
};

function indexByNormalizedName(nodes: Node[]): Map<string, Node[]> {
  const out = new Map<string, Node[]>();
  for (const node of nodes) {
    const raw = node.frontmatter?.['name'];
    const name = typeof raw === 'string' ? raw : '';
    if (!name) continue;
    const key = normalizeTrigger(name);
    const bucket = out.get(key) ?? [];
    bucket.push(node);
    out.set(key, bucket);
  }
  return out;
}

function isResolved(
  link: Link,
  byPath: Set<string>,
  byNormalizedName: Map<string, Node[]>,
): boolean {
  // Trigger-style: compare against normalized name index. An extractor may
  // have emitted `/deploy` or `@agent-name`; strip the leading sigil
  // before normalising for the name lookup.
  const normalized = link.trigger?.normalizedTrigger;
  if (normalized) {
    const withoutSigil = normalized.replace(/^[/@]/, '').trim();
    if (byNormalizedName.has(withoutSigil)) return true;
  }

  // Path-style (frontmatter-derived links) or fallback: verbatim path
  // must exist in the scan.
  if (byPath.has(link.target)) return true;

  return false;
}
