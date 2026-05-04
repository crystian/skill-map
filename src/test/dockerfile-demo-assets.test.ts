/**
 * Regression test for the production demo deploy.
 *
 * Bug history: the Dockerfile that ships skill-map.dev was missing two
 * required steps for demo mode:
 *   1. `node web/scripts/patch-demo-mode.js` — flips `<meta name="skill-map-mode">`
 *      from `live` to `demo`. Without it the SPA boots in live mode and
 *      404s on `/api/scan`.
 *   2. `node web/scripts/build-demo-dataset.js` + the corresponding
 *      `COPY --from=ui-build` lines for `data.json` / `data.meta.json`.
 *      Without them the SPA's StaticDataSource fetches `data.json`,
 *      hits Caddy's SPA fallback, gets `<!DOCTYPE html>`, and trips
 *      `JSON.parse`.
 *
 * Both bugs reached production. This test parses the live Dockerfile
 * and asserts the four critical lines are present so a future refactor
 * cannot silently drop one and re-break the deploy.
 *
 * It is a structural assertion against the file (not a `docker build`)
 * because building the image requires Docker in the test runner and
 * minutes of network I/O. The structural check is fast, deterministic,
 * and catches the exact regression class that the production bug
 * represented (lines accidentally removed).
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const DOCKERFILE = resolve(REPO_ROOT, 'Dockerfile');

function loadDockerfile(): string {
  return readFileSync(DOCKERFILE, 'utf8');
}

describe('Dockerfile — demo deploy assets', () => {
  it('runs web/scripts/patch-demo-mode.js against the built UI index.html', () => {
    const text = loadDockerfile();
    assert.match(
      text,
      /RUN\s+node\s+web\/scripts\/patch-demo-mode\.js\s+ui\/dist\/ui\/browser\/index\.html/,
      'Dockerfile must invoke patch-demo-mode.js so <meta skill-map-mode> flips to "demo"',
    );
  });

  it('runs web/scripts/build-demo-dataset.js so data.json + data.meta.json are produced', () => {
    const text = loadDockerfile();
    assert.match(
      text,
      /RUN\s+node\s+web\/scripts\/build-demo-dataset\.js/,
      'Dockerfile must invoke build-demo-dataset.js to produce the StaticDataSource payload',
    );
  });

  it('copies data.json into /usr/share/caddy/demo/ in the serve stage', () => {
    const text = loadDockerfile();
    assert.match(
      text,
      /COPY\s+--from=ui-build\s+\/app\/web\/demo\/data\.json\s+\/usr\/share\/caddy\/demo\/data\.json/,
      'serve stage must promote data.json so /demo/data.json is reachable',
    );
  });

  it('copies data.meta.json into /usr/share/caddy/demo/ in the serve stage', () => {
    const text = loadDockerfile();
    assert.match(
      text,
      /COPY\s+--from=ui-build\s+\/app\/web\/demo\/data\.meta\.json\s+\/usr\/share\/caddy\/demo\/data\.meta\.json/,
      'serve stage must promote data.meta.json so /demo/data.meta.json is reachable',
    );
  });

  it('orders the dataset script AFTER the npm ci that installs tsx (the script falls back to tsx)', () => {
    const text = loadDockerfile();
    const npmCi = text.indexOf('RUN npm ci');
    const dataset = text.indexOf('build-demo-dataset.js');
    assert.ok(npmCi >= 0, 'expected `RUN npm ci` somewhere in the Dockerfile');
    assert.ok(dataset >= 0, 'expected build-demo-dataset.js somewhere in the Dockerfile');
    assert.ok(
      npmCi < dataset,
      'build-demo-dataset.js needs tsx installed (no built CLI in this stage); it must run AFTER `npm ci`',
    );
  });
});
