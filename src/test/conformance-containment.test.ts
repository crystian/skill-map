/**
 * Audit M4 — conformance runner rejects case-supplied paths that
 * escape their anchored root. Two surfaces:
 *
 *   1. `case.fixture` flows through `replaceFixture(scope, fixturesRoot,
 *      ...)`. An escape (`../`, absolute) must throw before the malicious
 *      `cpSync` runs.
 *   2. Assertion `path` (file-exists, file-contains-verbatim) and
 *      `fixture` (file-contains-verbatim) flow through `assertContained`
 *      inside the per-assertion evaluator. An escape produces `ok:false`,
 *      not a throw, so the runner can keep evaluating siblings.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { runConformanceCase } from '../conformance/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = resolve(HERE, '..');
const REPO_ROOT = resolve(WORKSPACE, '..');
const SPEC_ROOT = resolve(REPO_ROOT, 'spec');
const BIN = resolve(WORKSPACE, 'bin', 'sm.js');

let root: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'sm-conformance-m4-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeCase(name: string, body: unknown): { casePath: string; fixturesRoot: string } {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const cases = join(dir, 'cases');
  const fixtures = join(dir, 'fixtures');
  mkdirSync(cases, { recursive: true });
  mkdirSync(fixtures, { recursive: true });
  // Provide a benign fixture the runner can copy in green-path tests.
  mkdirSync(join(fixtures, 'ok'), { recursive: true });
  writeFileSync(join(fixtures, 'ok', 'noop.md'), '# noop\n');
  const casePath = join(cases, `${name}.json`);
  writeFileSync(casePath, JSON.stringify(body));
  return { casePath, fixturesRoot: fixtures };
}

describe('conformance runner — fixture path containment (audit M4)', () => {
  it('throws when case.fixture escapes fixturesRoot via ..', () => {
    const { casePath, fixturesRoot } = writeCase('fixture-escape', {
      id: 'fixture-escape',
      fixture: '../../etc',
      invoke: { verb: 'version' },
      assertions: [{ type: 'exit-code', value: 0 }],
    });
    assert.throws(
      () =>
        runConformanceCase({
          binary: BIN,
          specRoot: SPEC_ROOT,
          casePath,
          fixturesRoot,
        }),
      /escapes its anchor|fixture path/,
    );
  });

  it('throws when case.fixture is absolute', () => {
    const { casePath, fixturesRoot } = writeCase('fixture-abs', {
      id: 'fixture-abs',
      fixture: '/etc',
      invoke: { verb: 'version' },
      assertions: [{ type: 'exit-code', value: 0 }],
    });
    assert.throws(
      () =>
        runConformanceCase({
          binary: BIN,
          specRoot: SPEC_ROOT,
          casePath,
          fixturesRoot,
        }),
      /must be relative to its anchor|fixture path/,
    );
  });
});

describe('conformance runner — assertion path containment (audit M4)', () => {
  it('file-exists with an escaping path returns ok:false instead of leaking existence', () => {
    const { casePath, fixturesRoot } = writeCase('assertion-escape', {
      id: 'assertion-escape',
      fixture: 'ok',
      invoke: { verb: 'version' },
      assertions: [
        { type: 'exit-code', value: 0 },
        { type: 'file-exists', path: '../../etc/passwd' },
      ],
    });
    const result = runConformanceCase({
      binary: BIN,
      specRoot: SPEC_ROOT,
      casePath,
      fixturesRoot,
    });
    assert.equal(result.assertions.length, 2);
    const fileExists = result.assertions.find((a) => a.type === 'file-exists')!;
    assert.equal(fileExists.ok, false);
    if (!fileExists.ok) {
      assert.match(fileExists.reason, /escapes its anchor|file-exists/);
    }
    // Other assertions still evaluate independently.
    const exitOk = result.assertions.find((a) => a.type === 'exit-code')!;
    assert.equal(exitOk.ok, true);
  });
});
