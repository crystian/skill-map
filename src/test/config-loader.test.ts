/**
 * Step 6.2 — Layered config loader. Asserts the six-layer precedence,
 * deep-merge semantics, sources tracking, JSON / schema resilience, and
 * strict-mode escalation.
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, deepStrictEqual, ok, throws, match } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig } from '../kernel/config/loader.js';

let root: string;
let counter = 0;

function freshScope(label: string): { home: string; cwd: string } {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  const home = join(dir, 'home');
  const cwd = join(dir, 'cwd');
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  return { home, cwd };
}

function writeSettings(scopeRoot: string, kind: 'settings' | 'settings.local', body: unknown): void {
  const dir = join(scopeRoot, '.skill-map');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${kind}.json`), JSON.stringify(body));
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-config-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('config loader — defaults', () => {
  it('applies defaults when no files exist', () => {
    const { home, cwd } = freshScope('defaults');
    const { effective, sources, warnings } = loadConfig({ scope: 'project', cwd, homedir: home });

    strictEqual(warnings.length, 0);
    strictEqual(effective.schemaVersion, 1);
    strictEqual(effective.autoMigrate, true);
    strictEqual(effective.tokenizer, 'cl100k_base');
    strictEqual(effective.scan.tokenize, true);
    strictEqual(effective.scan.maxFileSizeBytes, 1048576);
    strictEqual(effective.jobs.minimumTtlSeconds, 60);
    strictEqual(effective.jobs.retention.completed, 2592000);
    strictEqual(effective.jobs.retention.failed, null);
    strictEqual(effective.history.share, false);
    strictEqual(effective.i18n.locale, 'en');

    // Every key tracked back to defaults.
    strictEqual(sources.get('autoMigrate'), 'defaults');
    strictEqual(sources.get('scan.tokenize'), 'defaults');
    strictEqual(sources.get('jobs.retention.completed'), 'defaults');
    strictEqual(sources.get('jobs.retention.failed'), 'defaults');
  });
});

describe('config loader — layer precedence', () => {
  it('user overrides defaults', () => {
    const { home, cwd } = freshScope('user');
    writeSettings(home, 'settings', { tokenizer: 'gpt-4' });
    const { effective, sources } = loadConfig({ scope: 'project', cwd, homedir: home });
    strictEqual(effective.tokenizer, 'gpt-4');
    strictEqual(sources.get('tokenizer'), 'user');
    strictEqual(sources.get('autoMigrate'), 'defaults');
  });

  it('user-local overrides user', () => {
    const { home, cwd } = freshScope('user-local');
    writeSettings(home, 'settings', { tokenizer: 'gpt-4' });
    writeSettings(home, 'settings.local', { tokenizer: 'o200k_base' });
    const { effective, sources } = loadConfig({ scope: 'project', cwd, homedir: home });
    strictEqual(effective.tokenizer, 'o200k_base');
    strictEqual(sources.get('tokenizer'), 'user-local');
  });

  it('project overrides user-local', () => {
    const { home, cwd } = freshScope('project');
    writeSettings(home, 'settings.local', { tokenizer: 'o200k_base' });
    writeSettings(cwd, 'settings', { tokenizer: 'p50k_base' });
    const { effective, sources } = loadConfig({ scope: 'project', cwd, homedir: home });
    strictEqual(effective.tokenizer, 'p50k_base');
    strictEqual(sources.get('tokenizer'), 'project');
  });

  it('project-local overrides project', () => {
    const { home, cwd } = freshScope('project-local');
    writeSettings(cwd, 'settings', { tokenizer: 'p50k_base' });
    writeSettings(cwd, 'settings.local', { tokenizer: 'r50k_base' });
    const { effective, sources } = loadConfig({ scope: 'project', cwd, homedir: home });
    strictEqual(effective.tokenizer, 'r50k_base');
    strictEqual(sources.get('tokenizer'), 'project-local');
  });

  it('overrides layer wins over every file layer', () => {
    const { home, cwd } = freshScope('override');
    writeSettings(cwd, 'settings.local', { tokenizer: 'r50k_base' });
    const { effective, sources } = loadConfig({
      scope: 'project',
      cwd,
      homedir: home,
      overrides: { tokenizer: 'override-value' },
    });
    strictEqual(effective.tokenizer, 'override-value');
    strictEqual(sources.get('tokenizer'), 'override');
  });
});

describe('config loader — global scope', () => {
  it('skips project layers (would double-merge user files)', () => {
    const { home, cwd } = freshScope('global-scope');
    writeSettings(home, 'settings', { tokenizer: 'user-value' });
    // Project files exist BUT are user files in disguise when scope=global.
    // Layers 4/5 (project / project-local) MUST be skipped to avoid double-merging.
    writeSettings(cwd, 'settings', { tokenizer: 'project-value' });
    const { effective, sources } = loadConfig({ scope: 'global', cwd, homedir: home });
    strictEqual(effective.tokenizer, 'user-value');
    strictEqual(sources.get('tokenizer'), 'user');
  });
});

describe('config loader — deep merge semantics', () => {
  it('merges nested objects per key', () => {
    const { home, cwd } = freshScope('deep-merge');
    writeSettings(home, 'settings', { scan: { tokenize: false } });
    writeSettings(cwd, 'settings', { scan: { strict: true } });
    const { effective, sources } = loadConfig({ scope: 'project', cwd, homedir: home });
    strictEqual(effective.scan.tokenize, false);  // from user
    strictEqual(effective.scan.strict, true);     // from project
    strictEqual(effective.scan.followSymlinks, false); // from defaults
    strictEqual(sources.get('scan.tokenize'), 'user');
    strictEqual(sources.get('scan.strict'), 'project');
    strictEqual(sources.get('scan.followSymlinks'), 'defaults');
  });

  it('replaces arrays whole-cloth (no element-wise merge)', () => {
    const { home, cwd } = freshScope('arrays');
    writeSettings(home, 'settings', { ignore: ['a', 'b'] });
    writeSettings(cwd, 'settings', { ignore: ['c'] });
    const { effective } = loadConfig({ scope: 'project', cwd, homedir: home });
    deepStrictEqual(effective.ignore, ['c']);
  });

  it('preserves null values (e.g. retention.failed)', () => {
    const { home, cwd } = freshScope('null-preserve');
    writeSettings(home, 'settings', { jobs: { retention: { completed: 1000 } } });
    const { effective } = loadConfig({ scope: 'project', cwd, homedir: home });
    strictEqual(effective.jobs.retention.completed, 1000);
    strictEqual(effective.jobs.retention.failed, null);
  });
});

describe('config loader — resilience', () => {
  it('warns + skips on malformed JSON', () => {
    const { home, cwd } = freshScope('malformed');
    mkdirSync(join(home, '.skill-map'), { recursive: true });
    writeFileSync(join(home, '.skill-map', 'settings.json'), '{ this is not json');
    const { effective, warnings } = loadConfig({ scope: 'project', cwd, homedir: home });
    strictEqual(effective.tokenizer, 'cl100k_base'); // defaults applied
    strictEqual(warnings.length, 1);
    match(warnings[0]!, /invalid JSON/);
    match(warnings[0]!, /\[config:user\]/);
  });

  it('strips unknown keys (additionalProperties: false)', () => {
    const { home, cwd } = freshScope('unknown-key');
    writeSettings(home, 'settings', { tokenizer: 'gpt-4', bogus: 'nope' });
    const { effective, warnings } = loadConfig({ scope: 'project', cwd, homedir: home });
    strictEqual(effective.tokenizer, 'gpt-4'); // valid key preserved
    ok(!('bogus' in (effective as unknown as Record<string, unknown>)));
    strictEqual(warnings.length, 1);
    match(warnings[0]!, /unknown key/);
    match(warnings[0]!, /bogus/);
  });

  it('strips type-mismatched values', () => {
    const { home, cwd } = freshScope('type-mismatch');
    writeSettings(home, 'settings', { autoMigrate: 'yes-please' }); // should be boolean
    const { effective, warnings } = loadConfig({ scope: 'project', cwd, homedir: home });
    strictEqual(effective.autoMigrate, true); // default kept
    strictEqual(warnings.length, 1);
    match(warnings[0]!, /invalid value/);
    match(warnings[0]!, /autoMigrate/);
  });

  it('continues past one bad key to apply the rest of the file', () => {
    const { home, cwd } = freshScope('partial-bad');
    writeSettings(home, 'settings', { tokenizer: 'gpt-4', autoMigrate: 'string-not-bool' });
    const { effective, warnings } = loadConfig({ scope: 'project', cwd, homedir: home });
    strictEqual(effective.tokenizer, 'gpt-4');     // good key applied
    strictEqual(effective.autoMigrate, true);       // bad key dropped, default kept
    strictEqual(warnings.length, 1);
  });

  it('warns + ignores when the file is not a JSON object', () => {
    const { home, cwd } = freshScope('not-object');
    mkdirSync(join(home, '.skill-map'), { recursive: true });
    writeFileSync(join(home, '.skill-map', 'settings.json'), '[1, 2, 3]');
    const { warnings } = loadConfig({ scope: 'project', cwd, homedir: home });
    strictEqual(warnings.length, 1);
    match(warnings[0]!, /expected a JSON object/);
  });
});

describe('config loader — strict mode', () => {
  it('throws on malformed JSON', () => {
    const { home, cwd } = freshScope('strict-json');
    mkdirSync(join(home, '.skill-map'), { recursive: true });
    writeFileSync(join(home, '.skill-map', 'settings.json'), '{');
    throws(
      () => loadConfig({ scope: 'project', cwd, homedir: home, strict: true }),
      /invalid JSON/,
    );
  });

  it('throws on schema violation', () => {
    const { home, cwd } = freshScope('strict-schema');
    writeSettings(home, 'settings', { autoMigrate: 42 });
    throws(
      () => loadConfig({ scope: 'project', cwd, homedir: home, strict: true }),
      /invalid value/,
    );
  });

  it('throws on unknown key', () => {
    const { home, cwd } = freshScope('strict-unknown');
    writeSettings(home, 'settings', { unrecognised: 'key' });
    throws(
      () => loadConfig({ scope: 'project', cwd, homedir: home, strict: true }),
      /unknown key/,
    );
  });
});
