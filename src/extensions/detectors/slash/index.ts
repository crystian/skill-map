/**
 * Slash detector. Scans the node body for `/<command>` tokens and emits
 * one `invokes` link per distinct invocation. Deduplicates by trigger so
 * a body mentioning `/deploy` three times produces a single link.
 *
 * Matching rules:
 *
 * - Token must start with a standalone `/` (start-of-line or
 *   non-word char before) so file paths like `src/cli` don't match.
 * - Command identifier is one or more of `[a-z0-9_-]`, optionally
 *   followed by a namespace separator `:` + another identifier
 *   (matches Claude Code plugin namespace convention, e.g.
 *   `/skill-map:explore`).
 * - Case-insensitive match; the original text is preserved verbatim
 *   in `originalTrigger`.
 *
 * Target resolution is left to the rules layer: the detector emits
 * `target: <command>` as a bare name, and `broken-ref` marks it invalid
 * if no node in the scan advertises that trigger.
 */

import type { IDetector, IDetectContext } from '../../../kernel/extensions/index.js';
import type { Link } from '../../../kernel/types.js';
import { normalizeTrigger } from '../../../kernel/trigger-normalize.js';

const ID = 'slash';

// Allow `/` at start of body, after whitespace, or after any non-word char
// other than `/` itself (so `//` doesn't match, and filenames like `foo/bar`
// don't trigger on `/bar`).
const SLASH_RE = /(?:^|[^A-Za-z0-9_/])(\/[a-z0-9][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)?)/gi;

export const slashDetector: IDetector = {
  id: ID,
  kind: 'detector',
  version: '1.0.0',
  description: 'Detects /command invocation tokens in the node body.',
  stability: 'stable',
  mode: 'deterministic',
  emitsLinkKinds: ['invokes'],
  defaultConfidence: 'medium',
  scope: 'body',

  detect(ctx: IDetectContext): Link[] {
    const seen = new Set<string>();
    const out: Link[] = [];

    for (const match of ctx.body.matchAll(SLASH_RE)) {
      const original = match[1]!;
      const normalized = normalizeTrigger(original);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push({
        source: ctx.node.path,
        target: original,
        kind: 'invokes',
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
