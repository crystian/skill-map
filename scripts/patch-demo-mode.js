#!/usr/bin/env node
/**
 * `scripts/patch-demo-mode.js [<target-html>]` — flip the runtime-mode
 * meta-tag and the `<base href>` on a built SPA `index.html` so it
 * boots in demo mode under the `/demo/` sub-path.
 *
 * Two replacements:
 *
 *   - `<meta name="skill-map-mode" content="live">` → `content="demo"`
 *     (the factory at `data-source.factory.ts` keys off this).
 *   - `<base href="/">` → `<base href="/demo/">` (the deploy target on
 *     `skill-map.dev`).
 *
 * **Target** — defaults to `web/demo/index.html` for the local
 * `npm run demo:build` flow (which copies the Angular dist into
 * `web/demo/` for e2e + preview). The Dockerfile passes the
 * `ui/dist/ui/browser/index.html` path explicitly because production
 * deploys directly from the Angular dist without going through
 * `web/demo/`.
 *
 * **Idempotent**: running twice is a no-op. The script reads the file,
 * regex-replaces both attributes, writes back only if anything changed.
 *
 * Configurability is deferred until a second deployment forces it
 * (per ROADMAP § 14.3) — for now the `/demo/` sub-path is hardcoded.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const DEFAULT_TARGET = join(REPO_ROOT, 'web', 'demo', 'index.html');
const TARGET = resolveTarget(process.argv.slice(2));

function resolveTarget(args) {
  const explicit = args.find((arg) => !arg.startsWith('-'));
  if (!explicit) return DEFAULT_TARGET;
  return resolve(process.cwd(), explicit);
}

const META_PATTERN = /<meta\s+name="skill-map-mode"\s+content="[^"]*"\s*\/?\s*>/i;
const META_REPLACEMENT = '<meta name="skill-map-mode" content="demo" />';

const BASE_PATTERN = /<base\s+href="[^"]*"\s*\/?\s*>/i;
const BASE_REPLACEMENT = '<base href="/demo/" />';

async function main() {
  if (!existsSync(TARGET)) {
    throw new Error(`patch target missing: ${TARGET}`);
  }
  const original = await readFile(TARGET, 'utf8');

  if (!META_PATTERN.test(original)) {
    throw new Error(
      `meta tag not found in ${TARGET} (expected <meta name="skill-map-mode" content="..."/>)`,
    );
  }
  if (!BASE_PATTERN.test(original)) {
    throw new Error(
      `base tag not found in ${TARGET} (expected <base href="..."/>)`,
    );
  }

  const patched = original
    .replace(META_PATTERN, META_REPLACEMENT)
    .replace(BASE_PATTERN, BASE_REPLACEMENT);

  if (patched === original) {
    process.stdout.write(`[patch-demo-mode] ${TARGET} already in demo shape — no change\n`);
    return;
  }

  await writeFile(TARGET, patched, 'utf8');
  process.stdout.write(`[patch-demo-mode] patched ${TARGET}\n`);
  process.stdout.write(`[patch-demo-mode]   meta: skill-map-mode=demo\n`);
  process.stdout.write(`[patch-demo-mode]   base: href="/demo/"\n`);
}

main().catch((err) => {
  process.stderr.write(`[patch-demo-mode] FAILED: ${err.message}\n`);
  process.exit(1);
});
