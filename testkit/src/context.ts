/**
 * Fake extension contexts. The kernel passes per-kind context objects
 * to extension methods (`extract`, `evaluate`, `format`, ...). When
 * unit-testing an extension you typically don't want to spin up the
 * whole orchestrator; you just want a context with the fields your
 * code reads.
 *
 * Each helper builds one with sensible defaults. Override any field
 * via the `overrides` arg. The fields the kernel injects (e.g.
 * `node.path`, `body`, callbacks) match what the orchestrator passes
 * at runtime.
 */

import type {
  IExtractorContext,
  IFormatterContext,
  IRuleContext,
  Issue,
  Link,
  Node,
} from '@skill-map/cli';

import { node as buildNode } from './builders.js';

/**
 * Build an `IExtractorContext` for an extractor test. The kernel
 * supplies three callbacks at runtime — `emitLink`, `enrichNode`, and
 * (when configured) `store` / `runner`. Defaults supply no-op
 * implementations of the two mandatory callbacks; the test typically
 * overrides them with capturing arrays / spies.
 *
 * Defaults:
 *   - `node`: `node()` (placeholder skill node).
 *   - `body`: empty string.
 *   - `frontmatter`: empty object.
 *   - `emitLink`: no-op.
 *   - `enrichNode`: no-op.
 *
 * For `scope: 'frontmatter'` extractors, the orchestrator passes an
 * empty body — set both fields explicitly if your test cares.
 */
export function makeExtractorContext(overrides: Partial<IExtractorContext> = {}): IExtractorContext {
  return {
    node: overrides.node ?? buildNode(),
    body: overrides.body ?? '',
    frontmatter: overrides.frontmatter ?? {},
    emitLink: overrides.emitLink ?? (() => {}),
    enrichNode: overrides.enrichNode ?? (() => {}),
    ...(overrides.store !== undefined ? { store: overrides.store } : {}),
    ...(overrides.runner !== undefined ? { runner: overrides.runner } : {}),
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
 * Build an `IFormatterContext` for a formatter test. Same shape as a
 * rule context plus the issue list.
 */
export function makeFormatterContext(overrides: Partial<IFormatterContext> = {}): IFormatterContext {
  return {
    nodes: overrides.nodes ?? [],
    links: overrides.links ?? [],
    issues: overrides.issues ?? [],
  };
}

/**
 * Convenience: pre-fill extractor context from a body string. Useful
 * when the extractor only consumes `body` and the test wants to assert
 * "given this markdown, the extractor emits these links via emitLink".
 */
export function extractorContextFromBody(body: string, overrides: Partial<IExtractorContext> = {}): IExtractorContext {
  return makeExtractorContext({ ...overrides, body });
}

// Re-export the underlying types so callers don't need a second import
// from `@skill-map/cli` just to type their fixtures.
export type { IExtractorContext, IRuleContext, IFormatterContext, Issue, Link, Node };
