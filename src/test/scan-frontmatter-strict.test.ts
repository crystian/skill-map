/**
 * Step 6.7 — Frontmatter strict mode. Asserts that:
 *
 *   1. Files without a `---` fence never produce a frontmatter-invalid
 *      issue, even if every frontmatter schema requires fields.
 *   2. Files with a fence but missing required base fields produce a
 *      `frontmatter-invalid` issue with severity `warn` by default.
 *   3. `runScan({ strict: true })` promotes the same issue to `error`.
 *   4. The CLI surfaces the toggle through `--strict` and through
 *      `scan.strict: true` in `.skill-map/settings.json`. `--strict`
 *      overrides config when set.
 *   5. Incremental scans reuse the prior frontmatter-invalid issue for
 *      cached nodes; without this, a clean second scan would silently
 *      "lose" the warning.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { createKernel, runScan } from '../kernel/index.js';
import { builtIns } from '../extensions/built-ins.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', 'bin', 'sm.mjs');

let root: string;
let counter = 0;

function freshScope(label: string): { cwd: string; home: string } {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  const cwd = join(dir, 'cwd');
  const home = join(dir, 'home');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { cwd, home };
}

function writeNode(scopeRoot: string, rel: string, body: string): void {
  const full = join(scopeRoot, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
}

function sm(args: string[], scope: { cwd: string; home: string }) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: scope.cwd,
    env: { ...process.env, HOME: scope.home, USERPROFILE: scope.home },
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-fmstrict-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

// -----------------------------------------------------------------------------
// Kernel-level (runScan)
// -----------------------------------------------------------------------------

describe('frontmatter validation (kernel-level)', () => {
  it('files without a fence never trigger frontmatter-invalid', async () => {
    const scope = freshScope('no-fence');
    writeNode(scope.cwd, '.claude/agents/raw.md', 'plain markdown body, no frontmatter\n');
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    const fmIssues = result.issues.filter((i) => i.ruleId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 0);
  });

  it('files with a fence but missing required fields → warn issue by default', async () => {
    const scope = freshScope('warn-default');
    // Base schema requires name + description + metadata. Provide only name.
    writeNode(
      scope.cwd,
      '.claude/agents/incomplete.md',
      '---\nname: Inc\n---\nbody\n',
    );
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    const fmIssues = result.issues.filter((i) => i.ruleId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 1);
    assert.equal(fmIssues[0]!.severity, 'warn');
    assert.deepEqual(fmIssues[0]!.nodeIds, ['.claude/agents/incomplete.md']);
    assert.match(fmIssues[0]!.message, /description|metadata/);
  });

  it('strict: true promotes warn → error', async () => {
    const scope = freshScope('strict-error');
    writeNode(
      scope.cwd,
      '.claude/agents/incomplete.md',
      '---\nname: Inc\n---\nbody\n',
    );
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
      strict: true,
    });
    const fmIssues = result.issues.filter((i) => i.ruleId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 1);
    assert.equal(fmIssues[0]!.severity, 'error');
  });

  it('valid frontmatter against the per-kind schema → no issue', async () => {
    const scope = freshScope('valid');
    writeNode(
      scope.cwd,
      '.claude/agents/full.md',
      [
        '---',
        'name: Full',
        'description: A complete agent.',
        'metadata:',
        '  version: 1.0.0',
        '---',
        'body',
      ].join('\n'),
    );
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    const fmIssues = result.issues.filter((i) => i.ruleId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 0);
  });

  it('incremental scan preserves the prior frontmatter-invalid for cached nodes', async () => {
    const scope = freshScope('incremental-preserve');
    writeNode(
      scope.cwd,
      '.claude/agents/incomplete.md',
      '---\nname: Inc\n---\nbody\n',
    );
    const kernel = await createKernel();
    const first = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    assert.equal(
      first.issues.filter((i) => i.ruleId === 'frontmatter-invalid').length,
      1,
    );

    // Second incremental scan with the same fixture — node is cached
    // (same hashes), but the issue must reappear in the result.
    const second = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
      priorSnapshot: first,
      enableCache: true,
    });
    const fmIssues = second.issues.filter((i) => i.ruleId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 1);
    assert.equal(fmIssues[0]!.severity, 'warn');
  });

  it('catches type-mismatch on a base field (name: 42 instead of string)', async () => {
    const scope = freshScope('type-mismatch');
    writeNode(
      scope.cwd,
      '.claude/agents/badtype.md',
      [
        '---',
        'name: 42',
        'description: A description',
        'metadata:',
        '  version: 1.0.0',
        '---',
        'body',
      ].join('\n'),
    );
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    const fmIssues = result.issues.filter((i) => i.ruleId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 1);
    assert.match(fmIssues[0]!.message, /name|string|type/);
  });

  it('validates against per-kind schemas: skill / command / hook / note all flag missing fields', async () => {
    const scope = freshScope('multi-kind');
    // Drop one minimal-but-incomplete file per kind. Each is missing
    // `description` and `metadata` (base.required), so each must
    // produce exactly one frontmatter-invalid issue tagged with its
    // own kind in `data`.
    writeNode(scope.cwd, '.claude/skills/s/SKILL.md', '---\nname: s\n---\nbody\n');
    writeNode(scope.cwd, '.claude/commands/c.md', '---\nname: c\n---\nbody\n');
    writeNode(scope.cwd, '.claude/hooks/h.md', '---\nname: h\n---\nbody\n');
    writeNode(scope.cwd, 'notes/n.md', '---\nname: n\n---\nbody\n');
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    const fmIssues = result.issues.filter((i) => i.ruleId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 4);
    const kinds = new Set(
      fmIssues.map((i) => (i.data as { kind: string } | undefined)?.kind),
    );
    assert.deepEqual(kinds, new Set(['skill', 'command', 'hook', 'note']));
  });

  it('incremental + strict promotes the cached issue to error', async () => {
    const scope = freshScope('incremental-strict');
    writeNode(
      scope.cwd,
      '.claude/agents/incomplete.md',
      '---\nname: Inc\n---\nbody\n',
    );
    const kernel = await createKernel();
    const first = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    const second = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
      priorSnapshot: first,
      enableCache: true,
      strict: true,
    });
    const fmIssues = second.issues.filter((i) => i.ruleId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 1);
    assert.equal(fmIssues[0]!.severity, 'error');
  });
});

// -----------------------------------------------------------------------------
// CLI surface (sm scan --strict and scan.strict config)
// -----------------------------------------------------------------------------

describe('frontmatter strict — CLI', () => {
  it('default scan exits 0 even with frontmatter warnings', () => {
    const scope = freshScope('cli-default');
    sm(['init', '--no-scan'], scope);
    writeNode(scope.cwd, '.claude/agents/inc.md', '---\nname: Inc\n---\nbody\n');
    const r = sm(['scan'], scope);
    // exit 1 = "issues" but only when severity=error; warns are exit 0.
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  });

  it('--strict escalates to exit 1 on frontmatter warnings', () => {
    const scope = freshScope('cli-strict');
    sm(['init', '--no-scan'], scope);
    writeNode(scope.cwd, '.claude/agents/inc.md', '---\nname: Inc\n---\nbody\n');
    const r = sm(['scan', '--strict'], scope);
    assert.equal(r.status, 1);
  });

  it('scan.strict: true in settings.json acts the same as --strict', () => {
    const scope = freshScope('cli-config-strict');
    sm(['init', '--no-scan'], scope);
    sm(['config', 'set', 'scan.strict', 'true'], scope);
    writeNode(scope.cwd, '.claude/agents/inc.md', '---\nname: Inc\n---\nbody\n');
    const r = sm(['scan'], scope);
    assert.equal(r.status, 1);
  });

  it('--strict overrides scan.strict: false in config (CLI flag wins)', () => {
    const scope = freshScope('cli-flag-overrides');
    sm(['init', '--no-scan'], scope);
    sm(['config', 'set', 'scan.strict', 'false'], scope);
    writeNode(scope.cwd, '.claude/agents/inc.md', '---\nname: Inc\n---\nbody\n');
    const r = sm(['scan', '--strict'], scope);
    assert.equal(r.status, 1);
  });
});
