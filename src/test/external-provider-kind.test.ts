/**
 * Phase E acceptance — open-node-kinds end-to-end.
 *
 * Wires up a fake "Cursor" Provider that classifies every `.md` file
 * under `<root>/.cursor/rules/` into `kind: 'cursorRule'` (a string the
 * built-in Claude Provider does NOT know about), runs the full scan
 * pipeline through the orchestrator, persists the result via the
 * SQLite adapter, reads it back via `loadScanResult`, and filters the
 * snapshot through `applyExportQuery({ kinds: ['cursorRule'] })`.
 *
 * Every layer between the spec (`node.schema.json#/properties/kind`)
 * and the live SQL (`003_open_node_kinds.sql`) MUST accept the
 * external kind verbatim. This test lights up the whole gauntlet:
 *
 *   IProvider.classify → orchestrator → buildNode → AJV validate
 *     → persistScanResult → SQLite scan_nodes (no CHECK rejection)
 *     → loadScanResult → applyExportQuery filter.
 *
 * If any layer regresses to the closed-enum behaviour (a stray cast,
 * a forgotten CHECK, a renamed column missed by the migration), this
 * test fails before the regression reaches a release.
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { createKernel, runScanWithRenames } from '../kernel/index.js';
import { applyExportQuery } from '../kernel/index.js';
import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import { loadScanResult } from '../kernel/adapters/sqlite/scan-load.js';
import { persistScanResult } from '../kernel/adapters/sqlite/scan-persistence.js';
import type {
  IProvider,
  IRawNode,
} from '../kernel/extensions/index.js';

let fixture: string;
let dbPath: string;

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-external-kind-fixture-'));
  dbPath = join(
    mkdtempSync(join(tmpdir(), 'skill-map-external-kind-db-')),
    'skill-map.db',
  );
  // Seed two .cursor/rules/*.md files. Frontmatter shape mirrors a
  // realistic Cursor rule (name, description) but is intentionally
  // minimal — the test pins the cross-layer kind contract, not the
  // schema validation details.
  const seed = (rel: string, body: string): void => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  };
  seed(
    '.cursor/rules/strict-mode.md',
    ['---', 'name: strict-mode', 'description: TS strict.', '---', 'Body A.'].join('\n'),
  );
  seed(
    '.cursor/rules/test-naming.md',
    ['---', 'name: test-naming', 'description: Naming rules.', '---', 'Body B.'].join('\n'),
  );
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
  rmSync(join(dbPath, '..'), { recursive: true, force: true });
});

/**
 * Minimal IProvider: walks `<root>/.cursor/rules/*.md`, parses an
 * `--- … ---` frontmatter block by hand (test scope only — the real
 * `claudeProvider` uses js-yaml), and classifies everything into
 * `cursorRule`. The Provider's `kinds` map declares no schemas — the
 * orchestrator's frontmatter validator falls back to a permissive
 * mode for kinds whose Provider declares no per-kind schema.
 */
const cursorProvider: IProvider = {
  id: 'cursor',
  pluginId: 'cursor',
  kind: 'provider',
  version: '1.0.0',
  description: 'Walks .cursor/rules/*.md and classifies into kind: cursorRule.',
  stability: 'experimental',
  explorationDir: '.cursor/rules',
  kinds: {
    cursorRule: {
      schema: 'schemas/cursorRule.schema.json',
      schemaJson: { type: 'object', additionalProperties: true },
      defaultRefreshAction: 'cursor/refresh-rule',
    },
  },
  async *walk(roots): AsyncIterable<IRawNode> {
    const { readdir, stat, readFile } = await import('node:fs/promises');
    for (const root of roots) {
      const rulesDir = join(root, '.cursor', 'rules');
      let entries: string[] = [];
      try {
        entries = await readdir(rulesDir);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (!name.endsWith('.md')) continue;
        const abs = join(rulesDir, name);
        const st = await stat(abs);
        if (!st.isFile()) continue;
        const text = await readFile(abs, 'utf8');
        const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
        const frontmatterRaw = match ? match[1]! : '';
        const body = match ? match[2]! : text;
        const frontmatter = parseFrontmatter(frontmatterRaw);
        const rel = relative(root, abs).split(sep).join('/');
        yield {
          path: rel,
          frontmatterRaw,
          frontmatter,
          body,
        };
      }
    }
  },
  classify(): string {
    return 'cursorRule';
  },
};

/**
 * Trivial `key: value` frontmatter parser. Test scope only — the real
 * Claude Provider uses js-yaml. The fixture frontmatter is structured
 * to parse correctly here without pulling yaml in as a test dep.
 */
function parseFrontmatter(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key.length > 0) out[key] = value;
  }
  return out;
}

describe('open-node-kinds end-to-end (Phase E)', () => {
  it('external Provider emits kind: "cursorRule" — scan, persist, load, filter all preserve the open kind', async () => {
    const kernel = createKernel();

    // 1. Scan with the fake Provider only — no built-in claude
    //    extensions. Two `.cursor/rules/*.md` files become two nodes.
    const scan = await runScanWithRenames(kernel, {
      roots: [fixture],
      extensions: {
        providers: [cursorProvider],
        extractors: [],
        rules: [],
      },
      tokenize: false,
    });

    strictEqual(scan.result.nodes.length, 2);
    for (const node of scan.result.nodes) {
      strictEqual(node.kind, 'cursorRule', 'scan must preserve the external kind');
      strictEqual(node.provider, 'cursor');
    }
    const paths = scan.result.nodes.map((n) => n.path).sort();
    deepStrictEqual(paths, [
      '.cursor/rules/strict-mode.md',
      '.cursor/rules/test-naming.md',
    ]);

    // 2. Persist via the SQLite adapter. The CHECK constraint on
    //    `scan_nodes.kind` is gone post-003; this insert MUST succeed
    //    without rejection.
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      await persistScanResult(
        adapter.db,
        scan.result,
        scan.renameOps,
        scan.extractorRuns,
        scan.enrichments,
      );

      // 3. Read the snapshot back. `rowToNode` no longer casts to a
      //    closed `NodeKind`; the open string survives the round-trip.
      const reloaded = await loadScanResult(adapter.db);
      strictEqual(reloaded.nodes.length, 2);
      for (const node of reloaded.nodes) {
        strictEqual(node.kind, 'cursorRule');
        strictEqual(node.provider, 'cursor');
      }
    } finally {
      await adapter.close();
    }

    // 4. Filter the snapshot through the export query. The parser no
    //    longer enforces a closed enum; `kind=cursorRule` is a valid
    //    query that yields exactly the two seeded nodes.
    const subset = applyExportQuery(scan.result, {
      raw: 'kind=cursorRule',
      kinds: ['cursorRule'],
    });
    strictEqual(subset.nodes.length, 2);
    ok(
      subset.nodes.every((n) => n.kind === 'cursorRule'),
      'filter must keep only cursorRule nodes',
    );

    // 5. Negative control: filtering on a non-existent kind yields zero.
    const empty = applyExportQuery(scan.result, {
      raw: 'kind=widget',
      kinds: ['widget'],
    });
    strictEqual(empty.nodes.length, 0);
  });

  it('Provider with a strict per-kind schema produces a frontmatter-invalid issue when frontmatter does not match', async () => {
    // Variant of the smoke above with a stricter `cursorRule` schema —
    // requires a `name` field of type string. The first fixture file
    // satisfies it; we plant a second under a temporary root with a
    // missing `name` to land a `frontmatter-invalid` issue. This proves
    // the kernel's per-Provider validator path works for external kinds
    // exactly the same way it works for the built-in claude catalog.
    const strictFixture = mkdtempSync(join(tmpdir(), 'skill-map-external-kind-strict-'));
    try {
      const seed = (rel: string, body: string): void => {
        const abs = join(strictFixture, rel);
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, body);
      };
      seed(
        '.cursor/rules/has-name.md',
        ['---', 'name: ok', 'description: fine.', '---', 'Body.'].join('\n'),
      );
      seed(
        '.cursor/rules/missing-name.md',
        ['---', 'description: lacks name.', '---', 'Body.'].join('\n'),
      );

      const strictProvider: IProvider = {
        ...cursorProvider,
        kinds: {
          cursorRule: {
            schema: 'schemas/cursorRule.schema.json',
            schemaJson: {
              type: 'object',
              required: ['name'],
              properties: { name: { type: 'string' } },
              additionalProperties: true,
            },
            defaultRefreshAction: 'cursor/refresh-rule',
          },
        },
      };

      const kernel = createKernel();
      const scan = await runScanWithRenames(kernel, {
        roots: [strictFixture],
        extensions: { providers: [strictProvider], extractors: [], rules: [] },
        tokenize: false,
      });

      strictEqual(scan.result.nodes.length, 2);
      const invalid = scan.result.issues.filter(
        (i) => i.ruleId === 'frontmatter-invalid',
      );
      strictEqual(invalid.length, 1, 'exactly one node should fail per-kind frontmatter validation');
      strictEqual(invalid[0]?.nodeIds[0], '.cursor/rules/missing-name.md');
      // `cursorRule` shows up in the issue's `data.kind` so consumers
      // can group / filter by external kind without reading the message.
      strictEqual((invalid[0]?.data as { kind?: unknown })?.kind, 'cursorRule');
    } finally {
      rmSync(strictFixture, { recursive: true, force: true });
    }
  });

  it('Provider classify returns a kind absent from its kinds catalog → no-schema issue, no crash', async () => {
    // Defensive case: a misbehaving Provider classifies into a kind
    // it never declared in `kinds`. The kernel must NOT crash; it
    // should surface a `frontmatter-invalid` issue with
    // `data.errors === 'no-schema'` so the plugin author sees the
    // mismatch in `sm scan` output.
    const sloppyFixture = mkdtempSync(join(tmpdir(), 'skill-map-external-kind-sloppy-'));
    try {
      mkdirSync(join(sloppyFixture, '.cursor', 'rules'), { recursive: true });
      writeFileSync(
        join(sloppyFixture, '.cursor', 'rules', 'one.md'),
        ['---', 'name: solo', '---', 'Body.'].join('\n'),
      );

      const sloppyProvider: IProvider = {
        ...cursorProvider,
        kinds: {
          // Declares `cursorRule` but classify returns `'undeclared'`.
          cursorRule: {
            schema: 'schemas/cursorRule.schema.json',
            schemaJson: { type: 'object', additionalProperties: true },
            defaultRefreshAction: 'cursor/refresh-rule',
          },
        },
        classify(): string {
          return 'undeclared';
        },
      };

      const kernel = createKernel();
      const scan = await runScanWithRenames(kernel, {
        roots: [sloppyFixture],
        extensions: { providers: [sloppyProvider], extractors: [], rules: [] },
        tokenize: false,
      });

      strictEqual(scan.result.nodes.length, 1);
      strictEqual(scan.result.nodes[0]?.kind, 'undeclared');
      const noSchema = scan.result.issues.filter(
        (i) =>
          i.ruleId === 'frontmatter-invalid' &&
          (i.data as { errors?: unknown })?.errors === 'no-schema',
      );
      strictEqual(noSchema.length, 1, 'kernel must report the no-schema mismatch as a directed issue');
    } finally {
      rmSync(sloppyFixture, { recursive: true, force: true });
    }
  });
});
