/**
 * Strings rendered by `<sm-node-card>` (graph node body). Labels
 * are short codes — tooltips spell them out so the abbreviation
 * doesn't need to be memorised.
 */
export const NODE_CARD_TEXTS = {
  llm: {
    /** `summary.whatItDoes` / `whatItCovers` (note kind) */
    what: { label: 'what', tooltip: 'What it does (LLM-inferred summary)' },
    /** Agent-only: `summary.whenToUse` */
    when: { label: 'when', tooltip: 'When to use (LLM-inferred)' },
    /** Agent-only: `summary.interactionStyle` */
    style: { label: 'style', tooltip: 'Interaction style (LLM-inferred)' },
    /** Agent-only: `summary.capabilities[]` */
    does: { label: 'does', tooltip: 'Capabilities (LLM-inferred)' },
    /** Skill-only: `summary.recipe[]` */
    steps: { label: 'steps', tooltip: 'Recipe / ordered steps (LLM-inferred)' },
    /** Skill-only: `summary.preconditions[]` */
    pre: { label: 'pre', tooltip: 'Preconditions (LLM-inferred)' },
    /** Skill-only: `summary.outputs[]` (LLM-inferred, distinct from frontmatter outputs) */
    out: { label: 'out', tooltip: 'Outputs / produced artifacts (LLM-inferred)' },
    /** Skill / command: `summary.sideEffects[]` */
    fx: { label: 'fx', tooltip: 'Side effects (LLM-inferred)' },
    /** Command-only: `summary.invocationExample` */
    eg: { label: 'eg', tooltip: 'Invocation example (LLM-inferred)' },
    /** Note-only: `summary.topics[]` */
    topics: { label: 'topics', tooltip: 'Topics covered (LLM-inferred)' },
    /** Note-only: `summary.keyFacts[]` */
    facts: { label: 'facts', tooltip: 'Key facts (LLM-inferred discrete claims)' },
  },
  meta: {
    model: 'model',
    allowed: 'allowed',
    tools: 'tools',
    tags: 'tags',
  },
  stats: {
    /** Pluralised in formatters — singular is template fallback only. */
    errors: (n: number) => `${n} error${n === 1 ? '' : 's'}`,
    warns: (n: number) => `${n} warning${n === 1 ? '' : 's'}`,
    tools: (n: number) => `${n} tool${n === 1 ? '' : 's'}`,
    toolsBreakdown: (allowlist: number, preApproved: number) =>
      `${allowlist} allowlist + ${preApproved} pre-approved`,
    linksIn: (n: number) => `${n} incoming link${n === 1 ? '' : 's'}`,
    linksOut: (n: number) => `${n} outgoing link${n === 1 ? '' : 's'}`,
    extRefs: (n: number) => `${n} external URL${n === 1 ? '' : 's'} in body`,
    bytes: (total: number) => `${total.toLocaleString('en-US')} bytes`,
    tokens: (total: number) => `${total.toLocaleString('en-US')} tokens`,
    daysAgo: (iso: string, days: number) => `updated ${iso} (${days} day${days === 1 ? '' : 's'} ago)`,
  },
  stability: {
    experimental: 'experimental',
    deprecated: 'deprecated',
  },
  safety: {
    injection: (type: string | null) => `injection${type ? `: ${type}` : ''}`,
  },
  confidence: (value: number) => `LLM summary · confidence ${value.toFixed(2)}`,
  ariaExpand: 'Expand',
} as const;
