/**
 * Self-scan acceptance test (Step 4.6, upgraded in Step 4.7).
 *
 * Runs the orchestrator against the **project repo itself** and asserts the
 * result is structurally valid and operationally sane:
 *
 *   1. `schemaVersion === 1`.
 *   2. The whole `ScanResult` validates against the top-level
 *      `scan-result.schema.json` (Step 4.7 reconciliation — the runtime now
 *      matches the spec it should have matched all along: integer
 *      `scannedAt`, `scope`, `providers`, `scannedBy`, `filesWalked`,
 *      `filesSkipped`). Per-element node / link / issue schemas are
 *      transitively exercised via `$ref` from the top-level schema.
 *   3. The repo has nodes (markdown is everywhere).
 *   4. All five node kinds appear (relaxed to "≥ 4 of 5" if `.claude/hooks/`
 *      is empty in the working tree — see comment below).
 *   5. No `error`-severity issues. Warnings are allowed (and expected on
 *      intentional broken-ref placeholders in the repo's docs).
 *   6. Token counts are populated for ≥ 1 node (smoke test for Step 4.2).
 *   7. External refs counted for ≥ 1 node (smoke test for Step 4.3 — the
 *      README has plenty of http URLs).
 *
 * Calls `runScan` directly, NOT via `ScanCommand`, so the test never
 * persists `<root>/.skill-map/skill-map.db` and never trips the persistence
 * layer for a contributor running the suite locally.
 */

import { describe, it } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createKernel, runScan } from '../kernel/index.js';
import type { NodeKind } from '../kernel/index.js';
import { builtIns, listBuiltIns } from '../built-in-plugins/built-ins.js';
import { loadSchemaValidators } from '../kernel/adapters/schema-validators.js';

// `src/test/` → `src/` → repo root.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

const ALL_KINDS: readonly NodeKind[] = ['agent', 'command', 'hook', 'skill', 'note'] as const;

describe('self-scan acceptance', () => {
  it('produces a structurally valid + operationally sane scan of the repo', async () => {
    const kernel = createKernel();
    for (const manifest of listBuiltIns()) kernel.registry.register(manifest);

    const result = await runScan(kernel, {
      roots: [REPO_ROOT],
      extensions: builtIns(),
    });

    // 1. schemaVersion -----------------------------------------------------
    strictEqual(result.schemaVersion, 1);

    // 2. spec validation ---------------------------------------------------
    // Top-level: validate the whole `ScanResult` against the authoritative
    // `scan-result.schema.json` (per-element node / link / issue schemas
    // are reached transitively via $ref). This is the strong assertion
    // for Step 4.7 reconciliation — proves the runtime now matches the
    // spec it should have matched all along (integer `scannedAt`,
    // `scope`, `providers`, `scannedBy`, `filesWalked` / `filesSkipped`).
    const validators = loadSchemaValidators();
    const scanResultValidator = validators.getValidator('scan-result');
    const valid = scanResultValidator(result);
    if (!valid) {
      const errors = (scanResultValidator.errors ?? []).slice(0, 5).map((e) => {
        const path = e.instancePath || '(root)';
        return `  - ${path} ${e.message ?? e.keyword}`;
      }).join('\n');
      const total = scanResultValidator.errors?.length ?? 0;
      throw new Error(
        `ScanResult failed top-level scan-result.schema.json validation ` +
          `(${total} error(s); first 5):\n${errors}`,
      );
    }

    // 3. nodes count -------------------------------------------------------
    ok(result.stats.nodesCount > 0, 'self-scan should produce at least one node');

    // 4. node kinds --------------------------------------------------------
    // The repo contains agents (.claude/agents/commit.md), skills
    // (.claude/skills/foblex-flow/SKILL.md), and notes (README,
    // ROADMAP, every spec/*.md, etc.). It does NOT carry any
    // `.claude/commands/*.md` or `.claude/hooks/*.md` today — neither
    // directory exists in the working tree. Both are tolerated as
    // missing here; faking a fixture for a *self*-scan defeats its
    // purpose. The moment either directory grows a real file, the
    // assertion auto-tightens.
    //
    // Tolerated-missing list is the SUBSET of ALL_KINDS that may legitimately
    // be absent today. Any other missing kind is a regression.
    const TOLERATED_MISSING: ReadonlySet<NodeKind> = new Set<NodeKind>(['command', 'hook']);
    // `node.kind` is open string post-refactor; the assertion still
    // runs against the closed `NodeKind` catalog because that's the
    // built-in Claude Provider's catalog and the only thing this
    // self-scan should produce. An external Provider showing up here
    // would itself be a finding worth flagging — `ALL_KINDS.filter`
    // below ensures it.
    const presentKinds = new Set<string>(result.nodes.map((n) => n.kind));
    const missingKinds = ALL_KINDS.filter((k) => !presentKinds.has(k));
    const unexpectedMissing = missingKinds.filter((k) => !TOLERATED_MISSING.has(k));
    if (unexpectedMissing.length > 0) {
      throw new Error(
        `Self-scan missing required node kinds. ` +
          `Present: [${[...presentKinds].sort().join(', ')}]. ` +
          `Missing: [${missingKinds.sort().join(', ')}]. ` +
          `Tolerated-missing: [${[...TOLERATED_MISSING].sort().join(', ')}].`,
      );
    }

    // 5. no error-severity issues -----------------------------------------
    const errorIssues = result.issues.filter((i) => i.severity === 'error');
    if (errorIssues.length > 0) {
      const lines = errorIssues
        .map((i) => `  - [${i.ruleId}] ${i.nodeIds.join(', ')}: ${i.message}`)
        .join('\n');
      throw new Error(
        `Self-scan produced ${errorIssues.length} error-severity issue(s):\n${lines}`,
      );
    }

    // 6. tokens populated for at least one node (smoke test for 4.2) -----
    const withTokens = result.nodes.find(
      (n) => n.tokens !== undefined && n.tokens.total > 0,
    );
    ok(withTokens, 'expected at least one node with tokens populated (Step 4.2 smoke test)');

    // 7. external refs counted for at least one node (smoke test for 4.3)
    const withExternal = result.nodes.find((n) => n.externalRefsCount > 0);
    ok(
      withExternal,
      'expected at least one node with externalRefsCount > 0 (README has http URLs — Step 4.3 smoke test)',
    );
  });
});

