#!/usr/bin/env node
/**
 * Regenerate context/cli-reference.md from `sm help --format md`.
 *
 *   node scripts/build-cli-reference.js           → write the file
 *   node scripts/build-cli-reference.js --check   → fail if drift
 *
 * --check is what CI runs: it captures the current output, compares to
 * context/cli-reference.md, and exits 1 with a diff pointer on mismatch.
 * The reference file itself is committed so diff reviewers can see the CLI
 * surface evolve alongside feature commits; CI blocks any PR that edits
 * the CLI without re-running this script.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const TARGET = resolve(ROOT, 'context/cli-reference.md');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');

function runHelp() {
  // tsx has to be invoked against the TypeScript source — the dist/ output
  // would work too but would require a build step, and the script is meant
  // to run at any moment (dev, pre-commit, CI).
  const entry = resolve(ROOT, 'src/cli/entry.ts');
  const cmd = `node --import tsx ${JSON.stringify(entry)} help --format md`;
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8' });
}

const generated = runHelp();

if (CHECK) {
  if (!existsSync(TARGET)) {
    console.error(`cli-reference.md missing at ${TARGET}. Run: node scripts/build-cli-reference.js`);
    process.exit(1);
  }
  const current = readFileSync(TARGET, 'utf8');
  if (current !== generated) {
    console.error(
      'context/cli-reference.md is out of sync with `sm help --format md`.\n' +
        'Run: node scripts/build-cli-reference.js',
    );
    process.exit(1);
  }
  console.log('cli-reference.md in sync.');
  process.exit(0);
}

writeFileSync(TARGET, generated, 'utf8');
console.log(`cli-reference.md written (${generated.length} bytes).`);
