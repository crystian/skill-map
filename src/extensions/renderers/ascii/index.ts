/**
 * `ascii` renderer. Produces a plain-text dump of the graph for
 * `sm graph --format ascii`. Purposely minimal — a human reads it to
 * grok the shape of a scan, not to study layout. Fancier renderers
 * (mermaid, dot) land as drop-in additions in later steps.
 *
 * Output layout:
 *
 *   skill-map graph — <N> nodes, <M> links, <K> issues
 *
 *   ## agent (3)
 *   - agents/backend-architect.md — "Backend Architect"
 *   - agents/doc-writer.md — "Doc Writer"
 *
 *   ## command (2)
 *   - commands/deploy.md — "Deploy"
 *
 *   ## links
 *   - agents/a.md --supersedes--> agents/b.md  [high]
 *   - notes/n.md --references--> notes/m.md    [high]
 *
 *   ## issues (1)
 *   - [warn] broken-ref: ...
 */

import type { IRenderer, IRenderContext } from '../../../kernel/extensions/index.js';
import type { NodeKind } from '../../../kernel/types.js';

const ID = 'ascii';
const KIND_ORDER: NodeKind[] = ['agent', 'command', 'hook', 'skill', 'note'];

export const asciiRenderer: IRenderer = {
  id: ID,
  kind: 'renderer',
  version: '1.0.0',
  description: 'Plain-text graph dump, grouped by node kind then links then issues.',
  stability: 'stable',
  format: 'ascii',

  render(ctx: IRenderContext): string {
    const out: string[] = [];
    out.push(
      `skill-map graph — ${ctx.nodes.length} nodes, ${ctx.links.length} links, ${ctx.issues.length} issues`,
      '',
    );

    // Group nodes by kind.
    const byKind = new Map<NodeKind, typeof ctx.nodes>();
    for (const node of ctx.nodes) {
      if (!byKind.has(node.kind)) byKind.set(node.kind, []);
      byKind.get(node.kind)!.push(node);
    }

    for (const kind of KIND_ORDER) {
      const group = byKind.get(kind);
      if (!group || group.length === 0) continue;
      const sorted = [...group].sort((a, b) => a.path.localeCompare(b.path));
      out.push(`## ${kind} (${sorted.length})`);
      for (const node of sorted) {
        const title = pickTitle(node);
        out.push(`- ${node.path}${title ? ` — "${title}"` : ''}`);
      }
      out.push('');
    }

    if (ctx.links.length > 0) {
      out.push(`## links (${ctx.links.length})`);
      const sorted = [...ctx.links].sort((a, b) => {
        const aKey = `${a.source}\0${a.kind}\0${a.target}`;
        const bKey = `${b.source}\0${b.kind}\0${b.target}`;
        return aKey.localeCompare(bKey);
      });
      for (const link of sorted) {
        out.push(
          `- ${link.source} --${link.kind}--> ${link.target}  [${link.confidence}]`,
        );
      }
      out.push('');
    }

    if (ctx.issues.length > 0) {
      out.push(`## issues (${ctx.issues.length})`);
      for (const issue of ctx.issues) {
        out.push(`- [${issue.severity}] ${issue.ruleId}: ${issue.message}`);
      }
      out.push('');
    }

    return out.join('\n');
  },
};

function pickTitle(node: { title?: string | null; frontmatter?: Record<string, unknown> }): string | null {
  if (node.title) return node.title;
  const name = node.frontmatter?.['name'];
  return typeof name === 'string' ? name : null;
}
