#!/usr/bin/env node
/**
 * `scripts/sync-spec-pin.js [--check]` — keep `@skill-map/cli`'s pin
 * on `@skill-map/spec` in lockstep with the spec's actual published
 * version. Wired into `changeset:version` so every release bump that
 * moves the spec also retags the CLI's dep pin to the new spec
 * version, in the same `chore: version packages` PR.
 *
 * Modes:
 *   - default (no args)  → write the pin if it drifted
 *   - `--check`          → exit 1 with a diagnostic if drifted, do not write
 *
 * History: the CLI shipped with `"@skill-map/spec": "*"`, the broadest
 * range npm honours. End users running `npm i -g @skill-map/cli@X.Y`
 * received whatever spec version was newest in the registry — not
 * necessarily the one the CLI was tested against. This script
 * eliminates that drift class entirely; the dep is re-pinned to an
 * exact version on every spec bump.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SPEC_PKG = resolve(REPO_ROOT, 'spec', 'package.json');
const CLI_PKG = resolve(REPO_ROOT, 'src', 'package.json');
const DEP_KEY = '@skill-map/spec';

const CHECK = process.argv.slice(2).includes('--check');

async function main() {
  const specVersion = JSON.parse(await readFile(SPEC_PKG, 'utf8')).version;
  if (typeof specVersion !== 'string' || !/^\d+\.\d+\.\d+/.test(specVersion)) {
    fail(`unexpected spec version in ${SPEC_PKG}: ${JSON.stringify(specVersion)}`);
  }

  const cliRaw = await readFile(CLI_PKG, 'utf8');
  const cliPkg = JSON.parse(cliRaw);
  const currentPin = cliPkg.dependencies?.[DEP_KEY];
  if (typeof currentPin !== 'string') {
    fail(`${CLI_PKG} does not declare a dependency on ${DEP_KEY}`);
  }

  if (currentPin === specVersion) {
    process.stdout.write(`[sync-spec-pin] in sync at ${specVersion}\n`);
    return;
  }

  if (CHECK) {
    fail(
      `[sync-spec-pin] DRIFT: ${DEP_KEY} pinned to "${currentPin}" in src/package.json ` +
        `but spec/package.json is at "${specVersion}". Run: node scripts/sync-spec-pin.js`,
    );
  }

  // Targeted string replacement so we don't touch JSON formatting (key
  // order, indentation, trailing newline). The dep key is unique inside
  // src/package.json — package names cannot contain quote chars.
  const updated = cliRaw.replace(
    new RegExp(`("${escape(DEP_KEY)}"\\s*:\\s*)"[^"]*"`),
    `$1"${specVersion}"`,
  );
  if (updated === cliRaw) {
    fail(`failed to locate the ${DEP_KEY} dependency line for replacement in ${CLI_PKG}`);
  }
  await writeFile(CLI_PKG, updated, 'utf8');
  process.stdout.write(`[sync-spec-pin] retagged ${DEP_KEY}: "${currentPin}" -> "${specVersion}"\n`);
}

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fail(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`[sync-spec-pin] FAILED: ${err.message}\n`);
  process.exit(1);
});
