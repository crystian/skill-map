---
"@skill-map/spec": minor
"@skill-map/cli": patch
---

Add a `--no-ui` flag to `sm serve`. With it, the BFF stops serving the Angular bundle (stale or otherwise) and the root `/` renders an inline dev-mode placeholder pointing the user at `npm run ui:dev` + `http://localhost:4200/`. Used by the root `bff:dev` shortcut so iterating on the BFF alongside the Angular dev server doesn't surface a stale UI by accident.

Mutually exclusive with `--ui-dist <path>` (rejected with exit 2). Combining `--no-ui` with the default `--open` emits a non-fatal stderr warning suggesting `--no-open` (the auto-opened tab would land on the placeholder rather than the live UI). `/api/*` and `/ws` remain fully functional; only the static SPA is suppressed.

Spec impact: `spec/cli-contract.md` documents the new flag in the `sm serve` signature and the §Server flags table, including the mutual-exclusion + warning rules.
