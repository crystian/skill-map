#!/usr/bin/env node
/**
 * PR gate: fail if workspace code changed without a changeset.
 *
 * Usage:  node scripts/check-changeset.mjs <baseRef>
 *
 * Rules:
 *  - If the PR modifies files inside any declared workspace and does NOT
 *    add a new `.changeset/*.md`, fail.
 *  - The Version Packages PR opened by `changesets/action`
 *    (branch `changeset-release/*`) is exempt — it consumes changesets
 *    rather than adding them.
 *  - PRs that touch only tooling / docs outside workspaces pass.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const baseRef = process.argv[2];
if (!baseRef) {
  console.error('usage: check-changeset.mjs <baseRef>');
  process.exit(2);
}

function git(args) {
  return execSync(`git ${args}`, { encoding: 'utf8' }).trim();
}

function changedFiles(base) {
  try {
    return git(`diff --name-only ${base}...HEAD`).split('\n').filter(Boolean);
  } catch (err) {
    console.error(`git diff against ${base} failed: ${err.message}`);
    process.exit(2);
  }
}

function newChangesets(base) {
  try {
    return git(`diff --name-only --diff-filter=A ${base}...HEAD -- .changeset/`)
      .split('\n')
      .filter(Boolean)
      .filter((f) => f.endsWith('.md') && !f.endsWith('README.md'));
  } catch {
    return [];
  }
}

function currentBranch() {
  if (process.env.GITHUB_HEAD_REF) return process.env.GITHUB_HEAD_REF;
  try {
    return git('rev-parse --abbrev-ref HEAD');
  } catch {
    return '';
  }
}

function workspacePaths() {
  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
  const ws = pkg.workspaces ?? [];
  return ws.map((w) => w.replace(/\/\*$/, '')).map((w) => w.replace(/\/$/, ''));
}

function touchesWorkspace(files, roots) {
  return files.some((f) => roots.some((r) => f === r || f.startsWith(`${r}/`)));
}

const branch = currentBranch();
if (branch.startsWith('changeset-release/')) {
  console.log('Version Packages PR — changeset check skipped.');
  process.exit(0);
}

const files = changedFiles(baseRef);
if (files.length === 0) {
  console.log('No diff against base — nothing to check.');
  process.exit(0);
}

const roots = workspacePaths();
if (!touchesWorkspace(files, roots)) {
  console.log(`No workspace files touched (${roots.join(', ')}). Changeset not required.`);
  process.exit(0);
}

const added = newChangesets(baseRef);
if (added.length === 0) {
  console.error('::error::This PR modifies a workspace but no changeset was added.');
  console.error('Run `npm run changeset` and commit the generated file.');
  console.error('Workspaces watched: ' + roots.join(', '));
  process.exit(1);
}

console.log(`Changeset(s) found: ${added.join(', ')}`);
