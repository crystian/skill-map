/**
 * Step 9.1 acceptance tests — drop-in plugins participate in the read-side
 * pipeline.
 *
 * Up to v0.4.0, `PluginLoader` only fed the `sm plugins` introspection
 * verbs. `sm scan`, `sm graph`, and friends ran on built-ins exclusively.
 * Step 9.1 wires the loader into the runtime: a plugin dropped under
 * `<scope>/.skill-map/plugins/<id>/` shows up in scan output (its
 * extractors emit links, its rules emit issues) and `sm graph --format
 * <plugin-format>` resolves through the same formatter registry as the
 * built-in `ascii` formatter.
 *
 * Tests cover:
 *
 *   1. Plugin extractor contributes a link kind to the persisted scan.
 *   2. `--no-plugins` skips discovery entirely.
 *   3. A broken plugin (malformed manifest) emits a stderr warning but
 *      `sm scan` keeps running and persists the built-in result.
 *   4. Plugin formatter is selectable via `sm graph --format <plugin>`.
 *
 * The tests use `process.chdir(fixture)` rather than spawnSync so they
 * exercise the actual command code without needing a `dist/` build. Each
 * `it` restores the original cwd in a `finally` block.
 */

import { after, before, describe, it } from 'node:test';
import { match, ok, strictEqual } from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BaseContext } from 'clipanion';

import { GraphCommand } from '../cli/commands/graph.js';
import { ScanCommand } from '../cli/commands/scan.js';
import type { ScanResult } from '../kernel/index.js';

let tmpRoot: string;
let counter = 0;

function freshFixture(label: string): string {
  counter += 1;
  return mkdtempSync(join(tmpRoot, `${label}-${counter}-`));
}

function writeFixtureFile(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-9-1-'));
});

after(() => {
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

interface IBuildScanOpts {
  noPlugins?: boolean;
  json?: boolean;
}

function buildScan(opts: IBuildScanOpts = {}): ScanCommand {
  const cmd = new ScanCommand();
  cmd.roots = [];
  cmd.json = opts.json ?? false;
  cmd.noBuiltIns = false;
  cmd.noPlugins = opts.noPlugins ?? false;
  cmd.noTokens = true;
  cmd.dryRun = false;
  cmd.changed = false;
  cmd.allowEmpty = false;
  cmd.strict = false;
  cmd.watch = false;
  return cmd;
}

function buildGraph(opts: { format: string; noPlugins?: boolean }): GraphCommand {
  const cmd = new GraphCommand();
  cmd.format = opts.format;
  cmd.global = false;
  cmd.db = undefined;
  cmd.noPlugins = opts.noPlugins ?? false;
  return cmd;
}

/** Lay down a single skill node so scan has something to chew on. */
function plantClaudeFixture(root: string): void {
  writeFixtureFile(
    root,
    '.claude/skills/explorer.md',
    [
      '---',
      'name: explorer',
      'description: Explores the skill map.',
      'metadata:',
      '  version: 1.0.0',
      '---',
      '',
      'Body: see https://example.com/explorer for context.',
    ].join('\n'),
  );
}

/**
 * Plant a working plugin with one extractor that always emits a single
 * `references` link with a synthetic target. The unique target lets the
 * test assert "this exact link came from the plugin and not from any
 * built-in extractor".
 */
function plantPluginExtractor(root: string, id: string, target: string): void {
  const dir = join(root, '.skill-map', 'plugins', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({
      id,
      version: '1.0.0',
      specCompat: '>=0.0.0',
      extensions: ['./extractor.mjs'],
    }),
  );
  writeFileSync(
    join(dir, 'extractor.mjs'),
    `
      export default {
        id: '${id}-extractor',
        kind: 'extractor',
        version: '1.0.0',
        description: 'Step 9.1 fixture extractor — emits one synthetic reference per node.',
        emitsLinkKinds: ['references'],
        defaultConfidence: 'high',
        extract(ctx) {
          ctx.emitLink({
            source: ctx.node.path,
            target: '${target}',
            kind: 'references',
            confidence: 'high',
            sources: ['${id}-extractor'],
            trigger: {
              originalTrigger: '${target}',
              normalizedTrigger: '${target.toLowerCase()}',
            },
          });
        },
      };
    `,
  );
}

/**
 * Plant a working formatter plugin so the formatter code path is exercised
 * end-to-end via `sm graph`.
 */
function plantPluginFormatter(root: string, id: string, formatId: string, sentinel: string): void {
  const dir = join(root, '.skill-map', 'plugins', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({
      id,
      version: '1.0.0',
      specCompat: '>=0.0.0',
      extensions: ['./formatter.mjs'],
    }),
  );
  writeFileSync(
    join(dir, 'formatter.mjs'),
    `
      export default {
        id: '${id}-formatter',
        kind: 'formatter',
        version: '1.0.0',
        description: 'Step 9.1 fixture formatter.',
        formatId: '${formatId}',
        format(ctx) {
          return '${sentinel}\\n' + 'nodes:' + ctx.nodes.length;
        },
      };
    `,
  );
}

/** Plant a plugin whose manifest is malformed JSON to test the warning path. */
function plantBrokenManifest(root: string, id: string): void {
  const dir = join(root, '.skill-map', 'plugins', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), '{ this is not json');
}

/** Read the persisted ScanResult emitted under `--json`. */
function parseScanResult(stdout: string): ScanResult {
  return JSON.parse(stdout) as ScanResult;
}

describe('Step 9.1 — plugin runtime wiring', () => {
  it('plugin extractor contributes a link to the scan output', async () => {
    const fixture = freshFixture('plugin-extractor');
    plantClaudeFixture(fixture);
    const target = '/synthetic-step9-target';
    plantPluginExtractor(fixture, 'fixture-emitter', target);

    const original = process.cwd();
    process.chdir(fixture);
    try {
      const cap = captureContext();
      const cmd = buildScan({ json: true });
      cmd.context = cap.context;
      const code = await cmd.execute();
      strictEqual(code, 0, `scan exited ${code}; stderr=${cap.stderr()}`);
      const result = parseScanResult(cap.stdout());
      const planted = result.links.find((l) => l.target === target);
      ok(planted, `expected synthetic link with target=${target}; got ${JSON.stringify(result.links)}`);
      strictEqual(planted.kind, 'references');
      ok(planted.sources.includes('fixture-emitter-extractor'));
    } finally {
      process.chdir(original);
    }
  });

  it('--no-plugins skips plugin discovery entirely', async () => {
    const fixture = freshFixture('no-plugins');
    plantClaudeFixture(fixture);
    const target = '/synthetic-step9-skipped';
    plantPluginExtractor(fixture, 'fixture-skipped', target);

    const original = process.cwd();
    process.chdir(fixture);
    try {
      const cap = captureContext();
      const cmd = buildScan({ json: true, noPlugins: true });
      cmd.context = cap.context;
      const code = await cmd.execute();
      strictEqual(code, 0, `scan exited ${code}; stderr=${cap.stderr()}`);
      const result = parseScanResult(cap.stdout());
      const planted = result.links.find((l) => l.target === target);
      strictEqual(
        planted,
        undefined,
        `--no-plugins should suppress plugin output; found ${JSON.stringify(planted)}`,
      );
    } finally {
      process.chdir(original);
    }
  });

  it('broken manifest emits a stderr warning but scan completes', async () => {
    const fixture = freshFixture('broken-mani');
    plantClaudeFixture(fixture);
    plantBrokenManifest(fixture, 'busted-plugin');

    const original = process.cwd();
    process.chdir(fixture);
    try {
      const cap = captureContext();
      const cmd = buildScan({ json: true });
      cmd.context = cap.context;
      const code = await cmd.execute();
      strictEqual(code, 0, `scan exited ${code}; stderr=${cap.stderr()}`);
      match(cap.stderr(), /plugin busted-plugin: invalid-manifest/);
      // The built-in pipeline still runs — at least one node persisted.
      const result = parseScanResult(cap.stdout());
      ok(result.stats.nodesCount >= 1, 'scan must keep running on a bad plugin');
    } finally {
      process.chdir(original);
    }
  });

  it('plugin formatter is selectable via sm graph --format <plugin>', async () => {
    const fixture = freshFixture('plugin-formatter');
    plantClaudeFixture(fixture);
    plantPluginFormatter(fixture, 'fixture-shouter', 'shout', 'PLUGIN-FORMATTER-SENTINEL');

    const original = process.cwd();
    process.chdir(fixture);
    try {
      // 1. Prime the DB with a real scan (also exercises plugin discovery
      //    in the scan path; harmless because this plugin only contributes
      //    a formatter, not an extractor).
      const scanCap = captureContext();
      const scanCmd = buildScan();
      scanCmd.context = scanCap.context;
      const scanCode = await scanCmd.execute();
      strictEqual(scanCode, 0, `scan exited ${scanCode}; stderr=${scanCap.stderr()}`);

      // 2. Render via the plugin format.
      const graphCap = captureContext();
      const graphCmd = buildGraph({ format: 'shout' });
      graphCmd.context = graphCap.context;
      const code = await graphCmd.execute();
      strictEqual(code, 0, `graph exited ${code}; stderr=${graphCap.stderr()}`);
      match(graphCap.stdout(), /PLUGIN-FORMATTER-SENTINEL/);
    } finally {
      process.chdir(original);
    }
  });

  it('--no-plugins on sm graph falls back to built-in formatters only', async () => {
    const fixture = freshFixture('graph-no-plugins');
    plantClaudeFixture(fixture);
    plantPluginFormatter(fixture, 'fixture-hidden', 'hidden', 'HIDDEN-SENTINEL');

    const original = process.cwd();
    process.chdir(fixture);
    try {
      // Prime the DB; pass --no-plugins to scan too so the test stays
      // hermetic (the formatter plugin doesn't affect scan output, but
      // skipping discovery on both verbs keeps the assertion focused).
      const scanCap = captureContext();
      const scanCmd = buildScan({ noPlugins: true });
      scanCmd.context = scanCap.context;
      strictEqual(await scanCmd.execute(), 0);

      const graphCap = captureContext();
      const graphCmd = buildGraph({ format: 'hidden', noPlugins: true });
      graphCmd.context = graphCap.context;
      const code = await graphCmd.execute();
      strictEqual(code, 2, 'plugin formatter must be invisible under --no-plugins');
      match(graphCap.stderr(), /No formatter registered for format=hidden/);
    } finally {
      process.chdir(original);
    }
  });
});
