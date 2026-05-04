/**
 * `sm serve` — start the Hono BFF (single-port: `/api/*` + `/ws` + SPA bundle).
 *
 * Step 14.1 surface: `/api/health` is the only real endpoint. Every
 * other `/api/*` returns the structured error envelope (404 `not-found`).
 * `/ws` accepts a WebSocket upgrade and immediately closes (broadcaster
 * lands at 14.4). The Angular SPA is served from `--ui-dist <path>` (or
 * the auto-resolved `ui/dist/browser/` walking upwards from cwd); the
 * SPA fallback hands `index.html` to any unmatched GET.
 *
 * Defaults — locked at the Step 14 pivot:
 *
 *   - `--port`  = `4242`
 *   - `--host`  = `127.0.0.1` (loopback-only through v0.6.0; Decision #119)
 *   - `--scope` = `project`
 *   - `--open`  = on (browser opens after listen; `--no-open` opts out)
 *
 * `--scope global` is an alias for `-g/--global` (the SmCommand inherited
 * flag). Inside `run()` the value is collapsed onto `this.global` so
 * `resolveDbPath` and any future helpers see one consistent signal.
 *
 * Exit codes:
 *
 *   - `ExitCode.Ok` (0)        → clean shutdown via SIGINT / SIGTERM.
 *   - `ExitCode.Error` (2)     → bad flag combo, bind failure, missing UI
 *                                bundle when `--ui-dist <path>` was explicit,
 *                                runtime errors during boot.
 *   - `ExitCode.NotFound` (5)  → `--db <path>` doesn't exist on disk.
 *
 * The verb opts out of `done in <…>` (`emitElapsed = false`) — long-running
 * processes never trail the elapsed line; `sm watch` does the same.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

import { Command, Option } from 'clipanion';

import { tx } from '../../kernel/util/tx.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import {
  createServer,
  resolveDefaultUiDist,
  resolveExplicitUiDist,
  validateServerOptions,
  isUiBundleDir,
  type IServerOptionsInput,
  type ServerHandle,
  type TServerScope,
} from '../../server/index.js';
import { SERVE_TEXTS } from '../i18n/serve.texts.js';
import { resolveDbPath } from '../util/db-path.js';
import { ExitCode } from '../util/exit-codes.js';
import { formatErrorMessage } from '../util/error-reporter.js';
import { defaultRuntimeContext, type IRuntimeContext } from '../util/runtime-context.js';
import { renderBanner, resolveColorEnabled } from '../util/serve-banner.js';
import { SmCommand } from '../util/sm-command.js';
import { VERSION } from '../version.js';

export class ServeCommand extends SmCommand {
  static override paths = [['serve']];

  static override usage = Command.Usage({
    category: 'Setup',
    description: 'Start the Hono BFF (single-port: REST + WebSocket + SPA bundle).',
    details: `
      Boots the skill-map Web UI's backing server. One Node process
      serves the Angular SPA, the REST API under /api/*, and the
      WebSocket at /ws — single-port mandate, no proxy.

      Default port is 4242, default host is 127.0.0.1. The server boots
      even when the project DB is missing — /api/health reports
      'db: missing' so the SPA renders an empty-state CTA instead of
      failing the connection.

      Loopback-only assumption through v0.6.0 (no per-connection auth on
      /ws). Combining --dev-cors with a non-loopback --host is rejected.

      SIGINT / SIGTERM trigger a graceful shutdown.
    `,
    examples: [
      ['Start on the default port and open the browser', '$0 serve'],
      ['Custom port, no browser auto-open', '$0 serve --port 5000 --no-open'],
      ['Use the global scope DB', '$0 serve --scope global'],
      ['Point at a pre-built UI bundle', '$0 serve --ui-dist ./ui/dist/browser'],
    ],
  });

  port = Option.String('--port', {
    required: false,
    description: 'Listening port (default 4242). 0 = OS-assigned.',
  });
  host = Option.String('--host', {
    required: false,
    description: 'Listening host (default 127.0.0.1). Loopback-only enforced when --dev-cors is set.',
  });
  scope = Option.String('--scope', {
    required: false,
    description: 'project | global. Alias for -g/--global. Default: project.',
  });
  noBuiltIns = Option.Boolean('--no-built-ins', false, {
    description: 'Skip built-in plugin registration (parity with sm scan --no-built-ins).',
  });
  noPlugins = Option.Boolean('--no-plugins', false, {
    description: 'Skip drop-in plugin discovery.',
  });
  // `Option.Boolean('--open', true)` — Clipanion's parser auto-derives
  // the `--no-open` inverse for every boolean flag (search for
  // `--no-${name.slice(2)}` in clipanion's core), so the explicit
  // `--no-open` descriptor must NOT be declared here or the parser sees
  // two registrations for the same flag and rejects the invocation
  // with "Ambiguous Syntax Error". Same convention shipped by every
  // other `--no-...` flag in the CLI tree.
  open = Option.Boolean('--open', true, {
    description: 'Auto-open the SPA in the user\'s default browser after listen. --no-open opts out.',
  });
  devCors = Option.Boolean('--dev-cors', false, {
    description: 'Enable permissive CORS for the Angular dev-server proxy workflow.',
  });
  // `--ui-dist` is intentionally undocumented in the Usage block above
  // (the demo build pipeline + tests rely on it; everyday users never
  // need it). Clipanion still exposes it on the parser; the Usage
  // omission is the "hidden" contract per the 14.1 brief.
  uiDist = Option.String('--ui-dist', { required: false, hidden: true });
  noUi = Option.Boolean('--no-ui', false, {
    description: "Don't serve the Angular UI bundle. Use this when running the BFF alongside `ui:dev` (Angular dev server with HMR). The root `/` then renders an inline placeholder pointing the user at the dev server.",
  });
  noWatcher = Option.Boolean('--no-watcher', false, {
    description: 'Disable the chokidar-fed scan-and-broadcast loop. Use only for CI / read-only deployments.',
  });
  // `--watcher-debounce-ms` is undocumented sugar for advanced users
  // who want to tighten / relax the watcher's batching window without
  // editing settings.json. Hidden flag — the Usage block omits it.
  watcherDebounceMs = Option.String('--watcher-debounce-ms', { required: false, hidden: true });

  // Long-running daemon — `done in <…>` after a graceful shutdown is
  // noise. Mirrors `sm watch`'s opt-out.
  protected override emitElapsed = false;

  // CLI orchestrator with multi-flag handling — each `if (this.flag)`
  // branch is one cyclomatic point. Splitting per branch scatters the
  // validation away from the flag it gates. Per AGENTS.md §Linting
  // category 1 ("CLI orchestrators with multi-flag handling").
  // eslint-disable-next-line complexity
  protected async run(): Promise<number> {
    const runtimeCtx = defaultRuntimeContext();

    // 1. Collapse --scope onto the inherited --global flag.
    const scopeResult = resolveScope(this.scope, this.global);
    if (!scopeResult.ok) {
      this.context.stderr.write(
        tx(SERVE_TEXTS.scopeInvalid, { value: sanitizeForTerminal(scopeResult.value) }),
      );
      return ExitCode.Error;
    }
    const scope: TServerScope = scopeResult.scope;
    if (scope === 'global') this.global = true;

    // 2. Parse --port up front so a non-numeric value rejects with a
    //    clear hint (Clipanion gives us the raw string).
    const portResult = parsePort(this.port);
    if (!portResult.ok) {
      this.context.stderr.write(
        tx(SERVE_TEXTS.portInvalid, { value: sanitizeForTerminal(portResult.value) }),
      );
      return ExitCode.Error;
    }

    // 3. DB path (--db wins over --global wins over project default).
    const dbPath = resolveDbPath({ global: this.global, db: this.db, ...runtimeCtx });
    // Only `--db <path>` triggers the NotFound exit; the project / global
    // default may legitimately be absent (boot-with-missing-DB is the
    // documented behaviour per Decision §14.1).
    if (this.db !== undefined && !existsSync(dbPath)) {
      this.context.stderr.write(
        tx(SERVE_TEXTS.dbNotFound, { path: sanitizeForTerminal(dbPath) }),
      );
      return ExitCode.NotFound;
    }

    // 4. UI bundle resolution.
    //    - `--no-ui` + `--ui-dist <path>` is contradictory → exit 2.
    //    - `--no-ui` alone → skip resolution, force uiDist=null, route
    //      the static middleware at the dev-mode placeholder.
    //    - Explicit path → exit 2 if missing; auto-resolved → null
    //      (server logs the placeholder hint).
    if (this.noUi && this.uiDist !== undefined) {
      this.context.stderr.write(
        tx(SERVE_TEXTS.noUiConflictsUiDist, { path: sanitizeForTerminal(this.uiDist) }),
      );
      return ExitCode.Error;
    }
    let resolvedUiDist: string | null;
    if (this.noUi) {
      resolvedUiDist = null;
    } else {
      const uiDistResult = resolveUiDist(runtimeCtx, this.uiDist);
      if (!uiDistResult.ok) {
        this.context.stderr.write(
          tx(SERVE_TEXTS.startupFailed, { message: sanitizeForTerminal(uiDistResult.message) }),
        );
        return ExitCode.Error;
      }
      resolvedUiDist = uiDistResult.uiDist;
    }

    // 4a. Non-fatal info: pairing `--no-ui` with `--open` opens the
    //     placeholder rather than the live SPA. The Architect almost
    //     certainly meant `--no-open` if they're running `ui:dev` in
    //     another terminal — call it out, but don't reject.
    if (this.noUi && this.open) {
      this.context.stderr.write(SERVE_TEXTS.noUiOpenWarning);
    }

    // 4b. Parse --watcher-debounce-ms up front. Empty / non-integer →
    //     reject with the same template family the other numeric
    //     parsers use.
    const debounceResult = parseDebounce(this.watcherDebounceMs);
    if (!debounceResult.ok) {
      this.context.stderr.write(
        tx(SERVE_TEXTS.watcherDebounceInvalid, {
          value: sanitizeForTerminal(debounceResult.value),
        }),
      );
      return ExitCode.Error;
    }

    // 5. Validate the assembled options bag (loopback + dev-cors check,
    //    port range check). Errors map to the right SERVE_TEXTS template.
    const input: IServerOptionsInput = {
      dbPath,
      scope,
      uiDist: resolvedUiDist,
      noUi: this.noUi,
      noBuiltIns: this.noBuiltIns,
      noPlugins: this.noPlugins,
      open: this.open,
      devCors: this.devCors,
      noWatcher: this.noWatcher,
    };
    if (portResult.port !== undefined) input.port = portResult.port;
    if (this.host !== undefined) input.host = this.host;
    if (debounceResult.value !== undefined) input.watcherDebounceMs = debounceResult.value;

    const validation = validateServerOptions(input);
    if (!validation.ok) {
      this.context.stderr.write(formatValidationError(validation.error));
      return ExitCode.Error;
    }

    // 6. Boot.
    let handle: ServerHandle;
    try {
      handle = await createServer(validation.options);
    } catch (err) {
      const message = formatErrorMessage(err);
      this.context.stderr.write(
        tx(SERVE_TEXTS.bindFailed, {
          host: sanitizeForTerminal(validation.options.host),
          port: validation.options.port,
          message: sanitizeForTerminal(message),
        }),
      );
      return ExitCode.Error;
    }

    // 7. Boot banner. TTY-aware (color box vs flat legacy lines) so
    //    pipes / redirects keep grep-friendly output. Color toggle
    //    honours `--no-color`, `NO_COLOR`, and `FORCE_COLOR`.
    const stderr = this.context.stderr as NodeJS.WritableStream & { isTTY?: boolean };
    const isTTY = stderr.isTTY === true;
    const colorEnabled = resolveColorEnabled({
      isTTY,
      noColorFlag: this.noColor,
      env: process.env,
    });
    this.context.stderr.write(
      renderBanner({
        version: VERSION,
        host: sanitizeForTerminal(handle.address.host),
        port: handle.address.port,
        scope,
        dbPath,
        cwd: runtimeCtx.cwd,
        openBrowser: validation.options.open,
        isTTY,
        colorEnabled,
      }),
    );

    // 8. Browser auto-open (best-effort; failure → stderr hint, never a fail).
    if (validation.options.open) {
      const url = `http://${handle.address.host}:${handle.address.port}/`;
      tryOpenBrowser(url, this.context.stderr);
    }

    // 9. Wait for SIGINT / SIGTERM, then close.
    await waitForShutdown();
    await handle.close();
    this.context.stderr.write(SERVE_TEXTS.shutdown);
    return ExitCode.Ok;
  }
}

interface IPortOk { ok: true; port: number | undefined; }
interface IPortErr { ok: false; value: string; }

function parsePort(raw: string | undefined): IPortOk | IPortErr {
  if (raw === undefined) return { ok: true, port: undefined };
  const trimmed = raw.trim();
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== trimmed) {
    return { ok: false, value: raw };
  }
  return { ok: true, port: parsed };
}

interface IDebounceOk { ok: true; value: number | undefined; }
interface IDebounceErr { ok: false; value: string; }

function parseDebounce(raw: string | undefined): IDebounceOk | IDebounceErr {
  if (raw === undefined) return { ok: true, value: undefined };
  const trimmed = raw.trim();
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== trimmed) {
    return { ok: false, value: raw };
  }
  return { ok: true, value: parsed };
}

interface IScopeOk { ok: true; scope: TServerScope; }
interface IScopeErr { ok: false; value: string; }

function resolveScope(rawScope: string | undefined, global: boolean): IScopeOk | IScopeErr {
  if (rawScope === undefined) return { ok: true, scope: global ? 'global' : 'project' };
  if (rawScope === 'project' || rawScope === 'global') {
    return { ok: true, scope: rawScope };
  }
  return { ok: false, value: rawScope };
}

interface IUiDistOk { ok: true; uiDist: string | null; }
interface IUiDistErr { ok: false; message: string; }

function resolveUiDist(ctx: IRuntimeContext, raw: string | undefined): IUiDistOk | IUiDistErr {
  if (raw === undefined) {
    return { ok: true, uiDist: resolveDefaultUiDist(ctx) };
  }
  const abs = resolveExplicitUiDist(ctx, raw);
  if (!isUiBundleDir(abs)) {
    return {
      ok: false,
      message: `--ui-dist ${abs} does not exist or is not a directory containing index.html`,
    };
  }
  return { ok: true, uiDist: abs };
}

function formatValidationError(err: { code: string; value: string; message: string }): string {
  switch (err.code) {
    case 'host-dev-cors-rejected':
      return tx(SERVE_TEXTS.hostDevCorsRejected, { host: sanitizeForTerminal(err.value) });
    case 'port-out-of-range':
      return tx(SERVE_TEXTS.portOutOfRange, { value: sanitizeForTerminal(err.value) });
    case 'port-invalid':
      return tx(SERVE_TEXTS.portInvalid, { value: sanitizeForTerminal(err.value) });
    case 'scope-invalid':
      return tx(SERVE_TEXTS.scopeInvalid, { value: sanitizeForTerminal(err.value) });
    case 'watcher-requires-pipeline':
      return tx(SERVE_TEXTS.watcherRequiresPipeline, { value: sanitizeForTerminal(err.value) });
    case 'watcher-debounce-invalid':
      return tx(SERVE_TEXTS.watcherDebounceInvalid, { value: sanitizeForTerminal(err.value) });
    case 'no-ui-conflicts-ui-dist':
      return tx(SERVE_TEXTS.noUiConflictsUiDist, { path: sanitizeForTerminal(err.value) });
    default:
      return tx(SERVE_TEXTS.startupFailed, { message: sanitizeForTerminal(err.message) });
  }
}

function waitForShutdown(): Promise<void> {
  return new Promise<void>((resolveShutdown) => {
    const onSignal = (): void => {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      resolveShutdown();
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  });
}

/**
 * Best-effort browser open. The platform-specific opener is detached
 * + unrefed so an error inside the launcher process can't bubble back
 * up and crash the server. Failures log a hint via stderr but are NEVER
 * fatal — the URL is already printed on the boot banner.
 */
function tryOpenBrowser(url: string, stderr: NodeJS.WritableStream): void {
  try {
    const platform = process.platform;
    let command: string;
    let args: string[];
    if (platform === 'darwin') {
      command = 'open';
      args = [url];
    } else if (platform === 'win32') {
      command = 'cmd';
      args = ['/c', 'start', '""', url];
    } else {
      command = 'xdg-open';
      args = [url];
    }
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', (err) => {
      stderr.write(
        tx(SERVE_TEXTS.openFailed, {
          message: sanitizeForTerminal(formatErrorMessage(err)),
          url: sanitizeForTerminal(url),
        }),
      );
    });
    child.unref();
  } catch (err) {
    stderr.write(
      tx(SERVE_TEXTS.openFailed, {
        message: sanitizeForTerminal(formatErrorMessage(err)),
        url: sanitizeForTerminal(url),
      }),
    );
  }
}
