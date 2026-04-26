/**
 * External URL counter detector. Scans the node body for `http://` and
 * `https://` URLs and emits one "pseudo-link" per distinct normalized URL.
 *
 * The pseudo-links are the on-the-wire transport for a count: the
 * orchestrator partitions them out of `result.links` (any link whose
 * target starts with `http://` or `https://`), increments
 * `node.externalRefsCount` per source, then DROPS them. They are never
 * persisted to `scan_links` and never reach the rules layer.
 *
 * Design constraint: the spec's `link.kind` enum is locked to
 * `invokes / references / mentions / supersedes`. We reuse `references`
 * (closest semantic match — a URL IS a reference, just to something
 * outside the graph) at low confidence to avoid bumping the spec for a
 * counter that the orchestrator strips before serialising.
 *
 * URL normalization rules (cheap, deterministic):
 *   1. `new URL(raw)` — bad URLs are silently dropped.
 *   2. Lowercase the host (RFC 3986 case-insensitive).
 *   3. Drop the fragment (`#a` and `#b` count as the same external ref).
 *   4. Preserve scheme, port, path, query verbatim.
 *   5. Dedup key is the resulting `url.href`.
 *
 * Per-node dedup: the first occurrence of a normalized URL wins; later
 * duplicates within the same body are skipped.
 *
 * The trigger-normalize util in `kernel/trigger-normalize.ts` is for
 * human-typed slash / at-directive triggers, NOT URLs — it would mangle
 * paths and queries. We roll our own URL normalization here.
 */

import type { IDetector, IDetectContext } from '../../../kernel/extensions/index.js';
import type { Link } from '../../../kernel/types.js';

const ID = 'external-url-counter';

// Greedy match of http(s) URLs. Stops at whitespace and the markdown
// delimiters that commonly wrap URLs: `<`, `>`, `"`, `'`, backtick,
// `)`, `]`. The trailing-punctuation pass below trims sentence enders
// like `.`, `,`, `;`, `:`, `!`, `?` that the regex still picks up.
const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g;

const TRAILING_PUNCT = /[.,;:!?]+$/;

export const externalUrlCounterDetector: IDetector = {
  id: ID,
  kind: 'detector',
  version: '1.0.0',
  description:
    'Counts distinct external http(s) URLs in the node body. Emits pseudo-links the orchestrator strips after counting.',
  stability: 'stable',
  emitsLinkKinds: ['references'],
  defaultConfidence: 'low',
  scope: 'body',

  detect(ctx: IDetectContext): Link[] {
    const seen = new Set<string>();
    const out: Link[] = [];
    const lineStarts = computeLineStarts(ctx.body);

    for (const match of ctx.body.matchAll(URL_RE)) {
      const original = stripTrailingPunctuation(match[0]);
      if (original.length === 0) continue;

      const normalized = normalizeUrl(original);
      if (normalized === null) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      const offset = match.index ?? 0;
      const link: Link = {
        source: ctx.node.path,
        target: normalized,
        kind: 'references',
        confidence: 'low',
        sources: [ID],
        trigger: {
          originalTrigger: original,
          normalizedTrigger: normalized,
        },
        location: { line: lineFor(lineStarts, offset) },
      };
      out.push(link);
    }
    return out;
  },
};

function stripTrailingPunctuation(raw: string): string {
  return raw.replace(TRAILING_PUNCT, '');
}

function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    // URL already lowercases host on parse, but be explicit so future
    // refactors don't regress.
    url.hostname = url.hostname.toLowerCase();
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function computeLineStarts(body: string): number[] {
  const starts = [0];
  for (let i = 0; i < body.length; i += 1) {
    if (body.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
  }
  return starts;
}

function lineFor(lineStarts: number[], offset: number): number {
  // Binary search: find the largest start <= offset, return its 1-indexed line.
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lineStarts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
