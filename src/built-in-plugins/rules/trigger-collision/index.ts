/**
 * `trigger-collision` rule. Flags ambiguous trigger ownership. Two
 * independent kinds of ambiguity contribute claims to the same trigger
 * bucket:
 *
 *   1. **Advertisement claims** — every node with `kind in {command,
 *      skill, agent}` and a `frontmatter.name` advertises the trigger
 *      `'/' + normalizeTrigger(name)`. The claim token is `node.path`
 *      (so two advertisers of `deploy` produce two distinct tokens).
 *      Canonical example: two commands both declaring `name: deploy`
 *      from different plugins compete for `/deploy`.
 *   2. **Invocation claims** — every detected link with a
 *      `trigger.normalizedTrigger` claims that trigger. The claim token
 *      is `link.target` (the raw trigger string), so five sources
 *      invoking `/deploy` collapse to a single token, while `/Deploy`
 *      and `/deploy` from two different sources stay distinct (the
 *      case-mismatch ambiguity).
 *
 * The rule fires (one `error` issue per trigger) under any of:
 *   - `≥ 2` distinct advertiser paths, OR
 *   - `≥ 2` distinct invocation targets, OR
 *   - exactly one advertiser plus at least one non-canonical invocation
 *     (raw target does not match the advertiser's literal canonical form
 *     `'/' + frontmatter.name`). `/Deploy` against advertiser `deploy`
 *     is non-canonical; `/foblex-flow` against `foblex-flow` is
 *     canonical (separator unification is a normalizer concern, not a
 *     user-facing ambiguity).
 *
 * The "one advertiser + canonical invocation" case (`name: deploy`
 * advertised, `/deploy` invoked) is the normal flow and stays silent.
 * Severity is `error` — the rule can't pick which claim is "right";
 * the user has to rename one or the other.
 */

import type { IRule, IRuleContext } from '../../../kernel/extensions/index.js';
import { normalizeTrigger } from '../../../kernel/trigger-normalize.js';
import type { Issue } from '../../../kernel/types.js';

const ID = 'trigger-collision';

// Kinds whose nodes "advertise" a trigger (slash command name, skill
// trigger, etc.). The set is keyed by string because `node.kind` is an
// open string — external Providers may declare additional advertising
// kinds in the future, and the rule applies if and only if the kind
// is in this set. Built-in Claude catalog covers the three values today.
const ADVERTISING_KINDS: ReadonlySet<string> = new Set<string>([
  'command',
  'skill',
  'agent',
]);

interface IInvocationClaim {
  kind: 'invocation';
  /** Raw `link.target` — the unnormalized trigger string the source emitted. */
  token: string;
  /** Path of the source node that issued the invocation. */
  nodeId: string;
}

interface IAdvertiserClaim {
  kind: 'advertiser';
  /** `node.path` — guarantees two advertisers of the same name produce distinct tokens. */
  token: string;
  nodeId: string;
  /**
   * Canonical literal form of the advertised trigger: `'/' + frontmatter.name`.
   * Used to decide whether an invocation in the same bucket is "canonical"
   * for this advertiser (literal match) vs "non-canonical" (e.g. `/Deploy`
   * vs advertiser `deploy`, which is a real case-mismatch ambiguity).
   * Note: this is the LITERAL form, not the normalized one — an
   * advertiser of `foblex-flow` is canonically `/foblex-flow`, even
   * though normalization yields `/foblex flow`.
   */
  canonicalForm: string;
}

type IClaim = IInvocationClaim | IAdvertiserClaim;

export const triggerCollisionRule: IRule = {
  id: ID,
  pluginId: 'core',
  kind: 'rule',
  mode: 'deterministic',
  version: '1.0.0',
  description:
    'Flags trigger names (/command, @agent) claimed by multiple distinct nodes — by advertisement (frontmatter.name) or by invocation.',
  stability: 'stable',

  // Two claim-collection passes (advertisement + invocation) feeding
  // the bucket map. Per-bucket analysis lives in `analyzeTriggerBucket`.
  // eslint-disable-next-line complexity
  evaluate(ctx: IRuleContext): Issue[] {
    // Bucket claims by normalized trigger.
    const buckets = new Map<string, IClaim[]>();
    const push = (key: string, claim: IClaim): void => {
      const bucket = buckets.get(key) ?? [];
      bucket.push(claim);
      buckets.set(key, bucket);
    };

    // 1. Advertisement claims. Only nodes whose kind can advertise a
    //    trigger contribute (a `note` happening to carry `frontmatter.name`
    //    isn't competing for a slash command). The advertised trigger is
    //    `/<normalized name>`.
    for (const node of ctx.nodes) {
      if (!ADVERTISING_KINDS.has(node.kind)) continue;
      const raw = node.frontmatter?.['name'];
      if (typeof raw !== 'string' || raw.length === 0) continue;
      const normalized = `/${normalizeTrigger(raw)}`;
      // Empty after normalization (e.g. `name: "  "`): ignore — it can't
      // be invoked anyway.
      if (normalized === '/') continue;
      push(normalized, {
        kind: 'advertiser',
        token: node.path,
        nodeId: node.path,
        canonicalForm: `/${raw}`,
      });
    }

    // 2. Invocation claims. Only links carrying a normalized trigger
    //    contribute. Using `link.target` as the token preserves the
    //    historical "same target = no collision" behaviour: five sources
    //    invoking `/deploy` collapse to a single token.
    for (const link of ctx.links) {
      const normalized = link.trigger?.normalizedTrigger;
      if (!normalized) continue;
      push(normalized, {
        kind: 'invocation',
        token: link.target,
        nodeId: link.source,
      });
    }

    const issues: Issue[] = [];
    for (const [normalized, claims] of buckets) {
      const issue = analyzeTriggerBucket(normalized, claims);
      if (issue) issues.push(issue);
    }
    return issues;
  },
};

/**
 * Analyze one bucket of trigger claims and decide whether to emit an
 * `error` issue. Three independent fire conditions:
 *
 *   1. ≥ 2 distinct advertisers (two nodes both `name: deploy`) — real
 *      ambiguity even without any invocations.
 *   2. ≥ 2 distinct invocation forms (`/Deploy` + `/deploy` from
 *      different sources) — historical case-mismatch ambiguity.
 *   3. Exactly 1 advertiser + ≥ 1 non-canonical invocation. An
 *      invocation is "canonical" if its raw target equals the
 *      advertiser's literal canonical form (`/<frontmatter.name>`).
 *      `/foblex-flow` against `foblex-flow` IS canonical (separator
 *      unification is a normalizer concern, not user-facing ambiguity).
 *
 * Otherwise (1 advertiser + only canonical invocations, or repeated
 * invocations of the same target) we stay silent: same logical claim.
 */
// eslint-disable-next-line complexity
function analyzeTriggerBucket(normalized: string, claims: IClaim[]): Issue | null {
  const advertiserPaths = [
    ...new Set(claims.filter((c) => c.kind === 'advertiser').map((c) => c.token)),
  ].sort();
  const invocationTargets = [
    ...new Set(claims.filter((c) => c.kind === 'invocation').map((c) => c.token)),
  ].sort();
  const advertisers = claims.filter(
    (c): c is IAdvertiserClaim => c.kind === 'advertiser',
  );

  const advertiserAmbiguous = advertiserPaths.length >= 2;
  const invocationAmbiguous = invocationTargets.length >= 2;
  const canonicalForms = new Set(advertisers.map((a) => a.canonicalForm));
  const nonCanonicalInvocations = invocationTargets.filter((t) => !canonicalForms.has(t));
  const crossKindAmbiguous =
    advertiserPaths.length === 1 && nonCanonicalInvocations.length >= 1;

  if (!advertiserAmbiguous && !invocationAmbiguous && !crossKindAmbiguous) {
    return null;
  }

  const nodeIds = [...new Set(claims.map((c) => c.nodeId))].sort();
  const parts: string[] = [];
  if (advertiserAmbiguous) {
    parts.push(
      `${advertiserPaths.length} nodes advertise it: ${advertiserPaths.join(', ')}`,
    );
  }
  if (invocationAmbiguous) {
    parts.push(
      `${invocationTargets.length} distinct invocation forms: ${invocationTargets.join(', ')}`,
    );
  } else if (crossKindAmbiguous) {
    parts.push(
      `non-canonical invocation${nonCanonicalInvocations.length > 1 ? 's' : ''} ` +
        `${nonCanonicalInvocations.join(', ')} against advertiser ${advertiserPaths[0]}`,
    );
  }

  return {
    ruleId: ID,
    severity: 'error',
    nodeIds,
    message: `Trigger "${normalized}" has ${parts.join('; and ')}.`,
    data: {
      normalizedTrigger: normalized,
      invocationTargets,
      advertiserPaths,
    },
  };
}
