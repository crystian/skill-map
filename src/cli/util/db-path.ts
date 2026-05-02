/**
 * Shared helpers for resolving the project / global skill-map DB file path
 * from CLI flags, and for asserting the file exists before any read-side
 * verb opens it. Used by every command that touches the DB on the
 * read-side (`sm list`, `sm show`, `sm check`) and by `sm db *` for
 * lifecycle ops.
 *
 * Spec global flags (per `spec/cli-contract.md` §Global flags):
 *   -g / --global    operate on `~/.skill-map/` instead of `./.skill-map/`
 *   --db <path>      escape hatch for explicit DB file
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { tx } from '../../kernel/util/tx.js';
import { UTIL_TEXTS } from '../i18n/util.texts.js';
import type { IRuntimeContext } from './runtime-context.js';

const DEFAULT_PROJECT_DB = '.skill-map/skill-map.db';
const DEFAULT_GLOBAL_DB = '.skill-map/skill-map.db';

/**
 * Inputs for `resolveDbPath`. Extends `IRuntimeContext` so the helper
 * never reads `process.cwd()` / `homedir()` directly — every caller
 * threads the runtime context (mandatory) alongside the spec flags.
 * Pattern: `resolveDbPath({ global, db, ...defaultRuntimeContext() })`.
 */
export interface IDbLocationOptions extends IRuntimeContext {
  global: boolean;
  db: string | undefined;
}

/**
 * Resolve the DB file path from command-line options.
 *
 * Precedence: explicit `--db <path>` > `-g/--global` (~/.skill-map/) >
 * project default (cwd/.skill-map/).
 *
 * Always returns an absolute path. Does NOT verify existence — pair with
 * `assertDbExists` for read-side verbs.
 */
export function resolveDbPath(options: IDbLocationOptions): string {
  if (options.db) return resolve(options.db);
  if (options.global) return join(options.homedir, DEFAULT_GLOBAL_DB);
  return resolve(options.cwd, DEFAULT_PROJECT_DB);
}

/**
 * Read-side guard: returns true if the DB file exists (or is `:memory:`),
 * otherwise writes a clear hint to stderr and returns false. Callers
 * should propagate exit code 5 (not-found) on a false return per
 * `spec/cli-contract.md` §Exit codes.
 */
export function assertDbExists(path: string, stderr: NodeJS.WritableStream): boolean {
  if (path === ':memory:' || existsSync(path)) return true;
  stderr.write(tx(UTIL_TEXTS.dbNotFound, { path }));
  return false;
}
