#!/usr/bin/env node
/**
 * Walks ui/mock-collection/**\/*.md and emits ui/mock-collection/index.json.
 *
 * The index is a flat list of relative paths from the mock-collection root,
 * sorted for deterministic output. Runs as `prestart` / `prebuild` so the ui
 * dev server and production build always ship with an up-to-date manifest.
 */

import { readdir, writeFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(here, '..', 'mock-collection');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  const files = await walk(ROOT);
  const paths = files
    .map((f) => relative(ROOT, f).split(sep).join('/'))
    .filter((p) => p !== 'index.json')
    .sort();

  const manifest = {
    generatedAt: new Date().toISOString(),
    root: 'mock-collection',
    count: paths.length,
    paths,
  };

  const target = join(ROOT, 'index.json');
  await writeFile(target, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`[build-mock-index] wrote ${target} (${paths.length} entries)`);
}

try {
  await stat(ROOT);
} catch {
  console.error(`[build-mock-index] root missing: ${ROOT}`);
  process.exit(1);
}

await main();
