# skill-map e2e

End-to-end / smoke tests for skill-map. Private workspace — never published to npm.

## What lives here

- `playwright.config.ts` — single Chromium-only project (`smoke`). Spins up `../web/scripts/serve-demo.js` automatically via `webServer` (the static server lives in the web workspace and can also be invoked manually via `npm run demo:serve --workspace=@skill-map/web`).
- `smoke/` — Playwright specs.

## First-time setup

Browsers are NOT vendored with the npm install — they live outside `node_modules`. After the first `npm install` from the repo root, install Chromium:

```bash
npm run install:browsers --workspace=skill-map-e2e
```

That downloads ~150 MB into `~/.cache/ms-playwright/` and is a one-shot per machine.

## Running locally

```bash
# Full smoke (build + browser install + tests):
npm run validate --workspace=skill-map-e2e

# Or, if web/demo/ is already built and chromium is installed:
npm run test:smoke --workspace=skill-map-e2e
```

## What the smoke proves

- The demo bundle boots without console errors under `MODE === 'demo'`.
- The bundle never fetches `/api/...` — a regression activating the live-mode `RestDataSource` in the demo build is caught here.
- The two views (graph, list) render and route correctly.

## Run via root validate

`npm run validate` from the repo root invokes this workspace's `validate` script, which runs `prevalidate` first (`install:browsers` + `npm --prefix .. run demo:build`) and then `playwright test`. CI picks it up automatically as part of the orchestrator.
