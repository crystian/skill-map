---
"@skill-map/cli": minor
---

`npm run start` now opens Windows Terminal with two side-by-side panes that run `bff:dev` (the BFF watcher with the Hono API + the Angular dev-mode placeholder) and `ui:dev` (the Angular dev server with HMR). Replaces the previous `start` which was a thin alias to `ng serve` that booted the SPA without a backing BFF.

WSL2 + Windows Terminal only — the script aborts with a clear hint when `wt.exe` isn't on PATH. No cross-platform fallback by design; the workflow is meant for the local dev environment, not portable across collaborators.
