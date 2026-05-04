/**
 * Static-handler placeholder tests — covers the dual-placeholder branch
 * introduced with `--no-ui`:
 *
 *   - `uiDist: null, noUi: false` → "UI bundle was not found" copy
 *     (the long-standing accidental-missing-bundle hint).
 *   - `uiDist: null, noUi: true`  → "BFF in dev mode — UI disabled"
 *     copy (intentional opt-out, points the operator at `npm run ui:dev`).
 *
 * The handlers are exercised in isolation against a stand-alone Hono
 * instance — no listener bind, no cross-cutting boot. That keeps the
 * test snappy and focused on the placeholder dispatch.
 *
 * Table-driven: each case names the option bag, the request path, and
 * the substrings that MUST and MUST NOT appear in the response body.
 * Adding a new placeholder branch becomes a one-row append.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Hono } from 'hono';

import { createSpaFallback, createStaticHandler } from '../server/static.js';

interface IPlaceholderCase {
  name: string;
  opts: { uiDist: string | null; noUi: boolean };
  path: string;
  expectMatch: RegExp[];
  expectNoMatch: RegExp[];
}

const CASES: IPlaceholderCase[] = [
  {
    name: 'serves the dev-mode placeholder at "/" when uiDist is null and noUi is true',
    opts: { uiDist: null, noUi: true },
    path: '/',
    expectMatch: [/dev mode — UI disabled/, /npm run ui:dev/],
    expectNoMatch: [/UI bundle was not found/],
  },
  {
    name: 'serves the dev-mode placeholder for SPA deep links when noUi is true',
    opts: { uiDist: null, noUi: true },
    path: '/inspector/foo.md',
    expectMatch: [/dev mode — UI disabled/],
    expectNoMatch: [/UI bundle was not found/],
  },
  {
    name: 'serves the accidental-missing-bundle placeholder when uiDist is null and noUi is false',
    opts: { uiDist: null, noUi: false },
    path: '/',
    expectMatch: [/UI bundle was not found/, /skill-map server is running/],
    expectNoMatch: [/dev mode — UI disabled/],
  },
];

function mountStatic(opts: { uiDist: string | null; noUi: boolean }): Hono {
  const app = new Hono();
  app.use('*', createStaticHandler(opts));
  app.get('*', createSpaFallback(opts));
  return app;
}

describe('static handler — placeholder dispatch', () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const app = mountStatic(c.opts);
      const res = await app.request(c.path);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /text\/html/);
      const body = await res.text();
      for (const re of c.expectMatch) assert.match(body, re);
      for (const re of c.expectNoMatch) assert.doesNotMatch(body, re);
    });
  }
});
