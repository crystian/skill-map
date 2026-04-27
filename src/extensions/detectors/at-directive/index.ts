/**
 * At-directive detector. Scans the node body for `@<agent>` tokens and
 * emits one `mentions` link per distinct handle. Deduplicates by
 * normalized trigger.
 *
 * Matching rules are a close mirror of the slash detector's:
 *
 * - Token must start with a standalone `@` (SOL or non-word prefix) so
 *   emails (`foo@bar.com`) and `@@` don't match.
 * - Handle is one or more of `[a-z0-9_-]`, optionally followed by a
 *   namespace segment `/<id>` or `:<id>` — matches both GitHub-style
 *   (`@my-plugin/foo-detector`) and Claude-style (`@skill-map:explore`)
 *   handles.
 */

import type { IDetector, IDetectContext } from '../../../kernel/extensions/index.js';
import type { Link } from '../../../kernel/types.js';
import { normalizeTrigger } from '../../../kernel/trigger-normalize.js';

const ID = 'at-directive';

const AT_RE = /(?:^|[^A-Za-z0-9_@])(@[a-z0-9][a-z0-9_-]*(?:[/:][a-z0-9][a-z0-9_-]*)?)/gi;

export const atDirectiveDetector: IDetector = {
  id: ID,
  kind: 'detector',
  version: '1.0.0',
  description: 'Detects @agent-name mentions in the node body.',
  stability: 'stable',
  mode: 'deterministic',
  emitsLinkKinds: ['mentions'],
  defaultConfidence: 'medium',
  scope: 'body',

  detect(ctx: IDetectContext): Link[] {
    const seen = new Set<string>();
    const out: Link[] = [];

    for (const match of ctx.body.matchAll(AT_RE)) {
      const original = match[1]!;
      const normalized = normalizeTrigger(original);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push({
        source: ctx.node.path,
        target: original,
        kind: 'mentions',
        confidence: 'medium',
        sources: [ID],
        trigger: {
          originalTrigger: original,
          normalizedTrigger: normalized,
        },
      });
    }
    return out;
  },
};
