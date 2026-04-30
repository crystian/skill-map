/**
 * High-level helpers for the most common plugin-test shapes:
 *
 *   - `runExtractorOnFixture`: invoke an extractor against a single
 *     node + body, collecting links the extractor emits via
 *     `ctx.emitLink` and enrichments via `ctx.enrichNode`. Mirrors
 *     what the orchestrator does for each node during `sm scan`.
 *   - `runRuleOnGraph`: invoke a rule against a (nodes, links) graph,
 *     get back its issues. Mirrors what the orchestrator does after
 *     all extractors have completed.
 *   - `runFormatterOnGraph`: invoke a formatter and get its string
 *     output. Mirrors `sm graph --format <name>`.
 *
 * Each helper builds a fake context with sensible defaults so most
 * plugin tests reduce to one line. Override anything via the `context`
 * field when a test needs a richer fixture.
 */

import type {
  IExtractorContext,
  IExtractor,
  IFormatterContext,
  IFormatter,
  IRule,
  IRuleContext,
  Issue,
  Link,
  Node,
} from '@skill-map/cli';

import { makeExtractorContext, makeFormatterContext, makeRuleContext } from './context.js';
import { node as buildNode } from './builders.js';

export interface IRunExtractorOptions {
  /** Markdown body the extractor consumes. Default: empty string. */
  body?: string;
  /** Frontmatter the extractor consumes. Default: empty object. */
  frontmatter?: Record<string, unknown>;
  /** Override the surrounding node. Defaults to `node()` placeholder. */
  context?: Partial<IExtractorContext>;
}

/**
 * Result of `runExtractorOnFixture`. `links` aggregates every call to
 * `ctx.emitLink`; `enrichments` aggregates every call to
 * `ctx.enrichNode`. Order is preserved as emitted.
 */
export interface IRunExtractorResult {
  links: Link[];
  enrichments: Partial<Node>[];
}

/**
 * Run an extractor once and return the links + enrichments it emitted
 * via the context callbacks.
 *
 * The extractor's `scope` field is **not** enforced here. The kernel
 * passes an empty body to a `frontmatter`-scope extractor at runtime;
 * tests can mirror that explicitly by passing `body: ''`. We don't
 * scrub here so the test keeps full control over the inputs.
 *
 * Note: B.1 reshaped the extractor contract — the runtime method now
 * returns `void` and emits through `ctx.emitLink` / `ctx.enrichNode`.
 * If a test passes `context.emitLink` or `context.enrichNode`, those
 * callbacks are honoured first AND the helper still appends the same
 * payload into the returned arrays so the test gets a single inspection
 * point. (Useful for asserting both "the extractor's own emit fired"
 * and "the captured set looks right".)
 */
export async function runExtractorOnFixture(
  extractor: IExtractor,
  opts: IRunExtractorOptions = {},
): Promise<IRunExtractorResult> {
  const links: Link[] = [];
  const enrichments: Partial<Node>[] = [];

  const ctxOverrides: Partial<IExtractorContext> = { ...(opts.context ?? {}) };
  if (opts.body !== undefined) ctxOverrides.body = opts.body;
  if (opts.frontmatter !== undefined) ctxOverrides.frontmatter = opts.frontmatter;
  if (ctxOverrides.node === undefined) ctxOverrides.node = buildNode();

  const callerEmitLink = ctxOverrides.emitLink;
  const callerEnrichNode = ctxOverrides.enrichNode;
  ctxOverrides.emitLink = (link: Link): void => {
    links.push(link);
    if (callerEmitLink) callerEmitLink(link);
  };
  ctxOverrides.enrichNode = (partial: Partial<Node>): void => {
    enrichments.push(partial);
    if (callerEnrichNode) callerEnrichNode(partial);
  };

  const ctx = makeExtractorContext(ctxOverrides);
  await extractor.extract(ctx);
  return { links, enrichments };
}

export interface IRunRuleOptions {
  context?: Partial<IRuleContext>;
}

/** Run a rule against a graph and return its issues. */
export async function runRuleOnGraph(
  rule: IRule,
  opts: IRunRuleOptions = {},
): Promise<Issue[]> {
  const ctx = makeRuleContext(opts.context ?? {});
  return rule.evaluate(ctx);
}

export interface IRunFormatterOptions {
  context?: Partial<IFormatterContext>;
}

/** Format a graph and return the formatter's string output. */
export function runFormatterOnGraph(
  formatter: IFormatter,
  opts: IRunFormatterOptions = {},
): string {
  const ctx = makeFormatterContext(opts.context ?? {});
  return formatter.format(ctx);
}
