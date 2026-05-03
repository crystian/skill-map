/**
 * `GET /api/config` — merged effective config (defaults → user → user-local
 * → project → project-local → override).
 *
 * Wraps `loadConfig` from `kernel/config/loader.ts`. Returns the
 * `effective` object inside an `IValueEnvelope` so the SPA gets a
 * stable `{ schemaVersion, kind, value }` shape.
 *
 * Warnings emitted by the layered loader (malformed JSON, schema
 * violations) are forwarded to `process.stderr` — they do NOT reach the
 * client response. Read parity with `sm config list`: warnings are
 * informational at the operator level, not user-facing on every request.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { loadConfig } from '../../kernel/config/loader.js';
import { formatErrorMessage } from '../../cli/util/error-reporter.js';
import { buildValueEnvelope } from '../envelope.js';
import type { IRouteDeps } from './deps.js';

export function registerConfigRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/config', (c) => {
    let loaded;
    try {
      loaded = loadConfig({
        scope: deps.options.scope,
        cwd: deps.runtimeContext.cwd,
        homedir: deps.runtimeContext.homedir,
      });
    } catch (err) {
      // `--strict` mode would throw; the BFF never enables strict so this
      // path normally never trips. If it does (config FS read failed
      // hard), surface it as `internal` so the SPA shows a generic
      // failure instead of silently rendering empty defaults.
      throw new HTTPException(500, { message: formatErrorMessage(err) });
    }
    for (const warn of loaded.warnings) {
      process.stderr.write(`${warn}\n`);
    }
    return c.json(buildValueEnvelope('config', loaded.effective, deps.kindRegistry));
  });
}
