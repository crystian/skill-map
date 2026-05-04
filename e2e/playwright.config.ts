import { defineConfig } from '@playwright/test';

const isCI = !!process.env.CI;
const PORT = Number(process.env.SMOKE_PORT ?? 4321);

export default defineConfig({
  timeout: 30_000,
  globalTimeout: 5 * 60_000,
  retries: isCI ? 1 : 0,
  reporter: isCI ? 'html' : 'list',
  fullyParallel: false,
  workers: 1,

  use: {
    // The demo bundle is built with <base href="/demo/"> so the public
    // site can deploy it under /demo/. Mirror that mount path locally
    // so the smoke test exercises the bundle in its production shape.
    baseURL: `http://127.0.0.1:${PORT}/demo/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'smoke',
      testDir: './smoke',
    },
  ],

  webServer: {
    // Boot a deps-free Node static server that serves web/demo/. Run
    // `npm run demo:build` from the repo root before invoking the smoke
    // suite so the demo bundle exists. Playwright tears the server down
    // automatically when the test run ends.
    command: `node ../web/scripts/serve-demo.js --port=${PORT}`,
    cwd: '.',
    url: `http://127.0.0.1:${PORT}/demo/`,
    reuseExistingServer: !isCI,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
