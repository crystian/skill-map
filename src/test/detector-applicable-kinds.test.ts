/**
 * Spec § A.10 — Detector `applicableKinds` filter.
 *
 * The detector manifest gains an optional `applicableKinds` array. When
 * declared, the orchestrator skips invocation of `detect()` for nodes
 * whose `kind` is not in the list — fail-fast, BEFORE the detect context
 * is built, BEFORE any LLM cost is incurred for probabilistic detectors.
 * Default (absent) = applies to every kind.
 *
 * These tests pin:
 *   (a) absent → runs on every kind in the fixture.
 *   (b) ['skill'] → runs only on skills.
 *   (c) ['skill', 'agent'] → runs on skills + agents only.
 *   (d) `detect()` is NOT called for excluded kinds (zero-cost skip).
 *
 * The fixture seeds one node per built-in kind: skill, agent, command,
 * hook, note. The Claude adapter classifies each one based on path
 * prefix (`.claude/skills/<name>/SKILL.md`, `.claude/agents/*.md`, etc.).
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKernel, runScan } from '../kernel/index.js';
import { builtIns } from '../extensions/built-ins.js';
import type { IDetector } from '../kernel/extensions/index.js';
import type { Link, NodeKind } from '../kernel/types.js';

let fixture: string;

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-applicable-kinds-'));
  const write = (rel: string, content: string): void => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };
  // One node per built-in kind. Frontmatter shape is irrelevant — the
  // probe detector runs unconditionally on whichever nodes the
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
 * Build a probe detector whose `detect()` method records every kind it
 * is invoked against. The returned `seenKinds` array is filled during
 * the scan and inspected by the test afterwards. The probe emits no
 * links — it only observes invocations.
 *
 * `applicableKinds` is wired via spread (`...partial`) so tests can opt
 * into the field per case (omitted entirely for case `a`, declared for
 * cases `b` / `c` / `d`).
 */
function buildProbeDetector(
  applicableKinds?: NodeKind[],
): { detector: IDetector; seenKinds: NodeKind[] } {
  const seenKinds: NodeKind[] = [];
  const detector: IDetector = {
    kind: 'detector',
    id: 'probe',
    pluginId: 'test',
    version: '1.0.0',
    emitsLinkKinds: ['references'],
    defaultConfidence: 'low',
    scope: 'body',
    ...(applicableKinds ? { applicableKinds } : {}),
    detect: (ctx): Link[] => {
      seenKinds.push(ctx.node.kind);
      return [];
    },
  };
  return { detector, seenKinds };
}

describe('Detector applicableKinds — orchestrator filtering', () => {
  it('(a) absent applicableKinds: detector runs on every kind', async () => {
    const { detector, seenKinds } = buildProbeDetector();
    const kernel = createKernel();
    const baseline = builtIns();
    await runScan(kernel, {
      roots: [fixture],
      extensions: {
        adapters: baseline.adapters,
        detectors: [detector],
        rules: [],
      },
    });
    // Five built-in kinds in the fixture; sort to remove walk-order
    // sensitivity (the claude adapter's traversal is deterministic but
    // alphabetical-by-directory, not by kind).
    deepStrictEqual(
      [...seenKinds].sort(),
      ['agent', 'command', 'hook', 'note', 'skill'],
    );
  });

  it('(b) applicableKinds: ["skill"] → runs only on skill nodes', async () => {
    const { detector, seenKinds } = buildProbeDetector(['skill']);
    const kernel = createKernel();
    const baseline = builtIns();
    await runScan(kernel, {
      roots: [fixture],
      extensions: {
        adapters: baseline.adapters,
        detectors: [detector],
        rules: [],
      },
    });
    deepStrictEqual(seenKinds, ['skill']);
  });

  it('(c) applicableKinds: ["skill", "agent"] → runs on skills + agents only', async () => {
    const { detector, seenKinds } = buildProbeDetector(['skill', 'agent']);
    const kernel = createKernel();
    const baseline = builtIns();
    await runScan(kernel, {
      roots: [fixture],
      extensions: {
        adapters: baseline.adapters,
        detectors: [detector],
        rules: [],
      },
    });
    deepStrictEqual([...seenKinds].sort(), ['agent', 'skill']);
  });

  it('(d) applicableKinds: ["skill"] → detect() NOT invoked for excluded kinds (zero CPU / LLM cost)', async () => {
    // The strict invariant from the spec text: the kernel filters
    // BEFORE building the detect context and BEFORE calling detect().
    // We pin "not invoked" by counting calls — `seenKinds.length` MUST
    // equal the number of skill nodes (1), nothing more, nothing less.
    const { detector, seenKinds } = buildProbeDetector(['skill']);
    const kernel = createKernel();
    const baseline = builtIns();
    await runScan(kernel, {
      roots: [fixture],
      extensions: {
        adapters: baseline.adapters,
        detectors: [detector],
        rules: [],
      },
    });
    strictEqual(
      seenKinds.length,
      1,
      `detect() called ${seenKinds.length} times; expected exactly 1 (one skill node)`,
    );
    strictEqual(seenKinds[0], 'skill');
  });
});
