# UI (`ui/`) conventions

Annex of [`AGENTS.md`](../AGENTS.md). Read this file before editing anything under `ui/src/`.

## UI library reference (Foblex Flow)

The `ui/` workspace uses **Foblex Flow** (`@foblex/flow`) for the graph visualization layer. The library is poorly documented upstream, so the full operating guide (seven non-negotiable rules, antipattern checklist, canonical patterns, full API reference) lives in the project-local **`foblex-flow` skill** at `.claude/skills/foblex-flow/`.

Invoke it via `/foblex-flow` — or it auto-triggers when touching any graph-related Angular template, component, CSS, or `@foblex/flow` import. **Read the skill before touching any graph code.** The rules it encodes were all learned the hard way and skipping any produces silent failures.

## UI test IDs

Every interactive or test-targetable element in `ui/src/` carries a `data-testid` attribute. The codebase has no E2E tests today, but the IDs are placed proactively so future Playwright/Cypress/Vitest-Testing-Library flows land on stable selectors instead of CSS chains or i18n-fragile text.

**Naming convention**: `kebab-case`, shaped as `<area>-<element>` or `<area>-<element>-<modifier>`.

- Page sections: `list-view`, `graph-view`, `inspector-view`, `shell`, `shell-topbar`, `shell-nav`.
- Navigation: `nav-list`, `nav-graph`, `nav-inspector`, `inspector-back`.
- Action buttons: `action-<verb>` (`action-simulate-scan`, `action-theme-toggle`, `action-det`, `action-prob`).
- Toolbar buttons: `<view>-<verb>` (`graph-zoom-in`, `graph-fit-to-screen`, `graph-reset-layout`, `graph-theme-toggle`).
- Form controls: `filter-search`, `filter-kinds`, `filter-stabilities`, `filter-has-issues`, `filter-reset`.
- Empty / loading / error states: `<view>-empty-<reason>` / `<view>-loading` / `<view>-error` (`list-empty-filtered`, `list-empty-all`, `inspector-empty-no-selection`, `inspector-empty-not-found`, `graph-loading`, `graph-error`, `graph-empty`).
- Cards / panels: `<view>-card-<topic>` (`inspector-card-summary`, `inspector-card-agent`, …, `inspector-card-body`).

**Dynamic IDs** (per-row, per-node, per-kind): `[attr.data-testid]="'<prefix>-' + value"`. Examples in the codebase: `list-row-<path>`, `graph-node-<id>`, `kind-palette-<kind>`.

**PrimeNG components**: place `data-testid` directly on the `<p-button>` / `<p-togglebutton>` / `<p-multiselect>` / `<p-table>` host tag. Tests reach the inner `<button>` / `<input>` via descendant selectors. Keeping the testid on the host tag survives PrimeNG internal DOM changes.

**When to add**:

- Every new view's section root.
- Every new interactive element a test could plausibly target (button, link, input, toggle, row).
- Every distinguishable empty / loading / error state.
- Every card or panel that a test might assert "is shown" or read content from.

**When to skip**: purely decorative elements (icons, separators, swatches), text inside an already-targetable parent, and elements with no test value.

**Why testids and not CSS / text**: CSS-selector tests rot with every styling refactor (`.foo .bar > .baz:nth-child(2)`); text-based tests rot when copy changes (which happens routinely in i18n-bound UIs). `data-testid` is deliberately test-only — neither styling nor logic touches it, so it stays stable across both.
