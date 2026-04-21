#!/usr/bin/env node
/**
 * Regenerate spec/index.json with an integrity block (sha256 per file).
 *
 * Source of truth for "what ships": `files` in spec/package.json.
 * The script walks every entry (file or directory), computes sha256 over
 * raw bytes, and writes a deterministic listing (lexicographically sorted).
 *
 * Modes:
 *   node scripts/build-spec-index.mjs            → write spec/index.json
 *   node scripts/build-spec-index.mjs --check    → exit 1 on drift
 */

import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SPEC = resolve(REPO, 'spec');
const INDEX_PATH = join(SPEC, 'index.json');
const PKG_PATH = join(SPEC, 'package.json');
const CHECK = process.argv.includes('--check');

const SELF_REFERENCE = 'index.json';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function isDir(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function walk(absPath, out) {
  const s = await stat(absPath);
  if (s.isFile()) {
    out.push(absPath);
    return;
  }
  if (s.isDirectory()) {
    const entries = await readdir(absPath);
    for (const name of entries) {
      if (name === '.DS_Store') continue;
      await walk(join(absPath, name), out);
    }
  }
}

async function collectFiles(pkgFiles) {
  const collected = new Set();
  for (const entry of pkgFiles) {
    const abs = join(SPEC, entry);
    const dir = await isDir(abs);
    if (!dir) {
      collected.add(abs);
      continue;
    }
    const bucket = [];
    await walk(abs, bucket);
    for (const f of bucket) collected.add(f);
  }
  return [...collected]
    .map((abs) => relative(SPEC, abs).split(sep).join('/'))
    .filter((rel) => rel !== SELF_REFERENCE)
    .sort();
}

async function hashFile(relPath) {
  const bytes = await readFile(join(SPEC, relPath));
  return createHash('sha256').update(bytes).digest('hex');
}

async function buildIntegrity(pkgFiles) {
  const rels = await collectFiles(pkgFiles);
  const files = {};
  for (const rel of rels) {
    files[rel] = await hashFile(rel);
  }
  return { algorithm: 'sha256', files };
}

function stableStringify(value, indent = 2) {
  return JSON.stringify(value, null, indent) + '\n';
}

function stripIntegrity(indexDoc) {
  const { integrity, ...rest } = indexDoc;
  return { rest, integrity };
}

async function main() {
  const pkg = await readJson(PKG_PATH);
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
    console.error('spec/package.json has no `files` array — nothing to hash.');
    process.exit(2);
  }
  if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
    console.error('spec/package.json has no `version` — cannot stamp manifest.');
    process.exit(2);
  }

  const indexDoc = await readJson(INDEX_PATH);
  const { rest, integrity: existing } = stripIntegrity(indexDoc);
  rest.specPackageVersion = pkg.version;
  const fresh = await buildIntegrity(pkg.files);
  const next = { ...rest, integrity: fresh };
  const serialized = stableStringify(next);

  if (CHECK) {
    const onDisk = await readFile(INDEX_PATH, 'utf8');
    if (onDisk !== serialized) {
      console.error('spec/index.json is out of date.');
      console.error('Run: node scripts/build-spec-index.mjs');
      if (existing) {
        const existingKeys = Object.keys(existing.files ?? {});
        const freshKeys = Object.keys(fresh.files);
        const added = freshKeys.filter((k) => !existingKeys.includes(k));
        const removed = existingKeys.filter((k) => !freshKeys.includes(k));
        const changed = freshKeys.filter(
          (k) => existingKeys.includes(k) && existing.files[k] !== fresh.files[k],
        );
        if (added.length) console.error('  added:   ' + added.join(', '));
        if (removed.length) console.error('  removed: ' + removed.join(', '));
        if (changed.length) console.error('  changed: ' + changed.join(', '));
      }
      process.exit(1);
    }
    console.log(`spec/index.json OK (${Object.keys(fresh.files).length} files hashed).`);
    return;
  }

  await writeFile(INDEX_PATH, serialized);
  console.log(
    `spec/index.json written (${Object.keys(fresh.files).length} files, sha256).`,
  );
}

main().catch((err) => {
  console.error(err.stack ?? err.message ?? err);
  process.exit(2);
});
