/**
 * `sm guide` end-to-end through the real binary. Each test isolates
 * cwd so the host's working directory is never touched.
 *
 * Spec contract under test (spec/cli-contract.md § `sm guide`):
 *
 *   - `sm guide`            → writes <cwd>/sm-guide.md, exit 0.
 *   - `sm guide` (clobber)  → exits 2, does NOT overwrite.
 *   - `sm guide --force`    → overwrites existing file, exit 0.
 *   - Content matches the canonical SKILL.md byte-for-byte.
 *   - No `.skill-map/` is required (verb runs in a virgin dir).
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', 'bin', 'sm.js');

// Repo root → .claude/skills/sm-guide/SKILL.md is the source of truth
// the verb materializes. From src/test/ that's three levels up.
const SKILL_SOURCE = resolve(HERE, '..', '..', '.claude', 'skills', 'sm-guide', 'SKILL.md');

let root: string;
let counter = 0;

interface IScope {
  cwd: string;
}

function freshScope(label: string): IScope {
  counter += 1;
  const cwd = join(root, `${label}-${counter}`);
  mkdirSync(cwd, { recursive: true });
  return { cwd };
}

function sm(
  args: string[],
  scope: IScope,
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: scope.cwd,
    env: { ...process.env },
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-guide-'));
  // Sanity: the source file must exist for these tests to be meaningful.
  // If it does not, the verb's bundled-loader fallback would still
  // resolve it from dist/ — but the byte-for-byte assertion below
  // would lose its anchor, so fail fast here instead.
  assert.ok(existsSync(SKILL_SOURCE), `SKILL.md source missing at ${SKILL_SOURCE}`);
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sm guide — happy path', () => {
  it('writes sm-guide.md in cwd with exit 0 and a Spanish success line', () => {
    const scope = freshScope('basic');
    const r = sm(['guide'], scope);

    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const target = join(scope.cwd, 'sm-guide.md');
    assert.ok(existsSync(target), 'sm-guide.md must be written');

    // Spec-mandated success message contents.
    assert.match(r.stdout, /sm-guide\.md creado en/);
    assert.match(r.stdout, /Abrí Claude Code/);
    assert.match(r.stdout, /guíame/);
  });

  it('content matches the canonical SKILL.md byte-for-byte', () => {
    const scope = freshScope('byte-match');
    const r = sm(['guide'], scope);
    assert.equal(r.status, 0);

    const written = readFileSync(join(scope.cwd, 'sm-guide.md'));
    const source = readFileSync(SKILL_SOURCE);
    assert.deepEqual(
      written,
      source,
      'sm-guide.md content must match .claude/skills/sm-guide/SKILL.md byte-for-byte',
    );
  });

  it('runs in a virgin directory (no .skill-map/ required)', () => {
    const scope = freshScope('virgin');
    // Sanity: confirm there's no .skill-map/ in the scope.
    assert.equal(existsSync(join(scope.cwd, '.skill-map')), false);

    const r = sm(['guide'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(existsSync(join(scope.cwd, 'sm-guide.md')));
    // And still no .skill-map/ — the verb must not bootstrap one.
    assert.equal(existsSync(join(scope.cwd, '.skill-map')), false);
  });

  it('writes to top-level (no subdirectory)', () => {
    const scope = freshScope('top-level');
    const r = sm(['guide'], scope);
    assert.equal(r.status, 0);

    // No subdirectory, single file at the top.
    assert.ok(existsSync(join(scope.cwd, 'sm-guide.md')));
    assert.equal(existsSync(join(scope.cwd, 'sm-guide')), false);
    assert.equal(existsSync(join(scope.cwd, '.sm-guide')), false);
  });
});

describe('sm guide — clobber protection', () => {
  it('exits 2 when sm-guide.md already exists and --force is not passed', () => {
    const scope = freshScope('clobber-blocked');
    const target = join(scope.cwd, 'sm-guide.md');
    const sentinel = '# pre-existing content — must NOT be overwritten\n';
    writeFileSync(target, sentinel);

    const r = sm(['guide'], scope);

    assert.equal(r.status, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /ya existe/);
    assert.match(r.stderr, /--force/);

    // File untouched.
    assert.equal(readFileSync(target, 'utf8'), sentinel);
  });

  it('--force overwrites an existing file and exits 0', () => {
    const scope = freshScope('clobber-force');
    const target = join(scope.cwd, 'sm-guide.md');
    writeFileSync(target, '# stale content\n');

    const r = sm(['guide', '--force'], scope);

    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const written = readFileSync(target);
    const source = readFileSync(SKILL_SOURCE);
    assert.deepEqual(written, source, 'after --force, content must match SKILL.md');
  });
});
