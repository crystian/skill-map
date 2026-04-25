---
"ui": patch
---

Two related polish passes that ride together: a UI inspector rewrite
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
