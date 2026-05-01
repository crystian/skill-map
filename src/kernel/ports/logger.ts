/**
 * `LoggerPort` — structured logging port for the kernel.
 *
 * The kernel must NOT write to stdout/stderr directly. Anything that
 * would historically have been a `console.log` / `console.error` goes
 * through this port; the adapter (CLI, server, test harness) decides
 * format, level filter, and destination.
 *
 * Levels follow the conventional ordering, lowest = most verbose:
 *
 *   trace < debug < info < warn < error < silent
 *
 * `silent` is a sentinel for filtering only — it never appears as a
 * `LogRecord.level`. Setting an adapter to `silent` disables every
 * method.
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

export type LogMethodLevel = Exclude<LogLevel, 'silent'>;

export const LOG_LEVELS: readonly LogLevel[] = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'silent',
] as const;

const LEVEL_RANK: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  silent: 5,
};

export function logLevelRank(level: LogLevel): number {
  return LEVEL_RANK[level];
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LEVEL_RANK, value);
}

/**
 * Parse a string into a `LogLevel`. Returns `null` for invalid input
 * (incl. `undefined` / `null` / empty). Case-insensitive; trims
 * whitespace.
 */
export function parseLogLevel(value: string | undefined | null): LogLevel | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === '') return null;
  return isLogLevel(normalized) ? normalized : null;
}

export interface LogRecord {
  level: LogMethodLevel;
  /** ISO 8601 timestamp produced at the moment the log call was made. */
  timestamp: string;
  message: string;
  /** Optional structured context. Caller-owned; serialization is up to the formatter. */
  context?: Record<string, unknown>;
}

export interface LoggerPort {
  trace(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}
