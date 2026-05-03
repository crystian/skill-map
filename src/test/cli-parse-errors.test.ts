/**
 * Verifies the entry-level parse-error handler that replaces Clipanion's
 * default full-catalog dump with a concise one-screen diagnostic.
 *
 * Coverage:
 *   - exit code is `2` (operational error per spec/cli-contract.md)
 *   - diagnostic goes to stderr, NOT stdout (Clipanion's default leaks
 *     errors to stdout, which breaks `sm <verb> | jq` pipelines)
 *   - single-dash long flag → `--` suggestion (`-version` → `--version`)
 *   - typo on a known verb → edit-distance suggestion (`sacn` → `scan`)
 *   - unknown flag on a known verb → message scoped to the verb
 *   - incomplete namespace (`sm db`) → list of subcommands
 *   - happy paths (`--version`, `-v`, `help`) still work
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', 'bin', 'sm.js');

interface IRun {
  status: number;
  stdout: string;
  stderr: string;
}

function sm(args: string[]): IRun {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('CLI parse-error handler', () => {
  it('rejects single-dash long option with --version suggestion', () => {
    const r = sm(['-version']);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /unknown option '-version'/);
    assert.match(r.stderr, /Did you mean '--version'\?/);
    assert.match(r.stderr, /Run 'sm help'/);
  });

  it('rejects single-dash -help with --help suggestion', () => {
    const r = sm(['-help']);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /unknown option '-help'/);
    assert.match(r.stderr, /Did you mean '--help'\?/);
  });

  it('caps the diagnostic to a few lines (no full-catalog dump)', () => {
    const r = sm(['-version']);
    const lines = r.stderr.trim().split('\n');
    assert.ok(lines.length <= 5, `expected at most 5 stderr lines, got ${lines.length}: ${r.stderr}`);
  });

  it('suggests the closest verb on a typo', () => {
    const r = sm(['sacn']);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /unknown command 'sacn'/);
    assert.match(r.stderr, /Did you mean 'scan'/);
  });

  it('emits no suggestion when no verb is close enough', () => {
    const r = sm(['fooooo']);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /unknown command 'fooooo'/);
    assert.doesNotMatch(r.stderr, /Did you mean/);
    assert.match(r.stderr, /Run 'sm help'/);
  });

  it('scopes the diagnostic to the verb when the verb is valid but the flag is not', () => {
    const r = sm(['scan', '--definitely-not-a-flag']);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /scan: unknown option '--definitely-not-a-flag'/);
  });

  it('rewrites Clipanion\'s "Not enough positional arguments" with the missing positional names', () => {
    // `sm show` requires <nodePath>; running it bare should surface the
    // missing positional name explicitly, not just the cryptic
    // "Not enough positional arguments" which leaves users guessing.
    const r = sm(['show']);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /show: missing required positional argument\(s\) <nodePath>/);
    assert.match(r.stderr, /Run 'sm help show' for usage/);
    // The redundant Clipanion usage hint line ("$ sm show [...]") must
    // be stripped — `sm help show` is the single point of truth.
    assert.doesNotMatch(r.stderr, /\$ sm show \[/);
  });

  it('lists subcommands on an incomplete namespace invocation', () => {
    const r = sm(['db']);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /incomplete command 'db'/);
    assert.match(r.stderr, /Available subcommands: 'db backup'/);
  });

  it('still serves --version (Clipanion built-in)', () => {
    const r = sm(['--version']);
    assert.equal(r.status, 0);
    assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
  });

  it('still serves -v (Clipanion built-in short form)', () => {
    const r = sm(['-v']);
    assert.equal(r.status, 0);
    assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
  });
});
