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
import { isAbsolute, join, relative, resolve } from 'node:path';

import { tx } from '../kernel/util/tx.js';
import { CONFORMANCE_RUNNER_TEXTS } from './i18n/runner.texts.js';

export type IAssertionResult =
  | { ok: true; type: string }
  | { ok: false; type: string; reason: string };

export interface IRunCaseResult {
  caseId: string;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  assertions: IAssertionResult[];
}

export interface IRunCaseOptions {
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

interface IConformanceCase {
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
  assertions: IAssertion[];
}

/**
 * Build the env-var bag a case's `setup.disableAll*` toggles inject into
 * every child invocation (priorScans + the main `invoke`). The CLI's scan
 * composer (`composeScanExtensions`) reads these vars and drops every
 * extension of the matching kind from the in-scan pipeline.
 */
function disableEnv(setup: IConformanceCase['setup']): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (setup?.disableAllProviders) env['SKILL_MAP_DISABLE_ALL_PROVIDERS'] = '1';
  if (setup?.disableAllExtractors) env['SKILL_MAP_DISABLE_ALL_EXTRACTORS'] = '1';
  if (setup?.disableAllRules) env['SKILL_MAP_DISABLE_ALL_RULES'] = '1';
  return env;
}

export type IAssertion =
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

// eslint-disable-next-line complexity
export function runConformanceCase(options: IRunCaseOptions): IRunCaseResult {
  const raw = readFileSync(options.casePath, 'utf8');
  const c: IConformanceCase = JSON.parse(raw);

  const fixturesRoot = options.fixturesRoot ?? join(options.specRoot, 'conformance', 'fixtures');

  // Defence in depth (audit L5): the conformance case id is JSON-author-
  // controlled. Replace anything that isn't a safe filesystem char and
  // cap the length so an over-long id (or one carrying path separators
  // / control bytes) can't escape `tmpdir()` or grow the prefix beyond
  // a reasonable bound.
  const safeId = c.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
  const scope = mkdtempSync(join(tmpdir(), `sm-conformance-${safeId}-`));
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
 * Returns `null` on success (caller continues) or a `IRunCaseResult`
 * with a single `priorScan` failure assertion (caller returns it
 * unchanged).
 */
// Per-step replay: replace fixture, spawn `sm scan`, check exit. The
// failure-result construction is verbose because it carries every
// stream the caller reports back.
// eslint-disable-next-line complexity
function runPriorScansSetup(
  c: IConformanceCase,
  options: IRunCaseOptions,
  scope: string,
  fixturesRoot: string,
  setupEnv: NodeJS.ProcessEnv,
): IRunCaseResult | null {
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
            reason: tx(CONFORMANCE_RUNNER_TEXTS.priorScanFailed, {
              fixture: step.fixture,
              exit: stepChild.status ?? 0,
              stderr: stepChild.stderr ?? '',
            }),
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
 * Provider-owned for Provider cases — see `IRunCaseOptions.fixturesRoot`).
 */
function replaceFixture(scope: string, fixturesRoot: string, fixture: string): void {
  assertContained(fixturesRoot, fixture, 'fixture');
  for (const entry of readdirSync(scope)) {
    if (entry === '.skill-map') continue;
    rmSync(join(scope, entry), { recursive: true, force: true });
  }
  const src = join(fixturesRoot, fixture);
  cpSync(src, scope, { recursive: true });
}

/**
 * Reject case-supplied path strings that escape the directory tree they
 * are anchored to. A hostile case JSON would otherwise be able to copy
 * arbitrary filesystem content into the tmp scope (`fixture: "../.."`)
 * or read files outside the conformance sandbox via `file-exists` /
 * `file-contains-verbatim` assertions.
 */
function assertContained(root: string, rel: string, label: string): void {
  if (isAbsolute(rel)) {
    throw new Error(
      tx(CONFORMANCE_RUNNER_TEXTS.pathMustBeRelative, { label, path: rel, anchor: root }),
    );
  }
  const abs = resolve(root, rel);
  const r = relative(root, abs);
  if (r.startsWith('..') || isAbsolute(r)) {
    throw new Error(
      tx(CONFORMANCE_RUNNER_TEXTS.pathEscapesAnchor, { label, path: rel, anchor: root }),
    );
  }
}

interface IAssertionContext {
  exitCode: number;
  stdout: string;
  stderr: string;
  scope: string;
  specRoot: string;
  fixturesRoot: string;
}

// Switch over assertion types (`exit-code` / `stdout-matches` /
// `file-exists` / `file-contains-verbatim` / `file-matches-schema` /
// `stderr-matches` / `json-path`) with one branch per type. Splitting
// per type would scatter the discriminated-union dispatch.
// eslint-disable-next-line complexity
function evaluateAssertion(a: IAssertion, ctx: IAssertionContext): IAssertionResult {
  switch (a.type) {
    case 'exit-code':
      return ctx.exitCode === a.value
        ? { ok: true, type: a.type }
        : {
            ok: false,
            type: a.type,
            reason: tx(CONFORMANCE_RUNNER_TEXTS.expectedExitCode, {
              expected: a.value,
              actual: ctx.exitCode,
            }),
          };
    case 'json-path':
      return evaluateJsonPath(a, ctx);
    case 'file-exists': {
      try {
        assertContained(ctx.scope, a.path, 'file-exists');
      } catch (err) {
        return { ok: false, type: a.type, reason: (err as Error).message };
      }
      const abs = resolve(ctx.scope, a.path);
      return existsSync(abs)
        ? { ok: true, type: a.type }
        : {
            ok: false,
            type: a.type,
            reason: tx(CONFORMANCE_RUNNER_TEXTS.fileNotFound, { path: a.path }),
          };
    }
    case 'file-contains-verbatim': {
      try {
        assertContained(ctx.fixturesRoot, a.fixture, 'file-contains-verbatim/fixture');
        assertContained(ctx.scope, a.path, 'file-contains-verbatim/path');
      } catch (err) {
        return { ok: false, type: a.type, reason: (err as Error).message };
      }
      const fixturePath = join(ctx.fixturesRoot, a.fixture);
      const targetPath = resolve(ctx.scope, a.path);
      if (!existsSync(targetPath)) {
        return {
          ok: false,
          type: a.type,
          reason: tx(CONFORMANCE_RUNNER_TEXTS.targetNotFound, { path: a.path }),
        };
      }
      const needle = readFileSync(fixturePath);
      const haystack = readFileSync(targetPath);
      return haystack.includes(needle)
        ? { ok: true, type: a.type }
        : {
            ok: false,
            type: a.type,
            reason: tx(CONFORMANCE_RUNNER_TEXTS.targetMissingFixture, { fixture: a.fixture }),
          };
    }
    case 'file-matches-schema':
      return {
        ok: false,
        type: a.type,
        reason: CONFORMANCE_RUNNER_TEXTS.fileMatchesSchemaUnimplemented,
      };
    case 'stderr-matches': {
      const re = new RegExp(a.pattern);
      return re.test(ctx.stderr)
        ? { ok: true, type: a.type }
        : {
            ok: false,
            type: a.type,
            reason: tx(CONFORMANCE_RUNNER_TEXTS.stderrDidNotMatch, { pattern: a.pattern }),
          };
    }
  }
}

/**
 * Minimal JSONPath evaluator — supports only the subset used by the stub
 * conformance suite: `$.foo`, `$.foo.bar`, `$.foo.length`, `$[0]`.
 * The full RFC 9535 implementation lands with Step 2.
 */
function evaluateJsonPath(
  a: Extract<IAssertion, { type: 'json-path' }>,
  ctx: IAssertionContext,
): IAssertionResult {
  let doc: unknown;
  try {
    doc = JSON.parse(ctx.stdout);
  } catch (err) {
    return {
      ok: false,
      type: a.type,
      reason: tx(CONFORMANCE_RUNNER_TEXTS.stdoutNotJson, { message: (err as Error).message }),
    };
  }

  const segments = parsePath(a.path);
  if (!segments) {
    return {
      ok: false,
      type: a.type,
      reason: tx(CONFORMANCE_RUNNER_TEXTS.unsupportedJsonPath, { path: a.path }),
    };
  }

  const walked = traverseJsonPath(doc, segments, a.path);
  if (!walked.ok) return { ok: false, type: a.type, reason: walked.reason };

  return applyJsonPathComparator(a, walked.value);
}

/**
 * Walk a parsed JSONPath segment list against a JSON document. Returns
 * the resolved value or a structured failure (caller maps to
 * `IAssertionResult`). Pure — no IO, no shared state.
 */
function traverseJsonPath(
  doc: unknown,
  segments: Array<string | number>,
  path: string,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  let current: unknown = doc;
  for (const seg of segments) {
    if (typeof seg === 'number') {
      if (!Array.isArray(current)) {
        return { ok: false, reason: tx(CONFORMANCE_RUNNER_TEXTS.expectedArrayAtPath, { path }) };
      }
      current = current[seg];
    } else if (seg === 'length' && Array.isArray(current)) {
      current = current.length;
    } else if (typeof current === 'object' && current !== null) {
      current = (current as Record<string, unknown>)[seg];
    } else {
      return {
        ok: false,
        reason: tx(CONFORMANCE_RUNNER_TEXTS.cannotTraverseSegment, {
          type: typeof current,
          segment: String(seg),
        }),
      };
    }
  }
  return { ok: true, value: current };
}

/**
 * Apply the comparator clause (`equals` / `greaterThan` / `lessThan` /
 * `matches`) of a `json-path` assertion against the value resolved at
 * the requested path. Returns the final `IAssertionResult` directly.
 *
 * Complexity from the four parallel comparator branches; splitting into
 * one helper per comparator would be ceremony.
 */
// eslint-disable-next-line complexity
function applyJsonPathComparator(
  a: Extract<IAssertion, { type: 'json-path' }>,
  current: unknown,
): IAssertionResult {
  if ('equals' in a && a.equals !== undefined) {
    return deepEqual(current, a.equals)
      ? { ok: true, type: a.type }
      : {
          ok: false,
          type: a.type,
          reason: tx(CONFORMANCE_RUNNER_TEXTS.jsonPathEqualsMismatch, {
            path: a.path,
            actual: JSON.stringify(current),
            expected: JSON.stringify(a.equals),
          }),
        };
  }
  if ('greaterThan' in a && typeof a.greaterThan === 'number') {
    return typeof current === 'number' && current > a.greaterThan
      ? { ok: true, type: a.type }
      : {
          ok: false,
          type: a.type,
          reason: tx(CONFORMANCE_RUNNER_TEXTS.jsonPathNotGreaterThan, {
            path: a.path,
            value: a.greaterThan,
          }),
        };
  }
  if ('lessThan' in a && typeof a.lessThan === 'number') {
    return typeof current === 'number' && current < a.lessThan
      ? { ok: true, type: a.type }
      : {
          ok: false,
          type: a.type,
          reason: tx(CONFORMANCE_RUNNER_TEXTS.jsonPathNotLessThan, {
            path: a.path,
            value: a.lessThan,
          }),
        };
  }
  if ('matches' in a && typeof a.matches === 'string') {
    const re = new RegExp(a.matches);
    return typeof current === 'string' && re.test(current)
      ? { ok: true, type: a.type }
      : {
          ok: false,
          type: a.type,
          reason: tx(CONFORMANCE_RUNNER_TEXTS.jsonPathDidNotMatch, {
            path: a.path,
            pattern: a.matches,
          }),
        };
  }
  return { ok: false, type: a.type, reason: CONFORMANCE_RUNNER_TEXTS.jsonPathNoComparator };
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

// eslint-disable-next-line complexity
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
    throw new Error(tx(CONFORMANCE_RUNNER_TEXTS.specRootMissingIndex, { specRoot }));
  }
}
