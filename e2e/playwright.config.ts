import { defineConfig } from '@playwright/test';

const isCI = !!process.env.CI;
const PORT = Number(process.env.SMOKE_PORT ?? 4321);

/**
 * Playwright config — two projects:
 *
 *   - `smoke`    runs the static demo bundle (deps-free Node static
 *                server + `web/demo/`). Default in CI; the existing
 *                `webServer` block boots the static server.
 *   - `live-bff` runs against a real `sm serve` spawned by
 *                `live-bff/global-setup.ts`. Closes R10 from the
 *                §Step 9.6 review queue. Opt-in (`--project=live-bff`).
 *
 * Each project carries its own `baseURL` because the two run against
 * different servers on different ports. The live-bff suite hits a
 * port chosen at boot (free-port pick) and reads it back from
 * `process.env.LIVE_BFF_URL` once globalSetup has stashed it.
 */
export default defineConfig({
  timeout: 30_000,
  globalTimeout: 5 * 60_000,
  retries: isCI ? 1 : 0,
  reporter: isCI ? 'html' : 'list',
  fullyParallel: false,
  workers: 1,

  // The live-BFF project depends on this hook to spawn `sm serve`. The
  // hook is cheap-skip when only the smoke project is selected (see
  // `live-bff/global-setup.ts` §projectFilter).
  globalSetup: './live-bff/global-setup.ts',
  globalTeardown: './live-bff/global-teardown.ts',

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'smoke',
      testDir: './smoke',
      use: {
        // The demo bundle is built with <base href="/demo/"> so the
        // public site can deploy it under /demo/. Mirror that mount path
        // locally so the smoke test exercises the bundle in its
        // production shape.
        baseURL: `http://127.0.0.1:${PORT}/demo/`,
      },
    },
    {
      name: 'live-bff',
      testDir: './live-bff/specs',
      // baseURL is filled in at runtime by globalSetup (it picks a free
      // port at boot, so we can't hard-code it here). Tests read
      // `process.env.LIVE_BFF_URL` directly via the helper in
      // `live-bff/specs/_fixtures.ts`.
    },
  ],

  webServer: {
    // Boots the deps-free static server that serves web/demo/. Run
    // `bun run demo:build` from the repo root before invoking the smoke
    // suite so the demo bundle exists. Playwright tears the server down
    // automatically when the test run ends.
    //
    // The live-BFF kernel is NOT booted via `webServer` — it lives in
    // globalSetup so the harness can pick a free port at boot and
    // materialise its fixture tempdir before the kernel attaches.
    command: `bun ../web/scripts/serve-demo.js --port=${PORT}`,
    cwd: '.',
    url: `http://127.0.0.1:${PORT}/demo/`,
    reuseExistingServer: !isCI,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
