/**
 * Frontmatter detector. Reads the parsed frontmatter block and emits one
 * link per structured reference:
 *
 *   metadata.supersedes[]    → supersedes links (this node → listed paths)
 *   metadata.supersededBy    → supersedes link (listed path → this node)
 *   metadata.requires[]      → references links
 *   metadata.related[]       → references links
 *
 * Frontmatter-scope detector — the orchestrator passes an empty body.
 * No trigger normalization on these links: the source is structured
 * path strings, not a user-typed invocation. `originalTrigger` and
 * `normalizedTrigger` stay null.
 */

import type { IDetector, IDetectContext } from '../../../kernel/extensions/index.js';
import type { Link } from '../../../kernel/types.js';

const ID = 'frontmatter';

export const frontmatterDetector: IDetector = {
  id: ID,
  pluginId: 'claude',
  kind: 'detector',
  version: '1.0.0',
  description: 'Reads structured references from the frontmatter (supersedes, supersededBy, requires, related).',
  stability: 'stable',
  mode: 'deterministic',
  emitsLinkKinds: ['supersedes', 'references'],
  defaultConfidence: 'high',
  scope: 'frontmatter',

  detect(ctx: IDetectContext): Link[] {
    const meta = pickMetadata(ctx.frontmatter);
    if (!meta) return [];

    const sourcePath = ctx.node.path;
    const out: Link[] = [];

    for (const target of stringArray(meta['supersedes'])) {
      out.push(link(sourcePath, target, 'supersedes'));
    }
    const supersededBy = meta['supersededBy'];
    if (typeof supersededBy === 'string' && supersededBy.length > 0) {
      // Inverse direction: the path listed in supersededBy is the new node,
      // and it supersedes `sourcePath`. Emit the edge FROM the new node
      // so consumers can ask "what did X supersede?" with a single query.
      out.push(link(supersededBy, sourcePath, 'supersedes'));
    }
    for (const target of stringArray(meta['requires'])) {
      out.push(link(sourcePath, target, 'references'));
    }
    for (const target of stringArray(meta['related'])) {
      out.push(link(sourcePath, target, 'references'));
    }
    return out;
  },
};

function pickMetadata(frontmatter: Record<string, unknown>): Record<string, unknown> | null {
  const meta = frontmatter['metadata'];
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    return meta as Record<string, unknown>;
  }
  return null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function link(source: string, target: string, kind: 'supersedes' | 'references'): Link {
  return {
    source,
    target,
    kind,
    confidence: 'high',
    sources: [ID],
  };
}
