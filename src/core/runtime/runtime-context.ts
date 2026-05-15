/**
 * Bridge between Node globals and kernel functions that need a runtime
 * context (`cwd`, `homedir`). The kernel deliberately does NOT read
 * `process.cwd()` / `os.homedir()` itself — those are CLI / adapter
 * concerns. Anywhere a kernel API needs them, the CLI calls
 * `defaultRuntimeContext()` and passes the values through.
 *
 * Why a helper instead of inlining `{ cwd: process.cwd(), homedir: homedir() }`
 * in every caller: 8+ command sites consume it; centralising keeps the
 * intent obvious ("use the live process context") and gives one place
 * to extend if a future override (e.g. resolved absolute cwd) is needed.
 *
 * Lives under `core/` so the BFF (`src/server/`) can consume it without
 * crossing into `src/cli/`. The historic `cli/util/runtime-context.ts`
 * import path keeps working through a re-export shim there.
 */

import { homedir } from 'node:os';

export interface IRuntimeContext {
  cwd: string;
  homedir: string;
}

export function defaultRuntimeContext(): IRuntimeContext {
  // The single legitimate `process.cwd()` read in core/ — this helper
  // exists precisely to lift the live process context into a typed
  // value the rest of core/ consumes via `IRuntimeContext`. Every
  // other core/ module gets `cwd` injected through the bag this
  // returns; only the BFF / CLI adapters call this fabricator.
  //
  // `$HOME` takes precedence over `homedir()` so tests (and end users
  // overriding the env explicitly) get the resolved value. Node's
  // `os.homedir()` already reads `$HOME` on POSIX, but bun's
  // implementation goes straight to the passwd database and ignores
  // the env var — reading the env first keeps both runtimes aligned.
  // eslint-disable-next-line no-restricted-syntax
  return { cwd: process.cwd(), homedir: process.env['HOME'] ?? homedir() };
}
