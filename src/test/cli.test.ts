import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', 'bin', 'sm.mjs');

function sm(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('CLI binary', () => {
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

  it('prints usage on --help', () => {
    const r = sm(['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /skill-map/);
    assert.match(r.stdout, /sm scan/);
  });

  it('scan --json emits a well-formed empty ScanResult', () => {
    const r = sm(['scan', '--json']);
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
    const r = sm(['scan', './a', './b', '--json']);
    assert.equal(r.status, 0);
    const result = JSON.parse(r.stdout);
    assert.deepEqual(result.roots, ['./a', './b']);
  });

  it('scan without --json emits a human-readable summary', () => {
    const r = sm(['scan']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /0 nodes/);
    assert.match(r.stdout, /0 issues/);
  });
});
