/**
 * `ascii` formatter. Produces a plain-text dump of the graph for
 * `sm graph --format ascii`. Purposely minimal — a human reads it to
 * grok the shape of a scan, not to study layout. Fancier formatters
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

import type { IFormatter, IFormatterContext } from '../../../kernel/extensions/index.js';

const ID = 'ascii';
// Built-in Claude Provider catalog rendered first, in this canonical
// order. Anything else (`'cursorRule'`, `'daily'`, … from external
// Providers) is rendered after, sorted alphabetically — the formatter
// no longer assumes the closed enum and the order stays deterministic.
const KIND_ORDER: readonly string[] = ['agent', 'command', 'hook', 'skill', 'note'];

export const asciiFormatter: IFormatter = {
  id: ID,
  pluginId: 'core',
  kind: 'formatter',
  version: '1.0.0',
  description: 'Plain-text graph dump, grouped by node kind then links then issues.',
  stability: 'stable',
  formatId: 'ascii',

  // ASCII tree formatter — header + per-kind sections + per-issue
  // section. Each section iterates and renders; splitting per section
  // would multiply the for-loop boilerplate.
  // eslint-disable-next-line complexity
  format(ctx: IFormatterContext): string {
    const out: string[] = [];
    out.push(
      `skill-map graph — ${ctx.nodes.length} nodes, ${ctx.links.length} links, ${ctx.issues.length} issues`,
      '',
    );

    // Group nodes by kind. `kind` is an open string — the formatter
    // accepts whatever an enabled Provider classified into.
    const byKind = new Map<string, typeof ctx.nodes>();
    for (const node of ctx.nodes) {
      if (!byKind.has(node.kind)) byKind.set(node.kind, []);
      byKind.get(node.kind)!.push(node);
    }

    // Built-in Claude catalog first in canonical order, then any extra
    // kinds an external Provider emitted, sorted alphabetically so the
    // output stays deterministic across runs.
    const renderedKinds = new Set<string>();
    for (const kind of KIND_ORDER) {
      const group = byKind.get(kind);
      if (!group || group.length === 0) continue;
      renderSection(out, kind, group);
      renderedKinds.add(kind);
    }
    const extraKinds = [...byKind.keys()]
      .filter((k) => !renderedKinds.has(k))
      .sort();
    for (const kind of extraKinds) {
      const group = byKind.get(kind);
      if (!group || group.length === 0) continue;
      renderSection(out, kind, group);
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

function renderSection(
  out: string[],
  kind: string,
  group: ReadonlyArray<{ path: string; title?: string | null; frontmatter?: Record<string, unknown> }>,
): void {
  const sorted = [...group].sort((a, b) => a.path.localeCompare(b.path));
  out.push(`## ${kind} (${sorted.length})`);
  for (const node of sorted) {
    const title = pickTitle(node);
    out.push(`- ${node.path}${title ? ` — "${title}"` : ''}`);
  }
  out.push('');
}
