/**
 * CLI strings emitted by `sm serve` (`cli/commands/serve.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const SERVE_TEXTS = {
  // The boot banner (TTY box / flat-line fallback) is rendered by
  // `cli/util/serve-banner.ts` rather than templated through `tx` —
  // ANSI escapes + box-drawing aren't a good fit for the flat
  // `{{name}}` interpolation surface. The flat-mode strings live in
  // that helper and stay byte-equivalent to the pre-banner format so
  // existing pipes / redirects ('listening on <url>' scrapers) don't
  // break.

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

  // Watcher option failures — ExitCode.Error.
  watcherRequiresPipeline:
    'sm serve: --no-built-ins is incompatible with the watcher (would persist empty scans on every batch). Pass --no-watcher to opt out, or drop --no-built-ins.\n',
  watcherDebounceInvalid:
    'sm serve: --watcher-debounce-ms must be a non-negative integer (got {{value}}).\n',

  // Generic operational error — surfaced when the server itself throws
  // before the listener binds (e.g. UI bundle missing under explicit
  // --ui-dist).
  startupFailed: 'sm serve: startup failed — {{message}}\n',

  // DB-not-found (--db <path> doesn't exist) → ExitCode.NotFound.
  dbNotFound: 'sm serve: --db {{path}} does not exist.\n',

  // Shutdown trace — printed once the listener has closed.
  shutdown: 'sm serve: shutdown complete.\n',
} as const;
