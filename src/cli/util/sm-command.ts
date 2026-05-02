/**
 * `SmCommand` — abstract Clipanion command base for every `sm` verb.
 *
 * Single-source the global flags from `spec/cli-contract.md` §Global flags
 * (`-g/--global`, `--json`, `-q/--quiet`, `--no-color`, `-v/--verbose`,
 * `--db`) and the §Elapsed time emission so individual verbs no longer
 * declare them ad-hoc — they extend `SmCommand`, implement `run()`, and
 * inherit:
 *
 *   - Global flag declarations (Clipanion `Option.*`).
 *   - Env-var equivalents per spec § Global flags table:
 *     `SKILL_MAP_SCOPE=global` → `--global`, `SKILL_MAP_JSON=1` →
 *     `--json`, `NO_COLOR=1` → `--no-color`, `SKILL_MAP_DB=<path>` →
 *     `--db <path>`. CLI flag wins over env var (spec precedence).
 *   - `done in <…>` on stderr at the end of `execute()`, suppressed by
 *     `--quiet`. Verbs that should NOT emit elapsed (interactive
 *     spawns, long-running processes, meta verbs that report a
 *     version) opt out via `protected emitElapsed = false`.
 *   - `-v` / `-vv` / `-vvv` reconfigures the kernel logger to
 *     `info` / `debug` / `trace` respectively.
 *
 * Subclasses implement `run()` and never override `execute()`.
 */

import { Command, Option } from 'clipanion';

import { configureLogger } from '../../kernel/util/logger.js';
import type { LogLevel } from '../../kernel/ports/logger.js';
import { Logger } from './logger.js';
import { emitDoneStderr, startElapsed, type IElapsed } from './elapsed.js';

/**
 * Environment-variable presence test consistent with the spec
 * § Global flags precedence: any non-empty value counts as "set".
 * `NO_COLOR` follows the no-color.org convention (any non-empty value
 * disables color); `SKILL_MAP_JSON` / `SKILL_MAP_DB` mirror that for
 * consistency.
 */
function isEnvSet(value: string | undefined): boolean {
  return value !== undefined && value !== '';
}

export abstract class SmCommand extends Command {
  global = Option.Boolean('-g,--global', false, {
    description: 'Operate on ~/.skill-map/ instead of ./.skill-map/.',
  });
  json = Option.Boolean('--json', false, {
    description: 'Emit machine-readable output on stdout. Suppresses pretty printing.',
  });
  quiet = Option.Boolean('-q,--quiet', false, {
    description: 'Suppress non-error stderr output (including "done in <…>").',
  });
  noColor = Option.Boolean('--no-color', false, {
    description: 'Disable ANSI color codes.',
  });
  verbose = Option.Counter('-v,--verbose', 0, {
    description: 'Increase log level (-v=info, -vv=debug, -vvv=trace).',
  });
  db = Option.String('--db', { required: false, description: 'Override the database file location (escape hatch).' });

  /**
   * Subclasses set this to `false` to opt out of the trailing
   * `done in <…>` line — appropriate for interactive verbs (`db shell`),
   * watcher loops (`watch`), and meta verbs that report a fixed
   * version (`version`, `help`).
   */
  protected emitElapsed = true;

  /**
   * Wall-clock timer started just before `run()`. Subclasses that need
   * to embed `elapsedMs` in their `--json` output read `this.elapsed.ms()`.
   * `null` only between `Command` construction and the first
   * `execute()` call.
   */
  protected elapsed: IElapsed | null = null;

  protected abstract run(): Promise<number>;

  async execute(): Promise<number> {
    this.applyEnvOverrides();
    this.applyVerboseLogger();
    this.elapsed = startElapsed();
    try {
      return await this.run();
    } finally {
      // `run()` may opt out by setting `this.emitElapsed = false`
      // (e.g. the `--watch` alias on `sm scan` delegates into the
      // long-running watcher loop and the watcher owns its own
      // shutdown line).
      if (this.emitElapsed) emitDoneStderr(this.context.stderr, this.elapsed, this.quiet);
    }
  }

  /**
   * Promote spec env vars into flag values when the flag was left at
   * default. CLI flag wins over env var (spec § Global flags
   * precedence: "CLI flag wins over env var. Env var wins over config
   * file.").
   */
  private applyEnvOverrides(): void {
    const env = process.env;
    this.noColor = this.noColor || isEnvSet(env['NO_COLOR']);
    this.global = this.global || env['SKILL_MAP_SCOPE'] === 'global';
    this.json = this.json || isEnvSet(env['SKILL_MAP_JSON']);
    if (this.db === undefined && isEnvSet(env['SKILL_MAP_DB'])) {
      this.db = env['SKILL_MAP_DB'];
    }
  }

  /**
   * `-v` / `-vv` / `-vvv` reconfigures the kernel logger. Skipped
   * when `verbose === 0` so the level configured at `entry.ts` boot
   * (from `--log-level` / `SKILL_MAP_LOG_LEVEL`) stays in effect.
   */
  private applyVerboseLogger(): void {
    if (this.verbose <= 0) return;
    const level: LogLevel = this.verbose >= 3 ? 'trace' : this.verbose === 2 ? 'debug' : 'info';
    configureLogger(new Logger({ level, stream: process.stderr }));
  }
}
