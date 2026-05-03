/**
 * Slash extractor. Scans the node body for `/<command>` tokens and emits
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
 * Target resolution is left to the rules layer: the extractor emits
 * `target: <command>` as a bare name, and `broken-ref` marks it invalid
 * if no node in the scan advertises that trigger.
 */

import type { IExtractor, IExtractorContext } from '../../../kernel/extensions/index.js';
import { normalizeTrigger } from '../../../kernel/trigger-normalize.js';

const ID = 'slash';

// Match `/command` only when the preceding character is NOT one that
// would make the `/` part of a URL, file path, or markdown relative
// link. Negative lookbehind enumerates the disallowed predecessors:
//
//   - `A-Za-z0-9_` — mid-word (`foo/bar` shouldn't match `/bar`).
//   - `/`           — `//` shouldn't match.
//   - `.`           — `./foo`, `../foo`, `domain.com/path`. This is
//                     the "markdown relative link" footgun: `[link](./
//                     file.md)` was extracting `/file` and producing a
//                     broken-ref link to a non-existent command.
//   - `:`           — `https://foo`, `c:/Win`. URL schemes / drive letters.
//   - `?` `#`       — query strings and fragments inside URLs.
//
// JS supports fixed-width negative lookbehind in V8 since 2018 — safe
// in all our targets (Node 24 / current evergreen browsers).
const SLASH_RE = /(?<![A-Za-z0-9_/.:?#])(\/[a-z0-9][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)?)/gi;

export const slashExtractor: IExtractor = {
  id: ID,
  pluginId: 'claude',
  kind: 'extractor',
  version: '1.0.0',
  description: 'Detects /command invocation tokens in the node body.',
  stability: 'stable',
  mode: 'deterministic',
  emitsLinkKinds: ['invokes'],
  defaultConfidence: 'medium',
  scope: 'body',

  extract(ctx: IExtractorContext): void {
    const seen = new Set<string>();

    for (const match of ctx.body.matchAll(SLASH_RE)) {
      const original = match[1]!;
      const normalized = normalizeTrigger(original);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      ctx.emitLink({
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
  },
};
