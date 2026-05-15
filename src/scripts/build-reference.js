#!/usr/bin/env bun
/**
 * Regenerate context/cli-reference.md from `sm help --format md`.
 *
 *   bun run --filter @skill-map/cli reference         → write the file
 *   bun run --filter @skill-map/cli reference:check   → fail if drift
 *
 * --check is what CI runs: it captures the current output, compares to
 * context/cli-reference.md, and exits 1 with a diff pointer on mismatch.
 * The reference file itself is committed so diff reviewers can see the CLI
 * surface evolve alongside feature commits; CI blocks any PR that edits
 * the CLI without re-running this script.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..');
const TARGET = resolve(REPO_ROOT, 'context/cli-reference.md');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');

function runHelp() {
  // Bun executes the TS source directly — no tsx loader needed. The
  // dist/ output would also work but would require a build step, and
  // this script is meant to run at any moment (dev, pre-commit, CI).
  const entry = resolve(REPO_ROOT, 'src/cli/entry.ts');
  return execFileSync('bun', [entry, 'help', '--format', 'md'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
}

const generated = runHelp();

if (CHECK) {
  if (!existsSync(TARGET)) {
    console.error(`cli-reference.md missing at ${TARGET}. Run: bun run --filter @skill-map/cli reference`);
    process.exit(1);
  }
  const current = readFileSync(TARGET, 'utf8');
  if (current !== generated) {
    console.error(
      'context/cli-reference.md is out of sync with `sm help --format md`.\n' +
        'Run: bun run --filter @skill-map/cli reference',
    );
    process.exit(1);
  }
  console.log('cli-reference.md in sync.');
  process.exit(0);
}

writeFileSync(TARGET, generated, 'utf8');
console.log(`cli-reference.md written (${generated.length} bytes).`);
