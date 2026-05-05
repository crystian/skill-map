#!/usr/bin/env node
/**
 * PR gate: fail if workspace code changed without a changeset.
 *
 * Usage:  node scripts/check-changeset.js <baseRef>
 *
 * Rules:
 *  - Only PRs that touch a *versioned* workspace (one that publishes to
 *    npm or whose version tag drives a public deploy) require a changeset.
 *    Today: `spec/`, `src/`, `testkit/`, `web/`.
 *  - Workspaces that ship as private internals — `ui/` (bundled inside
 *    the CLI; user-visible UI changes ride along the next CLI changeset),
 *    `e2e/` (Playwright suite, never published), `examples/hello-world/`
 *    (illustrative, never published) — are exempt. They're listed in the
 *    root `package.json` `workspaces` array so npm orchestrates them, but
 *    they don't independently mint a release tag.
 *  - The Version Packages PR opened by `changesets/action`
 *    (branch `changeset-release/*`) is exempt — it consumes changesets
 *    rather than adding them.
 *  - PRs that touch only tooling / docs outside workspaces pass.
 */

import { execSync } from 'node:child_process';

const baseRef = process.argv[2];
if (!baseRef) {
  console.error('usage: check-changeset.js <baseRef>');
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

/**
 * Workspaces that gate the changeset check. A subset of the npm
 * `workspaces` array — only the ones whose version drives a publish or
 * a public deploy. See the file header for rationale.
 */
const VERSIONED_WORKSPACES = ['spec', 'src', 'testkit', 'web'];

function workspacePaths() {
  return VERSIONED_WORKSPACES;
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
  console.error('Run `npm run release:changeset` and commit the generated file.');
  console.error('Workspaces watched: ' + roots.join(', '));
  process.exit(1);
}

console.log(`Changeset(s) found: ${added.join(', ')}`);
