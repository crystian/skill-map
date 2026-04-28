/**
 * High-level helpers for the most common plugin-test shapes:
 *
 *   - `runDetectorOnFixture`: invoke a detector against a single node +
 *     body, get back its links. Mirrors what the orchestrator does for
 *     each node during `sm scan`.
 *   - `runRuleOnGraph`: invoke a rule against a (nodes, links) graph,
 *     get back its issues. Mirrors what the orchestrator does after
 *     all detectors have completed.
 *   - `runRendererOnGraph`: invoke a renderer and get its string output.
 *     Mirrors `sm graph --format <name>`.
 *
 * Each helper builds a fake context with sensible defaults so most
 * plugin tests reduce to one line. Override anything via the `context`
 * field when a test needs a richer fixture.
 */

import type {
  IDetectContext,
  IDetector,
  IRenderContext,
  IRenderer,
  IRule,
  IRuleContext,
  Issue,
  Link,
} from '@skill-map/cli';

import { makeDetectContext, makeRenderContext, makeRuleContext } from './context.js';
import { node as buildNode } from './builders.js';

export interface IRunDetectorOptions {
  /** Markdown body the detector consumes. Default: empty string. */
  body?: string;
  /** Frontmatter the detector consumes. Default: empty object. */
  frontmatter?: Record<string, unknown>;
  /** Override the surrounding node. Defaults to `node()` placeholder. */
  context?: Partial<IDetectContext>;
}

/**
 * Run a detector once and return its emitted links.
 *
 * The detector's `scope` field is **not** enforced here. The kernel
 * passes an empty body to a `frontmatter`-scope detector at runtime;
 * tests can mirror that explicitly by passing `body: ''`. We don't
 * scrub here so the test keeps full control over the inputs.
 */
export async function runDetectorOnFixture(
  detector: IDetector,
  opts: IRunDetectorOptions = {},
): Promise<Link[]> {
  const ctxBuild: Partial<IDetectContext> = { ...(opts.context ?? {}) };
  if (opts.body !== undefined) ctxBuild.body = opts.body;
  if (opts.frontmatter !== undefined) ctxBuild.frontmatter = opts.frontmatter;
  if (ctxBuild.node === undefined) ctxBuild.node = buildNode();
  const ctx = makeDetectContext(ctxBuild);
  return detector.detect(ctx);
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

export interface IRunRendererOptions {
  context?: Partial<IRenderContext>;
}

/** Render a graph and return the renderer's string output. */
export function runRendererOnGraph(
  renderer: IRenderer,
  opts: IRunRendererOptions = {},
): string {
  const ctx = makeRenderContext(opts.context ?? {});
  return renderer.render(ctx);
}
