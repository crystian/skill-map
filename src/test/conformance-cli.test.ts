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
import { match, strictEqual } from 'node:assert/strict';

import type { BaseContext } from 'clipanion';

import { ConformanceRunCommand } from '../cli/commands/conformance.js';

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
