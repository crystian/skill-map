/**
 * End-to-end coverage of the conformance runner's `setup.disableAll*`
 * → env-var pipeline. Lands the contract that was missing pre-Plan B:
 * the schema declared the toggles, the runner accepted them, but
 * nothing actually consumed them — the original `kernel-empty-boot`
 * case happened to pass because the fixture was empty.
 *
 * These tests author a synthetic case in tmp that points at a
 * **populated** fixture and toggles each kill-switch in turn. If the
 * runner correctly injects `SKILL_MAP_DISABLE_ALL_*=1` and the scan
 * composer correctly filters by kind, the asserted counts (`nodesCount`,
 * `linksCount`, `issuesCount`) drop to zero even though the fixture
 * contains real files.
 *
 * Three sub-cases cover the three kinds:
 *   (a) `disableAllProviders: true` — no Provider walks the tree, so
 *       no nodes are produced.
 *   (b) `disableAllExtractors: true` — Provider still walks (nodes > 0)
 *       but no extractors run, so no links emit.
 *   (c) `disableAllRules: true` — extractors emit links, but no rules
 *       fire issues.
 *
 * A fourth case proves the inverse: with NO toggles, the same fixture
 * yields the populated baseline. Without that anchor a regression where
 * the toggles never fire would be invisible (counts stay at the
 * baseline regardless).
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { runConformanceCase } from '../conformance/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = resolve(HERE, '..');
const REPO_ROOT = resolve(WORKSPACE, '..');
const SPEC_ROOT = resolve(REPO_ROOT, 'spec');
const BIN = resolve(WORKSPACE, 'bin', 'sm.js');

const CLAUDE_FIXTURES_DIR = resolve(
  WORKSPACE,
  'built-in-plugins',
  'providers',
  'claude',
  'conformance',
  'fixtures',
);

interface IDisableToggles {
  disableAllProviders?: boolean;
  disableAllExtractors?: boolean;
  disableAllRules?: boolean;
}

function writeCase(toggles: IDisableToggles): string {
  const dir = mkdtempSync(join(tmpdir(), 'sm-disable-flags-case-'));
  const casePath = join(dir, 'populated-fixture-disabled.json');
  writeFileSync(
    casePath,
    JSON.stringify({
      $schema: 'https://skill-map.dev/spec/v0/conformance-case.schema.json',
      id: 'populated-fixture-disabled',
      description: 'Synthetic case covering the disableAll* env-var pipeline.',
      fixture: 'minimal-claude',
      setup: toggles,
      invoke: { verb: 'scan', flags: ['--json'] },
      assertions: [{ type: 'exit-code', value: 0 }],
    }),
    'utf8',
  );
  return casePath;
}

function jsonValue(stdout: string, dottedPath: string): unknown {
  const parsed = JSON.parse(stdout);
  let cursor: unknown = parsed;
  for (const segment of dottedPath.split('.')) {
    if (cursor && typeof cursor === 'object' && segment in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return cursor;
}

describe('conformance runner — disableAll* env-var pipeline', () => {
  it('baseline (no toggles) on minimal-claude → populated ScanResult', () => {
    const casePath = writeCase({});
    const result = runConformanceCase({
      binary: BIN,
      specRoot: SPEC_ROOT,
      casePath,
      fixturesRoot: CLAUDE_FIXTURES_DIR,
    });
    rmSync(dirname(casePath), { recursive: true, force: true });
    assert.equal(result.exitCode, 0, result.stderr);
    const nodesCount = jsonValue(result.stdout, 'stats.nodesCount') as number;
    const linksCount = jsonValue(result.stdout, 'stats.linksCount') as number;
    assert.ok(nodesCount > 0, `baseline must have nodes; saw ${nodesCount}`);
    assert.ok(linksCount > 0, `baseline must have links; saw ${linksCount}`);
  });

  it('(a) disableAllProviders=true on populated fixture → 0 nodes', () => {
    const casePath = writeCase({ disableAllProviders: true });
    const result = runConformanceCase({
      binary: BIN,
      specRoot: SPEC_ROOT,
      casePath,
      fixturesRoot: CLAUDE_FIXTURES_DIR,
    });
    rmSync(dirname(casePath), { recursive: true, force: true });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(jsonValue(result.stdout, 'stats.nodesCount'), 0);
    assert.equal(jsonValue(result.stdout, 'stats.linksCount'), 0);
  });

  it('(b) disableAllExtractors=true on populated fixture → nodes > 0, 0 links', () => {
    const casePath = writeCase({ disableAllExtractors: true });
    const result = runConformanceCase({
      binary: BIN,
      specRoot: SPEC_ROOT,
      casePath,
      fixturesRoot: CLAUDE_FIXTURES_DIR,
    });
    rmSync(dirname(casePath), { recursive: true, force: true });
    assert.equal(result.exitCode, 0, result.stderr);
    const nodesCount = jsonValue(result.stdout, 'stats.nodesCount') as number;
    assert.ok(nodesCount > 0, `Provider should still walk; saw ${nodesCount} nodes`);
    assert.equal(jsonValue(result.stdout, 'stats.linksCount'), 0, 'no extractor → no links');
  });

  it('(c) disableAllRules=true on populated fixture → nodes > 0, 0 issues', () => {
    const casePath = writeCase({ disableAllRules: true });
    const result = runConformanceCase({
      binary: BIN,
      specRoot: SPEC_ROOT,
      casePath,
      fixturesRoot: CLAUDE_FIXTURES_DIR,
    });
    rmSync(dirname(casePath), { recursive: true, force: true });
    assert.equal(result.exitCode, 0, result.stderr);
    const nodesCount = jsonValue(result.stdout, 'stats.nodesCount') as number;
    assert.ok(nodesCount > 0, `Provider + extractors still run; saw ${nodesCount} nodes`);
    assert.equal(jsonValue(result.stdout, 'stats.issuesCount'), 0, 'no rule → no issues');
  });
});
