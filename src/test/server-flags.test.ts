/**
 * Flag-validation tests for the `sm serve` CLI verb (Step 14.1).
 *
 * These tests drive the verb through Clipanion's `Cli.run` so the flag
 * parsing + envelope + exit code mapping are exercised end-to-end —
 * exactly what `validateServerOptions` plus `ServeCommand.run` produce
 * when invoked from a real shell.
 *
 * For combinations that would actually bind a port (`--port 0`, etc.)
 * we reach for `--ui-dist <missing>` to short-circuit at the validation
 * layer — no listener is opened, so no cleanup is required.
 *
 * Boot-and-shut-down test for the legitimate path lives in
 * `server-boot.test.ts`; this file focuses on rejection.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Builtins, Cli } from 'clipanion';
import type { BaseContext } from 'clipanion';

import { ServeCommand } from '../cli/commands/serve.js';
import { ExitCode } from '../cli/util/exit-codes.js';

interface ICapture {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICapture {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const context = {
    stdin: process.stdin,
    stdout: { write: (s: string) => { stdoutChunks.push(s); return true; } },
    stderr: { write: (s: string) => { stderrChunks.push(s); return true; } },
  } as unknown as BaseContext;
  return {
    context,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
  };
}

function buildCli(): Cli {
  const cli = new Cli({ binaryName: 'sm', binaryLabel: 'skill-map', binaryVersion: '0.0.0' });
  cli.register(Builtins.HelpCommand);
  cli.register(ServeCommand);
  return cli;
}

let tmpRoot: string;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-server-flags-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('sm serve — flag validation', () => {
  it('rejects --host 0.0.0.0 + --dev-cors with exit 2 and a clear hint', async () => {
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(['serve', '--host', '0.0.0.0', '--dev-cors'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(
      cap.stderr(),
      /--dev-cors requires a loopback --host \(got 0\.0\.0\.0\)/,
      cap.stderr(),
    );
  });

  it('rejects --port 99999 (out of range) with exit 2', async () => {
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(['serve', '--port', '99999'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(cap.stderr(), /--port must be an integer in \[0, 65535\]/, cap.stderr());
  });

  it('rejects --port abc (non-numeric) with exit 2', async () => {
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(['serve', '--port', 'abc'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(cap.stderr(), /--port must be a non-negative integer/, cap.stderr());
  });

  it('rejects --scope nonsense with exit 2', async () => {
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(['serve', '--scope', 'nonsense'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(cap.stderr(), /--scope must be "project" or "global"/, cap.stderr());
  });

  it('rejects --ui-dist <missing> with exit 2 (explicit path requires existence)', async () => {
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(
      ['serve', '--ui-dist', join(tmpRoot, 'does-not-exist')],
      cap.context,
    );
    assert.equal(exit, ExitCode.Error);
    assert.match(cap.stderr(), /does not exist/, cap.stderr());
  });

  it('emits a non-fatal warning when --no-ui is combined with the default --open', async () => {
    // Combining --no-ui with the default --open auto-opens the placeholder,
    // which is almost certainly not what the operator intended. The verb
    // emits a stderr hint suggesting --no-open but does NOT reject — the
    // request is honored. To avoid binding a real listener, we pair the
    // combo with a bailout (--host 0.0.0.0 + --dev-cors) that fails at
    // the post-warning validation step. Both messages should appear in
    // stderr; the warning fires BEFORE the rejection.
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(
      ['serve', '--no-ui', '--host', '0.0.0.0', '--dev-cors'],
      cap.context,
    );
    assert.equal(exit, ExitCode.Error);
    const stderr = cap.stderr();
    assert.match(
      stderr,
      /warning: --open with --no-ui will open the placeholder/,
      stderr,
    );
    // The bailout that drove the exit code:
    assert.match(stderr, /--dev-cors requires a loopback --host/, stderr);
    // Ordering invariant: warning appears before the rejection.
    const warnIdx = stderr.indexOf('warning: --open with --no-ui');
    const errIdx = stderr.indexOf('--dev-cors requires');
    assert.ok(warnIdx >= 0 && errIdx >= 0 && warnIdx < errIdx, stderr);
  });

  it('does NOT emit the --no-ui/--open warning when --no-open is set explicitly', async () => {
    // Counterpart to the warning test: a deliberate --no-open should
    // never trigger the hint. Use the same dev-cors bailout to avoid
    // binding.
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(
      ['serve', '--no-ui', '--no-open', '--host', '0.0.0.0', '--dev-cors'],
      cap.context,
    );
    assert.equal(exit, ExitCode.Error);
    assert.doesNotMatch(
      cap.stderr(),
      /warning: --open with --no-ui/,
      cap.stderr(),
    );
  });

  it('rejects --no-ui combined with --ui-dist <path> with exit 2', async () => {
    const distDir = join(tmpRoot, 'ui-bundle-conflict');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><html></html>');

    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(
      ['serve', '--no-ui', '--ui-dist', distDir],
      cap.context,
    );
    assert.equal(exit, ExitCode.Error);
    assert.match(
      cap.stderr(),
      /--no-ui and --ui-dist .* are mutually exclusive/,
      cap.stderr(),
    );
  });

  it('accepts --ui-dist when the directory contains index.html', async () => {
    // Build a minimal valid bundle so the validator + UI-dist resolver
    // both clear; we then immediately rely on flag-validation rejecting
    // an invalid combination so we never actually bind a listener.
    const distDir = join(tmpRoot, 'ui-bundle');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><html></html>');

    // Re-trigger a known-bad-combo (`--dev-cors` + `--host 0.0.0.0`)
    // AFTER the ui-dist check passes, proving the verb walked through
    // the bundle resolution without erroring there.
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(
      ['serve', '--ui-dist', distDir, '--host', '0.0.0.0', '--dev-cors'],
      cap.context,
    );
    assert.equal(exit, ExitCode.Error);
    assert.match(cap.stderr(), /--dev-cors requires a loopback --host/, cap.stderr());
  });
});
