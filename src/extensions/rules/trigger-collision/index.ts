/**
 * `trigger-collision` rule. Keys on `link.trigger.normalizedTrigger` and
 * emits an `error` issue per group of 2+ links that share a normalized
 * trigger but resolve to different targets.
 *
 * Canonical example: two nodes advertising the same `/deploy` command
 * from different plugins. The user needs to rename one; the rule can't
 * pick which is "right".
 */

import type { IRule, IRuleContext } from '../../../kernel/extensions/index.js';
import type { Issue, Link } from '../../../kernel/types.js';

const ID = 'trigger-collision';

export const triggerCollisionRule: IRule = {
  id: ID,
  kind: 'rule',
  version: '1.0.0',
  description: 'Flags invocation triggers (/command, @agent) claimed by multiple distinct targets.',
  stability: 'stable',

  evaluate(ctx: IRuleContext): Issue[] {
    // Bucket links by normalized trigger, skipping links without one.
    const byTrigger = new Map<string, Link[]>();
    for (const link of ctx.links) {
      const normalized = link.trigger?.normalizedTrigger;
      if (!normalized) continue;
      const bucket = byTrigger.get(normalized) ?? [];
      bucket.push(link);
      byTrigger.set(normalized, bucket);
    }

    const issues: Issue[] = [];
    for (const [normalized, links] of byTrigger) {
      // A single link is fine; two links with the same target (e.g. same
      // node mentioned from two different sources) is also fine.
      const distinctTargets = new Set(links.map((l) => l.target));
      if (distinctTargets.size < 2) continue;

      const targets = [...distinctTargets].sort();
      issues.push({
        ruleId: ID,
        severity: 'error',
        nodeIds: [...new Set(links.map((l) => l.source))].sort(),
        message: `Trigger "${normalized}" is claimed by ${distinctTargets.size} distinct targets: ${targets.join(', ')}`,
        data: { normalizedTrigger: normalized, targets },
      });
    }
    return issues;
  },
};
