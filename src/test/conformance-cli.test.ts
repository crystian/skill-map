/**
 * Phase 5 / A.13 — `sm conformance run` verb.
 *
 * Acceptance tests for the new CLI verb. The verb dispatches to a child
 * `sm` process per case, so end-to-end runs are slower than other unit
 * tests; we keep the fixture surface small (one targeted scope at a
 * time) and rely on the in-process suite at `conformance.test.ts` to
 * cover the underlying runner mechanics.
 *
 * Cases covered:
 *
 *   (a) `sm conformance run --scope spec` exits 0 — the spec scope
 *       contains only `kernel-empty-boot`, which is universal. Exercises
 *       the happy path: scope selection, case enumeration, summary
 *       output.
 *
 *   (b) `sm conformance run --scope <bogus>` exits 2 with a directed
 *       stderr message naming the available scopes. Exercises the
 *       unknown-scope guard rail.
 *
 * The `--scope all` and `--scope provider:claude` paths are exercised
 * at full breadth by the in-process `conformance.test.ts` suite which
 * runs every spec + Claude case directly through the runner.
 */

import { describe, it } from 'node:test';
import { match, ok, strictEqual } from 'node:assert/strict';

import type { BaseContext } from 'clipanion';

import {
  ConformanceRunCommand,
  formatAssertionFailureDetail,
} from '../cli/commands/conformance.js';

interface ICapturedContext {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICapturedContext {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const context = {
    stdout: { write: (s: string) => { stdoutChunks.push(s); return true; } },
    stderr: { write: (s: string) => { stderrChunks.push(s); return true; } },
  } as unknown as BaseContext;
  return {
    context,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
  };
}

describe('sm conformance run', () => {
  it('runs the spec scope cleanly', async () => {
    const cap = captureContext();
    const cmd = new ConformanceRunCommand();
    cmd.scope = 'spec';
    Object.defineProperty(cmd, 'context', { value: cap.context });

    const exit = await cmd.execute();
    strictEqual(exit, 0, `expected exit 0, got ${exit}\n--- stdout ---\n${cap.stdout()}\n--- stderr ---\n${cap.stderr()}`);
    // Header for the spec scope is emitted to stdout.
    match(cap.stdout(), /Running conformance scope spec/);
    // The spec scope ships at least the kernel-empty-boot case.
    match(cap.stdout(), /ok\s+kernel-empty-boot/);
    // The grand total references at least one scope.
    match(cap.stdout(), /sm conformance: \d+\/\d+ passed across 1 scope/);
  });

  it('rejects an unknown scope with a directed error', async () => {
    const cap = captureContext();
    const cmd = new ConformanceRunCommand();
    cmd.scope = 'bogus-scope';
    Object.defineProperty(cmd, 'context', { value: cap.context });

    const exit = await cmd.execute();
    strictEqual(exit, 2, `expected exit 2, got ${exit}`);
    match(cap.stderr(), /unknown --scope 'bogus-scope'/);
    match(cap.stderr(), /Available: spec/);
  });
});

// Audit M1 — assertion `reason` strings flow from the conformance
// runner; some variants splice the impl-under-test's stderr verbatim
// (`runtime-error` carries subprocess output) — a runaway or hostile
// impl could emit kilobytes that drown the user's terminal AND embed
// ANSI escapes that repaint it. The CLI must sanitize + cap (1000
// chars) before printing. Driving the full runner just to provoke a
// hostile reason would require a contrived failing case + bespoke
// fixture; instead the formatter is exposed as
// `formatAssertionFailureDetail` and unit-tested directly. The
// production call site uses the same helper, so the behavioural
// contract stays pinned.
describe('formatAssertionFailureDetail — audit M1 sanitization + length cap', () => {
  it('strips C0 escapes from the reason', () => {
    const out = formatAssertionFailureDetail('exit-code', 'expected 0 got 1\x1b[2J\x1b[H');
    ok(!out.includes('\x1b'), `expected no ESC byte; got ${JSON.stringify(out)}`);
    ok(out.includes('expected 0 got 1'));
    ok(out.includes('exit-code'));
  });

  it('caps an oversized reason — bounded total output length', () => {
    const oversize = 'x'.repeat(5000);
    const out = formatAssertionFailureDetail('runtime-error', oversize);
    // Cap is 1000 chars on the reason interpolation; the surrounding
    // template adds a fixed tail. Bound a few hundred chars above 1000
    // so we pin the cap policy without coupling to template byte
    // counts.
    ok(out.length < 1500, `expected capped output length, got ${out.length}`);
    // Sanity: the original 5000-char tail must not round-trip — the
    // helper's `truncateHead` cuts and replaces the overflow with an
    // ellipsis.
    ok(!out.includes('x'.repeat(2000)), 'oversize payload was cut');
  });

  it('combined: oversized reason WITH C0 escapes — both gates fire', () => {
    // The cap applies to the raw reason BEFORE sanitization; even so,
    // any ESC byte that survives the cut must still be stripped. This
    // pins both halves of the gate at once.
    const reason = '\x1b[31m' + 'y'.repeat(5000) + '\x1b[0m';
    const out = formatAssertionFailureDetail('runtime-error', reason);
    ok(!out.includes('\x1b'));
    ok(out.length < 1500);
  });
});
