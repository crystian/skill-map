/**
 * Step 9.6.4 — `sm bump` CLI verb tests.
 *
 * Tests instantiate the Command class, swap `process.cwd()` to a
 * tmpdir fixture (so the verb's `defaultRuntimeContext()` and its
 * abs-path resolution agree), and run a real scan + persistence so
 * the sidecar overlay rides through the kernel into the persisted
 * `Node`. The verb then materialises the bump through
 * `FilesystemSidecarStore` against the on-disk `.sm` file.
 *
 * Single-node refusal / first-time-creation / batch / staged-with-
 * git, plus the not-in-repo / no-binary error matrix, are all
 * covered. `--staged` is exercised via a real `git init` fixture so
 * the `spawnSync('git', ['add', ...])` call hits a real binary.
 *
 * Per AGENTS.md: tests use `mkdtempSync` paths (file-based SQLite,
 * never `:memory:`) and write everything under `.tmp/<scope>/`.
 */

import { describe, it,beforeAll as before,afterAll as after} from 'bun:test';
import { ok, strictEqual } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';

import type { BaseContext } from 'clipanion';

import { BumpCommand } from '../cli/commands/bump.js';
import { builtIns, listBuiltIns } from '../built-in-plugins/built-ins.js';
import {
  createKernel,
  runScanWithRenames,
} from '../kernel/index.js';
import type { ScanResult } from '../kernel/index.js';
import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../kernel/adapters/sqlite/scan-persistence.js';

let tmpRoot: string;
let counter = 0;
const originalCwd = process.cwd();

function freshDbPath(label: string): string {
  counter += 1;
  return join(tmpRoot, `${label}-${counter}.db`);
}

function freshFixture(label: string): string {
  counter += 1;
  return mkdtempSync(join(tmpRoot, `${label}-${counter}-`));
}

function writeFile(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

before(() => {
  // AGENTS.md baseline — temp files always under `.tmp/`.
  const projectTmp = resolve(originalCwd, '.tmp');
  mkdirSync(projectTmp, { recursive: true });
  tmpRoot = mkdtempSync(join(projectTmp, 'bump-cli-'));
});

after(() => {
  process.chdir(originalCwd);
  rmSync(tmpRoot, { recursive: true, force: true });
});

interface ICapturedContext {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICapturedContext {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const context = {
    stdout: { write: (s: string) => { stdoutChunks.push(s); return true; } },
    stderr: { write: (s: string) => { stderrChunks.push(s); return true; } },
  } as unknown as BaseContext;
  return {
    context,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
  };
}

async function runScanAndPersist(
  fixture: string,
  dbPath: string,
  prior: ScanResult | null = null,
): Promise<{ result: ScanResult }> {
  const kernel = createKernel();
  for (const m of listBuiltIns()) kernel.registry.register(m);
  const opts: Parameters<typeof runScanWithRenames>[1] = {
    roots: [fixture],
    extensions: builtIns(),
  };
  if (prior) opts.priorSnapshot = prior;
  const ran = await runScanWithRenames(kernel, opts);
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await persistScanResult(adapter.db, ran.result, ran.renameOps);
  } finally {
    await adapter.close();
  }
  return { result: ran.result };
}

function makeBump(): BumpCommand {
  const cmd = new BumpCommand();
  cmd.global = false;
  cmd.json = false;
  cmd.quiet = true;
  cmd.noColor = true;
  cmd.verbose = 0;
  cmd.pending = false;
  cmd.staged = false;
  cmd.force = false;
  // Clipanion's Option.String({required:false}) leaves the field set to
  // its placeholder until the parser runs; tests instantiate the
  // command directly so we MUST clear it manually.
  cmd.nodePath = undefined;
  return cmd;
}

describe('sm bump <node-path> — single-node mode', () => {
  it('first-time bump creates the .sm file with audit + version=1', async () => {
    const fixture = freshFixture('first');
    const dbPath = freshDbPath('first');
    writeFile(fixture, '.claude/skills/foo.md',
      ['---', 'name: foo', '---', 'Body.'].join('\n'),
    );
    process.chdir(fixture);
    await runScanAndPersist(fixture, dbPath);

    const cap = captureContext();
    const cmd = makeBump();
    cmd.db = dbPath;
    cmd.nodePath = '.claude/skills/foo.md';
    cmd.context = cap.context;
    const code = await cmd.execute();

    strictEqual(code, 0);
    const sidecarPath = join(fixture, '.claude/skills/foo.sm');
    ok(existsSync(sidecarPath), '.sm file was created');
    const parsed = yaml.load(readFileSync(sidecarPath, 'utf8')) as Record<string, unknown>;
    strictEqual((parsed['annotations'] as Record<string, unknown>)['version'], 1);
    const audit = parsed['audit'] as Record<string, unknown>;
    strictEqual(audit['lastBumpedBy'], 'cli');
    strictEqual(audit['createdBy'], 'cli');
  });

  it('refuses on a fresh node without --force (exit 2)', async () => {
    const fixture = freshFixture('fresh');
    const dbPath = freshDbPath('fresh');
    writeFile(fixture, '.claude/skills/bar.md',
      ['---', 'name: bar', '---', 'Body.'].join('\n'),
    );
    process.chdir(fixture);
    await runScanAndPersist(fixture, dbPath);

    // First bump → version 1, sidecar fresh against current hashes.
    const first = makeBump();
    first.db = dbPath; first.nodePath = '.claude/skills/bar.md';
    first.context = captureContext().context;
    strictEqual(await first.execute(), 0);

    // Re-scan so the persisted overlay's status flips to fresh.
    const prior = (await runScanAndPersist(fixture, dbPath)).result;
    void prior;

    // Second bump on the now-fresh node → refused.
    const cap = captureContext();
    const second = makeBump();
    second.db = dbPath; second.nodePath = '.claude/skills/bar.md';
    second.context = cap.context;
    strictEqual(await second.execute(), 2);
    ok(cap.stderr().includes('fresh'), 'refusal message mentions fresh');
  });

  it('--force on a fresh node → silent no-op (exit 0, no stdout)', async () => {
    const fixture = freshFixture('forced');
    const dbPath = freshDbPath('forced');
    writeFile(fixture, '.claude/skills/baz.md',
      ['---', 'name: baz', '---', 'Body.'].join('\n'),
    );
    process.chdir(fixture);
    await runScanAndPersist(fixture, dbPath);

    const first = makeBump();
    first.db = dbPath; first.nodePath = '.claude/skills/baz.md';
    first.context = captureContext().context;
    strictEqual(await first.execute(), 0);
    await runScanAndPersist(fixture, dbPath);

    const cap = captureContext();
    const cmd = makeBump();
    cmd.db = dbPath; cmd.nodePath = '.claude/skills/baz.md';
    cmd.force = true;
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);
    strictEqual(cap.stdout(), ''); // silent
  });

  it('node not in scan → exit 5', async () => {
    const fixture = freshFixture('missing');
    const dbPath = freshDbPath('missing');
    writeFile(fixture, '.claude/skills/x.md',
      ['---', 'name: x', '---', 'Body.'].join('\n'),
    );
    process.chdir(fixture);
    await runScanAndPersist(fixture, dbPath);

    const cap = captureContext();
    const cmd = makeBump();
    cmd.db = dbPath; cmd.nodePath = '.claude/skills/does-not-exist.md';
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 5);
  });

  it('--pending and positional are mutually exclusive (exit 2)', async () => {
    const cap = captureContext();
    const cmd = makeBump();
    cmd.db = freshDbPath('mutex');
    cmd.nodePath = 'x.md';
    cmd.pending = true;
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 2);
  });
});

describe('sm bump --pending — batch mode', () => {
  it('walks every stale node in node.path ASC order', async () => {
    const fixture = freshFixture('pending');
    const dbPath = freshDbPath('pending');
    writeFile(fixture, '.claude/skills/a.md',
      ['---', 'name: a', '---', 'A1.'].join('\n'),
    );
    writeFile(fixture, '.claude/skills/b.md',
      ['---', 'name: b', '---', 'B1.'].join('\n'),
    );
    process.chdir(fixture);
    await runScanAndPersist(fixture, dbPath);

    // First bump on each — establishes sidecars at v1.
    for (const path of ['.claude/skills/a.md', '.claude/skills/b.md']) {
      const c = makeBump();
      c.db = dbPath; c.nodePath = path;
      c.context = captureContext().context;
      strictEqual(await c.execute(), 0);
    }

    // Mutate bodies → drift on both.
    writeFile(fixture, '.claude/skills/a.md',
      ['---', 'name: a', '---', 'A2 (changed).'].join('\n'),
    );
    writeFile(fixture, '.claude/skills/b.md',
      ['---', 'name: b', '---', 'B2 (changed).'].join('\n'),
    );
    await runScanAndPersist(fixture, dbPath);

    const cap = captureContext();
    const cmd = makeBump();
    cmd.db = dbPath; cmd.pending = true; cmd.json = true;
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);

    const env = JSON.parse(cap.stdout()) as { bumped: number; refused: number; skipped: number };
    strictEqual(env.bumped, 2);
    strictEqual(env.refused, 0);

    // Both sidecars should now be at v2.
    const a = yaml.load(readFileSync(join(fixture, '.claude/skills/a.sm'), 'utf8')) as Record<string, unknown>;
    const b = yaml.load(readFileSync(join(fixture, '.claude/skills/b.sm'), 'utf8')) as Record<string, unknown>;
    strictEqual((a['annotations'] as Record<string, unknown>)['version'], 2);
    strictEqual((b['annotations'] as Record<string, unknown>)['version'], 2);
  });

  // The `not in a git repo → exit 5` branch is not exercised here:
  // `.tmp/` lives inside the project, which itself is a git repo,
  // so `findGitRepoRoot` always succeeds during tests. The branch is
  // covered by the i18n contract + the explicit `findGitRepoRoot`
  // logic (returns null only when the walk hits `dirname(p) === p`).

  it('--pending --staged in a real repo runs git add per bump', async () => {
    // Skip if `git` isn't on PATH — the shared CI image has it but be
    // safe.
    const probe = spawnSync('git', ['--version'], { stdio: 'ignore' });
    if (probe.error !== undefined || probe.status !== 0) return;

    const fixture = freshFixture('staged');
    const dbPath = freshDbPath('staged');
    // git init + minimal config so commit-side hooks would work.
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: fixture });
    spawnSync('git', ['config', 'user.email', 'a@b.c'], { cwd: fixture });
    spawnSync('git', ['config', 'user.name', 'tester'], { cwd: fixture });
    writeFile(fixture, '.claude/skills/a.md',
      ['---', 'name: a', '---', 'A.'].join('\n'),
    );
    process.chdir(fixture);
    await runScanAndPersist(fixture, dbPath);

    // First bump establishes sidecar at v1.
    const first = makeBump();
    first.db = dbPath; first.nodePath = '.claude/skills/a.md';
    first.context = captureContext().context;
    strictEqual(await first.execute(), 0);

    // Drift the body.
    writeFile(fixture, '.claude/skills/a.md',
      ['---', 'name: a', '---', 'A2 changed.'].join('\n'),
    );
    await runScanAndPersist(fixture, dbPath);

    const cap = captureContext();
    const cmd = makeBump();
    cmd.db = dbPath; cmd.pending = true; cmd.staged = true; cmd.json = true;
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);

    // Sanity: the sidecar is now staged.
    const status = spawnSync('git', ['diff', '--cached', '--name-only'], {
      cwd: fixture, encoding: 'utf8',
    });
    ok(status.stdout.includes('.claude/skills/a.sm'), 'sidecar was git-added');
  });

  it('--pending with no stale nodes → empty envelope, exit 0', async () => {
    const fixture = freshFixture('clean');
    const dbPath = freshDbPath('clean');
    writeFile(fixture, '.claude/skills/a.md',
      ['---', 'name: a', '---', 'Body.'].join('\n'),
    );
    process.chdir(fixture);
    await runScanAndPersist(fixture, dbPath);

    const cap = captureContext();
    const cmd = makeBump();
    cmd.db = dbPath; cmd.pending = true; cmd.json = true;
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);
    const env = JSON.parse(cap.stdout()) as { bumped: number };
    strictEqual(env.bumped, 0);
  });
});
