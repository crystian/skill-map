/**
 * Audit L4 — `cli/util/option-validators.ts`. The helper consolidates
 * the three near-duplicate "must be a positive integer" checks that
 * lived inline in `sm list` (`--limit`) and `sm history` (`--limit`,
 * `--top`). Behaviour pinned here so a future loosening of
 * `Number.parseInt`'s permissiveness (which accepts `'12abc'` as `12`)
 * cannot regress silently.
 *
 * The helper writes the rejection line to a caller-supplied `stderr`
 * stream and returns `null`; callers short-circuit to `ExitCode.Error`.
 * Tests capture stderr by passing a `{ write: (s) => true }` shim — the
 * same lightweight pattern every other CLI test uses to inspect output.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { parsePositiveIntegerOption } from '../cli/util/option-validators.js';

interface ICapturedStderr {
  stderr: NodeJS.WritableStream;
  read: () => string;
}

function captureStderr(): ICapturedStderr {
  const chunks: string[] = [];
  const stderr = {
    write: (s: string) => {
      chunks.push(s);
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  return { stderr, read: () => chunks.join('') };
}

describe('parsePositiveIntegerOption', () => {
  it('returns the parsed integer for a valid positive string', () => {
    const cap = captureStderr();
    const out = parsePositiveIntegerOption('5', '--limit', cap.stderr);
    assert.equal(out, 5);
    assert.equal(cap.read(), '', 'no stderr write on the happy path');
  });

  it('returns the parsed integer for "1" (lower boundary)', () => {
    const cap = captureStderr();
    const out = parsePositiveIntegerOption('1', '--limit', cap.stderr);
    assert.equal(out, 1);
    assert.equal(cap.read(), '');
  });

  it('accepts whitespace-padded input (helper trims for symmetry with pre-consolidation behaviour)', () => {
    // The helper docstring lists `'  100  '` as accepted — the
    // pre-consolidation inline validators trimmed and so does the
    // shared one. Pin that contract so a refactor toward "no trim"
    // surfaces here.
    const cap = captureStderr();
    const out = parsePositiveIntegerOption('  100  ', '--limit', cap.stderr);
    assert.equal(out, 100);
    assert.equal(cap.read(), '');
  });

  it('rejects an empty string with a stderr message naming the label', () => {
    const cap = captureStderr();
    const out = parsePositiveIntegerOption('', '--limit', cap.stderr);
    assert.equal(out, null);
    assert.match(cap.read(), /--limit/);
    assert.match(cap.read(), /positive integer/);
  });

  it('rejects non-numeric input ("abc")', () => {
    const cap = captureStderr();
    const out = parsePositiveIntegerOption('abc', '--top', cap.stderr);
    assert.equal(out, null);
    assert.match(cap.read(), /--top/);
    assert.match(cap.read(), /"abc"/);
  });

  it('rejects "0" (zero is not positive)', () => {
    const cap = captureStderr();
    const out = parsePositiveIntegerOption('0', '--limit', cap.stderr);
    assert.equal(out, null);
    assert.match(cap.read(), /--limit/);
    assert.match(cap.read(), /"0"/);
  });

  it('rejects a negative integer ("-3")', () => {
    const cap = captureStderr();
    const out = parsePositiveIntegerOption('-3', '--limit', cap.stderr);
    assert.equal(out, null);
    assert.match(cap.read(), /--limit/);
    assert.match(cap.read(), /"-3"/);
  });

  it('rejects a float ("1.5")', () => {
    const cap = captureStderr();
    const out = parsePositiveIntegerOption('1.5', '--limit', cap.stderr);
    assert.equal(out, null);
    assert.match(cap.read(), /--limit/);
    assert.match(cap.read(), /"1\.5"/);
  });

  it('rejects "12abc" (parseInt would accept the leading digits — guard against that)', () => {
    // The helper docstring calls this out explicitly: a permissive
    // `Number.parseInt('12abc')` returns `12` and would silently let
    // garbled input through. The trailing-garbage check via
    // `String(parsed) !== trimmed` catches it.
    const cap = captureStderr();
    const out = parsePositiveIntegerOption('12abc', '--limit', cap.stderr);
    assert.equal(out, null);
    assert.match(cap.read(), /--limit/);
    assert.match(cap.read(), /"12abc"/);
  });

  it('the stderr message includes the `label` argument verbatim so the user sees which flag failed', () => {
    const cap = captureStderr();
    parsePositiveIntegerOption('not-int', '--my-bespoke-flag', cap.stderr);
    assert.match(cap.read(), /--my-bespoke-flag/);
  });
});
