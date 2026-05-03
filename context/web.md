# Web (`web/`) — responsive conventions

Annex of [`AGENTS.md`](../AGENTS.md). Read this file before editing anything under `web/`.

The `web/` workspace is the public marketing site (vanilla HTML/CSS/JS, no framework). It ships separately from `ui/` and has its own responsive contract.

**Minimum supported viewport**: **360px**. This is the realistic 2026 floor — covers Android mid-range (the largest segment of global mobile traffic) and iPhone SE / mini / 13–14 (~375px). 320px is theoretical (≪1% of 2026 traffic, mostly iPhone 5/SE-1) and the layout MAY degrade gracefully there but is not a design target.

**Test matrix**: 360 · 375 · 390 · 430 · 768 · 1024 · 1280. The first four are the phone reality, 768 is tablet portrait, 1024 is tablet landscape / small laptop, 1280 is the desktop reference width.

**Canonical breakpoints** (the only values allowed in `@media` rules in `web/styles.css`):

| Token | Use it for | Boundary |
|---|---|---|
| `480px` | Phone-only overrides | `max-width: 480px` |
| `768px` | Tablet portrait — 768 itself counts as tablet | `max-width: 767px` (phone) / `min-width: 768px` (tablet+) |
| `1024px` | Desktop / tablet-landscape boundary | `max-width: 1023px` (tablet-and-down) / `min-width: 1024px` (desktop+) |
| `1280px` | Large desktop refinements | `min-width: 1280px` |

The off-by-one (`767` / `1023`) is deliberate: it lets `min-width: 768` and `max-width: 767` partition the viewport space without a 1-pixel gap, and keeps "768 itself shows the tablet layout" as a precise rule (not "approximately 768"). The single exception in the codebase is the nav drawer's `min-width: 769px` paired with `max-width: 768px` on the nav layout — those two rules form the only `768` partition (instead of `768 / 1023` style) because the drawer's CSS layout and the JS that closes it on resize were authored together against that pair; do not "fix" it without re-reading both `web/styles.css:509` and `web/app.js:30`.

**Forbidden breakpoint values**: `540`, `560`, `600`, `640`, `900`, `960`, and any other off-canon number. If a layout breaks somewhere in between (e.g. content overflows at 720px), prefer fixing the layout (`clamp()`, `flex-wrap`, fluid grids) over inserting a new breakpoint. The principle is **"set breakpoints where content actually breaks, not where devices live"** — and the four canonical values above already cover the structural inflection points.

**Mobile-first vs desktop-first**: `web/styles.css` uses **desktop-first** (`max-width` queries) for historical reasons. Stay consistent — do not mix `min-width` and `max-width` queries in the same component. A future migration to mobile-first is acceptable but must be done in one PR per logical block (nav, hero, features, etc.), never piecemeal.

**Fluid sizing over breakpoints**: prefer `clamp(min, fluid, max)` for typography, paddings, and gaps so the design degrades smoothly between breakpoints instead of stair-stepping. The hero, sections, and titles already use this pattern; new components should follow it.

**Touch targets**: minimum 36px on mobile (≤768px), 44px is the WCAG 2.5.5 recommended target for primary actions (CTAs, close buttons, play/pause). Sub-36px controls are forbidden on mobile.

**JS guards must mirror CSS**: any `matchMedia('(max-width: Npx)')` in `web/app.js` MUST match a CSS `@media (max-width: Npx)` rule. The hero graph guards (`web/app.js:40` and `web/app.js:548`) are paired with `web/styles.css` lines that hide `.hero__graph` — change one and the other in the same diff.
