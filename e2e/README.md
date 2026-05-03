# skill-map e2e

End-to-end / smoke tests for skill-map. Private workspace — never published to npm.

## What lives here

- `playwright.config.ts` — single Chromium-only project (`smoke`). Spins up `scripts/serve-demo.js` automatically via `webServer`.
- `scripts/serve-demo.js` — deps-free Node static server that mounts `web/demo/` under `/demo/` with SPA fallback.
- `smoke/` — Playwright specs.

## First-time setup

Browsers are NOT vendored with the npm install — they live outside `node_modules`. After the first `npm install` from the repo root, install Chromium:

```bash
npm run install:browsers --workspace=skill-map-e2e
```

That downloads ~150 MB into `~/.cache/ms-playwright/` and is a one-shot per machine.

## Running locally

```bash
# Build the demo bundle (must exist before the smoke runs)
npm run demo:build              # from repo root

# Run the smoke
npm run smoke:demo              # from repo root — chains build + test
# or, if web/demo/ is already built:
npm run test:smoke --workspace=skill-map-e2e
```

## What the smoke proves

- The demo bundle boots without console errors under `MODE === 'demo'`.
- The bundle never fetches `/api/...` — a regression activating the live-mode `RestDataSource` in the demo build is caught here.
- The three views (list, graph, inspector) render and route correctly.

## Not run in CI (today)

`validate:all` deliberately does not include this suite — Chromium is heavy to install in a clean CI environment and the smoke is meant for local pre-release verification. Hook it into a release workflow when the public-site publish flow lands (ROADMAP §Step 14.7).
