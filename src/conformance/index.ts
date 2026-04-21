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
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
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
  /** Absolute path to the binary wrapper (e.g. `bin/sm.mjs`). */
  binary: string;
  /** Absolute path to the `@skill-map/spec` root. */
  specRoot: string;
  /** Absolute path to the case JSON under `spec/conformance/cases/`. */
  casePath: string;
  /** Extra env vars passed to the child. */
  env?: NodeJS.ProcessEnv;
}

interface ConformanceCase {
  id: string;
  description: string;
  fixture?: string;
  setup?: {
    disableAllAdapters?: boolean;
    disableAllDetectors?: boolean;
    disableAllRules?: boolean;
  };
  invoke: {
    verb: string;
    sub?: string;
    args?: string[];
    flags?: string[];
  };
  assertions: Assertion[];
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

  const scope = mkdtempSync(join(tmpdir(), `sm-conformance-${c.id}-`));
  try {
    if (c.fixture) {
      const src = join(options.specRoot, 'conformance', 'fixtures', c.fixture);
      cpSync(src, scope, { recursive: true });
    }

    const argv = [c.invoke.verb];
    if (c.invoke.sub) argv.push(c.invoke.sub);
    if (c.invoke.args) argv.push(...c.invoke.args);
    if (c.invoke.flags) argv.push(...c.invoke.flags);

    const child = spawnSync(process.execPath, [options.binary, ...argv], {
      cwd: scope,
      env: { ...process.env, ...options.env },
      encoding: 'utf8',
    });

    const stdout = child.stdout ?? '';
    const stderr = child.stderr ?? '';
    const exitCode = child.status ?? 0;

    const assertions = c.assertions.map((a) =>
      evaluateAssertion(a, { exitCode, stdout, stderr, scope, specRoot: options.specRoot }),
    );
    const passed = assertions.every((a) => a.ok);

    return { caseId: c.id, passed, exitCode, stdout, stderr, assertions };
  } finally {
    rmSync(scope, { recursive: true, force: true });
  }
}

interface AssertionContext {
  exitCode: number;
  stdout: string;
  stderr: string;
  scope: string;
  specRoot: string;
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
      const fixturePath = join(ctx.specRoot, 'conformance', 'fixtures', a.fixture);
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

  let current: unknown = doc;
  for (const seg of segments) {
    if (typeof seg === 'number') {
      if (!Array.isArray(current)) {
        return { ok: false, type: a.type, reason: `expected array at ${a.path}` };
      }
      current = current[seg];
    } else if (seg === 'length' && Array.isArray(current)) {
      current = current.length;
    } else if (typeof current === 'object' && current !== null) {
      current = (current as Record<string, unknown>)[seg];
    } else {
      return {
        ok: false,
        type: a.type,
        reason: `cannot traverse ${typeof current} at segment '${String(seg)}'`,
      };
    }
  }

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
        return false;
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
