/**
 * Markdown link extractor. Scans the node body for `[text](path)` tokens
 * and emits one `references` link per distinct file path that resolves
 * inside the scan scope. The natural sibling to the slash and
 * at-directive extractors: those cover authored Claude-style triggers
 * (`/foo`, `@bar`); this one covers plain markdown links — the
 * dominant cross-reference shape in real knowledge bases.
 *
 * What this catches and what it skips
 * -----------------------------------
 * Captured (relative file paths):
 *   - `[overview](./overview.md)`
 *   - `[parent readme](../README.md)`
 *   - `[bare](api.md)`            — no leading `./` is fine
 *   - `[anchor inside](./api.md#install)` — anchor stripped, link goes to api.md
 *
 * Skipped (the extractor emits no link):
 *   - `![alt](./img.png)` — image syntax. The `(?<!\!)` lookbehind drops it.
 *   - `[home](https://...)` / `mailto:` / `tel:` — has a URL scheme. URLs are
 *     counted by `external-url-counter`, not mapped to nodes.
 *   - `[#section](#section)` — same-doc anchor. No file to link to.
 *   - `[abs](/abs/path)` — leading `/` would be ambiguous (root of scope?
 *     filesystem root?) and almost never what an author means in a markdown
 *     body. Skipped to keep the contract simple; revisit if a use case appears.
 *
 * Path resolution
 * ---------------
 * Targets are resolved POSIX-style against the source node's directory:
 *   `dirname(node.path) + '/' + target` then `path.posix.normalize` to
 *   collapse `.` / `..`. The result is the candidate node path.
 *
 * The extractor emits the link unconditionally — whether or not the
 * resolved path matches an existing node. The `broken-ref` rule is the
 * one that decides whether to report it as an issue, exactly like
 * slash / at-directive do today. This keeps the extractor cheap and
 * testable in isolation.
 *
 * Confidence / kind
 * -----------------
 * `references` is the closest semantic match in the spec's link.kind
 * enum: a markdown link IS a reference, by definition. Confidence is
 * `high` — the syntax `[text](path)` is unambiguous authorial intent,
 * not a heuristic guess.
 *
 * Per-node dedup: the first occurrence of a normalized resolved target
 * wins; later duplicates within the same body are skipped. Matches the
 * other extractors' behaviour.
 */

import { posix as pathPosix } from 'node:path';

import type { IExtractor, IExtractorContext } from '../../../kernel/extensions/index.js';
import type { Link } from '../../../kernel/types.js';

const ID = 'markdown-link';

// `[text](url)` where:
//   - `(?<!\!)` — not preceded by `!` (skip image syntax `![alt](src)`).
//   - `\[([^\]]*)\]` — the visible text. Square brackets cannot nest in CommonMark.
//   - `\(([^)\s]+)(?:\s+"[^"]*")?\)` — the destination + optional title:
//       - `[^)\s]+`        — URL portion: anything that is not whitespace or `)`.
//       - `(?:\s+"[^"]*")?` — optional ` "title"` (CommonMark allows it; we
//         capture only the URL group, the title is decorative).
const LINK_RE = /(?<!!)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

// Schemes we treat as "not a file path" — the extractor skips these so
// `external-url-counter` can do its job for http(s) and so non-resolvable
// schemes (`mailto:`, `tel:`, `data:`, `ftp:` etc.) don't generate
// guaranteed-broken links. Matched case-insensitively.
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export const markdownLinkExtractor: IExtractor = {
  id: ID,
  pluginId: 'core',
  kind: 'extractor',
  version: '1.0.0',
  description:
    'Detects [text](path) markdown links and emits one references link per resolved file path.',
  stability: 'stable',
  mode: 'deterministic',
  emitsLinkKinds: ['references'],
  defaultConfidence: 'high',
  scope: 'body',

  extract(ctx: IExtractorContext): void {
    const seen = new Set<string>();
    const lineStarts = computeLineStarts(ctx.body);
    const sourceDir = pathPosix.dirname(ctx.node.path);

    for (const match of ctx.body.matchAll(LINK_RE)) {
      const original = match[2]!;
      const resolved = resolveTarget(sourceDir, original);
      if (resolved === null) continue;
      if (seen.has(resolved)) continue;
      seen.add(resolved);

      const offset = match.index ?? 0;
      const link: Link = {
        source: ctx.node.path,
        target: resolved,
        kind: 'references',
        confidence: 'high',
        sources: [ID],
        trigger: {
          originalTrigger: original,
          normalizedTrigger: resolved,
        },
        location: { line: lineFor(lineStarts, offset) },
      };
      ctx.emitLink(link);
    }
  },
};

/**
 * Strip `#anchor` and `?query`, reject URL schemes / absolute paths /
 * empty targets, then POSIX-normalise against `sourceDir`. Returns
 * `null` when the target should not produce a link.
 */
function resolveTarget(sourceDir: string, raw: string): string | null {
  // Strip fragment first (anchors live "after" the path) and then query.
  const noFragment = raw.split('#', 1)[0]!;
  const noQuery = noFragment.split('?', 1)[0]!;
  const trimmed = noQuery.trim();
  if (trimmed.length === 0) return null;

  // URL schemes (http, mailto, tel, data, ftp, ...) — skip. The
  // external-url-counter handles http/https; the others have no node
  // to link to.
  if (URL_SCHEME_RE.test(trimmed)) return null;

  // Leading `/` is ambiguous in a markdown body — skip per the doc
  // comment.
  if (trimmed.startsWith('/')) return null;

  const joined = sourceDir === '.' ? trimmed : `${sourceDir}/${trimmed}`;
  return pathPosix.normalize(joined);
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
