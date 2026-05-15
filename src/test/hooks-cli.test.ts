/**
 * Step 9.6.4 — `sm hooks install pre-commit-bump` CLI verb tests.
 *
 * Exercises the install / chain / idempotent-reinstall / dry-run /
 * not-in-repo branches against real `.git/` directories created with
 * `mkdirSync` (no shell out — we just need the directory to exist for
 * `findGitRepoRoot` to return). Per AGENTS.md tests use `.tmp/`-rooted
 * scratch dirs.
 */

import { describe, it,beforeAll as before,afterAll as after} from 'bun:test';
import { ok, strictEqual } from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import type { BaseContext } from 'clipanion';

import { HooksInstallCommand } from '../cli/commands/hooks.js';

let tmpRoot: string;
let counter = 0;
const originalCwd = process.cwd();

function freshFixture(label: string): string {
  counter += 1;
  return mkdtempSync(join(tmpRoot, `${label}-${counter}-`));
}

before(() => {
  const projectTmp = resolve(originalCwd, '.tmp');
  mkdirSync(projectTmp, { recursive: true });
  tmpRoot = mkdtempSync(join(projectTmp, 'hooks-cli-'));
});

after(() => {
  process.chdir(originalCwd);
  rmSync(tmpRoot, { recursive: true, force: true });
});

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

function makeCmd(): HooksInstallCommand {
  const cmd = new HooksInstallCommand();
  cmd.global = false;
  cmd.json = false;
  cmd.quiet = true;
  cmd.noColor = true;
  cmd.verbose = 0;
  cmd.flavour = 'pre-commit-bump';
  cmd.dryRun = false;
  return cmd;
}

describe('sm hooks install pre-commit-bump', () => {
  it('writes a fresh hook when none exists', async () => {
    const fixture = freshFixture('fresh');
    mkdirSync(join(fixture, '.git', 'hooks'), { recursive: true });
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeCmd();
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);

    const hookPath = join(fixture, '.git/hooks/pre-commit');
    ok(existsSync(hookPath));
    const body = readFileSync(hookPath, 'utf8');
    ok(body.startsWith('#!/usr/bin/env bash'), 'has bash shebang');
    ok(body.includes('sm bump --pending --staged'), 'invokes the batch verb');
    ok(body.includes('skill-map pre-commit-bump'), 'carries the marker');
  });

  it('chains into an existing hook (preserves user content)', async () => {
    const fixture = freshFixture('chain');
    mkdirSync(join(fixture, '.git', 'hooks'), { recursive: true });
    const hookPath = join(fixture, '.git/hooks/pre-commit');
    writeFileSync(hookPath, '#!/usr/bin/env bash\nuser-script.sh\n');
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeCmd();
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);

    const body = readFileSync(hookPath, 'utf8');
    ok(body.includes('user-script.sh'), 'user content survives');
    ok(body.includes('sm bump --pending --staged'), 'block appended');
  });

  it('idempotent: re-install detects the marker and no-ops', async () => {
    const fixture = freshFixture('idem');
    mkdirSync(join(fixture, '.git', 'hooks'), { recursive: true });
    process.chdir(fixture);

    const first = captureContext();
    const c1 = makeCmd(); c1.context = first.context;
    strictEqual(await c1.execute(), 0);
    const after1 = readFileSync(join(fixture, '.git/hooks/pre-commit'), 'utf8');

    const second = captureContext();
    const c2 = makeCmd(); c2.context = second.context;
    strictEqual(await c2.execute(), 0);
    const after2 = readFileSync(join(fixture, '.git/hooks/pre-commit'), 'utf8');
    strictEqual(after1, after2, 'file content unchanged on re-install');
  });

  it('--dry-run prints planned content without writing', async () => {
    const fixture = freshFixture('dry');
    mkdirSync(join(fixture, '.git'), { recursive: true });
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeCmd();
    cmd.dryRun = true; cmd.quiet = false;
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);

    ok(!existsSync(join(fixture, '.git/hooks/pre-commit')), 'no file written');
    const out = cap.stdout();
    ok(out.includes('--- target:'), 'has target marker');
    ok(out.includes('--- end ---'), 'has end marker');
    ok(out.includes('sm bump --pending --staged'), 'shows the planned body');
  });

  // The `not in a git repo → exit 5` branch is not exercised here:
  // `.tmp/` lives inside the project, which is itself a git repo, so
  // the upward walk always finds a `.git/`. The branch is covered by
  // the explicit `findGitRepoRoot` logic (returns null only when the
  // walk hits `dirname(p) === p`).

  it('unknown flavour → exit 2', async () => {
    const fixture = freshFixture('flavour');
    mkdirSync(join(fixture, '.git', 'hooks'), { recursive: true });
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeCmd();
    cmd.flavour = 'post-commit-something';
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 2);
  });
});
