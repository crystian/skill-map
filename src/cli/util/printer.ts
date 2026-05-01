/**
 * CLI output channel — the one place that decides what goes to stdout
 * versus stderr. Wraps the Clipanion-injected streams so command
 * handlers don't have to remember the convention by hand.
 *
 * Channel discipline (matches `spec/cli-contract.md` and the M1 review
 * finding):
 *
 *   - **`data(text)` → stdout.** The command's primary, machine-shaped
 *     payload: a `--json` body, a `sm export` formatter render, a
 *     deterministic-text query response. Anything a downstream pipe
 *     should be able to consume (`sm list --json | jq`, `sm scan
 *     --json > result.json`).
 *   - **`info(text)` → stderr.** Banners, progress lines, "Refreshing
 *     node X" advisories, "(dry-run)" markers — everything that tells
 *     the human something happened mid-flight without being the
 *     answer.
 *   - **`warn(text)` → stderr.** Non-fatal advisories the user should
 *     read (deprecated flag, plugin failed to load, fallback used).
 *   - **`error(text)` → stderr.** Fatal-path messages emitted before
 *     the command returns a non-`Ok` exit code.
 *
 * **Quiet info mode** (`quietInfo: true`) silences `info` so that
 * machine-readable output stays the only thing on either stream when a
 * verb is invoked with `--json`. `warn` and `error` still emit because
 * they signal degraded state the consumer must surface in its
 * pipeline.
 *
 * The printer never appends a trailing newline — callers are expected
 * to do that themselves so the existing `*_TEXTS` catalog (which
 * already includes line endings) drops in unchanged.
 *
 * Why a tiny abstraction at all: every CLI verb hand-rolls the
 * `this.context.stdout.write(...)` / `this.context.stderr.write(...)`
 * pair today. Drift is silent — `sm refresh` was emitting "Refreshing
 * node X" on stdout while every other channel for that command went to
 * stderr. A single typed surface keeps that from happening once new
 * verbs land. The shape is deliberately small; expand it only when a
 * concrete reuse pattern surfaces.
 */

export interface IPrinter {
  /** Primary command payload — goes to stdout. */
  data(text: string): void;
  /** Banner / progress / status — goes to stderr. */
  info(text: string): void;
  /** Non-fatal advisory — goes to stderr. */
  warn(text: string): void;
  /** Error message paired with a non-Ok exit code — goes to stderr. */
  error(text: string): void;
}

export interface ICreatePrinterOptions {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  /**
   * Suppress `info` lines. `warn` and `error` keep emitting because
   * they communicate degraded state the consumer cannot infer from
   * stdout alone. Default `false`. Verbs flip this to `true` when a
   * `--json` flag is set so `stdout` carries only the machine-shaped
   * payload.
   */
  quietInfo?: boolean;
}

export function createPrinter(opts: ICreatePrinterOptions): IPrinter {
  const { stdout, stderr } = opts;
  const quietInfo = opts.quietInfo === true;
  return {
    data: (text: string): void => { stdout.write(text); },
    info: (text: string): void => {
      if (quietInfo) return;
      stderr.write(text);
    },
    warn: (text: string): void => { stderr.write(text); },
    error: (text: string): void => { stderr.write(text); },
  };
}
