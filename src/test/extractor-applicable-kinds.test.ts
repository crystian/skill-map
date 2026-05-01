/**
 * Spec § A.10 — Extractor `applicableKinds` filter.
 *
 * The extractor manifest gains an optional `applicableKinds` array. When
 * declared, the orchestrator skips invocation of `extract()` for nodes
 * whose `kind` is not in the list — fail-fast, BEFORE the extractor context
 * is built, BEFORE any LLM cost is incurred for probabilistic extractors.
 * Default (absent) = applies to every kind.
 *
 * These tests pin:
 *   (a) absent → runs on every kind in the fixture.
 *   (b) ['skill'] → runs only on skills.
 *   (c) ['skill', 'agent'] → runs on skills + agents only.
 *   (d) `extract()` is NOT called for excluded kinds (zero-cost skip).
 *
 * The fixture seeds one node per built-in kind: skill, agent, command,
 * hook, note. The Claude provider classifies each one based on path
 * prefix (`.claude/skills/<name>/SKILL.md`, `.claude/agents/*.md`, etc.).
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKernel, runScan } from '../kernel/index.js';
import { builtIns } from '../built-in-plugins/built-ins.js';
import type { IExtractor } from '../kernel/extensions/index.js';
import type { NodeKind } from '../kernel/types.js';

let fixture: string;

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-applicable-kinds-'));
  const write = (rel: string, content: string): void => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };
  // One node per built-in kind. Frontmatter shape is irrelevant — the
  // probe extractor runs unconditionally on whichever nodes the
  // orchestrator hands it.
  write(
    '.claude/skills/explorer/SKILL.md',
    ['---', 'name: explorer', 'description: D', '---', 'Body.'].join('\n'),
  );
  write(
    '.claude/agents/architect.md',
    ['---', 'name: architect', 'description: D', '---', 'Body.'].join('\n'),
  );
  write(
    '.claude/commands/deploy.md',
    ['---', 'name: deploy', 'description: D', '---', 'Body.'].join('\n'),
  );
  write(
    '.claude/hooks/pre-commit.md',
    ['---', 'name: pre-commit', 'description: D', '---', 'Body.'].join('\n'),
  );
  write(
    'notes/idea.md',
    ['---', 'name: idea', 'description: D', '---', 'Body.'].join('\n'),
  );
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
});

/**
 * Build a probe extractor whose `extract()` method records every kind it
 * is invoked against. The returned `seenKinds` array is filled during
 * the scan and inspected by the test afterwards. The probe emits no
 * links (it does not call `ctx.emitLink`) — it only observes invocations.
 *
 * `applicableKinds` is wired via spread (`...partial`) so tests can opt
 * into the field per case (omitted entirely for case `a`, declared for
 * cases `b` / `c` / `d`).
 */
function buildProbeExtractor(
  applicableKinds?: NodeKind[],
): { extractor: IExtractor; seenKinds: NodeKind[] } {
  const seenKinds: NodeKind[] = [];
  const extractor: IExtractor = {
    kind: 'extractor',
    id: 'probe',
    pluginId: 'test',
    version: '1.0.0',
    emitsLinkKinds: ['references'],
    defaultConfidence: 'low',
    scope: 'body',
    ...(applicableKinds ? { applicableKinds } : {}),
    extract: (ctx): void => {
      seenKinds.push(ctx.node.kind);
    },
  };
  return { extractor, seenKinds };
}

describe('Extractor applicableKinds — orchestrator filtering', () => {
  it('(a) absent applicableKinds: extractor runs on every kind', async () => {
    const { extractor, seenKinds } = buildProbeExtractor();
    const kernel = createKernel();
    const baseline = builtIns();
    await runScan(kernel, {
      roots: [fixture],
      extensions: {
        providers: baseline.providers,
        extractors: [extractor],
        rules: [],
      },
    });
    // Five built-in kinds in the fixture; sort to remove walk-order
    // sensitivity (the claude provider's traversal is deterministic but
    // alphabetical-by-directory, not by kind).
    deepStrictEqual(
      [...seenKinds].sort(),
      ['agent', 'command', 'hook', 'note', 'skill'],
    );
  });

  it('(b) applicableKinds: ["skill"] → runs only on skill nodes', async () => {
    const { extractor, seenKinds } = buildProbeExtractor(['skill']);
    const kernel = createKernel();
    const baseline = builtIns();
    await runScan(kernel, {
      roots: [fixture],
      extensions: {
        providers: baseline.providers,
        extractors: [extractor],
        rules: [],
      },
    });
    deepStrictEqual(seenKinds, ['skill']);
  });

  it('(c) applicableKinds: ["skill", "agent"] → runs on skills + agents only', async () => {
    const { extractor, seenKinds } = buildProbeExtractor(['skill', 'agent']);
    const kernel = createKernel();
    const baseline = builtIns();
    await runScan(kernel, {
      roots: [fixture],
      extensions: {
        providers: baseline.providers,
        extractors: [extractor],
        rules: [],
      },
    });
    deepStrictEqual([...seenKinds].sort(), ['agent', 'skill']);
  });

  it('(d) applicableKinds: ["skill"] → extract() NOT invoked for excluded kinds (zero CPU / LLM cost)', async () => {
    // The strict invariant from the spec text: the kernel filters
    // BEFORE building the extractor context and BEFORE calling extract().
    // We pin "not invoked" by counting calls — `seenKinds.length` MUST
    // equal the number of skill nodes (1), nothing more, nothing less.
    const { extractor, seenKinds } = buildProbeExtractor(['skill']);
    const kernel = createKernel();
    const baseline = builtIns();
    await runScan(kernel, {
      roots: [fixture],
      extensions: {
        providers: baseline.providers,
        extractors: [extractor],
        rules: [],
      },
    });
    strictEqual(
      seenKinds.length,
      1,
      `extract() called ${seenKinds.length} times; expected exactly 1 (one skill node)`,
    );
    strictEqual(seenKinds[0], 'skill');
  });
});
