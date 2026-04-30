import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';

import { runConformanceCase } from '../conformance/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = resolve(HERE, '..');
const REPO_ROOT = resolve(WORKSPACE, '..');
const SPEC_ROOT = resolve(REPO_ROOT, 'spec');
const BIN = resolve(WORKSPACE, 'bin', 'sm.mjs');

const SPEC_CASES_DIR = resolve(SPEC_ROOT, 'conformance', 'cases');
const SPEC_FIXTURES_DIR = resolve(SPEC_ROOT, 'conformance', 'fixtures');

const CLAUDE_CONFORMANCE_DIR = resolve(
  WORKSPACE,
  'extensions',
  'providers',
  'claude',
  'conformance',
);
const CLAUDE_CASES_DIR = resolve(CLAUDE_CONFORMANCE_DIR, 'cases');
const CLAUDE_FIXTURES_DIR = resolve(CLAUDE_CONFORMANCE_DIR, 'fixtures');

/**
 * Step 0b reference subset, post-A.13 split:
 *
 *   - `kernel-empty-boot` is kernel-agnostic and stays in `spec/`.
 *   - `rename-high` and `orphan-detection` exercise the Claude Provider's
 *     kind catalog (`skill`) and now live with the Provider at
 *     `src/extensions/providers/claude/conformance/`.
 *
 * The runner is the same; only the case + fixtures roots change. This
 * test composes both into a single suite so CI exercises spec + Provider
 * conformance in one go (same as what `sm conformance run --scope all`
 * delivers to external consumers).
 */
const SPEC_CASES = ['kernel-empty-boot'] as const;
const PROVIDER_CLAUDE_CASES = ['rename-high', 'orphan-detection'] as const;

describe('conformance suite (Step 0b subset)', () => {
  for (const caseId of SPEC_CASES) {
    it(`spec case ${caseId} passes`, () => {
      const result = runConformanceCase({
        binary: BIN,
        specRoot: SPEC_ROOT,
        casePath: resolve(SPEC_CASES_DIR, `${caseId}.json`),
        fixturesRoot: SPEC_FIXTURES_DIR,
      });
      const failures = result.assertions.filter(
        (a): a is Extract<typeof a, { ok: false }> => !a.ok,
      );
      const summary = failures.length
        ? failures.map((f) => `  - [${f.type}] ${f.reason}`).join('\n')
        : '';
      assert.ok(
        result.passed,
        `spec case ${caseId} failed\n${summary}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
      );
    });
  }

  for (const caseId of PROVIDER_CLAUDE_CASES) {
    it(`provider:claude case ${caseId} passes`, () => {
      const result = runConformanceCase({
        binary: BIN,
        specRoot: SPEC_ROOT,
        casePath: resolve(CLAUDE_CASES_DIR, `${caseId}.json`),
        fixturesRoot: CLAUDE_FIXTURES_DIR,
      });
      const failures = result.assertions.filter(
        (a): a is Extract<typeof a, { ok: false }> => !a.ok,
      );
      const summary = failures.length
        ? failures.map((f) => `  - [${f.type}] ${f.reason}`).join('\n')
        : '';
      assert.ok(
        result.passed,
        `provider:claude case ${caseId} failed\n${summary}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
      );
    });
  }
});
