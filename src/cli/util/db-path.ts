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

/**
 * Per-scope directory the CLI stores its state under (DB file, settings,
 * plugins, etc.). Same name in project (`<cwd>/.skill-map/`) and global
 * (`~/.skill-map/`) scopes; the difference is the parent. Exported so
 * write-side scaffolding (`sm init`) and other helpers can reuse the
 * convention without duplicating the literal.
 */
export const SKILL_MAP_DIR = '.skill-map';

const DB_FILENAME = 'skill-map.db';
const JOBS_DIRNAME = 'jobs';
const PLUGINS_DIRNAME = 'plugins';

/**
 * Single source of truth for the relative DB path inside a scope
 * directory (`.skill-map/skill-map.db`). Same string in project and
 * global scope; the difference is the parent directory the helper
 * resolves against.
 */
const DEFAULT_DB_REL = `${SKILL_MAP_DIR}/${DB_FILENAME}`;

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
  if (options.global) return join(options.homedir, DEFAULT_DB_REL);
  return resolve(options.cwd, DEFAULT_DB_REL);
}

/**
 * Default project DB path (`<cwd>/.skill-map/skill-map.db`). Same effect
 * as `resolveDbPath({ global: false, db: undefined, ...ctx })`; this
 * helper is the cheaper and more explicit route for call sites that have
 * no `--global` / `--db` flags to honour (`sm scan`, `sm refresh`,
 * `sm watch`).
 */
export function defaultProjectDbPath(ctx: IRuntimeContext): string {
  return resolve(ctx.cwd, DEFAULT_DB_REL);
}

/**
 * Default project jobs directory (`<cwd>/.skill-map/jobs`). Used by the
 * `sm job prune` orphan-files pass and any other call site that needs
 * the project-scoped jobs spool.
 */
export function defaultProjectJobsDir(ctx: IRuntimeContext): string {
  return resolve(ctx.cwd, SKILL_MAP_DIR, JOBS_DIRNAME);
}

/**
 * Default project plugins directory (`<cwd>/.skill-map/plugins`).
 * Project + user plugin discovery composes this with the user-scoped
 * `<homedir>/.skill-map/plugins` peer.
 */
export function defaultProjectPluginsDir(ctx: IRuntimeContext): string {
  return resolve(ctx.cwd, SKILL_MAP_DIR, PLUGINS_DIRNAME);
}

/**
 * Default user (global) plugins directory (`<homedir>/.skill-map/plugins`).
 * Used alongside `defaultProjectPluginsDir` when discovery walks both
 * scopes.
 */
export function defaultUserPluginsDir(ctx: IRuntimeContext): string {
  return join(ctx.homedir, SKILL_MAP_DIR, PLUGINS_DIRNAME);
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
