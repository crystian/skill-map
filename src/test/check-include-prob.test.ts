/**
 * Phase 4 / A.7 — `sm check --include-prob` opt-in flag.
 *
 * Acceptance tests for the probabilistic-Rule dispatch flag. The job
 * subsystem (Step 10) is not in the tree yet, so the flag is a stub:
 * the verb detects probabilistic Rules registered via the plugin
 * runtime and emits a stderr advisory naming them. Deterministic rules
 * produce issues exactly as before — that is the CI-safe baseline the
 * flag deliberately preserves.
 *
 * Five cases (mirror the design brief):
 *
 *   (a) `sm check` (no flag) — det only, exit 0/1 by issue severity,
 *       no advisory regardless of whether prob rules are registered.
 *   (b) `sm check --include-prob` with prob rules registered — emits
 *       advisory naming the prob rule ids; det issues unchanged; exit
 *       code follows det issues only.
 *   (c) `sm check --include-prob` with NO prob rules registered — no
 *       advisory (nothing to skip); det issues unchanged.
 *   (d) `sm check --include-prob --rules core/validate-all` — `--rules`
 *       filter narrows both the issue list AND the advisory; with the
 *       single det rule selected, no prob advisory fires even when
 *       prob rules are registered.
 *   (e) `sm check --include-prob --async` — same advisory shape as (b)
 *       but the message also mentions `--async`. No actual job dispatch.
 *
 * The fixture uses `--no-plugins` for cases that don't need a plugin
 * on disk — the kernel's built-ins are all deterministic, so without a
 * plugin the prob detection finds zero rules. For cases that DO need a
 * prob rule, we plant a minimal plugin under a temp `--plugin-dir`
 * (mirroring the pattern in `plugin-runtime-branches.test.ts`).
 *
 * Note: at the runtime level, the CheckCommand calls
 * `loadPluginRuntime({ scope: 'project' })`, which honours
 * `process.cwd()` for the project search path. To plant a probabilistic
 * rule without juggling cwd/$HOME, we set `cmd.noPlugins = true` and
 * inject the prob rule via the global registry — but the verb's
 * detection path runs through the plugin loader, not the kernel
 * registry. So instead we drive the project search path: each test sets
 * cwd to a temp directory whose `.skill-map/plugins/` holds the planted
 * prob plugin (or doesn't, for the no-prob-rules case).
 */

import { after, before, describe, it } from 'node:test';
import { strictEqual, ok, match, doesNotMatch } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BaseContext } from 'clipanion';

import { CheckCommand } from '../cli/commands/check.js';
import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';

// --- shared scaffolding ----------------------------------------------------

let tmpRoot: string;
let counter = 0;

function freshDir(label: string): string {
  counter += 1;
  const dir = join(tmpRoot, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function freshDbPath(label: string): string {
  counter += 1;
  return join(tmpRoot, `${label}-${counter}.db`);
}

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

interface ICheckOverrides {
  db?: string | undefined;
  global?: boolean;
  json?: boolean;
  node?: string | undefined;
  rules?: string | undefined;
  includeProb?: boolean;
  async?: boolean;
  noPlugins?: boolean;
}

function buildCheck(overrides: ICheckOverrides = {}): CheckCommand {
  const cmd = new CheckCommand();
  cmd.global = overrides.global ?? false;
  cmd.db = overrides.db;
  cmd.json = overrides.json ?? false;
  cmd.node = overrides.node;
  cmd.rules = overrides.rules;
  cmd.includeProb = overrides.includeProb ?? false;
  cmd.async = overrides.async ?? false;
  cmd.noPlugins = overrides.noPlugins ?? false;
  return cmd;
}

/**
 * Plant a minimal user plugin under `<projectRoot>/.skill-map/plugins/<id>/`
 * exporting a Rule. The prob flag is opt-in via the `mode` argument.
 *
 * The runtime contract a Rule must satisfy is enforced by the schema and
 * by the loader's AJV pass; we plant valid JSON with the required
 * `emitsRuleIds`, `defaultSeverity`, and `mode` fields.
 */
function plantRulePlugin(
  projectRoot: string,
  pluginId: string,
  ruleId: string,
  mode: 'deterministic' | 'probabilistic',
): void {
  const dir = join(projectRoot, '.skill-map', 'plugins', pluginId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({
      id: pluginId,
      version: '1.0.0',
      specCompat: '>=0.0.0',
      extensions: ['./r.mjs'],
    }),
  );
  writeFileSync(
    join(dir, 'r.mjs'),
    `export default {
      id: '${ruleId}',
      kind: 'rule',
      version: '1.0.0',
      mode: '${mode}',
      emitsRuleIds: ['${ruleId}'],
      defaultSeverity: 'warn',
      evaluate() { return []; },
    };`,
  );
}

/**
 * Initialise an empty (migrated) DB at `dbPath` so `sm check` can read
 * `scan_issues` without tripping on missing tables. We never populate
 * issues — the focus here is the flag's advisory behaviour, not the
 * persisted-issue rendering already covered by `scan-readers.test.ts`.
 */
async function initEmptyDb(dbPath: string): Promise<void> {
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  await adapter.close();
}

/**
 * Insert a synthetic issue to give the verb something concrete to read.
 * The shape mirrors `scan-readers.test.ts`'s synthetic-error pattern —
 * we keep severity at `warn` so exit code stays 0 (the flag's stub
 * MUST NOT alter exit semantics).
 */
async function insertWarnIssue(
  dbPath: string,
  ruleId: string,
  nodePath: string,
): Promise<void> {
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await adapter.db
      .insertInto('scan_issues')
      .values({
        ruleId,
        severity: 'warn',
        nodeIdsJson: JSON.stringify([nodePath]),
        linkIndicesJson: null,
        message: `synthetic ${ruleId} on ${nodePath}`,
        detail: null,
        fixJson: null,
        dataJson: null,
      })
      .execute();
  } finally {
    await adapter.close();
  }
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-check-prob-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// --- (a) baseline: no flag → identical to pre-A.7 behaviour --------------

describe('sm check (no --include-prob) — baseline det-only behaviour', () => {
  it('(a) prob rules registered but flag absent → no advisory', async () => {
    const projectRoot = freshDir('a-project');
    plantRulePlugin(projectRoot, 'prob-pkg', 'prob-rule', 'probabilistic');
    const dbPath = freshDbPath('a-db');
    await initEmptyDb(dbPath);

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const cap = captureContext();
      const cmd = buildCheck({ db: dbPath });
      cmd.context = cap.context;
      const code = await cmd.execute();

      strictEqual(code, 0, `expected exit 0 with no error-severity issues, got ${code}`);
      doesNotMatch(
        cap.stderr(),
        /probabilistic Rule dispatch/,
        'no advisory expected without --include-prob',
      );
    } finally {
      process.chdir(origCwd);
    }
  });
});

// --- (b) flag set + prob rule registered → advisory --------------------

describe('sm check --include-prob — advisory path', () => {
  it('(b) prob rule registered → stderr advisory names the rule id', async () => {
    const projectRoot = freshDir('b-project');
    plantRulePlugin(projectRoot, 'prob-pkg', 'prob-rule', 'probabilistic');
    const dbPath = freshDbPath('b-db');
    await initEmptyDb(dbPath);
    // Plant a det-rule warning so we exercise the "det rules ran as
    // usual" wording in the issue list while the advisory fires.
    await insertWarnIssue(dbPath, 'core/broken-ref', '.claude/agents/a.md');

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const cap = captureContext();
      const cmd = buildCheck({ db: dbPath, includeProb: true });
      cmd.context = cap.context;
      const code = await cmd.execute();

      // Det issue is severity warn → exit 0. Prob stub MUST NOT change
      // exit semantics.
      strictEqual(code, 0, `expected exit 0; got ${code}; stderr=${cap.stderr()}`);
      match(cap.stderr(), /probabilistic Rule dispatch requires the job subsystem/);
      match(cap.stderr(), /prob-pkg\/prob-rule/);
      match(cap.stdout(), /\[warn\] core\/broken-ref/);
    } finally {
      process.chdir(origCwd);
    }
  });
});

// --- (c) flag set + NO prob rule → no advisory --------------------------

describe('sm check --include-prob — no prob rules registered', () => {
  it('(c) flag on but registry has no prob rules → no advisory emitted', async () => {
    // No project-local plugin folder planted; the kernel built-ins are
    // all deterministic, so the prob set is empty.
    const projectRoot = freshDir('c-project');
    const dbPath = freshDbPath('c-db');
    await initEmptyDb(dbPath);

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const cap = captureContext();
      const cmd = buildCheck({ db: dbPath, includeProb: true });
      cmd.context = cap.context;
      const code = await cmd.execute();

      strictEqual(code, 0);
      doesNotMatch(
        cap.stderr(),
        /probabilistic Rule dispatch/,
        'advisory MUST NOT fire when no prob rules are registered',
      );
    } finally {
      process.chdir(origCwd);
    }
  });
});

// --- (d) --rules narrows both the issue list and the advisory ----------

describe('sm check --include-prob --rules <ids>', () => {
  it('(d) --rules filter excludes the planted prob rule → no advisory', async () => {
    const projectRoot = freshDir('d-project');
    plantRulePlugin(projectRoot, 'prob-pkg', 'prob-rule', 'probabilistic');
    const dbPath = freshDbPath('d-db');
    await initEmptyDb(dbPath);
    // Insert a det issue under `core/validate-all` so the `--rules`
    // filter has something to match on the read side.
    await insertWarnIssue(dbPath, 'core/validate-all', '.claude/agents/a.md');
    await insertWarnIssue(dbPath, 'core/broken-ref', '.claude/agents/b.md');

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const cap = captureContext();
      const cmd = buildCheck({
        db: dbPath,
        includeProb: true,
        rules: 'core/validate-all',
      });
      cmd.context = cap.context;
      const code = await cmd.execute();

      strictEqual(code, 0);
      // No prob advisory: the planted prob rule (`prob-pkg/prob-rule`)
      // is filtered out by the `--rules core/validate-all` selector.
      doesNotMatch(
        cap.stderr(),
        /probabilistic Rule dispatch/,
        'advisory MUST be filtered out when --rules excludes every prob rule',
      );
      // Issue list narrowed to validate-all only.
      match(cap.stdout(), /core\/validate-all/);
      doesNotMatch(cap.stdout(), /core\/broken-ref/);
    } finally {
      process.chdir(origCwd);
    }
  });
});

// --- (e) --async companion mentions the flag in the advisory ----------

describe('sm check --include-prob --async — reserved companion', () => {
  it('(e) advisory shape mentions --async; behaviour identical to (b)', async () => {
    const projectRoot = freshDir('e-project');
    plantRulePlugin(projectRoot, 'prob-pkg', 'prob-rule', 'probabilistic');
    const dbPath = freshDbPath('e-db');
    await initEmptyDb(dbPath);

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const cap = captureContext();
      const cmd = buildCheck({ db: dbPath, includeProb: true, async: true });
      cmd.context = cap.context;
      const code = await cmd.execute();

      strictEqual(code, 0);
      match(cap.stderr(), /--async flag is reserved for future encoding/);
      match(cap.stderr(), /prob-pkg\/prob-rule/);
    } finally {
      process.chdir(origCwd);
    }
  });
});
