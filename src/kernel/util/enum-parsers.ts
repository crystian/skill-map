/**
 * Runtime guards for the closed-enum domain types (`Stability`,
 * `LinkKind`, `Confidence`, `Severity`, `TExecutionMode`,
 * `ExecutionRunner`, `ExecutionFailureReason`). Used at the storage
 * boundary (`scan-load.ts` row → domain conversion) and by any other
 * adapter that needs to coerce raw column strings into the kernel's
 * union types.
 *
 * Two flavors per enum:
 *
 *   - `is<Name>(s) → s is <Name>` — type guard that the input is a
 *     valid member of the union. No throw.
 *   - `parse<Name>(s, ctx) → <Name>` — narrowing parser. `s` MUST be a
 *     known value; an unknown one throws with a clear diagnostic that
 *     names the offending value, the allowed set, and the caller's
 *     `ctx` (typically a row id / column / file path) so the error is
 *     actionable. The caller decides whether `null` is allowed by
 *     branching on it before invoking.
 *
 * Why throw instead of coercing to a default: the kernel's read path
 * is a faithful inverse of the write path. If a row carries a value
 * outside the closed union, either the DB was modified out-of-band by
 * a different tool (fail loud, the user wants to know) or the kernel
 * itself just shipped a bug that wrote a bad value (fail loud — the
 * sooner the better). Silent coercion masks both cases.
 *
 * `Node.kind` is intentionally NOT covered here — it is open by spec
 * (`node.schema.json` accepts any non-empty string), and external
 * Providers freely return their own kinds.
 */

import type {
  Confidence,
  ExecutionFailureReason,
  ExecutionRunner,
  ExecutionStatus,
  LinkKind,
  Severity,
  Stability,
  TExecutionMode,
} from '../types.js';

const STABILITY_VALUES: readonly Stability[] = Object.freeze([
  'experimental',
  'stable',
  'deprecated',
]);

const LINK_KIND_VALUES: readonly LinkKind[] = Object.freeze([
  'invokes',
  'references',
  'mentions',
  'supersedes',
]);

const CONFIDENCE_VALUES: readonly Confidence[] = Object.freeze([
  'high',
  'medium',
  'low',
]);

const SEVERITY_VALUES: readonly Severity[] = Object.freeze([
  'error',
  'warn',
  'info',
]);

const EXECUTION_MODE_VALUES: readonly TExecutionMode[] = Object.freeze([
  'deterministic',
  'probabilistic',
]);

const EXECUTION_RUNNER_VALUES: readonly ExecutionRunner[] = Object.freeze([
  'cli',
  'skill',
  'in-process',
]);

const EXECUTION_STATUS_VALUES: readonly ExecutionStatus[] = Object.freeze([
  'completed',
  'failed',
  'cancelled',
]);

const EXECUTION_FAILURE_REASON_VALUES: readonly ExecutionFailureReason[] = Object.freeze([
  'runner-error',
  'report-invalid',
  'timeout',
  'abandoned',
  'job-file-missing',
  'user-cancelled',
]);

export function isStability(s: unknown): s is Stability {
  return typeof s === 'string' && (STABILITY_VALUES as readonly string[]).includes(s);
}

export function isLinkKind(s: unknown): s is LinkKind {
  return typeof s === 'string' && (LINK_KIND_VALUES as readonly string[]).includes(s);
}

export function isConfidence(s: unknown): s is Confidence {
  return typeof s === 'string' && (CONFIDENCE_VALUES as readonly string[]).includes(s);
}

export function isSeverity(s: unknown): s is Severity {
  return typeof s === 'string' && (SEVERITY_VALUES as readonly string[]).includes(s);
}

export function isExecutionMode(s: unknown): s is TExecutionMode {
  return typeof s === 'string' && (EXECUTION_MODE_VALUES as readonly string[]).includes(s);
}

export function isExecutionRunner(s: unknown): s is ExecutionRunner {
  return typeof s === 'string' && (EXECUTION_RUNNER_VALUES as readonly string[]).includes(s);
}

export function isExecutionStatus(s: unknown): s is ExecutionStatus {
  return typeof s === 'string' && (EXECUTION_STATUS_VALUES as readonly string[]).includes(s);
}

export function isExecutionFailureReason(s: unknown): s is ExecutionFailureReason {
  return typeof s === 'string' && (EXECUTION_FAILURE_REASON_VALUES as readonly string[]).includes(s);
}

export function parseStability(s: unknown, ctx: string): Stability {
  if (isStability(s)) return s;
  throw new Error(
    `Invalid Stability value ${formatValue(s)} at ${ctx}. Allowed: ${STABILITY_VALUES.join(' | ')}.`,
  );
}

export function parseLinkKind(s: unknown, ctx: string): LinkKind {
  if (isLinkKind(s)) return s;
  throw new Error(
    `Invalid LinkKind value ${formatValue(s)} at ${ctx}. Allowed: ${LINK_KIND_VALUES.join(' | ')}.`,
  );
}

export function parseConfidence(s: unknown, ctx: string): Confidence {
  if (isConfidence(s)) return s;
  throw new Error(
    `Invalid Confidence value ${formatValue(s)} at ${ctx}. Allowed: ${CONFIDENCE_VALUES.join(' | ')}.`,
  );
}

export function parseSeverity(s: unknown, ctx: string): Severity {
  if (isSeverity(s)) return s;
  throw new Error(
    `Invalid Severity value ${formatValue(s)} at ${ctx}. Allowed: ${SEVERITY_VALUES.join(' | ')}.`,
  );
}

export function parseExecutionRunner(s: unknown, ctx: string): ExecutionRunner {
  if (isExecutionRunner(s)) return s;
  throw new Error(
    `Invalid ExecutionRunner value ${formatValue(s)} at ${ctx}. Allowed: ${EXECUTION_RUNNER_VALUES.join(' | ')}.`,
  );
}

export function parseExecutionFailureReason(s: unknown, ctx: string): ExecutionFailureReason {
  if (isExecutionFailureReason(s)) return s;
  throw new Error(
    `Invalid ExecutionFailureReason value ${formatValue(s)} at ${ctx}. Allowed: ${EXECUTION_FAILURE_REASON_VALUES.join(' | ')}.`,
  );
}

function formatValue(s: unknown): string {
  if (typeof s === 'string') return JSON.stringify(s);
  if (s === null) return 'null';
  if (s === undefined) return 'undefined';
  return String(s);
}
