/**
 * No-op `LoggerPort`. Default when the kernel is invoked without a
 * logger (tests, embedded usage). Equivalent in spirit to
 * `InMemoryProgressEmitter`: callers that don't care get a working
 * implementation that does nothing.
 *
 * Every method is intentionally empty — that IS the contract of this
 * class. We disable `no-empty-function` for the whole file because
 * adding `// eslint-disable-next-line` to each method would be noise.
 */

/* eslint-disable @typescript-eslint/no-empty-function */

import type { LoggerPort } from '../ports/logger.js';

export class SilentLogger implements LoggerPort {
  trace(): void {}
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}
