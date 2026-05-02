/**
 * Coverage for `kernel/jobs/orphan-files:findOrphanJobFiles`. Pairs
 * with `kernel/adapters/sqlite/jobs:selectReferencedJobFilePaths` —
 * the SQLite helper returns the set of `state_jobs.filePath` values;
 * this helper walks the directory and computes the set difference.
 *
 * Behaviour pinned by these tests:
 *   - Shallow walk (no recursion into subdirectories).
 *   - Only `*.md` entries considered.
 *   - Symlinks are not followed (covered indirectly by the directory
 *     guard).
 *   - Missing or non-directory `jobsDir` → empty result, not a throw.
 *   - Result paths are absolute and sorted.
 *   - `referencedCount` echoes the input set size for the JSON output.
 */

import { strict as assert } from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { findOrphanJobFiles } from '../kernel/jobs/orphan-files.js';

let tempRoot: string;

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'skill-map-orphan-files-'));
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function makeJobsDir(name: string): string {
  const dir = join(tempRoot, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function touch(dir: string, name: string, contents = ''): string {
  const abs = resolve(join(dir, name));
  writeFileSync(abs, contents);
  return abs;
}

describe('findOrphanJobFiles', () => {
  it('returns empty list when jobsDir does not exist', () => {
    const r = findOrphanJobFiles(join(tempRoot, 'never-created'), new Set(['/anywhere/a.md']));
    assert.deepEqual(r.orphanFilePaths, []);
    assert.equal(r.referencedCount, 1);
  });

  it('returns empty list when jobsDir is a file, not a directory', () => {
    const dir = makeJobsDir('file-not-dir-parent');
    const filePath = touch(dir, 'pretending-to-be-jobs-dir.md');
    const r = findOrphanJobFiles(filePath, new Set());
    assert.deepEqual(r.orphanFilePaths, []);
    assert.equal(r.referencedCount, 0);
  });

  it('returns empty list when jobsDir is empty', () => {
    const dir = makeJobsDir('empty-dir');
    const r = findOrphanJobFiles(dir, new Set());
    assert.deepEqual(r.orphanFilePaths, []);
    assert.equal(r.referencedCount, 0);
  });

  it('returns empty list when every .md file is referenced', () => {
    const dir = makeJobsDir('all-referenced');
    const a = touch(dir, 'd-20260501-100000-aaaa.md');
    const b = touch(dir, 'd-20260501-110000-bbbb.md');
    const r = findOrphanJobFiles(dir, new Set([a, b]));
    assert.deepEqual(r.orphanFilePaths, []);
    assert.equal(r.referencedCount, 2);
  });

  it('returns every .md when none are referenced', () => {
    const dir = makeJobsDir('all-orphan');
    const a = touch(dir, 'd-20260501-100000-aaaa.md');
    const b = touch(dir, 'd-20260501-110000-bbbb.md');
    const r = findOrphanJobFiles(dir, new Set());
    assert.deepEqual(r.orphanFilePaths.sort(), [a, b].sort());
    assert.equal(r.referencedCount, 0);
  });

  it('returns only the orphans when input is mixed', () => {
    const dir = makeJobsDir('mixed');
    const ref = touch(dir, 'd-20260501-100000-aaaa.md');
    const orphanA = touch(dir, 'd-20260501-110000-bbbb.md');
    const orphanB = touch(dir, 'd-20260501-120000-cccc.md');
    const r = findOrphanJobFiles(dir, new Set([ref]));
    assert.deepEqual(r.orphanFilePaths, [orphanA, orphanB].sort());
    assert.equal(r.referencedCount, 1);
  });

  it('ignores non-.md files (txt / json / no extension)', () => {
    const dir = makeJobsDir('non-md');
    touch(dir, 'note.txt');
    touch(dir, 'report.json');
    touch(dir, 'README');
    const orphan = touch(dir, 'd-20260501-100000-aaaa.md');
    const r = findOrphanJobFiles(dir, new Set());
    assert.deepEqual(r.orphanFilePaths, [orphan]);
    assert.equal(r.referencedCount, 0);
  });

  it('does not recurse into subdirectories (shallow walk)', () => {
    const dir = makeJobsDir('with-subdir');
    const top = touch(dir, 'd-20260501-100000-aaaa.md');
    const subdir = join(dir, 'archive');
    mkdirSync(subdir, { recursive: true });
    touch(subdir, 'd-20260101-000000-zzzz.md');
    const r = findOrphanJobFiles(dir, new Set());
    assert.deepEqual(r.orphanFilePaths, [top]);
    assert.equal(r.referencedCount, 0);
  });

  it('returns paths sorted alphabetically (deterministic output)', () => {
    const dir = makeJobsDir('sort-check');
    // Create out of order to make sure the result ordering is by sort, not by readdir.
    const c = touch(dir, 'd-20260501-300000-cccc.md');
    const a = touch(dir, 'd-20260501-100000-aaaa.md');
    const b = touch(dir, 'd-20260501-200000-bbbb.md');
    const r = findOrphanJobFiles(dir, new Set());
    assert.deepEqual(r.orphanFilePaths, [a, b, c]);
    assert.equal(r.referencedCount, 0);
  });
});
