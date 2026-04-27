/**
 * Built-in `claude` adapter. Walks Claude Code's on-disk convention:
 *
 *     <root>/.claude/agents/*.md             → kind: agent
 *     <root>/.claude/commands/*.md           → kind: command
 *     <root>/.claude/hooks/*.md              → kind: hook
 *     <root>/.claude/skills/<name>/SKILL.md  → kind: skill
 *     <root>/notes/**.md                     → kind: note
 *     <root>/**.md  (fallback)               → kind: note
 *
 * Frontmatter is parsed with js-yaml; anything that fails to parse still
 * produces a node with an empty-object frontmatter so the scan keeps
 * advancing. Pure filesystem walk + parse — no DB awareness.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import yaml from 'js-yaml';

import { buildIgnoreFilter, type IIgnoreFilter } from '../../../kernel/scan/ignore.js';
import type { IAdapter, IRawNode } from '../../../kernel/extensions/index.js';
import type { NodeKind } from '../../../kernel/types.js';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export const claudeAdapter: IAdapter = {
  id: 'claude',
  kind: 'adapter',
  version: '1.0.0',
  description: 'Walks Claude Code scope conventions (.claude/{agents,commands,hooks,skills} + notes).',
  stability: 'stable',

  defaultRefreshAction: {
    agent: 'summarize-agent',
    command: 'summarize-command',
    skill: 'summarize-skill',
    hook: 'summarize-hook',
    note: 'summarize-note',
  },

  async *walk(roots, options = {}): AsyncIterable<IRawNode> {
    // The orchestrator is the canonical source of the filter (it composes
    // bundled defaults + config.ignore + .skill-mapignore). When the
    // adapter is invoked directly (tests, kernel-empty-boot), fall back
    // to bundled defaults only — that's still enough to keep `.git`,
    // `node_modules`, and friends out of the result.
    const filter: IIgnoreFilter = options.ignoreFilter ?? buildIgnoreFilter();
    for (const root of roots) {
      for await (const file of walkMarkdown(root, root, filter)) {
        const relPath = relative(root, file).split(sep).join('/');
        const raw = await readFile(file, 'utf8');
        const parsed = splitFrontmatter(raw);
        yield {
          path: relPath,
          body: parsed.body,
          frontmatterRaw: parsed.frontmatterRaw,
          frontmatter: parsed.frontmatter,
        };
      }
    }
  },

  classify(path: string): NodeKind {
    const lower = path.toLowerCase();
    if (lower.startsWith('.claude/agents/')) return 'agent';
    if (lower.startsWith('.claude/commands/')) return 'command';
    if (lower.startsWith('.claude/hooks/')) return 'hook';
    if (lower.startsWith('.claude/skills/')) return 'skill';
    return 'note';
  },
};

async function* walkMarkdown(
  root: string,
  current: string,
  filter: IIgnoreFilter,
): AsyncIterable<string> {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    const full = join(current, name);
    const rel = relative(root, full).split(sep).join('/');
    if (filter.ignores(rel)) continue;
    if (entry.isDirectory()) {
      yield* walkMarkdown(root, full, filter);
    } else if (entry.isFile() && name.endsWith('.md')) {
      // stat() guards against symlinks that point to non-files after
      // readdir reported them as a file (rare but possible on some FSes).
      try {
        const s = await stat(full);
        if (s.isFile()) yield full;
      } catch {
        // silently skip unreadable files
      }
    }
  }
}

interface ISplitResult {
  frontmatterRaw: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

function splitFrontmatter(raw: string): ISplitResult {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { frontmatterRaw: '', frontmatter: {}, body: raw };
  const frontmatterRaw = match[1]!;
  const body = match[2]!;
  let parsed: Record<string, unknown> = {};
  try {
    const doc = yaml.load(frontmatterRaw);
    if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
      parsed = doc as Record<string, unknown>;
    }
  } catch {
    // Malformed YAML — leave as empty object, keep the raw string for
    // downstream diagnostics.
  }
  return { frontmatterRaw, frontmatter: parsed, body };
}
