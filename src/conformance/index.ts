/**
 * Contract runner — executes the conformance cases shipped with
 * `@skill-map/spec` against an installed binary and emits a pass/fail result
 * per case.
 *
 * Implements the six assertion types from `spec/schemas/conformance-case.schema.json`.
 * Provisions a clean tmp scope per case, optionally pre-populated with the
 * referenced fixture corpus.
 *
 * Step 0b scope: single-case dispatch. Suite-level runner + reporter land
 * alongside Step 2 extensions.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export type AssertionResult =
  | { ok: true; type: string }
  | { ok: false; type: string; reason: string };

export interface RunCaseResult {
  caseId: string;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  assertions: AssertionResult[];
}

export interface RunCaseOptions {
  /** Absolute path to the binary wrapper (e.g. `bin/sm.js`). */
  binary: string;
  /** Absolute path to the `@skill-map/spec` root. */
  specRoot: string;
  /** Absolute path to the case JSON under `<conformance-root>/cases/`. */
  casePath: string;
  /**
   * Absolute path to the `<conformance-root>/fixtures/` directory backing
   * this case (or the parent conformance suite).
   *
   * Phase 5 / A.13 introduced per-Provider conformance directories that
   * live outside the spec tree (Claude-specific cases moved to
   * `src/extensions/providers/claude/conformance/`). Cases reference
   * fixtures by directory name; the runner resolves them under
   * `fixturesRoot` so the spec-agnostic kernel-empty-boot case and the
   * Claude `basic-scan` / `rename-high` / `orphan-detection` cases can
   * coexist without colliding fixture namespaces. Defaults to
   * `<specRoot>/conformance/fixtures` for the legacy spec layout.
   */
  fixturesRoot?: string;
  /** Extra env vars passed to the child. */
  env?: NodeJS.ProcessEnv;
}

interface ConformanceCase {
  id: string;
  description: string;
  fixture?: string;
  setup?: {
    disableAllProviders?: boolean;
    disableAllExtractors?: boolean;
    disableAllRules?: boolean;
    priorScans?: Array<{ fixture: string; flags?: string[] }>;
  };
  invoke: {
    verb: string;
    sub?: string;
    args?: string[];
    flags?: string[];
  };
  assertions: Assertion[];
}

/**
 * Build the env-var bag a case's `setup.disableAll*` toggles inject into
 * every child invocation (priorScans + the main `invoke`). The CLI's scan
 * composer (`composeScanExtensions`) reads these vars and drops every
 * extension of the matching kind from the in-scan pipeline.
 */
function disableEnv(setup: ConformanceCase['setup']): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (setup?.disableAllProviders) env['SKILL_MAP_DISABLE_ALL_PROVIDERS'] = '1';
  if (setup?.disableAllExtractors) env['SKILL_MAP_DISABLE_ALL_EXTRACTORS'] = '1';
  if (setup?.disableAllRules) env['SKILL_MAP_DISABLE_ALL_RULES'] = '1';
  return env;
}

type Assertion =
  | { type: 'exit-code'; value: number }
  | {
      type: 'json-path';
      path: string;
      equals?: unknown;
      greaterThan?: number;
      lessThan?: number;
      matches?: string;
    }
  | { type: 'file-exists'; path: string }
  | { type: 'file-contains-verbatim'; path: string; fixture: string }
  | { type: 'file-matches-schema'; path: string; schema: string }
  | { type: 'stderr-matches'; pattern: string };

export function runConformanceCase(options: RunCaseOptions): RunCaseResult {
  const raw = readFileSync(options.casePath, 'utf8');
  const c: ConformanceCase = JSON.parse(raw);

  const fixturesRoot = options.fixturesRoot ?? join(options.specRoot, 'conformance', 'fixtures');

  const scope = mkdtempSync(join(tmpdir(), `sm-conformance-${c.id}-`));
  const setupEnv = disableEnv(c.setup);
  try {
    // 1. Replay every `setup.priorScans` step into the scope DB before
    //    the main invoke runs. Returns the failure result early if any
    //    step exits non-zero.
    const priorFailure = runPriorScansSetup(c, options, scope, fixturesRoot, setupEnv);
    if (priorFailure) return priorFailure;

    // 2. Copy the main fixture (replacing prior fixture content but
    //    preserving the DB), then run the case's `invoke`.
    if (c.fixture) {
      replaceFixture(scope, fixturesRoot, c.fixture);
    }

    const argv = [c.invoke.verb];
    if (c.invoke.sub) argv.push(c.invoke.sub);
    if (c.invoke.args) argv.push(...c.invoke.args);
    if (c.invoke.flags) argv.push(...c.invoke.flags);

    const child = spawnSync(process.execPath, [options.binary, ...argv], {
      cwd: scope,
      env: { ...process.env, ...options.env, ...setupEnv },
      encoding: 'utf8',
    });

    const stdout = child.stdout ?? '';
    const stderr = child.stderr ?? '';
    const exitCode = child.status ?? 0;

    const assertions = c.assertions.map((a) =>
      evaluateAssertion(a, {
        exitCode,
        stdout,
        stderr,
        scope,
        specRoot: options.specRoot,
        fixturesRoot,
      }),
    );
    const passed = assertions.every((a) => a.ok);

    return { caseId: c.id, passed, exitCode, stdout, stderr, assertions };
  } finally {
    rmSync(scope, { recursive: true, force: true });
  }
}

/**
 * Phase 1 of `runConformanceCase` — replay every `setup.priorScans`
 * step in order. Each step replaces every non-`.skill-map/` directory
 * with the named fixture, then runs `sm scan` so the snapshot persists
 * into the scope DB. The scope DB survives across steps (we never
 * delete `.skill-map/`).
 *
 * Returns `null` on success (caller continues) or a `RunCaseResult`
 * with a single `priorScan` failure assertion (caller returns it
 * unchanged).
 */
function runPriorScansSetup(
  c: ConformanceCase,
  options: RunCaseOptions,
  scope: string,
  fixturesRoot: string,
  setupEnv: NodeJS.ProcessEnv,
): RunCaseResult | null {
  for (const step of c.setup?.priorScans ?? []) {
    replaceFixture(scope, fixturesRoot, step.fixture);
    const stepArgv = ['scan', ...(step.flags ?? [])];
    const stepChild = spawnSync(process.execPath, [options.binary, ...stepArgv], {
      cwd: scope,
      env: { ...process.env, ...options.env, ...setupEnv },
      encoding: 'utf8',
    });
    if ((stepChild.status ?? 0) !== 0) {
      return {
        caseId: c.id,
        passed: false,
        exitCode: stepChild.status ?? 0,
        stdout: stepChild.stdout ?? '',
        stderr: stepChild.stderr ?? '',
        assertions: [
          {
            ok: false,
            type: 'priorScan',
            reason: `setup.priorScans step \`${step.fixture}\` failed with exit ${stepChild.status ?? 0}: ${stepChild.stderr ?? ''}`,
          },
        ],
      };
    }
  }
  return null;
}

/**
 * Replace every top-level entry in `scope` EXCEPT `.skill-map/` (which
 * holds the kernel DB and persists across staging steps), then copy
 * the fixture's contents on top. Used by `priorScans` and the main
 * fixture phase to swap Provider content while keeping the DB stable.
 *
 * `fixturesRoot` is the absolute path to the `fixtures/` directory of
 * the conformance suite hosting the case (spec-owned for kernel cases,
 * Provider-owned for Provider cases — see `RunCaseOptions.fixturesRoot`).
 */
function replaceFixture(scope: string, fixturesRoot: string, fixture: string): void {
  for (const entry of readdirSync(scope)) {
    if (entry === '.skill-map') continue;
    rmSync(join(scope, entry), { recursive: true, force: true });
  }
  const src = join(fixturesRoot, fixture);
  cpSync(src, scope, { recursive: true });
}

interface AssertionContext {
  exitCode: number;
  stdout: string;
  stderr: string;
  scope: string;
  specRoot: string;
  fixturesRoot: string;
}

function evaluateAssertion(a: Assertion, ctx: AssertionContext): AssertionResult {
  switch (a.type) {
    case 'exit-code':
      return ctx.exitCode === a.value
        ? { ok: true, type: a.type }
        : {
            ok: false,
            type: a.type,
            reason: `expected exit ${a.value}, got ${ctx.exitCode}`,
          };
    case 'json-path':
      return evaluateJsonPath(a, ctx);
    case 'file-exists': {
      const abs = resolve(ctx.scope, a.path);
      return existsSync(abs)
        ? { ok: true, type: a.type }
        : { ok: false, type: a.type, reason: `file not found: ${a.path}` };
    }
    case 'file-contains-verbatim': {
      const fixturePath = join(ctx.fixturesRoot, a.fixture);
      const targetPath = resolve(ctx.scope, a.path);
      if (!existsSync(targetPath)) {
        return { ok: false, type: a.type, reason: `target not found: ${a.path}` };
      }
      const needle = readFileSync(fixturePath);
      const haystack = readFileSync(targetPath);
      return haystack.includes(needle)
        ? { ok: true, type: a.type }
        : {
            ok: false,
            type: a.type,
            reason: `target does not contain fixture ${a.fixture} verbatim`,
          };
    }
    case 'file-matches-schema':
      return {
        ok: false,
        type: a.type,
        reason: 'file-matches-schema not yet implemented (requires ajv; lands with Step 2)',
      };
    case 'stderr-matches': {
      const re = new RegExp(a.pattern);
      return re.test(ctx.stderr)
        ? { ok: true, type: a.type }
        : { ok: false, type: a.type, reason: `stderr did not match /${a.pattern}/` };
    }
  }
}

/**
 * Minimal JSONPath evaluator — supports only the subset used by the stub
 * conformance suite: `$.foo`, `$.foo.bar`, `$.foo.length`, `$[0]`.
 * The full RFC 9535 implementation lands with Step 2.
 */
function evaluateJsonPath(
  a: Extract<Assertion, { type: 'json-path' }>,
  ctx: AssertionContext,
): AssertionResult {
  let doc: unknown;
  try {
    doc = JSON.parse(ctx.stdout);
  } catch (err) {
    return {
      ok: false,
      type: a.type,
      reason: `stdout is not valid JSON: ${(err as Error).message}`,
    };
  }

  const segments = parsePath(a.path);
  if (!segments) {
    return { ok: false, type: a.type, reason: `unsupported jsonpath: ${a.path}` };
  }

  const walked = traverseJsonPath(doc, segments, a.path);
  if (!walked.ok) return { ok: false, type: a.type, reason: walked.reason };

  return applyJsonPathComparator(a, walked.value);
}

/**
 * Walk a parsed JSONPath segment list against a JSON document. Returns
 * the resolved value or a structured failure (caller maps to
 * `AssertionResult`). Pure — no IO, no shared state.
 */
function traverseJsonPath(
  doc: unknown,
  segments: Array<string | number>,
  path: string,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  let current: unknown = doc;
  for (const seg of segments) {
    if (typeof seg === 'number') {
      if (!Array.isArray(current)) return { ok: false, reason: `expected array at ${path}` };
      current = current[seg];
    } else if (seg === 'length' && Array.isArray(current)) {
      current = current.length;
    } else if (typeof current === 'object' && current !== null) {
      current = (current as Record<string, unknown>)[seg];
    } else {
      return { ok: false, reason: `cannot traverse ${typeof current} at segment '${String(seg)}'` };
    }
  }
  return { ok: true, value: current };
}

/**
 * Apply the comparator clause (`equals` / `greaterThan` / `lessThan` /
 * `matches`) of a `json-path` assertion against the value resolved at
 * the requested path. Returns the final `AssertionResult` directly.
 *
 * Complexity from the four parallel comparator branches; splitting into
 * one helper per comparator would be ceremony.
 */
// eslint-disable-next-line complexity
function applyJsonPathComparator(
  a: Extract<Assertion, { type: 'json-path' }>,
  current: unknown,
): AssertionResult {
  if ('equals' in a && a.equals !== undefined) {
    return deepEqual(current, a.equals)
      ? { ok: true, type: a.type }
      : {
          ok: false,
          type: a.type,
          reason: `${a.path} = ${JSON.stringify(current)}, expected ${JSON.stringify(a.equals)}`,
        };
  }
  if ('greaterThan' in a && typeof a.greaterThan === 'number') {
    return typeof current === 'number' && current > a.greaterThan
      ? { ok: true, type: a.type }
      : { ok: false, type: a.type, reason: `${a.path} not > ${a.greaterThan}` };
  }
  if ('lessThan' in a && typeof a.lessThan === 'number') {
    return typeof current === 'number' && current < a.lessThan
      ? { ok: true, type: a.type }
      : { ok: false, type: a.type, reason: `${a.path} not < ${a.lessThan}` };
  }
  if ('matches' in a && typeof a.matches === 'string') {
    const re = new RegExp(a.matches);
    return typeof current === 'string' && re.test(current)
      ? { ok: true, type: a.type }
      : { ok: false, type: a.type, reason: `${a.path} did not match /${a.matches}/` };
  }
  return { ok: false, type: a.type, reason: 'no comparator on json-path assertion' };
}

function parsePath(path: string): Array<string | number> | null {
  if (!path.startsWith('$')) return null;
  const tail = path.slice(1);
  const segments: Array<string | number> = [];
  const re = /\.([a-zA-Z_][a-zA-Z0-9_-]*)|\[(\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tail)) !== null) {
    if (match.index !== lastIndex) return null;
    if (match[1] !== undefined) segments.push(match[1]);
    else if (match[2] !== undefined) segments.push(Number.parseInt(match[2], 10));
    lastIndex = re.lastIndex;
  }
  if (lastIndex !== tail.length) return null;
  return segments;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (
        !deepEqual(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        )
      )
        {return false;}
    }
    return true;
  }
  return false;
}

/** Verifies the spec root looks sane (contains `index.json`). */
export function assertSpecRoot(specRoot: string): void {
  const indexPath = join(specRoot, 'index.json');
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
    throw new Error(`spec root missing index.json at ${specRoot}`);
  }
}
