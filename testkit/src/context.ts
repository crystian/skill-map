/**
 * Fake extension contexts. The kernel passes per-kind context objects
 * to extension methods (`detect`, `evaluate`, `render`, ...). When
 * unit-testing an extension you typically don't want to spin up the
 * whole orchestrator; you just want a context with the fields your
 * code reads.
 *
 * Each helper builds one with sensible defaults. Override any field
 * via the `overrides` arg. The fields the kernel injects (e.g.
 * `node.path`, `body`) match what the orchestrator passes at runtime.
 */

import type {
  IDetectContext,
  IRenderContext,
  IRuleContext,
  Issue,
  Link,
  Node,
} from '@skill-map/cli';

import { node as buildNode } from './builders.js';

/**
 * Build an `IDetectContext` for a detector test.
 *
 * Defaults:
 *   - `node`: `node()` (placeholder skill node).
 *   - `body`: empty string.
 *   - `frontmatter`: empty object.
 *
 * For `scope: 'frontmatter'` detectors, the orchestrator passes an
 * empty body — set both fields explicitly if your test cares.
 */
export function makeDetectContext(overrides: Partial<IDetectContext> = {}): IDetectContext {
  return {
    node: overrides.node ?? buildNode(),
    body: overrides.body ?? '',
    frontmatter: overrides.frontmatter ?? {},
  };
}

/**
 * Build an `IRuleContext` for a rule test. Rules see the entire graph;
 * defaults are empty arrays so the rule has nothing to react to unless
 * you populate them.
 */
export function makeRuleContext(overrides: Partial<IRuleContext> = {}): IRuleContext {
  return {
    nodes: overrides.nodes ?? [],
    links: overrides.links ?? [],
  };
}

/**
 * Build an `IRenderContext` for a renderer test. Same shape as a
 * rule context plus the issue list.
 */
export function makeRenderContext(overrides: Partial<IRenderContext> = {}): IRenderContext {
  return {
    nodes: overrides.nodes ?? [],
    links: overrides.links ?? [],
    issues: overrides.issues ?? [],
  };
}

/**
 * Convenience: pre-fill detect context from a body string. Useful when
 * the detector only consumes `body` and the test wants to assert
 * "given this markdown, the detector emits these links".
 */
export function detectContextFromBody(body: string, overrides: Partial<IDetectContext> = {}): IDetectContext {
  return makeDetectContext({ ...overrides, body });
}

// Re-export the underlying types so callers don't need a second import
// from `@skill-map/cli` just to type their fixtures.
export type { IDetectContext, IRuleContext, IRenderContext, Issue, Link, Node };
