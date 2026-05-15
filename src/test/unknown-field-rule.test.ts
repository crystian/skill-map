/**
 * Step 9.6.6 — `core/unknown-field` Tier-1 rule tests.
 *
 * Five scenarios per Decision #4 of the Step 9.6.6 brief:
 *   - fresh sidecar with all keys in `annotations.schema.json` → 0
 *   - typo'd key inside `annotations:` → 1
 *   - top-level key that is neither reserved nor a registered plugin
 *     namespace nor a registered root key → 1
 *   - registered plugin namespace `<plugin-id>:` containing a key that
 *     does NOT validate against the plugin's contributed schema → 1
 *   - registered `location: 'root'` key → 0 (registration legitimises it)
 *
 * The rule is invoked directly with a hand-built `IRuleContext` rather
 * than through `runScan` so the catalog and `sidecarRoots` map are
 * easy to control in isolation.
 */

import { describe, it } from 'bun:test';
import { strictEqual } from 'node:assert';

import { unknownFieldRule } from '../built-in-plugins/rules/unknown-field/index.js';
import type { Issue, Node } from '../kernel/index.js';
import type { IRegisteredAnnotationKey } from '../kernel/types/annotation-catalog.js';

function fakeNode(path: string): Node {
  return {
    path,
    kind: 'agent',
    title: path,
    bodyHash: 'a'.repeat(64),
    frontmatterHash: 'b'.repeat(64),
    provider: 'claude',
  } as unknown as Node;
}

function evaluate(
  sidecarRoot: Record<string, unknown>,
  contributions: readonly IRegisteredAnnotationKey[] = [],
): Issue[] {
  const node = fakeNode('agents/architect.md');
  const sidecarRoots = new Map<string, Record<string, unknown>>([
    [node.path, sidecarRoot],
  ]);
  const out = unknownFieldRule.evaluate({
    nodes: [node],
    links: [],
    sidecarRoots,
    annotationContributions: contributions,
  });
  return Array.isArray(out) ? out : [];
}

describe('core/unknown-field rule (Step 9.6.6)', () => {
  it('curated annotations.* keys yield 0 warnings', () => {
    const issues = evaluate({
      for: { path: 'agents/architect.md', bodyHash: 'a'.repeat(64), frontmatterHash: 'b'.repeat(64) },
      annotations: { version: 1, stability: 'stable', tags: ['x'] },
    });
    strictEqual(issues.length, 0, JSON.stringify(issues));
  });

  it("typo'd key inside annotations: yields exactly 1 warning", () => {
    const issues = evaluate({
      for: { path: 'agents/architect.md', bodyHash: 'a'.repeat(64), frontmatterHash: 'b'.repeat(64) },
      annotations: { versoin: 1 },
    });
    strictEqual(issues.length, 1);
    strictEqual(issues[0]!.severity, 'warn');
    strictEqual(issues[0]!.ruleId, 'unknown-field');
    strictEqual((issues[0]!.data as Record<string, unknown>)['surface'], 'annotations');
  });

  it('top-level non-reserved, non-registered key yields exactly 1 warning', () => {
    const issues = evaluate({
      for: { path: 'agents/architect.md', bodyHash: 'a'.repeat(64), frontmatterHash: 'b'.repeat(64) },
      'not-a-real-plugin': { foo: 'bar' },
    });
    strictEqual(issues.length, 1);
    strictEqual((issues[0]!.data as Record<string, unknown>)['surface'], 'root');
  });

  it('registered plugin namespace with invalid contributed value yields 1 warning', () => {
    const contributions: IRegisteredAnnotationKey[] = [
      {
        pluginId: 'reviewer',
        key: 'lastReviewedAt',
        location: 'namespaced',
        ownership: 'shared',
        schema: { type: 'string', format: 'date-time' },
      },
    ];
    const issues = evaluate(
      {
        for: { path: 'agents/architect.md', bodyHash: 'a'.repeat(64), frontmatterHash: 'b'.repeat(64) },
        reviewer: { lastReviewedAt: 12345 }, // wrong type — must be string
      },
      contributions,
    );
    strictEqual(issues.length, 1);
    strictEqual((issues[0]!.data as Record<string, unknown>)['surface'], 'plugin-namespace');
    strictEqual((issues[0]!.data as Record<string, unknown>)['pluginId'], 'reviewer');
  });

  it('registered location:root key yields 0 warnings', () => {
    const contributions: IRegisteredAnnotationKey[] = [
      {
        pluginId: 'compliance',
        key: 'compliance',
        location: 'root',
        ownership: 'exclusive',
        schema: { type: 'object' },
      },
    ];
    const issues = evaluate(
      {
        for: { path: 'agents/architect.md', bodyHash: 'a'.repeat(64), frontmatterHash: 'b'.repeat(64) },
        compliance: { audit: 'sox-2026' },
      },
      contributions,
    );
    strictEqual(issues.length, 0);
  });

  it('registered plugin namespace with value matching schema yields 0 warnings', () => {
    const contributions: IRegisteredAnnotationKey[] = [
      {
        pluginId: 'reviewer',
        key: 'lastReviewedAt',
        location: 'namespaced',
        ownership: 'shared',
        schema: { type: 'string' },
      },
    ];
    const issues = evaluate(
      {
        for: { path: 'agents/architect.md', bodyHash: 'a'.repeat(64), frontmatterHash: 'b'.repeat(64) },
        reviewer: { lastReviewedAt: '2026-05-06T10:00:00Z' },
      },
      contributions,
    );
    strictEqual(issues.length, 0);
  });

  it('absent sidecarRoots map → empty issue list (no false positives)', () => {
    const out = unknownFieldRule.evaluate({ nodes: [fakeNode('a.md')], links: [] });
    const issues = Array.isArray(out) ? out : [];
    strictEqual(issues.length, 0);
  });
});
