/**
 * `IServerOptions` — typed input to `createServer(opts)`.
 *
 * The composition root (`cli/commands/serve.ts`) parses raw flag values,
 * validates them via `validateServerOptions`, and hands the resulting
 * normalized object to `createServer`. The server itself never reads
 * `process.env` / `process.argv` — every knob lives in the options bag.
 *
 * Defaults:
 *
 *   - `port`     — `4242` (Decision: locked at the Step 14 pivot for
 *                  predictable single-port wiring).
 *   - `host`     — `127.0.0.1` (Decision #119: loopback-only through
 *                  v0.6.0; multi-host serve + auth deferred).
 *   - `scope`    — `project`.
 *   - `open`     — `true` (the verb default; tests pass `false`).
 *   - `devCors`  — `false`.
 *   - `noBuiltIns` / `noPlugins` — `false`.
 *
 * Validation rules (enforced by `validateServerOptions`):
 *
 *   1. `port` must be an integer in `[0, 65535]`. `0` is allowed (OS
 *      assigns the port; `ServerHandle.address.port` reports the actual
 *      value after bind). `65536+` and negatives reject.
 *   2. `scope` must be `'project'` or `'global'`.
 *   3. When `devCors` is true, `host` MUST be a loopback address
 *      (`127.0.0.1` / `::1` / `localhost`). Non-loopback + `--dev-cors`
 *      is rejected per Decision #119 — opening CORS on a non-loopback
 *      socket is the textbook way to hand the SPA's origin to anyone
 *      on the network.
 *
 * The validator returns either `{ ok: true, options }` (with defaults
 * filled in) or `{ ok: false, error: { code, message } }` so the CLI
 * surface can map the error to the right `tx(SERVE_TEXTS.*)` template
 * and exit code (`Error` for bad usage, `NotFound` reserved for the
 * caller's own DB-existence check).
 */

export type TServerScope = 'project' | 'global';

export interface IServerOptions {
  /** Listening port. `0` = OS-assigned. Default `4242`. */
  port: number;

  /** Listening host. Default `127.0.0.1`. Loopback-only enforced when `devCors` is true. */
  host: string;

  /** Effective scope for `/api/*` reads. Default `'project'`. */
  scope: TServerScope;

  /**
   * Pre-resolved DB file path. The CLI computes this via `resolveDbPath`
   * (`--db` > `--global` > project default) and threads it in. The
   * server NEVER calls `resolveDbPath` itself — kernel-boundary rule:
   * no `process.cwd()` / `homedir()` inside the BFF entry beyond the
   * composition root.
   */
  dbPath: string;

  /**
   * Absolute path to the Angular dist bundle (`ui/dist/browser/`).
   * `null` means "auto-detection failed" — the server logs a one-liner
   * to stderr via `SERVER_TEXTS.uiBundleMissing` and serves an inline
   * placeholder at `/`. The CLI promotes this to `ExitCode.Error` only
   * when `--ui-dist <path>` was passed explicitly.
   */
  uiDist: string | null;

  /** Skip built-in plugin registration (parity with `sm scan --no-built-ins`). Default `false`. */
  noBuiltIns: boolean;

  /** Skip drop-in plugin discovery (parity with `sm scan --no-plugins`). Default `false`. */
  noPlugins: boolean;

  /** Auto-open the SPA in the user's default browser after listen. Default `true`. */
  open: boolean;

  /** Enable permissive CORS for the dev workflow (Angular dev server proxy). Default `false`. */
  devCors: boolean;
}

export interface IServerOptionsInput {
  port?: number | undefined;
  host?: string | undefined;
  scope?: string | undefined;
  dbPath: string;
  uiDist?: string | null | undefined;
  noBuiltIns?: boolean | undefined;
  noPlugins?: boolean | undefined;
  open?: boolean | undefined;
  devCors?: boolean | undefined;
}

export type TServerOptionsErrorCode =
  | 'port-out-of-range'
  | 'port-invalid'
  | 'scope-invalid'
  | 'host-dev-cors-rejected';

export interface IServerOptionsError {
  code: TServerOptionsErrorCode;
  message: string;
  /** The original value the validator rejected — used by the CLI to interpolate the error template. */
  value: string;
}

export type TServerOptionsResult =
  | { ok: true; options: IServerOptions }
  | { ok: false; error: IServerOptionsError };

const DEFAULT_PORT = 4242;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_SCOPE: TServerScope = 'project';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '0:0:0:0:0:0:0:1']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

export function validateServerOptions(input: IServerOptionsInput): TServerOptionsResult {
  const filled = applyDefaults(input);

  const portError = validatePort(filled.port);
  if (portError !== null) return { ok: false, error: portError };

  const scopeError = validateScope(filled.scope);
  if (scopeError !== null) return { ok: false, error: scopeError };

  const hostError = validateHost(filled.host, filled.devCors);
  if (hostError !== null) return { ok: false, error: hostError };

  return {
    ok: true,
    options: {
      port: filled.port,
      host: filled.host,
      scope: filled.scope as TServerScope,
      dbPath: input.dbPath,
      uiDist: filled.uiDist,
      noBuiltIns: filled.noBuiltIns,
      noPlugins: filled.noPlugins,
      open: filled.open,
      devCors: filled.devCors,
    },
  };
}

interface IFilledInput {
  port: number;
  host: string;
  scope: string;
  uiDist: string | null;
  noBuiltIns: boolean;
  noPlugins: boolean;
  open: boolean;
  devCors: boolean;
}

/**
 * Pure column-mapping fold over the input bag — every field's default is
 * read once, with no branching beyond the per-field `??`. Per AGENTS.md
 * §Linting category 5 ("Pure column mappers — object literals where every
 * `??` adds a cyclomatic branch despite there being zero control flow").
 */
// eslint-disable-next-line complexity
function applyDefaults(input: IServerOptionsInput): IFilledInput {
  return {
    port: input.port ?? DEFAULT_PORT,
    host: input.host ?? DEFAULT_HOST,
    scope: input.scope ?? DEFAULT_SCOPE,
    uiDist: input.uiDist ?? null,
    noBuiltIns: input.noBuiltIns ?? false,
    noPlugins: input.noPlugins ?? false,
    open: input.open ?? true,
    devCors: input.devCors ?? false,
  };
}

function validatePort(port: number): IServerOptionsError | null {
  if (!Number.isInteger(port)) {
    return { code: 'port-invalid', message: `port must be an integer (got ${port})`, value: String(port) };
  }
  if (port < 0 || port > 65535) {
    return {
      code: 'port-out-of-range',
      message: `port must be in [0, 65535] (got ${port})`,
      value: String(port),
    };
  }
  return null;
}

function validateScope(scope: string): IServerOptionsError | null {
  if (scope !== 'project' && scope !== 'global') {
    return { code: 'scope-invalid', message: `scope must be "project" or "global"`, value: String(scope) };
  }
  return null;
}

function validateHost(host: string, devCors: boolean): IServerOptionsError | null {
  if (devCors && !isLoopbackHost(host)) {
    return {
      code: 'host-dev-cors-rejected',
      message: `--dev-cors requires a loopback --host (got ${host})`,
      value: host,
    };
  }
  return null;
}
