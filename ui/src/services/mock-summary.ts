/**
 * Deterministic mock summarizer for the in-browser prototype.
 *
 * Produces a `TSummary` per node so the LLM cluster on `<sm-node-card>`
 * (`what`, `when`, `style`, `does`, `steps`, `pre`, `out`, `fx`, `eg`,
 * `trigger`, `topics`, `facts`) renders with plausible content. The real
 * summarizer ships with the kernel; this is the prototype-only stand-in
 * until `sm summarize` lands. Pure function — same input always returns
 * the same output, so node cards stay stable across reloads.
 */

import type {
  IFrontmatterAgent,
  IFrontmatterCommand,
  IFrontmatterHook,
  IFrontmatterSkill,
  INodeView,
  ISummaryAgent,
  ISummaryCommand,
  ISummaryHook,
  ISummaryNote,
  ISummarySkill,
  TSummary,
} from '../models/node';

export function buildMockSummary(view: INodeView): TSummary {
  const fm = view.frontmatter;
  const what = firstSentence(fm.description) ?? `${view.kind} entry`;
  const confidence = pseudoConfidence(view.path);

  const base = {
    confidence,
    safety: { injectionDetected: false, contentQuality: 'clean' as const },
  };

  if (view.kind === 'hook') {
    const hook = fm as IFrontmatterHook;
    const summary: ISummaryHook = {
      ...base,
      kind: 'hook',
      whatItDoes: what,
      triggerInferred: hook.event ?? 'PreToolUse',
      sideEffects: deriveHookSideEffects(view, hook),
      blockingInferred: hook.blocking ?? false,
      idempotentInferred: hook.idempotent ?? true,
    };
    return summary;
  }

  if (view.kind === 'skill') {
    const skill = fm as IFrontmatterSkill;
    const summary: ISummarySkill = {
      ...base,
      kind: 'skill',
      whatItDoes: what,
      recipe: deriveRecipe(view),
      preconditions: pickKeywords(view, 2),
      outputs: skill.outputs?.map((o) => o.name) ?? deriveOutputs(view),
      sideEffects: deriveSideEffects(view),
    };
    return summary;
  }

  if (view.kind === 'command') {
    const cmd = fm as IFrontmatterCommand;
    const summary: ISummaryCommand = {
      ...base,
      kind: 'command',
      whatItDoes: what,
      invocationExample: deriveInvocation(view, cmd),
      sideEffects: deriveSideEffects(view),
    };
    return summary;
  }

  if (view.kind === 'agent') {
    const agent = fm as IFrontmatterAgent;
    const summary: ISummaryAgent = {
      ...base,
      kind: 'agent',
      whatItDoes: what,
      whenToUse: deriveWhenToUse(view),
      capabilities: pickKeywords(view, 4),
      toolsObserved: agent.tools ?? [],
      interactionStyle: 'synchronous; returns a structured response.',
    };
    return summary;
  }

  const summary: ISummaryNote = {
    ...base,
    kind: 'note',
    whatItCovers: what,
    topics: pickKeywords(view, 4),
    keyFacts: pickKeyFacts(view, 3),
  };
  return summary;
}

function firstSentence(text: string | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  const dot = trimmed.indexOf('.');
  return dot > 0 ? trimmed.slice(0, dot + 1) : trimmed;
}

/**
 * Hash the path into a confidence in [0.55, 0.95]. Stable per file so
 * the same node renders the same percentage across reloads — important
 * because the value is part of the visual identity (color tier).
 */
function pseudoConfidence(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const norm = (Math.abs(h) % 1000) / 1000;
  return 0.55 + norm * 0.4;
}

const HOOK_FX_BY_EVENT: Record<string, readonly string[]> = {
  PreToolUse: ['denies the tool call', 'writes to .claude/logs'],
  PostToolUse: ['mutates session state', 'writes to .claude/logs'],
  UserPromptSubmit: ['rewrites the prompt', 'logs the prompt'],
  Stop: ['flushes pending writes'],
  Notification: ['emits a desktop notification'],
};

function deriveHookSideEffects(
  view: INodeView,
  fm: IFrontmatterHook,
): readonly string[] {
  const event = fm.event ?? '';
  const fromEvent = HOOK_FX_BY_EVENT[event];
  if (fromEvent) return fromEvent;
  return deriveSideEffects(view);
}

function deriveSideEffects(view: INodeView): readonly string[] {
  const body = view.body.toLowerCase();
  const out: string[] = [];
  if (/\bwrites?\s+(to\s+)?(disk|file|files)\b/.test(body)) out.push('writes files to disk');
  if (/\bdeletes?\b/.test(body)) out.push('may delete existing files');
  if (/\bcommits?\b|\bgit\b/.test(body)) out.push('runs git commands');
  if (/\bnetwork\b|\bfetch\b|\bcurl\b|\bhttp/.test(body)) out.push('makes network calls');
  if (/\benv|process\.env|environment\b/.test(body)) out.push('reads env vars');
  if (out.length === 0) out.push('mutates project state');
  return out.slice(0, 3);
}

function deriveRecipe(view: INodeView): readonly { step: number; description: string }[] {
  const headings = view.body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^#{2,3}\s+/.test(l))
    .slice(0, 4)
    .map((l) => l.replace(/^#{2,3}\s+/, ''));
  if (headings.length === 0) return [{ step: 1, description: 'follow the body instructions' }];
  return headings.map((description, i) => ({ step: i + 1, description }));
}

function deriveOutputs(view: INodeView): readonly string[] {
  const out: string[] = [];
  if (/\bmarkdown\b|\.md\b/i.test(view.body)) out.push('markdown report');
  if (/\bjson\b/i.test(view.body)) out.push('json artifact');
  if (out.length === 0) out.push('summary');
  return out;
}

function deriveInvocation(view: INodeView, fm: IFrontmatterCommand): string {
  const name = fm.name ?? view.path.split('/').pop()?.replace(/\.md$/, '') ?? 'command';
  const arg = fm.args?.find((a) => a.required) ?? fm.args?.[0];
  return arg ? `/${name} --${arg.name}=<${arg.type ?? 'value'}>` : `/${name}`;
}

function deriveWhenToUse(view: INodeView): string {
  const tags = view.frontmatter.metadata.tags ?? [];
  if (tags.length > 0) return `when working with ${tags.slice(0, 2).join(' / ')}`;
  return 'when the agent matches the task at hand';
}

function pickKeywords(view: INodeView, max: number): readonly string[] {
  const tags = view.frontmatter.metadata.tags ?? [];
  if (tags.length >= max) return tags.slice(0, max);
  const keywords = view.frontmatter.metadata.keywords ?? [];
  const merged = [...new Set([...tags, ...keywords])];
  if (merged.length >= max) return merged.slice(0, max);
  return merged.length > 0 ? merged : pickFromBody(view.body, max);
}

function pickKeyFacts(view: INodeView, max: number): readonly string[] {
  const lines = view.body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+\S/.test(l))
    .slice(0, max)
    .map((l) => l.replace(/^[-*]\s+/, '').slice(0, 80));
  return lines;
}

function pickFromBody(body: string, max: number): readonly string[] {
  const words = body.match(/\b[a-z][a-z-]{4,}\b/gi) ?? [];
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w.toLowerCase(), (counts.get(w.toLowerCase()) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}
