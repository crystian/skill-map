/**
 * `superseded` rule. Emits an `info` issue for every node whose
 * frontmatter carries `metadata.supersededBy` — the author has declared
 * the node obsolete, so the rule just surfaces that declaration as a
 * graph-level finding.
 *
 * Does not inspect `metadata.stability: deprecated` on its own; a
 * deprecated node without a supersededBy is a different conversation
 * (the user wants to know *what replaces it*). That surface can land as
 * a separate rule once the use case materialises.
 */

import type { IRule, IRuleContext } from '../../../kernel/extensions/index.js';
import type { Issue } from '../../../kernel/types.js';

const ID = 'superseded';

export const supersededRule: IRule = {
  id: ID,
  kind: 'rule',
  version: '1.0.0',
  description: 'Surfaces nodes that declare a supersededBy replacement in their frontmatter.',
  stability: 'stable',
  mode: 'deterministic',

  evaluate(ctx: IRuleContext): Issue[] {
    const issues: Issue[] = [];
    for (const node of ctx.nodes) {
      const meta = node.frontmatter?.['metadata'];
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue;
      const supersededBy = (meta as Record<string, unknown>)['supersededBy'];
      if (typeof supersededBy !== 'string' || supersededBy.length === 0) continue;

      issues.push({
        ruleId: ID,
        severity: 'info',
        nodeIds: [node.path],
        message: `${node.path} is superseded by ${supersededBy}`,
        data: { supersededBy },
      });
    }
    return issues;
  },
};
