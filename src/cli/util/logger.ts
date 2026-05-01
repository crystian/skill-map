/**
 * Concrete CLI logger that implements `LoggerPort`. Configurable level,
 * stream, and format.
 *
 * Defaults: level `warn`, formatter `defaultFormat`, stream is supplied
 * by the caller (almost always `process.stderr` — logging is a side
 * channel, stdout stays clean for data output like JSON / table rows).
 *
 * Wiring: `entry.ts` pre-parses `--log-level` (CLI flag) and
 * `SKILL_MAP_LOG_LEVEL` (env var) via `extractLogLevelFlag` +
 * `resolveLogLevel`, instantiates `Logger`, and installs it as the
 * kernel singleton via `configureLogger(...)`. Anywhere in the codebase
 * that needs to log: `import { log } from '<.../>kernel/util/logger.js'`.
 */

import type {
  LogLevel,
  LogMethodLevel,
  LogRecord,
  LoggerPort,
} from '../../kernel/ports/logger.js';
import { LOG_LEVELS, logLevelRank, parseLogLevel } from '../../kernel/ports/logger.js';
import { tx } from '../../kernel/util/tx.js';
import { LOGGER_TEXTS } from '../i18n/logger.texts.js';

export type LogFormatter = (record: LogRecord) => string;

export interface ILoggerOptions {
  level: LogLevel;
  stream: NodeJS.WritableStream;
  format?: LogFormatter;
}

const ENV_VAR = 'SKILL_MAP_LOG_LEVEL';
const FLAG_NAME = '--log-level';

/**
 * Default human-readable format: pipe-separated `HH:MM:SS | LEVEL |
 * message [| {context}]`. Local time, no date — CLI sessions are
 * short-lived and the date is implicit. Use a custom formatter via
 * `new Logger({ format: ... })` if you need ISO timestamps or JSON
 * lines.
 *
 * `record.timestamp` is the ISO 8601 string captured at log time; we
 * re-derive local HH:MM:SS from it so the formatter is pure (no extra
 * `new Date()` call) and a custom record passed to the formatter
 * renders consistently.
 */
function localTimeFromIso(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export const defaultFormat: LogFormatter = (record) => {
  const time = localTimeFromIso(record.timestamp);
  const level = record.level.toUpperCase().padEnd(5);
  const ctx =
    record.context && Object.keys(record.context).length > 0
      ? ` | ${JSON.stringify(record.context)}`
      : '';
  return `${time} | ${level} | ${record.message}${ctx}\n`;
};

export class Logger implements LoggerPort {
  #level: LogLevel;
  readonly #stream: NodeJS.WritableStream;
  readonly #format: LogFormatter;

  constructor(opts: ILoggerOptions) {
    this.#level = opts.level;
    this.#stream = opts.stream;
    this.#format = opts.format ?? defaultFormat;
  }

  setLevel(level: LogLevel): void {
    this.#level = level;
  }

  level(): LogLevel {
    return this.#level;
  }

  trace(message: string, context?: Record<string, unknown>): void {
    this.#emit('trace', message, context);
  }
  debug(message: string, context?: Record<string, unknown>): void {
    this.#emit('debug', message, context);
  }
  info(message: string, context?: Record<string, unknown>): void {
    this.#emit('info', message, context);
  }
  warn(message: string, context?: Record<string, unknown>): void {
    this.#emit('warn', message, context);
  }
  error(message: string, context?: Record<string, unknown>): void {
    this.#emit('error', message, context);
  }

  #emit(level: LogMethodLevel, message: string, context?: Record<string, unknown>): void {
    if (logLevelRank(level) < logLevelRank(this.#level)) return;
    const record: LogRecord = {
      level,
      timestamp: new Date().toISOString(),
      message,
      ...(context !== undefined ? { context } : {}),
    };
    this.#stream.write(this.#format(record));
  }
}

export interface IResolveLogLevelOptions {
  flag?: string | null;
  env?: string | null;
  fallback: LogLevel;
  /** Where to write the warning when an invalid level is passed. Defaults to `process.stderr`. */
  errStream?: NodeJS.WritableStream;
}

/**
 * Resolve the active log level from CLI flag (highest priority), env
 * var (`SKILL_MAP_LOG_LEVEL`), then a fallback default. Invalid values
 * write a one-line warning to `errStream` and fall through to the next
 * source so a typo doesn't silently disable logging.
 */
export function resolveLogLevel(opts: IResolveLogLevelOptions): LogLevel {
  const allowed = LOG_LEVELS.join(', ');
  const errStream = opts.errStream ?? process.stderr;

  const sources: ReadonlyArray<string | null | undefined> = [opts.flag, opts.env];
  for (const raw of sources) {
    if (raw === undefined || raw === null || raw === '') continue;
    const parsed = parseLogLevel(raw);
    if (parsed) return parsed;
    errStream.write(tx(LOGGER_TEXTS.invalidLevel, { value: raw, allowed }));
  }
  return opts.fallback;
}

/**
 * Extract `--log-level` from an argv array without mutating the input.
 * Supports `--log-level=value` and `--log-level value` forms. Returns
 * the extracted value (or null) and the remaining argv with the flag
 * removed so Clipanion never sees it (it isn't a Clipanion option).
 *
 * Edge case: bare `--log-level` at end of argv yields `value: null`,
 * which `resolveLogLevel` treats as "no source supplied" and moves on.
 */
export function extractLogLevelFlag(argv: readonly string[]): {
  value: string | null;
  rest: string[];
} {
  const rest: string[] = [];
  let value: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === FLAG_NAME) {
      value = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg.startsWith(`${FLAG_NAME}=`)) {
      value = arg.slice(FLAG_NAME.length + 1);
      continue;
    }
    rest.push(arg);
  }
  return { value, rest };
}

export const LOGGER_ENV_VAR = ENV_VAR;
export const LOGGER_FLAG_NAME = FLAG_NAME;
