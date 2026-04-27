/**
 * 500-MD performance benchmark (Step 4.6).
 *
 * Generates 500 synthetic markdown files under
 * `<repo>/.tmp/scan-bench-<random>/.claude/{agents,commands,hooks,skills}/`
 * (+ a sibling `notes/` for the note kind) and runs `runScan` over them
 * with the full built-in pipeline (claude adapter + 4 detectors + 3
 * rules) and tokenization enabled. Asserts:
 *
 *   1. `runScan` completes within the perf budget.
 *   2. `result.stats.nodesCount === 500`.
 *   3. `result.stats.linksCount > 0` (sanity — detectors fired).
 *
 * On every run, prints a single line to stderr summarising the actual
 * numbers so a contributor whose CI tripped the threshold sees the
 * measurement instead of a bare assertion failure.
 *
 * Generation strategy:
 *   - 100 agents:   `<root>/.claude/agents/agent-NNN.md`
 *   - 100 commands: `<root>/.claude/commands/command-NNN.md`
 *   - 100 hooks:    `<root>/.claude/hooks/hook-NNN.md`
 *   - 100 skills:   `<root>/.claude/skills/skill-NNN/SKILL.md`
 *   - 100 notes:    `<root>/notes/note-NNN.md`
 *
 * Each file ships a minimal-but-realistic frontmatter (name + description
 * + occasional `metadata.related[]`) and a body of ~1 KB containing one
 * slash invocation, one `@`-directive, and one http URL — exercising every
 * detector. Ten of the agents intentionally share the same `name` so the
 * trigger-collision rule has work to do; a few commands cross-reference
 * each other via `metadata.related[]`.
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createKernel, runScan } from '../kernel/index.js';
import { builtIns, listBuiltIns } from '../extensions/built-ins.js';

// `src/test/` → `src/` → repo root.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const TMP_BASE = resolve(REPO_ROOT, '.tmp');

let tempDir: string;

before(() => {
  // Ensure `.tmp/` exists (the directory is gitignored). `mkdtempSync`
  // requires its parent to already exist.
  mkdirSync(TMP_BASE, { recursive: true });
  tempDir = mkdtempSync(join(TMP_BASE, 'scan-bench-'));
  generateFixture(tempDir);
});

after(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('scan benchmark (500 MDs)', () => {
  // Budget: 500 MDs in <= 2500ms.
  // Step 6.7 added per-node frontmatter validation against
  // `frontmatter/<kind>.schema.json`; AJV adds ~50-80μs per file × 500
  // ≈ 25-40ms over the prior 2000ms ceiling. The new ceiling preserves
  // headroom for slow CI without lowering the bar (the warm scan still
  // finishes in 1.0-1.2s on a developer laptop).
  // If this trips, FIRST profile (cold-start of the cl100k_base
  // encoder is ~150-200ms; AJV cold-compile of every spec schema is
  // ~80-120ms), then either bump threshold with a comment explaining
  // why, or split the assertion: warm-up scan (skip token cost) +
  // cold scan (full). Don't disable the test.
  const BUDGET_MS = 2500;

  it(`completes within ${BUDGET_MS}ms with full pipeline + tokenization`, async () => {
    const kernel = createKernel();
    for (const manifest of listBuiltIns()) kernel.registry.register(manifest);

    const t0 = Date.now();
    const result = await runScan(kernel, {
      roots: [tempDir],
      extensions: builtIns(),
    });
    const elapsedMs = Date.now() - t0;

    // Visibility line: emit the measurement BEFORE the assertions so a
    // failing run still surfaces the actual numbers in the test output.
    process.stderr.write(
      `[bench] 500 nodes / ${result.stats.linksCount} links / ` +
        `${result.stats.issuesCount} issues in ${elapsedMs}ms ` +
        `(orchestrator-reported ${result.stats.durationMs}ms)\n`,
    );

    strictEqual(result.stats.nodesCount, 500, 'expected exactly 500 nodes');
    ok(result.stats.linksCount > 0, 'detectors should produce at least one link');
    ok(
      elapsedMs <= BUDGET_MS,
      `scan took ${elapsedMs}ms, exceeds budget of ${BUDGET_MS}ms`,
    );
  });
});

// ---------------------------------------------------------------------------
// Fixture generation. Kept local to the test (not extracted to a helper)
// because the shape is intentionally test-specific: every change here will
// move the link / issue counts and someone reading the test should see the
// fixture in the same file as the assertions.
// ---------------------------------------------------------------------------

function generateFixture(root: string): void {
  const PER_KIND = 100;

  // Filler body to land each file at ~1 KB while exercising every detector.
  // Slash invocation + @-directive + http URL all present.
  const filler = (i: number): string =>
    [
      `# Synthetic node ${i}`,
      '',
      `Reference: see /command-${(i % PER_KIND).toString().padStart(3, '0')} ` +
        `for the canonical workflow. Coordinate with @agent-${(i % PER_KIND).toString().padStart(3, '0')} ` +
        `before invoking. Docs at https://example.com/doc-${i}.`,
      '',
      // Padding to ~1 KB. Lorem-ish, not real lorem (no dependency).
      Array.from({ length: 12 }, () =>
        'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. ' +
        'Sphinx of black quartz, judge my vow.').join(' '),
    ].join('\n');

  // 100 agents. Ten of them share the SAME `name: agent-shared` so the
  // trigger-collision rule fires on the agent kind.
  for (let i = 0; i < PER_KIND; i++) {
    const padded = i.toString().padStart(3, '0');
    const name = i < 10 ? 'agent-shared' : `agent-${padded}`;
    write(
      root,
      `.claude/agents/agent-${padded}.md`,
      buildFile({
        name,
        description: `Synthetic agent ${padded}.`,
        related: i % 5 === 0 ? [`.claude/commands/command-${padded}.md`] : null,
        body: filler(i),
      }),
    );
  }

  // 100 commands. A few cross-reference each other so the orchestrator
  // sees a non-trivial command-to-command link surface.
  for (let i = 0; i < PER_KIND; i++) {
    const padded = i.toString().padStart(3, '0');
    const next = ((i + 1) % PER_KIND).toString().padStart(3, '0');
    write(
      root,
      `.claude/commands/command-${padded}.md`,
      buildFile({
        name: `command-${padded}`,
        description: `Synthetic command ${padded}.`,
        related: i % 7 === 0 ? [`.claude/commands/command-${next}.md`] : null,
        body: filler(i + PER_KIND),
      }),
    );
  }

  // 100 hooks.
  for (let i = 0; i < PER_KIND; i++) {
    const padded = i.toString().padStart(3, '0');
    write(
      root,
      `.claude/hooks/hook-${padded}.md`,
      buildFile({
        name: `hook-${padded}`,
        description: `Synthetic hook ${padded}.`,
        related: null,
        body: filler(i + PER_KIND * 2),
      }),
    );
  }

  // 100 skills (each in its own directory under .claude/skills/<n>/SKILL.md).
  for (let i = 0; i < PER_KIND; i++) {
    const padded = i.toString().padStart(3, '0');
    write(
      root,
      `.claude/skills/skill-${padded}/SKILL.md`,
      buildFile({
        name: `skill-${padded}`,
        description: `Synthetic skill ${padded}.`,
        related: null,
        body: filler(i + PER_KIND * 3),
      }),
    );
  }

  // 100 notes.
  for (let i = 0; i < PER_KIND; i++) {
    const padded = i.toString().padStart(3, '0');
    write(
      root,
      `notes/note-${padded}.md`,
      buildFile({
        name: `note-${padded}`,
        description: `Synthetic note ${padded}.`,
        related: null,
        body: filler(i + PER_KIND * 4),
      }),
    );
  }
}

interface IBuildFileArgs {
  name: string;
  description: string;
  related: string[] | null;
  body: string;
}

function buildFile(args: IBuildFileArgs): string {
  const lines: string[] = ['---', `name: ${args.name}`, `description: ${args.description}`];
  if (args.related && args.related.length > 0) {
    lines.push('metadata:');
    lines.push('  related:');
    for (const r of args.related) lines.push(`    - ${r}`);
  }
  lines.push('---', '');
  lines.push(args.body);
  return lines.join('\n');
}

function write(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}
