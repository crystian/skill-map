/**
 * Step 6.5 — `sm init` end-to-end through the real binary. Each test
 * isolates HOME and cwd so the host's `~/.skill-map/` is never touched.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', 'bin', 'sm.mjs');

let root: string;
let counter = 0;

interface IScope {
  cwd: string;
  home: string;
}

function freshScope(label: string): IScope {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  const cwd = join(dir, 'cwd');
  const home = join(dir, 'home');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { cwd, home };
}

function sm(
  args: string[],
  scope: IScope,
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: scope.cwd,
    env: { ...process.env, HOME: scope.home, USERPROFILE: scope.home },
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-init-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sm init — project scope', () => {
  it('scaffolds .skill-map/ with settings + ignore + DB and runs first scan', () => {
    const scope = freshScope('basic');
    const r = sm(['init', '--no-scan'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(existsSync(join(scope.cwd, '.skill-map', 'settings.json')));
    assert.ok(existsSync(join(scope.cwd, '.skill-map', 'settings.local.json')));
    assert.ok(existsSync(join(scope.cwd, '.skill-map', 'skill-map.db')));
    assert.ok(existsSync(join(scope.cwd, '.skill-mapignore')));

    const settings = JSON.parse(
      readFileSync(join(scope.cwd, '.skill-map', 'settings.json'), 'utf8'),
    );
    assert.equal(settings.schemaVersion, 1);
    const local = JSON.parse(
      readFileSync(join(scope.cwd, '.skill-map', 'settings.local.json'), 'utf8'),
    );
    assert.deepEqual(local, {});
    const ignoreText = readFileSync(join(scope.cwd, '.skill-mapignore'), 'utf8');
    assert.match(ignoreText, /node_modules\//);
    assert.match(ignoreText, /\.git\//);
  });

  it('appends to .gitignore (creates if missing)', () => {
    const scope = freshScope('gitignore-create');
    const r = sm(['init', '--no-scan'], scope);
    assert.equal(r.status, 0);
    const gitignore = readFileSync(join(scope.cwd, '.gitignore'), 'utf8');
    assert.match(gitignore, /\.skill-map\/settings\.local\.json/);
    assert.match(gitignore, /\.skill-map\/skill-map\.db/);
  });

  it('appends to existing .gitignore without duplicating entries', () => {
    const scope = freshScope('gitignore-merge');
    writeFileSync(
      join(scope.cwd, '.gitignore'),
      'dist\nnode_modules\n.skill-map/skill-map.db\n',
    );
    const r = sm(['init', '--no-scan'], scope);
    assert.equal(r.status, 0);
    const lines = readFileSync(join(scope.cwd, '.gitignore'), 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    const dbCount = lines.filter((l) => l === '.skill-map/skill-map.db').length;
    assert.equal(dbCount, 1, 'must not duplicate existing entry');
    assert.ok(lines.includes('.skill-map/settings.local.json'));
  });

  it('errors with exit 2 when re-running over an existing scope without --force', () => {
    const scope = freshScope('reinit-blocked');
    sm(['init', '--no-scan'], scope);
    const r = sm(['init', '--no-scan'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /already exists/);
  });

  it('--force overwrites existing files', () => {
    const scope = freshScope('reinit-force');
    sm(['init', '--no-scan'], scope);
    // Mutate settings.json to detect overwrite.
    writeFileSync(
      join(scope.cwd, '.skill-map', 'settings.json'),
      JSON.stringify({ schemaVersion: 1, tokenizer: 'gpt-4' }, null, 2) + '\n',
    );
    const r = sm(['init', '--no-scan', '--force'], scope);
    assert.equal(r.status, 0);
    const settings = JSON.parse(
      readFileSync(join(scope.cwd, '.skill-map', 'settings.json'), 'utf8'),
    );
    assert.deepEqual(settings, { schemaVersion: 1 });
  });

  it('runs first scan by default (smoke: nodes counted in stdout)', () => {
    const scope = freshScope('first-scan');
    // Drop one .claude/agents/foo.md so the scan finds something.
    const agentDir = join(scope.cwd, '.claude', 'agents');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'foo.md'),
      '---\nname: foo\nkind: agent\n---\nbody\n',
    );
    const r = sm(['init'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /Running first scan/);
    assert.match(r.stdout, /First scan: 1 node\(s\)/);
  });
});

describe('sm init — global scope (-g)', () => {
  it('scaffolds under HOME/.skill-map and does not write .gitignore', () => {
    const scope = freshScope('global');
    const r = sm(['init', '-g', '--no-scan'], scope);
    assert.equal(r.status, 0);
    assert.ok(existsSync(join(scope.home, '.skill-map', 'settings.json')));
    assert.ok(existsSync(join(scope.home, '.skill-map', 'skill-map.db')));
    assert.ok(existsSync(join(scope.home, '.skill-mapignore')));
    // No .gitignore in HOME — never write there.
    assert.equal(existsSync(join(scope.home, '.gitignore')), false);
    // And nothing leaks into cwd.
    assert.equal(existsSync(join(scope.cwd, '.skill-map')), false);
  });
});
