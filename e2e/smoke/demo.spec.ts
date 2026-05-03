import { expect, test } from '@playwright/test';

/**
 * Demo bundle smoke test (ROADMAP §Step 14.7).
 *
 * The demo bundle is a static deployable that ships under `web/demo/`
 * and is served via the public site (skill-map.dev/demo/). It MUST work
 * standalone — no `sm` install, no kernel server, no /api/ traffic.
 *
 * The hard guarantee this suite enforces: a regression that re-introduces
 * a network call to `/api/...` from the demo bundle (e.g. a future
 * DataSource refactor accidentally activating `RestDataSource` under
 * `MODE === 'demo'`) is caught here, not in production.
 *
 * Server: deps-free Node static server (`scripts/serve-demo.js`)
 * managed by Playwright's `webServer` config. Mount: `/demo/`.
 */

test.describe('demo bundle', () => {
  test('boots without console errors and runs in demo mode', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('./');
    await page.waitForLoadState('networkidle');

    const mode = await page.locator('meta[name="skill-map-mode"]').getAttribute('content');
    expect(mode).toBe('demo');

    const shell = page.getByTestId('shell');
    await expect(shell).toBeVisible();

    expect(
      consoleErrors,
      `Demo bundle logged console errors:\n${consoleErrors.join('\n')}`,
    ).toEqual([]);
  });

  test('does not call any /api/* endpoint', async ({ page }) => {
    // Capture every network request before navigation. Playwright fires
    // `request` for every fetch the page issues — including XHR, fetch,
    // and EventSource. We assert no path under `/api/` shows up.
    const apiCalls: string[] = [];
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.pathname.startsWith('/api/')) apiCalls.push(req.url());
    });

    await page.goto('./');
    await page.waitForLoadState('networkidle');

    // Visit each view. A regression that activates RestDataSource under
    // demo mode will fire `/api/scan`, `/api/nodes`, etc. on view init.
    await page.getByTestId('nav-list').click();
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-graph').click();
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-inspector').click();
    await page.waitForLoadState('networkidle');

    expect(
      apiCalls,
      `Demo bundle fetched live-mode endpoints — DataSource leaked into demo:\n${apiCalls.join('\n')}`,
    ).toEqual([]);
  });

  test('renders the three views without errors', async ({ page }) => {
    await page.goto('./');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('nav-list').click();
    await expect(page).toHaveURL(/\/list/);

    await page.getByTestId('nav-graph').click();
    await expect(page).toHaveURL(/\/graph/);

    await page.getByTestId('nav-inspector').click();
    await expect(page).toHaveURL(/\/inspector/);
  });
});
