/**
 * Step 9.6.4 — `sm sidecar refresh|prune|annotate` CLI verb tests.
 *
 * Mirrors the layout of `bump-cli.test.ts`: real scan + persistence,
 * `process.chdir` to a tmpdir fixture, file-based SQLite under
 * `.tmp/`, no `:memory:`.
 */

import { describe, it,beforeAll as before,afterAll as after} from 'bun:test';
import { ok, strictEqual } from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import yaml from 'js-yaml';

import type { BaseContext } from 'clipanion';

import {
  SidecarAnnotateCommand,
  SidecarPruneCommand,
  SidecarRefreshCommand,
} from '../cli/commands/sidecar.js';
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
  const projectTmp = resolve(originalCwd, '.tmp');
  mkdirSync(projectTmp, { recursive: true });
  tmpRoot = mkdtempSync(join(projectTmp, 'sidecar-cli-'));
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
): Promise<void> {
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
}

function commonFlags<T extends { global: boolean; json: boolean; quiet: boolean; noColor: boolean; verbose: number; db?: string | undefined }>(cmd: T): T {
  cmd.global = false;
  cmd.json = false;
  cmd.quiet = true;
  cmd.noColor = true;
  cmd.verbose = 0;
  return cmd;
}

describe('sm sidecar refresh', () => {
  it('refreshes hashes without bumping the version', async () => {
    const fixture = freshFixture('refresh');
    const dbPath = freshDbPath('refresh');
    writeFile(fixture, 'notes/skill.md',
      ['---', 'name: skill', '---', 'Body 1.'].join('\n'),
    );
    process.chdir(fixture);
    await runScanAndPersist(fixture, dbPath);

    // Establish a sidecar at v3 via two bumps + a body change.
    const bump = new BumpCommand();
    commonFlags(bump);
    bump.pending = false; bump.staged = false; bump.force = false;
    bump.db = dbPath; bump.nodePath = 'notes/skill.md';
    bump.context = captureContext().context;
    strictEqual(await bump.execute(), 0);

    // Hand-edit the sidecar to v3 so we can see refresh leave it alone.
    const sidecarPath = join(fixture, 'notes/skill.sm');
    const current = yaml.load(readFileSync(sidecarPath, 'utf8')) as Record<string, unknown>;
    (current['annotations'] as Record<string, unknown>)['version'] = 3;
    writeFileSync(sidecarPath, yaml.dump(current, { sortKeys: true }));

    // Drift the body so refresh has work to do.
    writeFile(fixture, 'notes/skill.md',
      ['---', 'name: skill', '---', 'Body 2 changed.'].join('\n'),
    );
    await runScanAndPersist(fixture, dbPath);

    const cap = captureContext();
    const cmd = new SidecarRefreshCommand();
    commonFlags(cmd);
    cmd.db = dbPath; cmd.nodePath = 'notes/skill.md';
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);

    const after = yaml.load(readFileSync(sidecarPath, 'utf8')) as Record<string, unknown>;
    // version preserved
    strictEqual((after['annotations'] as Record<string, unknown>)['version'], 3);
    // body hash updated — should differ from the post-bump-v1 hash.
    const newBodyHash = (after['for'] as Record<string, unknown>)['bodyHash'];
    const oldBodyHash = (current['for'] as Record<string, unknown>)['bodyHash'];
    ok(newBodyHash !== oldBodyHash, 'bodyHash refreshed');
  });

  it('no sidecar → exit 5', async () => {
    const fixture = freshFixture('refresh-missing');
    const dbPath = freshDbPath('refresh-missing');
    writeFile(fixture, 'notes/skill.md',
      ['---', 'name: skill', '---', 'Body.'].join('\n'),
    );
    process.chdir(fixture);
    await runScanAndPersist(fixture, dbPath);

    const cap = captureContext();
    const cmd = new SidecarRefreshCommand();
    commonFlags(cmd);
    cmd.db = dbPath; cmd.nodePath = 'notes/skill.md';
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 5);
  });
});

describe('sm sidecar prune', () => {
  it('--dry-run reports orphans without deleting', async () => {
    const fixture = freshFixture('prune-dry');
    const dbPath = freshDbPath('prune-dry');
    // Create a sidecar with no .md sibling — definitely an orphan.
    writeFile(fixture, 'notes/orphan.sm',
      yaml.dump({
        for: { path: 'notes/orphan.md', bodyHash: 'a'.repeat(64), frontmatterHash: 'b'.repeat(64) },
        annotations: {},
      }),
    );
    process.chdir(fixture);
    // No scan needed for prune — it walks the fs.
    await runScanAndPersist(fixture, dbPath);

    const cap = captureContext();
    const cmd = new SidecarPruneCommand();
    commonFlags(cmd);
    cmd.db = dbPath; cmd.dryRun = true; cmd.json = true; cmd.yes = false;
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);
    const env = JSON.parse(cap.stdout()) as { wouldDelete: number; deleted: number };
    strictEqual(env.wouldDelete, 1);
    strictEqual(env.deleted, 0);
    ok(existsSync(join(fixture, 'notes/orphan.sm')), 'file not deleted in --dry-run');
  });

  it('without --dry-run actually deletes the orphan (with --yes to skip prompt)', async () => {
    const fixture = freshFixture('prune-real');
    const dbPath = freshDbPath('prune-real');
    writeFile(fixture, 'notes/orphan.sm',
      yaml.dump({
        for: { path: 'notes/orphan.md', bodyHash: 'a'.repeat(64), frontmatterHash: 'b'.repeat(64) },
        annotations: {},
      }),
    );
    process.chdir(fixture);
    await runScanAndPersist(fixture, dbPath);

    const cap = captureContext();
    const cmd = new SidecarPruneCommand();
    commonFlags(cmd);
    cmd.db = dbPath; cmd.json = true; cmd.yes = true;
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);
    const env = JSON.parse(cap.stdout()) as { deleted: number };
    strictEqual(env.deleted, 1);
    ok(!existsSync(join(fixture, 'notes/orphan.sm')), 'file deleted');
  });

  it('without --dry-run and without --yes, declining the prompt preserves files', async () => {
    const fixture = freshFixture('prune-decline');
    const dbPath = freshDbPath('prune-decline');
    writeFile(fixture, 'notes/orphan.sm',
      yaml.dump({
        for: { path: 'notes/orphan.md', bodyHash: 'a'.repeat(64), frontmatterHash: 'b'.repeat(64) },
        annotations: {},
      }),
    );
    process.chdir(fixture);
    await runScanAndPersist(fixture, dbPath);

    // Inject a fake stdin that answers "n" (decline). The verb must
    // detect the answer, abort, and leave the file in place.
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const stdin = Readable.from(['n\n']);
    const context = {
      stdin,
      stdout: { write: (s: string) => { stdoutChunks.push(s); return true; } },
      stderr: { write: (s: string) => { stderrChunks.push(s); return true; } },
    } as unknown as BaseContext;

    const cmd = new SidecarPruneCommand();
    commonFlags(cmd);
    cmd.db = dbPath; cmd.json = false; cmd.yes = false;
    cmd.context = context;
    strictEqual(await cmd.execute(), 0);
    ok(existsSync(join(fixture, 'notes/orphan.sm')), 'file preserved on decline');
  });
});

describe('sm sidecar annotate', () => {
  it('scaffolds an empty .sm with for + annotations: {}', async () => {
    const fixture = freshFixture('annotate');
    const dbPath = freshDbPath('annotate');
    writeFile(fixture, 'notes/skill.md',
      ['---', 'name: skill', '---', 'Body.'].join('\n'),
    );
    process.chdir(fixture);
    await runScanAndPersist(fixture, dbPath);

    const cap = captureContext();
    const cmd = new SidecarAnnotateCommand();
    commonFlags(cmd);
    cmd.db = dbPath; cmd.nodePath = 'notes/skill.md';
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);

    const sidecarPath = join(fixture, 'notes/skill.sm');
    ok(existsSync(sidecarPath), 'scaffold created');
    const parsed = yaml.load(readFileSync(sidecarPath, 'utf8')) as Record<string, unknown>;
    ok(parsed['for'], 'for: block present');
    const ann = parsed['annotations'] as Record<string, unknown>;
    strictEqual(Object.keys(ann).length, 0, 'annotations is an empty mapping');
  });

  it('refuses to overwrite without --force', async () => {
    const fixture = freshFixture('annotate-clash');
    const dbPath = freshDbPath('annotate-clash');
    writeFile(fixture, 'notes/skill.md',
      ['---', 'name: skill', '---', 'Body.'].join('\n'),
    );
    writeFile(fixture, 'notes/skill.sm',
      yaml.dump({ for: { path: 'notes/skill.md', bodyHash: 'a'.repeat(64), frontmatterHash: 'b'.repeat(64) }, annotations: { version: 9 } }),
    );
    process.chdir(fixture);
    await runScanAndPersist(fixture, dbPath);

    const cap = captureContext();
    const cmd = new SidecarAnnotateCommand();
    commonFlags(cmd);
    cmd.db = dbPath; cmd.nodePath = 'notes/skill.md';
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 2);

    // Original content preserved.
    const after = yaml.load(readFileSync(join(fixture, 'notes/skill.sm'), 'utf8')) as Record<string, unknown>;
    strictEqual((after['annotations'] as Record<string, unknown>)['version'], 9);
  });

  it('--force overwrites an existing sidecar', async () => {
    const fixture = freshFixture('annotate-force');
    const dbPath = freshDbPath('annotate-force');
    writeFile(fixture, 'notes/skill.md',
      ['---', 'name: skill', '---', 'Body.'].join('\n'),
    );
    writeFile(fixture, 'notes/skill.sm',
      yaml.dump({ for: { path: 'notes/skill.md', bodyHash: 'a'.repeat(64), frontmatterHash: 'b'.repeat(64) }, annotations: { version: 9 } }),
    );
    process.chdir(fixture);
    await runScanAndPersist(fixture, dbPath);

    const cap = captureContext();
    const cmd = new SidecarAnnotateCommand();
    commonFlags(cmd);
    cmd.db = dbPath; cmd.nodePath = 'notes/skill.md'; cmd.force = true;
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);
    const after = yaml.load(readFileSync(join(fixture, 'notes/skill.sm'), 'utf8')) as Record<string, unknown>;
    strictEqual(Object.keys(after['annotations'] as Record<string, unknown>).length, 0);
  });
});
