/**
 * Built-in `claude` Provider. Walks Claude Code's on-disk convention:
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
 *
 * **Phase 3 (spec 0.8.0).** The Provider owns the per-kind frontmatter
 * schemas (relocated from spec — `skill`, `agent`, `command`, `hook`,
 * `note`). The flat `defaultRefreshAction` map collapsed into the
 * `kinds` map; each kind entry pairs the loaded JSON Schema with its
 * qualified refresh action id. The kernel's frontmatter-validation flow
 * asks the Provider for the schema instead of reading directly from
 * spec/.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import yaml from 'js-yaml';

import { buildIgnoreFilter, type IIgnoreFilter } from '../../../kernel/scan/ignore.js';
import type { IProvider, IRawNode } from '../../../kernel/extensions/index.js';
import type { NodeKind } from '../../../kernel/types.js';
import skillSchema from './schemas/skill.schema.json' with { type: 'json' };
import agentSchema from './schemas/agent.schema.json' with { type: 'json' };
import commandSchema from './schemas/command.schema.json' with { type: 'json' };
import hookSchema from './schemas/hook.schema.json' with { type: 'json' };
import noteSchema from './schemas/note.schema.json' with { type: 'json' };

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export const claudeProvider: IProvider = {
  id: 'claude',
  pluginId: 'claude',
  kind: 'provider',
  version: '1.0.0',
  description: 'Walks Claude Code scope conventions (.claude/{agents,commands,hooks,skills} + notes).',
  stability: 'stable',

  // The Claude Provider's content lives under `~/.claude` for the global
  // scope (and inside `.claude/` for project scope). `sm doctor` validates
  // the directory exists for global scope; missing → non-blocking warning.
  explorationDir: '~/.claude',

  // Per spec § A.6, defaultRefreshAction values MUST be qualified action
  // ids. The summarize-* actions are not yet implemented as registry
  // entries (they ship later under the Claude bundle), but the qualified
  // form is the contract: when those actions land, they will register
  // under `claude/summarize-<kind>` and the Provider resolves them
  // deterministically.
  //
  // Phase 3 (spec 0.8.0): the per-kind catalog lives here. Each entry
  // pairs the relative manifest-style schema path (mirrors what the
  // spec's provider.schema.json validates) with the loaded JSON Schema
  // (`schemaJson`) the kernel registers with AJV at scan boot.
  // Step 14.5.d: each kind declares its UI presentation (label, color,
  // dark variant, icon). The UI consumes this registry via the
  // `kindRegistry` field embedded in REST envelopes; it derives bg/fg
  // tints from `color` per theme via a deterministic helper, so the
  // Provider only declares intent (one base color per theme) instead of
  // four hex values. Colors and SVG paths transplanted verbatim from
  // the previous static UI catalog (`ui/src/styles.css` for hex,
  // `ui/src/app/components/kind-icon/kind-icon.html` for SVG path data,
  // `ui/src/i18n/kinds.texts.ts` for labels).
  kinds: {
    agent: {
      schema: './schemas/agent.schema.json',
      schemaJson: agentSchema,
      defaultRefreshAction: 'claude/summarize-agent',
      ui: {
        label: 'Agents',
        color: '#3b82f6',
        colorDark: '#60a5fa',
        icon: { kind: 'pi', id: 'pi-user' },
      },
    },
    command: {
      schema: './schemas/command.schema.json',
      schemaJson: commandSchema,
      defaultRefreshAction: 'claude/summarize-command',
      ui: {
        label: 'Commands',
        color: '#f59e0b',
        colorDark: '#fbbf24',
        icon: {
          kind: 'svg',
          path: 'M4 17 L10 11 L4 5 M12 19 L20 19',
        },
      },
    },
    hook: {
      schema: './schemas/hook.schema.json',
      schemaJson: hookSchema,
      defaultRefreshAction: 'claude/summarize-hook',
      ui: {
        label: 'Hooks',
        color: '#8b5cf6',
        colorDark: '#a78bfa',
        icon: {
          kind: 'svg',
          path: 'M12 2 a3 3 0 1 0 0 6 a3 3 0 1 0 0 -6 M12 8 L12 22 M5 12 H2 a10 10 0 0 0 20 0 H19',
        },
      },
    },
    skill: {
      schema: './schemas/skill.schema.json',
      schemaJson: skillSchema,
      defaultRefreshAction: 'claude/summarize-skill',
      ui: {
        label: 'Skills',
        color: '#10b981',
        colorDark: '#34d399',
        icon: { kind: 'pi', id: 'pi-bolt' },
      },
    },
    note: {
      schema: './schemas/note.schema.json',
      schemaJson: noteSchema,
      defaultRefreshAction: 'claude/summarize-note',
      ui: {
        label: 'Notes',
        color: '#5b908c',
        colorDark: '#9bbcb8',
        icon: {
          kind: 'svg',
          path: 'M14 2 H6 a2 2 0 0 0 -2 2 V20 a2 2 0 0 0 2 2 H18 a2 2 0 0 0 2 -2 V8 L14 2 M14 2 V8 H20 M16 13 H8 M16 17 H8 M10 9 H8',
        },
      },
    },
  },

  async *walk(roots, options = {}): AsyncIterable<IRawNode> {
    // The orchestrator is the canonical source of the filter (it composes
    // bundled defaults + config.ignore + .skillmapignore). When the
    // Provider is invoked directly (tests, kernel-empty-boot), fall back
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

// eslint-disable-next-line complexity
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
    // Symlinks are skipped explicitly (audit M7). The follow-symlinks
    // config knob (`scan.followSymlinks` in settings.json) is reserved
    // for a future implementation that would also need cycle detection
    // and a `realpath`-resolved containment check; until then the
    // walker stays in the safe default. Without this guard we relied on
    // `Dirent.isFile()` returning false for symlinks — an implementation
    // detail of node's `withFileTypes`. The explicit skip is both
    // self-documenting and resilient to future Dirent API changes.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      yield* walkMarkdown(root, full, filter);
    } else if (entry.isFile() && name.endsWith('.md')) {
      // stat() guards against TOCTOU races where readdir reported a
      // regular file and the entry was swapped for a symlink between
      // calls. `stat` follows symlinks; rejecting non-regular results
      // closes that lane too.
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

const FORBIDDEN_FRONTMATTER_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function splitFrontmatter(raw: string): ISplitResult {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { frontmatterRaw: '', frontmatter: {}, body: raw };
  const frontmatterRaw = match[1]!;
  const body = match[2]!;
  const parsed: Record<string, unknown> = {};
  try {
    // Defence in depth (audit L3): pin the parser schema explicitly.
    // js-yaml v4's default schema is already safe (no `!!js/function`
    // tags) but the explicit `JSON_SCHEMA` selection both documents
    // intent and protects against an upstream default flip. Frontmatter
    // values that are valid JSON (string, number, bool, null, sequence,
    // mapping) round-trip unchanged; YAML-only conveniences like
    // unquoted timestamps would degrade to strings, but the kernel's
    // node schema does not depend on parsed Date objects so the
    // tradeoff is safe.
    const doc = yaml.load(frontmatterRaw, { schema: yaml.JSON_SCHEMA });
    if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
      // js-yaml stores `__proto__:` as an own data property (rather than
      // polluting Object.prototype), but the value still flows into
      // downstream `Object.assign`-style merges where the `__proto__`
      // setter fires. Strip pollution-class keys at parse time so the
      // returned object is safe to spread, copy, and persist. Prototype
      // stays normal so `deepStrictEqual` round-trips against the
      // persisted form (which goes through `JSON.parse` and inherits
      // Object.prototype).
      for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
        if (FORBIDDEN_FRONTMATTER_KEYS.has(k)) continue;
        parsed[k] = v;
      }
    }
  } catch {
    // Malformed YAML — leave as empty object, keep the raw string for
    // downstream diagnostics.
  }
  return { frontmatterRaw, frontmatter: parsed, body };
}
