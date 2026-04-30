/**
 * At-directive extractor. Scans the node body for `@<agent>` tokens and
 * emits one `mentions` link per distinct handle. Deduplicates by
 * normalized trigger.
 *
 * Matching rules are a close mirror of the slash extractor's:
 *
 * - Token must start with a standalone `@` (SOL or non-word prefix) so
 *   emails (`foo@bar.com`) and `@@` don't match.
 * - Handle is one or more of `[a-z0-9_-]`, optionally followed by a
 *   namespace segment `/<id>` or `:<id>` — matches both GitHub-style
 *   (`@my-plugin/foo-extractor`) and Claude-style (`@skill-map:explore`)
 *   handles.
 */

import type { IExtractor, IExtractorContext } from '../../../kernel/extensions/index.js';
import { normalizeTrigger } from '../../../kernel/trigger-normalize.js';

const ID = 'at-directive';

const AT_RE = /(?:^|[^A-Za-z0-9_@])(@[a-z0-9][a-z0-9_-]*(?:[/:][a-z0-9][a-z0-9_-]*)?)/gi;

export const atDirectiveExtractor: IExtractor = {
  id: ID,
  pluginId: 'claude',
  kind: 'extractor',
  version: '1.0.0',
  description: 'Detects @agent-name mentions in the node body.',
  stability: 'stable',
  mode: 'deterministic',
  emitsLinkKinds: ['mentions'],
  defaultConfidence: 'medium',
  scope: 'body',

  extract(ctx: IExtractorContext): void {
    const seen = new Set<string>();

    for (const match of ctx.body.matchAll(AT_RE)) {
      const original = match[1]!;
      const normalized = normalizeTrigger(original);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      ctx.emitLink({
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
  },
};
