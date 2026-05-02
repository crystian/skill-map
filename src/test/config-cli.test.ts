/**
 * Step 6.3 — `sm config list / get / set / reset / show` end-to-end through
 * the real binary. Each test isolates HOME and cwd so the host's
 * `~/.skill-map/` is never touched.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', 'bin', 'sm.js');

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

function writeSettings(scopeRoot: string, body: unknown, kind: 'settings' | 'settings.local' = 'settings'): void {
  const dir = join(scopeRoot, '.skill-map');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${kind}.json`), JSON.stringify(body));
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
  root = mkdtempSync(join(tmpdir(), 'skill-map-config-cli-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sm config list', () => {
  it('returns defaults when no settings files exist', () => {
    const scope = freshScope('list-defaults');
    const r = sm(['config', 'list', '--json'], scope);
    assert.equal(r.status, 0);
    const obj = JSON.parse(r.stdout);
    assert.equal(obj.tokenizer, 'cl100k_base');
    assert.equal(obj.scan.tokenize, true);
    assert.equal(obj.jobs.minimumTtlSeconds, 60);
  });

  it('reads project layer and prints sorted dot-paths in human mode', () => {
    const scope = freshScope('list-human');
    writeSettings(scope.cwd, { tokenizer: 'gpt-4' });
    const r = sm(['config', 'list'], scope);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^autoMigrate = true$/m);
    assert.match(r.stdout, /^tokenizer = gpt-4$/m);
    assert.match(r.stdout, /^scan\.tokenize = true$/m);
  });

  it('--json emits the merged object', () => {
    const scope = freshScope('list-json');
    writeSettings(scope.cwd, { scan: { strict: true } });
    const r = sm(['config', 'list', '--json'], scope);
    assert.equal(r.status, 0);
    const obj = JSON.parse(r.stdout);
    assert.equal(obj.scan.strict, true);
    assert.equal(obj.scan.tokenize, true); // from defaults
  });
});

describe('sm config get', () => {
  it('returns a leaf value', () => {
    const scope = freshScope('get-leaf');
    writeSettings(scope.cwd, { tokenizer: 'gpt-4' });
    const r = sm(['config', 'get', 'tokenizer'], scope);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), 'gpt-4');
  });

  it('returns a nested object as JSON in human mode', () => {
    const scope = freshScope('get-object');
    const r = sm(['config', 'get', 'scan'], scope);
    assert.equal(r.status, 0);
    const obj = JSON.parse(r.stdout);
    assert.equal(obj.tokenize, true);
  });

  it('--json wraps strings as JSON literals', () => {
    const scope = freshScope('get-json');
    const r = sm(['config', 'get', 'tokenizer', '--json'], scope);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '"cl100k_base"');
  });

  it('exit 5 on unknown key', () => {
    const scope = freshScope('get-unknown');
    const r = sm(['config', 'get', 'nope.nope'], scope);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /Unknown config key/);
  });
});

describe('sm config show', () => {
  it('--source surfaces the winning layer', () => {
    const scope = freshScope('show-source');
    writeSettings(scope.cwd, { tokenizer: 'p50k_base' });
    const r = sm(['config', 'show', 'tokenizer', '--source'], scope);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /p50k_base\s+\(from project\)/);
  });

  it('--source on a nested object reports the highest-precedence descendant', () => {
    const scope = freshScope('show-nested');
    writeSettings(scope.home, { scan: { tokenize: false } });
    writeSettings(scope.cwd, { scan: { strict: true } });
    const r = sm(['config', 'show', 'scan', '--source'], scope);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\(from project\)/);
  });

  it('--source --json emits { value, source }', () => {
    const scope = freshScope('show-json');
    writeSettings(scope.cwd, { tokenizer: 'gpt-4' });
    const r = sm(['config', 'show', 'tokenizer', '--source', '--json'], scope);
    assert.equal(r.status, 0);
    const payload = JSON.parse(r.stdout);
    assert.equal(payload.value, 'gpt-4');
    assert.equal(payload.source, 'project');
  });

  it('without --source behaves like get', () => {
    const scope = freshScope('show-no-source');
    const r = sm(['config', 'show', 'tokenizer'], scope);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), 'cl100k_base');
  });
});

describe('sm config set', () => {
  it('writes to project file by default and coerces JSON-like values', () => {
    const scope = freshScope('set-project');
    const r = sm(['config', 'set', 'autoMigrate', 'false'], scope);
    assert.equal(r.status, 0);
    const path = join(scope.cwd, '.skill-map', 'settings.json');
    const written = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(written.autoMigrate, false); // boolean, not string
  });

  it('-g writes to the user file', () => {
    const scope = freshScope('set-user');
    const r = sm(['config', 'set', 'tokenizer', 'gpt-4', '-g'], scope);
    assert.equal(r.status, 0);
    const userPath = join(scope.home, '.skill-map', 'settings.json');
    const projectPath = join(scope.cwd, '.skill-map', 'settings.json');
    assert.equal(existsSync(projectPath), false);
    const written = JSON.parse(readFileSync(userPath, 'utf8'));
    assert.equal(written.tokenizer, 'gpt-4');
  });

  it('coerces numbers and nested dot-paths', () => {
    const scope = freshScope('set-nested');
    const r = sm(['config', 'set', 'jobs.minimumTtlSeconds', '120'], scope);
    assert.equal(r.status, 0);
    const written = JSON.parse(
      readFileSync(join(scope.cwd, '.skill-map', 'settings.json'), 'utf8'),
    );
    assert.equal(written.jobs.minimumTtlSeconds, 120);
    assert.equal(typeof written.jobs.minimumTtlSeconds, 'number');
  });

  it('rejects schema-violating values without writing the file', () => {
    const scope = freshScope('set-invalid');
    const r = sm(['config', 'set', 'autoMigrate', 'maybe'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Invalid config/);
    assert.equal(existsSync(join(scope.cwd, '.skill-map', 'settings.json')), false);
  });

  it('preserves unrelated keys when setting a new one', () => {
    const scope = freshScope('set-preserve');
    writeSettings(scope.cwd, { tokenizer: 'gpt-4' });
    const r = sm(['config', 'set', 'autoMigrate', 'false'], scope);
    assert.equal(r.status, 0);
    const written = JSON.parse(
      readFileSync(join(scope.cwd, '.skill-map', 'settings.json'), 'utf8'),
    );
    assert.equal(written.tokenizer, 'gpt-4');
    assert.equal(written.autoMigrate, false);
  });

  it('emits done-in stderr (set is in-scope per cli-contract)', () => {
    const scope = freshScope('set-elapsed');
    const r = sm(['config', 'set', 'tokenizer', 'gpt-4'], scope);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /^done in /m);
  });

  // Audit M5 — atomic write. The set verb stages content into a sibling
  // `<settings>.tmp.<pid>` file and `renameSync`s it into place so a
  // crash mid-write leaves the destination either at its prior content
  // or at the new content — never half-written. The asymptotic check
  // here (no `<settings>.tmp.*` siblings remain after a successful
  // write) confirms the rename happened and the temp was reaped. We
  // skip the "interrupt mid-write" simulation as too brittle; this
  // pins the surface guarantee.
  it('atomic write: leaves no <settings>.tmp.<pid> sibling after a successful set', () => {
    const scope = freshScope('set-atomic');
    const r = sm(['config', 'set', 'tokenizer', 'gpt-4'], scope);
    assert.equal(r.status, 0);
    const dir = join(scope.cwd, '.skill-map');
    const written = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
    assert.equal(written.tokenizer, 'gpt-4', 'main settings file is updated');
    // No `settings.json.tmp.<pid>` sibling lingers after the rename —
    // the atomic-write helper either renames into place (success) or
    // unlinks the staged file in its `catch` (failure).
    const siblings = readdirSync(dir).filter((name) => name.startsWith('settings.json.tmp.'));
    assert.deepEqual(siblings, [], `expected no tmp siblings; got ${JSON.stringify(siblings)}`);
  });
});

describe('sm config reset', () => {
  it('removes a previously-set key from the project file', () => {
    const scope = freshScope('reset-basic');
    writeSettings(scope.cwd, { tokenizer: 'gpt-4', autoMigrate: false });
    const r = sm(['config', 'reset', 'autoMigrate'], scope);
    assert.equal(r.status, 0);
    const written = JSON.parse(
      readFileSync(join(scope.cwd, '.skill-map', 'settings.json'), 'utf8'),
    );
    assert.equal('autoMigrate' in written, false);
    assert.equal(written.tokenizer, 'gpt-4');
  });

  it('idempotent on absent key (exit 0, no write)', () => {
    const scope = freshScope('reset-absent');
    const r = sm(['config', 'reset', 'tokenizer'], scope);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /No override/);
  });

  it('-g resets in the user file', () => {
    const scope = freshScope('reset-global');
    writeSettings(scope.home, { tokenizer: 'gpt-4' });
    const r = sm(['config', 'reset', 'tokenizer', '-g'], scope);
    assert.equal(r.status, 0);
    const written = JSON.parse(
      readFileSync(join(scope.home, '.skill-map', 'settings.json'), 'utf8'),
    );
    assert.equal('tokenizer' in written, false);
  });

  it('prunes empty parent objects after deleting nested key', () => {
    const scope = freshScope('reset-prune');
    writeSettings(scope.cwd, { jobs: { minimumTtlSeconds: 120 } });
    const r = sm(['config', 'reset', 'jobs.minimumTtlSeconds'], scope);
    assert.equal(r.status, 0);
    const written = JSON.parse(
      readFileSync(join(scope.cwd, '.skill-map', 'settings.json'), 'utf8'),
    );
    assert.equal('jobs' in written, false);
  });
});

describe('sm config — --strict UX', () => {
  it('without --strict: warning to stderr, exit 0', () => {
    const scope = freshScope('strict-warn');
    writeSettings(scope.cwd, { bogus_key: 'nope' });
    const r = sm(['config', 'list'], scope);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /unknown key bogus_key/);
    assert.match(r.stdout, /^autoMigrate = true$/m);
  });

  it('--strict: clean stderr message + exit 2 (no Clipanion stack trace)', () => {
    const scope = freshScope('strict-error');
    writeSettings(scope.cwd, { bogus_key: 'nope' });
    const r = sm(['config', 'list', '--strict'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^sm config: /);
    assert.match(r.stderr, /unknown key bogus_key/);
    // Crucially NO stack trace leaking through.
    assert.ok(!r.stderr.includes('Internal Error'), `stack trace leaked: ${r.stderr}`);
    assert.ok(!r.stderr.includes('    at '), `stack trace leaked: ${r.stderr}`);
  });

  it('--strict also wraps `config get`', () => {
    const scope = freshScope('strict-get');
    writeSettings(scope.cwd, { autoMigrate: 'not-a-bool' });
    const r = sm(['config', 'get', 'autoMigrate', '--strict'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^sm config: /);
    assert.ok(!r.stderr.includes('Internal Error'));
  });

  it('--strict also wraps `config show`', () => {
    const scope = freshScope('strict-show');
    writeSettings(scope.cwd, { autoMigrate: 42 });
    const r = sm(['config', 'show', 'autoMigrate', '--strict'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^sm config: /);
    assert.ok(!r.stderr.includes('Internal Error'));
  });

  it('--strict: malformed JSON → clean message + exit 2', () => {
    const scope = freshScope('strict-bad-json');
    mkdirSync(join(scope.cwd, '.skill-map'), { recursive: true });
    writeFileSync(join(scope.cwd, '.skill-map', 'settings.json'), '{ not json');
    const r = sm(['config', 'list', '--strict'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^sm config: /);
    assert.match(r.stderr, /invalid JSON/);
    assert.ok(!r.stderr.includes('Internal Error'));
  });
});

describe('sm config — prototype-pollution defence (audit H2)', () => {
  for (const segment of ['__proto__', 'constructor', 'prototype']) {
    it(`config set rejects "${segment}" segment with a clean error`, () => {
      const scope = freshScope(`set-${segment}`);
      const r = sm(['config', 'set', `${segment}.polluted`, 'true'], scope);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /forbidden key segment/);
      assert.match(r.stderr, new RegExp(segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      // No file written.
      assert.ok(!existsSync(join(scope.cwd, '.skill-map', 'settings.json')));
    });

    it(`config set rejects nested "${segment}" segment`, () => {
      const scope = freshScope(`set-nested-${segment}`);
      const r = sm(['config', 'set', `scan.${segment}.x`, 'true'], scope);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /forbidden key segment/);
    });

    it(`config get rejects "${segment}" segment without exposing prototype data`, () => {
      const scope = freshScope(`get-${segment}`);
      const r = sm(['config', 'get', `${segment}.polluted`], scope);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /forbidden key segment/);
      assert.equal(r.stdout, '');
    });

    it(`config reset rejects "${segment}" segment`, () => {
      const scope = freshScope(`reset-${segment}`);
      writeSettings(scope.cwd, { autoMigrate: false });
      const r = sm(['config', 'reset', `${segment}.x`], scope);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /forbidden key segment/);
      // Pre-existing settings file untouched.
      const written = JSON.parse(
        readFileSync(join(scope.cwd, '.skill-map', 'settings.json'), 'utf8'),
      ) as Record<string, unknown>;
      assert.equal(written['autoMigrate'], false);
    });
  }
});
