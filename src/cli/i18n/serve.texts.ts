/**
 * CLI strings emitted by `sm serve` (`cli/commands/serve.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const SERVE_TEXTS = {
  // Banner emitted to stderr after the listener binds. Mirrors `sm watch`
  // by writing operational status to stderr (stdout is reserved for
  // future `--json` boot payloads).
  boot:
    'sm serve: listening on http://{{host}}:{{port}} (scope={{scope}}, db={{db}})\n',

  // Hint shown after the boot line. Branches on --open: when auto-open
  // is on (default), the message states intent ("opening …"); when
  // --no-open, it instructs the user to visit the URL manually.
  // Both end with the Ctrl+C reminder so the operational tail is
  // identical regardless of branch.
  bootOpening: 'sm serve: opening http://{{host}}:{{port}}/ in your browser. Press Ctrl+C to stop.\n',
  bootVisitHint: 'sm serve: visit http://{{host}}:{{port}}/ in your browser. Press Ctrl+C to stop.\n',

  // Browser-open failure. Non-fatal — the URL is already printed; the
  // user can open it manually.
  openFailed:
    'sm serve: could not auto-open browser ({{message}}). Visit {{url}} manually.\n',

  // Bind failure (port in use, EACCES, etc.) → ExitCode.Error.
  bindFailed: 'sm serve: failed to bind {{host}}:{{port}} — {{message}}\n',

  // Flag-validation failures — ExitCode.Error.
  hostDevCorsRejected:
    'sm serve: --dev-cors requires a loopback --host (got {{host}}). Refusing per Decision #119.\n',
  portOutOfRange:
    'sm serve: --port must be an integer in [0, 65535] (got {{value}}).\n',
  portInvalid:
    'sm serve: --port must be a non-negative integer (got {{value}}).\n',
  scopeInvalid:
    'sm serve: --scope must be "project" or "global" (got {{value}}).\n',

  // Generic operational error — surfaced when the server itself throws
  // before the listener binds (e.g. UI bundle missing under explicit
  // --ui-dist).
  startupFailed: 'sm serve: startup failed — {{message}}\n',

  // DB-not-found (--db <path> doesn't exist) → ExitCode.NotFound.
  dbNotFound: 'sm serve: --db {{path}} does not exist.\n',

  // Shutdown trace — printed once the listener has closed.
  shutdown: 'sm serve: shutdown complete.\n',
} as const;
