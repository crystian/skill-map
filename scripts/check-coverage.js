#!/usr/bin/env node
/**
 * Coverage gate: every schema under `spec/schemas/` MUST have a row in the
 * coverage matrix at `spec/conformance/coverage.md`, and every row in the
 * matrix MUST point to an existing schema. Drift in either direction fails.
 *
 * Rationale: `coverage.md` is the v1.0.0 release gate. A schema that lands
 * without a row slips past review silently; a row that outlives its schema
 * wastes reviewer attention. Both are caught here at CI time.
 *
 * Usage: node scripts/check-coverage.js
 * Exit:  0 in sync · 1 drift · 2 operational error.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const SCHEMAS_ROOT = resolve(REPO_ROOT, 'spec/schemas');
const COVERAGE_FILE = resolve(REPO_ROOT, 'spec/conformance/coverage.md');

function die(msg) {
  process.stderr.write(`check-coverage: ${msg}\n`);
  process.exit(2);
}

function walkSchemas(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    die(`cannot read ${dir}: ${err.message}`);
  }
  for (const name of entries) {
    const full = resolve(dir, name);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      out.push(...walkSchemas(full));
    } else if (name.endsWith('.schema.json')) {
      // Store relative to SCHEMAS_ROOT with forward slashes (matrix uses them).
      out.push(relative(SCHEMAS_ROOT, full).split(sep).join('/'));
    }
  }
  return out;
}

function parseMatrix(md) {
  // Each relevant row looks like:
  //   | 1 | `node.schema.json` | `basic-scan` | 🟢 covered | ... |
  //   | 22 | `extensions/base.schema.json` | — | 🔴 missing | ... |
  // We extract the path in the second `…` segment that ends in `.schema.json`.
  const pattern = /^\|\s*\d+\s*\|\s*`([^`]+\.schema\.json)`/gm;
  const found = new Set();
  for (const m of md.matchAll(pattern)) {
    found.add(m[1]);
  }
  return found;
}

let md;
try {
  md = readFileSync(COVERAGE_FILE, 'utf8');
} catch (err) {
  die(`cannot read ${COVERAGE_FILE}: ${err.message}`);
}

const onDisk = new Set(walkSchemas(SCHEMAS_ROOT));
const inMatrix = parseMatrix(md);

const missingFromMatrix = [...onDisk].filter((p) => !inMatrix.has(p)).sort();
const missingFromDisk = [...inMatrix].filter((p) => !onDisk.has(p)).sort();

if (missingFromMatrix.length === 0 && missingFromDisk.length === 0) {
  process.stdout.write(
    `coverage.md in sync with spec/schemas/ (${onDisk.size} schemas).\n`,
  );
  process.exit(0);
}

if (missingFromMatrix.length > 0) {
  process.stderr.write('::error file=spec/conformance/coverage.md::schemas without a coverage row:\n');
  for (const p of missingFromMatrix) {
    process.stderr.write(`  - ${p}\n`);
  }
  process.stderr.write(
    '\nAdd a row in the `## Coverage matrix` table of spec/conformance/coverage.md for each.\n',
  );
}

if (missingFromDisk.length > 0) {
  process.stderr.write(
    '::error file=spec/conformance/coverage.md::matrix rows pointing to missing schemas:\n',
  );
  for (const p of missingFromDisk) {
    process.stderr.write(`  - ${p}\n`);
  }
  process.stderr.write(
    '\nEither restore the schema file or remove the matrix row.\n',
  );
}

process.exit(1);
