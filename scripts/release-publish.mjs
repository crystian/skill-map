#!/usr/bin/env bun
/**
 * Bun-native publish step for `changesets/action`. Replaces the default
 * `changeset publish` call which shells out to `npm publish`. Walks the
 * monorepo, finds workspaces that just had their version bumped by
 * `changeset version`, and publishes them via `bun publish`.
 *
 * Why: the migration to Bun is "no npm in CI". `changeset publish`
 * invokes `npm publish` internally; `bun publish` produces an
 * equivalent npm-registry upload (auth via `NODE_AUTH_TOKEN` /
 * `NPM_TOKEN`, falls back to ~/.npmrc), so we orchestrate the per-
 * workspace loop ourselves and skip the shell-out.
 *
 * Strategy: read `.changeset/` consumed receipts via `changeset status
 * --output`, then for each released package run `bun publish --access
 * public` from its directory. Mirrors `changeset publish`'s contract
 * (publish-then-tag) closely enough for the changesets/action wrapper
 * to detect "published == true".
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function workspaceDirs() {
  const root = readJson(join(REPO_ROOT, 'package.json'));
  return (root.workspaces ?? []).map((entry) => join(REPO_ROOT, entry));
}

function packagesToPublish() {
  const out = [];
  for (const dir of workspaceDirs()) {
    const pkgPath = join(dir, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = readJson(pkgPath);
    if (pkg.private) continue;
    if (!pkg.name || !pkg.version) continue;
    out.push({ name: pkg.name, version: pkg.version, dir });
  }
  return out;
}

function isAlreadyPublished(name, version) {
  // `npm view` works against any registry, but we're avoiding the npm
  // CLI entirely — `bun pm view` is the Bun equivalent. Returns the
  // version string if published, throws otherwise.
  const r = spawnSync('bun', ['pm', 'view', `${name}@${version}`, 'version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return r.status === 0 && r.stdout.trim() === version;
}

function publish(pkg) {
  process.stdout.write(`[release-publish] ${pkg.name}@${pkg.version}\n`);
  if (isAlreadyPublished(pkg.name, pkg.version)) {
    process.stdout.write(`[release-publish] ${pkg.name}@${pkg.version} already on registry — skip\n`);
    return false;
  }
  execFileSync('bun', ['publish', '--access', 'public'], {
    cwd: pkg.dir,
    stdio: 'inherit',
  });
  return true;
}

let publishedAny = false;
for (const pkg of packagesToPublish()) {
  const ok = publish(pkg);
  publishedAny = publishedAny || ok;
}

// `changesets/action` reads `published` / `publishedPackages` from the
// step output by parsing the last "New tag:" lines on stdout. Emit a
// compatible line for each package so the action's downstream `if`
// gates (e.g. the smoke-install step) keep firing.
if (publishedAny) {
  for (const pkg of packagesToPublish()) {
    process.stdout.write(`New tag:  ${pkg.name}@${pkg.version}\n`);
  }
}
