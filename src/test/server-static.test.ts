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
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Hono } from 'hono';

import { createSpaFallback, createStaticHandler } from '../server/static.js';

function mountStatic(opts: { uiDist: string | null; noUi: boolean }): Hono {
  const app = new Hono();
  app.use('*', createStaticHandler(opts));
  app.get('*', createSpaFallback(opts));
  return app;
}

describe('static handler — placeholder dispatch', () => {
  it('serves the dev-mode placeholder at "/" when uiDist is null and noUi is true', async () => {
    const app = mountStatic({ uiDist: null, noUi: true });
    const res = await app.request('/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    const body = await res.text();
    assert.match(body, /dev mode — UI disabled/);
    assert.match(body, /npm run ui:dev/);
    // The accidental-missing-bundle copy must NOT leak into the dev-mode page.
    assert.doesNotMatch(body, /UI bundle was not found/);
  });

  it('serves the dev-mode placeholder for SPA deep links when noUi is true', async () => {
    const app = mountStatic({ uiDist: null, noUi: true });
    const res = await app.request('/inspector/foo.md');
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /dev mode — UI disabled/);
  });

  it('serves the accidental-missing-bundle placeholder when uiDist is null and noUi is false', async () => {
    const app = mountStatic({ uiDist: null, noUi: false });
    const res = await app.request('/');
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /UI bundle was not found/);
    assert.match(body, /skill-map server is running/);
    // The dev-mode hint must NOT bleed into the accidental-missing-bundle page.
    assert.doesNotMatch(body, /dev mode — UI disabled/);
  });
});
