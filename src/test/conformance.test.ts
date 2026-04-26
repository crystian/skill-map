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

/**
 * Cases the Step 0b reference implementation is expected to satisfy.
 * The rest of the suite (e.g. `basic-scan`, `preamble-bitwise-match`) lands
 * when the features they depend on are implemented.
 */
const STEP_0B_CASES = [
  'kernel-empty-boot',
  'rename-high',
  'orphan-detection',
] as const;

describe('conformance suite (Step 0b subset)', () => {
  for (const caseId of STEP_0B_CASES) {
    it(`case ${caseId} passes`, () => {
      const result = runConformanceCase({
        binary: BIN,
        specRoot: SPEC_ROOT,
        casePath: resolve(SPEC_ROOT, 'conformance', 'cases', `${caseId}.json`),
      });
      const failures = result.assertions.filter((a): a is Extract<typeof a, { ok: false }> => !a.ok);
      const summary = failures.length
        ? failures.map((f) => `  - [${f.type}] ${f.reason}`).join('\n')
        : '';
      assert.ok(
        result.passed,
        `case ${caseId} failed\n${summary}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
      );
    });
  }
});
