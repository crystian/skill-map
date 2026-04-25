# ui

## 0.1.1

### Patch Changes

- 22e10b7: Two related polish passes that ride together: a UI inspector rewrite
  around a reusable `node-card` component, and an extraction of the
  landing page from the build script into editable `web/` sources.

  UI — node-card + supporting components:

  - New `node-card` component (`ui/src/app/components/node-card/`) — a
    presentational, signal-input-driven card that renders the full
    inspector view for a node (header, kind chip, summary, metadata,
    links, source). Replaces the previous inline markup in
    `inspector-view` and is reused by the upcoming graph hover panel.
  - New `kind-icon` component (`ui/src/app/components/kind-icon/`) —
    inline SVG glyphs per node kind (skill / agent / command / hook /
    note). Two SVG sprites embedded in the template; theming via
    `currentColor`. Replaces ad-hoc emoji and font-icon usage.
  - `kind-palette` extended to expose icon + label tuples consumed by
    `kind-icon`; existing colour mapping preserved.
  - New mock data services (`mock-summary.ts`, `mock-links.ts`) feed the
    inspector cards while real summary/link extraction is still on the
    CLI side.
  - `node` model extended with `summary` / `links` shapes that mirror
    the upcoming `spec/schemas/summaries/*` contracts (kept loose for
    now; will be tightened to the schema once Step 14 lands the
    runtime-settings + summary contracts).
  - `graph-view` updated to render the new node-card on selection and
    to emit a richer inspector payload; CSS trimmed (~50 lines removed)
    as the card now owns its own styling.
  - New `node-card.texts.ts` slice in `ui/src/i18n/`. Existing
    `graph-view.texts.ts` updated for two new labels.
  - `styles.css` adds shared card tokens (`--card-pad`, `--card-radius`,
    `--card-border`) and a small focus-ring polish.
  - `angular.json` per-component CSS budget bumped (warn 4 → 6 kB,
    error 8 → 12 kB) to accommodate the node-card stylesheet, which is
    intentionally self-contained.

  Site / landing — extraction from build script to editable source:

  - New `web/` directory at the repo root with `index.html`, `styles.css`,
    `app.js`, and an `img/` placeholder. This becomes the editable
    landing source for `skill-map.dev`. `{{SPEC_VERSION}}` is the only
    placeholder; everything else is hand-authored HTML/CSS/JS.
  - `scripts/build-site.mjs` rewired: the landing is now a `cp web/ →
site/` plus a single placeholder substitution, instead of a
    template literal in JS. The schema-browse index at
    `/spec/v0/index.html` is still generated from the schema set (now
    also lists the prose contracts).
  - `Dockerfile` copies `web/` into the build context so the Railway /
    Caddy image still produces the same `site/` artifact end-to-end.
  - No change to canonical schema URLs; `$id` validation logic
    unchanged.

  Mock fixtures:

  - New `ui/mock-collection/.claude/commands/init-legacy.md` — adds a
    `deprecated` / `supersededBy` example to the mock graph so the
    inspector renders the deprecation badge in the new node-card.

  `spec/` and `src/` untouched. UI is still `private: true`; the
  changeset rides for changelog continuity.

- a35cf80: UI quality pass driven by an audit against the project's
  `app-angular-quick`, `app-angular-detailed`, and `foblex-flow` skills,
  plus drag-related performance fixes that surfaced while testing.

  Skill compliance:

  - All native `<button>` elements in `graph-view`, `kind-palette`,
    `perf-hud`, and `event-log` replaced with `<p-button>` /
    `<p-togglebutton>`. New module imports (`ButtonModule`,
    `ToggleButtonModule`, `TooltipModule`, `FormsModule`) where needed.
  - `provideAnimationsAsync()` removed from `app.config.ts` (skill
    prohibits; PrimeNG degrades cleanly without animations).
  - Redundant `standalone: true` removed from 8 components (Angular 21
    default).
  - `interface TNodeView` renamed to `INodeView` to match the `I` prefix
    convention; all consumers updated.
  - `::ng-deep` rules in `inspector-view.css` scoped under `:host`.

  I18n / copy:

  - New `ui/src/i18n/` directory with 13 typed `*.texts.ts` files holding
    every user-facing string. Components import their slice via
    `protected readonly texts = …`. No Transloco — explicit decision to
    keep it as plain typed const maps for now.
  - Filter-bar dropdowns now show capitalised labels ("Skills" / "Stable")
    instead of raw enum values, via shared `kinds.texts.ts` /
    `stabilities.texts.ts`.
  - `theme.texts.ts` shared between app shell and graph toolbar.

  Drag persistence + performance:

  - Node drag persistence moved off `(fNodePositionChange)` into a
    buffered field; the signal is written and `localStorage` is touched
    exactly once at `mouseup`. Eliminates a 60–120 Hz `graph` computed
    invalidation cascade and per-frame sync I/O stall during drag. New
    foblex-flow rule #9 documents that `fDragHandle` consumes `pointerup`
    so `mouseup` is the only reliable drag-end signal.
  - Middle-mouse pan `redraw()` throttled to `requestAnimationFrame`.
  - `pathExists()` in inspector switched from O(N) `.some()` to O(1)
    `Set.has()`.

  Visual:

  - Palette swap: skills are now green and agents are blue (previously
    inverted). Affects both light and dark themes.

  Test infrastructure:

  - 62 `data-testid` attributes added across 8 templates (sections,
    action buttons, form controls, list rows, graph nodes, inspector
    cards). No tests yet — placed proactively for future Playwright /
    Cypress flows. Naming convention documented in `AGENTS.md` under
    the new "UI test IDs" section.

  Skill / docs:

  - `foblex-flow/SKILL.md` — new non-negotiable rule #9 about
    `fDragHandle` consuming `pointerup`; 3 new antipattern checklist
    entries; 2 new troubleshooting entries; description and headings
    updated from "eight" to "nine".
  - `AGENTS.md` — new "UI test IDs" section.

  `spec/` and `src/` untouched.

## 0.1.0

### Minor Changes

- a683c56: Bootstrap the `ui/` workspace — Step 0c of the ROADMAP execution plan.

  **New workspace.** `ui/` is now registered as the third npm workspace alongside `spec/` and `src/`. Scaffolded with `ng new` (Angular 21.2, standalone components, SCSS, Vitest). The workspace is `private: true` — it never publishes to npm; the Flavor A prototype is consumed via `sm serve` once Step 13 lands, and as a local `ng serve` target in the meantime.

  **Stack locked at Step 0c start** per the ROADMAP:

  - Angular 21 standalone (pinned at major `21` via `^21.x`).
  - Foblex Flow for the node-based graph view.
  - PrimeNG + `@primeuix/themes` for components and theming (`@primeng/themes` is deprecated upstream and intentionally avoided).
  - SCSS scoped to components; no utility-CSS layer.

  **Mock collection.** `ui/mock-collection/` holds a fictional `acme-toolkit` scope spanning all five node kinds (4 agents, 4 commands, 4 skills, 3 hooks, 3 notes plus the scope `README.md`) with realistic frontmatter that conforms to `@skill-map/spec` `schemas/frontmatter/*`. Served as build assets via `angular.json` so the prototype can `fetch('/mock-collection/…')` at runtime, simulating an on-disk scope without wiring a backend. The collection also exercises the spec-level concepts that the later scanner will consume: `supersedes` / `supersededBy` cross-kind links, `requires` / `related` graph edges, `@agent`, `#skill`, and `/command` tokens in bodies, and external URLs for the future `external-url-counter` detector.

  **No runtime impl.** No `src/` code changed; the kernel still boots empty. Step 0c is a UI-only prototype — the roadmap review pass after it completes may surface kernel gaps, and those land in subsequent changesets against `skill-map`.

  Classification: minor per `spec/versioning.md` §Pre-1.0 (`0.Y.Z`). First published version for the `ui` workspace; `0.0.0` → `0.1.0`.
