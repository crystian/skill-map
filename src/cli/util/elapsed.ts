/**
 * Elapsed-time helpers per `spec/cli-contract.md` §Elapsed time.
 *
 * Two output channels:
 *
 *   - **Object outputs (`--json` whose schema is an object)** include a
 *     top-level `elapsedMs` field. The schema declares it as required.
 *   - **Stderr** receives `done in <formatted>` after every verb, except
 *     when `--quiet` is passed.
 *
 * Format rules:
 *   - `< 1000ms`         → `34ms`
 *   - `≥ 1s and < 60s`   → `2.4s`
 *   - `≥ 60s`            → `1m 42s`
 */

export interface IElapsed {
  /** Wall-clock ms since `startElapsed()` was called. */
  ms(): number;
  /** Same as `ms()` but pre-formatted for stderr / human display. */
  formatted(): string;
}

export function startElapsed(): IElapsed {
  const startNs = process.hrtime.bigint();
  return {
    ms() {
      const elapsedNs = Number(process.hrtime.bigint() - startNs);
      return Math.round(elapsedNs / 1_000_000);
    },
    formatted() {
      return formatElapsed(this.ms());
    },
  };
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Emit `done in <formatted>` to the supplied stderr stream unless
 * `quiet` is true. Trailing newline included.
 */
export function emitDoneStderr(
  stderr: NodeJS.WritableStream,
  elapsed: IElapsed,
  quiet = false,
): void {
  if (quiet) return;
  stderr.write(`done in ${elapsed.formatted()}\n`);
}
