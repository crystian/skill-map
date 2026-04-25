---
"ui": patch
---

UI quality pass driven by an audit against the project's
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
