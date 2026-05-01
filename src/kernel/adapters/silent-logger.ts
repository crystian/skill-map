/**
 * No-op `LoggerPort`. Default when the kernel is invoked without a
 * logger (tests, embedded usage). Equivalent in spirit to
 * `InMemoryProgressEmitter`: callers that don't care get a working
 * implementation that does nothing.
 */

import type { LoggerPort } from '../ports/logger.js';

export class SilentLogger implements LoggerPort {
  trace(): void {}
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}
