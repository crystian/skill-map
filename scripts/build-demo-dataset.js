#!/usr/bin/env node
/**
 * `scripts/build-demo-dataset.js` — derive the demo bundle's data assets.
 *
 * Pipeline:
 *
 *   1. Spawn `sm scan --json` over `ui/fixtures/demo-scope/`. Prefer the
 *      built CLI bundle (`src/dist/cli.js`) for speed; fall back to the
 *      tsx-driven source entry if the bundle is absent.
 *   2. Parse the resulting `ScanResult` (1:1 with `scan-result.schema.json`).
 *   3. Derive the per-endpoint envelopes the `StaticDataSource` serves:
 *      health, nodes-list, links-list, issues-list, config, plugins-list,
 *      and the ASCII graph render. Shape mirrors `src/server/envelope.ts`
 *      so demo and live keep one canonical envelope vocabulary.
 *   4. Write atomically to `web/demo/data.json` (raw `ScanResult`) and
 *      `web/demo/data.meta.json` (pre-derived envelopes).
 *
 * Idempotent — running twice with the same input emits byte-identical
 * output (the `scannedAt` timestamp is replaced with a deterministic
 * placeholder so the demo output doesn't churn on every build).
 *
 * **Why pre-derive instead of letting the SPA filter on the fly**: the
 * StaticDataSource's "no filter" fast path returns these envelopes
 * verbatim, with no kernel grammar re-implementation in the browser.
 * Filter / pagination cases derive on the fly from `data.json`.
 */

import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const FIXTURE_DIR = join(REPO_ROOT, 'ui', 'fixtures', 'demo-scope');
const OUT_DIR = join(REPO_ROOT, 'web', 'demo');
const DATA_PATH = join(OUT_DIR, 'data.json');
const META_PATH = join(OUT_DIR, 'data.meta.json');

const BUILT_CLI = join(REPO_ROOT, 'src', 'dist', 'cli.js');
const SOURCE_ENTRY = join(REPO_ROOT, 'src', 'cli', 'entry.ts');

/**
 * Stable timestamp baked into both `data.json` (`scannedAt`) and the
 * health snapshot. Keeping it deterministic means re-running the demo
 * pipeline doesn't show up as a churn in `git diff` after every build.
 */
const STABLE_SCANNED_AT = 0;

const exec = promisify(execFile);

async function readSpecVersion() {
  const path = join(REPO_ROOT, 'spec', 'package.json');
  const pkg = JSON.parse(await readFile(path, 'utf8'));
  return pkg.version ?? 'unknown';
}

async function readImplVersion() {
  const path = join(REPO_ROOT, 'src', 'package.json');
  const pkg = JSON.parse(await readFile(path, 'utf8'));
  return pkg.version ?? 'unknown';
}

/**
 * Run `sm scan --json` over the fixture and return the parsed
 * `ScanResult`. Spawned with `cwd=FIXTURE_DIR` so the kernel's project-
 * scope discovery (config, drop-in plugins, ignore globs) operates
 * against the fixture itself rather than picking up the repo root's
 * `.skill-map/` and `.claude/` artefacts. Prefer the built CLI bundle
 * for speed; fall back to the source entry through tsx if the bundle is
 * absent.
 *
 * The spawned process runs with `--no-plugins` so the demo bundle stays
 * deterministic across machines (no drop-in discovery side-effects);
 * the built-in pipeline still runs (the demo is supposed to showcase
 * the real built-in extractors / rules).
 */
async function runScan() {
  const args = ['scan', '.', '--json', '--no-plugins'];
  let cmd;
  let argv;
  if (existsSync(BUILT_CLI)) {
    cmd = process.execPath;
    argv = [BUILT_CLI, ...args];
  } else {
    cmd = process.execPath;
    argv = ['--import', 'tsx', SOURCE_ENTRY, ...args];
  }
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, argv, {
      cwd: FIXTURE_DIR,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [];
    const err = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', rejectP);
    child.on('close', (code) => {
      if (code !== 0) {
        const stderrText = Buffer.concat(err).toString('utf8');
        rejectP(new Error(`sm scan exited with code ${code}: ${stderrText}`));
        return;
      }
      try {
        const text = Buffer.concat(out).toString('utf8');
        resolveP(JSON.parse(text));
      } catch (e) {
        rejectP(new Error(`failed to parse sm scan JSON output: ${e.message}`));
      }
    });
  });
}

/**
 * Render the persisted graph to ASCII. Uses the same CLI verb the BFF
 * delegates to, so the demo bundle's ASCII art is byte-identical to
 * what `/api/graph?format=ascii` would return on the same data.
 */
async function renderAsciiGraph() {
  const args = ['graph', '--format', 'ascii', '--no-plugins'];
  let cmd;
  let argv;
  if (existsSync(BUILT_CLI)) {
    cmd = process.execPath;
    argv = [BUILT_CLI, ...args];
  } else {
    cmd = process.execPath;
    argv = ['--import', 'tsx', SOURCE_ENTRY, ...args];
  }
  try {
    const { stdout } = await exec(cmd, argv, { cwd: FIXTURE_DIR });
    return stdout;
  } catch (err) {
    // `sm graph` reads from the persisted DB. If the fixture has never
    // been persisted (no `.skill-map/skill-map.db` next to it), the verb
    // exits non-zero. Fall back to a placeholder so the demo bundle
    // still ships a graph asset; the smoke test of the demo bundle
    // doesn't need it to be populated.
    process.stderr.write(`[build-demo-dataset] sm graph failed (${err.message}); using placeholder ASCII\n`);
    return '(no graph available — run `sm scan && sm graph` against ui/fixtures/demo-scope/ to populate)\n';
  }
}

function buildHealthEnvelope({ specVersion, implVersion }) {
  return {
    ok: true,
    schemaVersion: '1',
    specVersion,
    implVersion,
    scope: 'project',
    db: 'present',
  };
}

/**
 * Pre-baked kindRegistry mirroring the Claude built-in Provider's `ui`
 * blocks (Step 14.5.d). Hardcoded here because the demo dataset never
 * boots the kernel; the values track `src/built-in-plugins/providers/claude/index.ts`
 * and would diverge if a built-in changes its visuals — but the demo
 * is supposed to showcase the built-ins, so a deliberate sync is fine
 * (the kind-presentation tests also assert these values exist).
 */
const DEMO_KIND_REGISTRY = {
  agent: {
    providerId: 'claude',
    label: 'Agents',
    color: '#3b82f6',
    colorDark: '#60a5fa',
    icon: { kind: 'pi', id: 'pi-user' },
  },
  command: {
    providerId: 'claude',
    label: 'Commands',
    color: '#f59e0b',
    colorDark: '#fbbf24',
    icon: { kind: 'svg', path: 'M4 17 L10 11 L4 5 M12 19 L20 19' },
  },
  hook: {
    providerId: 'claude',
    label: 'Hooks',
    color: '#8b5cf6',
    colorDark: '#a78bfa',
    icon: {
      kind: 'svg',
      path: 'M12 2 a3 3 0 1 0 0 6 a3 3 0 1 0 0 -6 M12 8 L12 22 M5 12 H2 a10 10 0 0 0 20 0 H19',
    },
  },
  skill: {
    providerId: 'claude',
    label: 'Skills',
    color: '#10b981',
    colorDark: '#34d399',
    icon: { kind: 'pi', id: 'pi-bolt' },
  },
  note: {
    providerId: 'claude',
    label: 'Notes',
    color: '#5b908c',
    colorDark: '#9bbcb8',
    icon: {
      kind: 'svg',
      path: 'M14 2 H6 a2 2 0 0 0 -2 2 V20 a2 2 0 0 0 2 2 H18 a2 2 0 0 0 2 -2 V8 L14 2 M14 2 V8 H20 M16 13 H8 M16 17 H8 M10 9 H8',
    },
  },
};

function buildNodesEnvelope(scan) {
  const items = scan.nodes ?? [];
  const total = items.length;
  return {
    schemaVersion: '1',
    kind: 'nodes',
    items,
    filters: { kind: null, hasIssues: null, path: null },
    counts: { total, returned: total, page: { offset: 0, limit: 1000 } },
    kindRegistry: DEMO_KIND_REGISTRY,
  };
}

function buildLinksEnvelope(scan) {
  const items = scan.links ?? [];
  const total = items.length;
  return {
    schemaVersion: '1',
    kind: 'links',
    items,
    filters: { kind: null, from: null, to: null },
    counts: { total, returned: total },
    kindRegistry: DEMO_KIND_REGISTRY,
  };
}

function buildIssuesEnvelope(scan) {
  const items = scan.issues ?? [];
  const total = items.length;
  return {
    schemaVersion: '1',
    kind: 'issues',
    items,
    filters: { severity: null, ruleId: null, node: null },
    counts: { total, returned: total },
    kindRegistry: DEMO_KIND_REGISTRY,
  };
}

function buildConfigEnvelope() {
  // The demo doesn't ship a real `ProjectConfig` — there's no `.skill-map`
  // dir alongside the fixture. Return the documented defaults shape so
  // the SPA's config card has something coherent to render.
  return {
    schemaVersion: '1',
    kind: 'config',
    value: {
      schemaVersion: 1,
      tokenizer: 'cl100k_base',
      providers: ['claude'],
      roots: ['.'],
      ignore: [],
    },
    kindRegistry: DEMO_KIND_REGISTRY,
  };
}

function buildPluginsEnvelope() {
  // Mirrors `/api/plugins` shape — list of installed plugins. The demo
  // bundle has no drop-in plugins, so the items array carries only the
  // built-in bundle records.
  const items = [
    {
      id: 'claude',
      version: null,
      kinds: ['provider', 'extractor', 'extractor', 'extractor', 'extractor'],
      status: 'enabled',
      reason: null,
      source: 'built-in',
    },
    {
      id: 'core',
      version: null,
      kinds: ['rule', 'rule', 'rule', 'rule', 'formatter'],
      status: 'enabled',
      reason: null,
      source: 'built-in',
    },
  ];
  return {
    schemaVersion: '1',
    kind: 'plugins',
    items,
    filters: {},
    counts: { total: items.length, returned: items.length },
    kindRegistry: DEMO_KIND_REGISTRY,
  };
}

async function writeAtomic(path, content) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, path);
}

/**
 * Read each `node.path` from disk relative to `fixtureDir`, strip the
 * YAML frontmatter, and assign the result to `node.body`. Mirrors
 * `src/server/node-body.ts` (the runtime path live mode uses) so the
 * demo body bytes match what live would serve byte-for-byte.
 */
async function embedBodies(scan, fixtureDir) {
  for (const node of scan.nodes ?? []) {
    try {
      const raw = await readFile(join(fixtureDir, node.path), 'utf8');
      node.body = stripFrontmatter(raw);
    } catch (err) {
      process.stderr.write(
        `[build-demo-dataset] body read failed for ${node.path} (${err.message}); embedding null\n`,
      );
      node.body = null;
    }
  }
}

function stripFrontmatter(raw) {
  if (!raw.startsWith('---')) return raw;
  const match = raw.match(/^---\r?\n[\s\S]*?^---\r?\n?/m);
  if (!match) return raw;
  return raw.slice(match[0].length);
}

async function main() {
  if (!existsSync(FIXTURE_DIR)) {
    throw new Error(`demo fixture missing: ${FIXTURE_DIR}`);
  }
  await mkdir(OUT_DIR, { recursive: true });

  const [specVersion, implVersion] = await Promise.all([
    readSpecVersion(),
    readImplVersion(),
  ]);

  process.stdout.write(`[build-demo-dataset] running sm scan on ${FIXTURE_DIR}\n`);
  const scan = await runScan();

  // Force the timestamp to a deterministic value so re-running the
  // pipeline doesn't churn the bundle on every build.
  scan.scannedAt = STABLE_SCANNED_AT;

  // Step 14.5.a — embed each node's body bytes (post-frontmatter)
  // directly into the demo `data.json`. Live mode reads bodies on
  // demand from `/api/nodes/:pathB64?include=body`, but the demo has
  // no live BFF — bundling them keeps the inspector experience
  // identical to live without forcing a runtime fetch indirection.
  // 21 fixtures × ~2 KB each is in the noise (~40 KB on a ~590 KB
  // bundle). When the fixture grows past ~100 nodes, revisit this
  // (split into per-node JSON assets fetched on demand).
  await embedBodies(scan, FIXTURE_DIR);

  const ascii = await renderAsciiGraph();

  const meta = {
    schemaVersion: '1',
    health: buildHealthEnvelope({ specVersion, implVersion }),
    nodes: buildNodesEnvelope(scan),
    links: buildLinksEnvelope(scan),
    issues: buildIssuesEnvelope(scan),
    config: buildConfigEnvelope(),
    plugins: buildPluginsEnvelope(),
    graph: { ascii },
  };

  await writeAtomic(DATA_PATH, JSON.stringify(scan, null, 2) + '\n');
  await writeAtomic(META_PATH, JSON.stringify(meta, null, 2) + '\n');

  const dataStat = await stat(DATA_PATH);
  const metaStat = await stat(META_PATH);
  process.stdout.write(
    `[build-demo-dataset] wrote ${DATA_PATH} (${dataStat.size} bytes)\n`,
  );
  process.stdout.write(
    `[build-demo-dataset] wrote ${META_PATH} (${metaStat.size} bytes)\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[build-demo-dataset] FAILED: ${err.message}\n`);
  process.exit(1);
});
