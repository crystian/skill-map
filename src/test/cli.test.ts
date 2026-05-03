import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', 'bin', 'sm.js');
const EMPTY_DIR = resolve(HERE, '..', '.tmp', 'empty-scan-test');

function sm(args: string[], cwd?: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('CLI binary', () => {
  before(() => mkdirSync(EMPTY_DIR, { recursive: true }));
  after(() => rmSync(EMPTY_DIR, { recursive: true, force: true }));

  it('prints version on --version', () => {
    const r = sm(['--version']);
    assert.equal(r.status, 0);
    assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
  });

  it('`sm version` prints the multi-line version matrix with runtime', () => {
    const r = sm(['version']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^sm\s+\d+\.\d+\.\d+/m);
    assert.match(r.stdout, /^kernel\s+/m);
    assert.match(r.stdout, /^spec\s+/m);
    assert.match(r.stdout, /^runtime\s+Node v\d+\.\d+\.\d+/m);
    assert.match(r.stdout, /^db-schema\s+/m);
  });

  it('`sm version` shows db-schema = "—" when no DB is provisioned in the cwd', () => {
    // EMPTY_DIR has no .skill-map/skill-map.db; the `db-schema` field
    // must degrade gracefully to the em-dash sentinel instead of erroring.
    const r = sm(['version'], EMPTY_DIR);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^db-schema\s+—\s*$/m);
  });

  it('`sm version --json` emits the four-field shape (sm, kernel, spec, dbSchema) per spec', () => {
    // `cli-contract.md` § `sm version`: `--json` emits exactly
    // `{ sm, kernel, spec, dbSchema }`. `runtime` is intentionally
    // absent from the JSON surface; expanding it is a spec change.
    const r = sm(['version', '--json'], EMPTY_DIR);
    assert.equal(r.status, 0);
    const payload = JSON.parse(r.stdout) as Record<string, unknown>;
    assert.deepEqual(
      [...Object.keys(payload)].sort(),
      ['dbSchema', 'kernel', 'sm', 'spec'],
    );
    assert.match(String(payload['sm']), /^\d+\.\d+\.\d+/);
    assert.match(String(payload['kernel']), /^\d+\.\d+\.\d+/);
    assert.equal(typeof payload['spec'], 'string');
    // `dbSchema` is the em-dash sentinel when no DB is provisioned.
    assert.equal(payload['dbSchema'], '—');
    // Nothing else lands on stdout.
    assert.equal(r.stderr, '');
  });

  it('`sm version` reports the applied migration version once a DB is provisioned', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'skill-map-version-cli-'));
    try {
      // `sm init --no-scan` creates the DB and applies kernel migrations.
      // After init, `PRAGMA user_version` should equal the latest kernel
      // migration version (currently 1: 001_initial — folded what was
      // 002_scan_meta back in pre-1.0).
      const init = sm(['init', '--no-scan'], tmpDir);
      assert.equal(init.status, 0, `init failed: ${init.stderr}`);
      const r = sm(['version'], tmpDir);
      assert.equal(r.status, 0);
      // Numeric, not the em-dash. Don't pin the exact number — the test
      // adapts to whatever migrations ship today.
      const match = /^db-schema\s+(\d+)\s*$/m.exec(r.stdout);
      assert.ok(match, `db-schema line not numeric: ${r.stdout}`);
      assert.ok(Number(match[1]) >= 1, 'expected at least one migration applied');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('prints usage on --help', () => {
    const r = sm(['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /skill-map/);
    assert.match(r.stdout, /sm scan/);
  });

  it('bare `sm` in a dir without `.skill-map/` prints a hint to stderr and exits 2', () => {
    // Spec contract §Binary: bare invocation MUST point the user at
    // `sm init` and `sm --help` when no project exists in cwd, instead
    // of starting the server (which would have nothing to serve).
    const r = sm([], EMPTY_DIR);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /No skill-map project found/);
    assert.match(r.stderr, /sm init/);
    assert.match(r.stderr, /sm --help/);
  });

  it('scan --json emits a well-formed empty ScanResult', () => {
    const r = sm(['scan', '--json'], EMPTY_DIR);
    assert.equal(r.status, 0);
    const result = JSON.parse(r.stdout);
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.stats.nodesCount, 0);
    assert.equal(result.stats.issuesCount, 0);
    assert.ok(Array.isArray(result.nodes));
    assert.ok(Array.isArray(result.links));
    assert.ok(Array.isArray(result.issues));
  });

  it('scan --json forwards custom roots to the ScanResult', () => {
    // The orchestrator now validates every root exists as a directory
    // (Step 4.11 — guards against `sm scan -- --dry-run` accidentally
    // wiping a populated DB). Create real on-disk subdirs so this test
    // stays focused on the roots-passthrough invariant.
    const a = resolve(EMPTY_DIR, 'a');
    const b = resolve(EMPTY_DIR, 'b');
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    const r = sm(['scan', './a', './b', '--json'], EMPTY_DIR);
    assert.equal(r.status, 0, `unexpected exit ${r.status}; stderr=${r.stderr}`);
    const result = JSON.parse(r.stdout);
    assert.deepEqual(result.roots, ['./a', './b']);
  });

  it('scan without --json emits a human-readable summary', () => {
    const r = sm(['scan'], EMPTY_DIR);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /0 nodes/);
    assert.match(r.stdout, /0 issues/);
  });

  it('Step 5.8: plain `sm scan` (no --changed) fires the rename heuristic when a prior exists', () => {
    // Provision a sandbox with a single file, scan it (populates DB),
    // delete the file, then re-scan WITHOUT --changed. The orphan
    // issue MUST appear because the heuristic now runs on every scan
    // that has a prior to compare against.
    const sandbox = resolve(HERE, '..', '.tmp', 'rename-on-plain-scan');
    rmSync(sandbox, { recursive: true, force: true });
    mkdirSync(resolve(sandbox, '.claude/skills'), { recursive: true });
    const fooPath = resolve(sandbox, '.claude/skills/foo.md');
    const fooContent = [
      '---', 'name: foo', 'metadata:', '  version: 1.0.0', '---',
      '', 'Body of foo.',
    ].join('\n');
    // 1. write + scan (populates DB)
    writeFileSync(fooPath, fooContent);
    const first = sm(['scan'], sandbox);
    assert.equal(first.status, 0, `first scan failed: ${first.stderr}`);

    // Add a sibling so the after-state isn't empty (avoids the
    // --allow-empty guard).
    const keepPath = resolve(sandbox, '.claude/skills/keep.md');
    writeFileSync(
      keepPath,
      [
        '---', 'name: keep', 'metadata:', '  version: 1.0.0', '---',
        '', 'Survivor.',
      ].join('\n'),
    );
    sm(['scan'], sandbox); // re-scan to record both files in prior

    // 2. delete foo.md and re-scan WITHOUT --changed.
    rmSync(fooPath);
    const second = sm(['scan', '--json'], sandbox);
    assert.equal(second.status, 0, `second scan failed: ${second.stderr}`);
    const result = JSON.parse(second.stdout);
    const orphanIssues = (result.issues as Array<{ ruleId: string }>).filter(
      (i) => i.ruleId === 'orphan',
    );
    assert.equal(
      orphanIssues.length,
      1,
      `expected 1 orphan issue from plain sm scan, got ${orphanIssues.length}: ${JSON.stringify(result.issues)}`,
    );

    rmSync(sandbox, { recursive: true, force: true });
  });
});
