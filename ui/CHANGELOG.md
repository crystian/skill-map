# ui

## 0.1.0

### Minor Changes

- a683c56: Bootstrap the `ui/` workspace — Step 0c of the ROADMAP execution plan.

  **New workspace.** `ui/` is now registered as the third npm workspace alongside `spec/` and `src/`. Scaffolded with `ng new` (Angular 21.2, standalone components, SCSS, Vitest). The workspace is `private: true` — it never publishes to npm; the Flavor A prototype is consumed via `sm serve` once Step 12 lands, and as a local `ng serve` target in the meantime.

  **Stack locked at Step 0c start** per the ROADMAP:

  - Angular 21 standalone (pinned at major `21` via `^21.x`).
  - Foblex Flow for the node-based graph view.
  - PrimeNG + `@primeuix/themes` for components and theming (`@primeng/themes` is deprecated upstream and intentionally avoided).
  - SCSS scoped to components; no utility-CSS layer.

  **Mock collection.** `ui/mock-collection/` holds a fictional `acme-toolkit` scope spanning all five node kinds (4 agents, 4 commands, 4 skills, 3 hooks, 3 notes plus the scope `README.md`) with realistic frontmatter that conforms to `@skill-map/spec` `schemas/frontmatter/*`. Served as build assets via `angular.json` so the prototype can `fetch('/mock-collection/…')` at runtime, simulating an on-disk scope without wiring a backend. The collection also exercises the spec-level concepts that the later scanner will consume: `supersedes` / `supersededBy` cross-kind links, `requires` / `related` graph edges, `@agent`, `#skill`, and `/command` tokens in bodies, and external URLs for the future `external-url-counter` detector.

  **No runtime impl.** No `src/` code changed; the kernel still boots empty. Step 0c is a UI-only prototype — the roadmap review pass after it completes may surface kernel gaps, and those land in subsequent changesets against `skill-map`.

  Classification: minor per `spec/versioning.md` §Pre-1.0 (`0.Y.Z`). First published version for the `ui` workspace; `0.0.0` → `0.1.0`.
