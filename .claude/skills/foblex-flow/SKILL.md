---
name: foblex-flow
description: Authoritative guide for working with Foblex Flow (@foblex/flow) in the skill-map UI. Use whenever editing Angular code in ui/ that touches graph rendering — templates with f-flow / f-canvas / f-connection / fNode / fDraggable / fZoom / fMarker directives; TypeScript importing from @foblex/flow (FFlowModule, FCanvasComponent, EFConnectableSide, EFMarkerType, FConnectionMarkerArrow, etc.); CSS targeting .f-* classes or .sm-gnode; angular.json style configuration for the Foblex theme; or any task involving node layout, connector rendering, pan/zoom behavior, edge styling, drag handles, or performance of the graph view. Covers the seven non-negotiable rules learned the hard way, the antipattern checklist, and points at the full API reference for every directive and component.
---

# Foblex Flow — working rules for skill-map

Foblex Flow (`@foblex/flow`) is the graph library that powers `ui/src/app/views/graph-view/`. Upstream documentation is sparse, so this skill is the authoritative operational guide. Before writing or reviewing any graph-related code, read the non-negotiables below.

**Reference material** (load on demand):

- [`references/api-reference.md`](references/api-reference.md) — every directive, component, input, output, event, method, CSS class, theme token, and enum.
- [`references/examples/`](references/examples/) — verbatim copies of every official example from [`libs/f-examples/`](https://github.com/Foblex/f-flow/tree/main/libs/f-examples) in the Foblex repo, organized by category (nodes, connectors, connections, extensions, plugins, advanced, reference-apps). Start at [`references/examples/README.md`](references/examples/README.md) for the index and the six canonical patterns that repeat across all examples. **When in doubt, the examples win** — they are the Foblex team's own reference shape.

## Mental model

- Foblex Flow does NOT own graph state. Your app owns nodes, groups, connections, ids, validation, and persistence.
- Angular templates render the current state; user actions emit events; your app mutates state; Angular rerenders.
- Connections are **connector-to-connector**, NOT node-to-node. Each edge goes from an `fNodeOutput` (identified by `fOutputId`) to an `fNodeInput` (`fInputId`).
- Do NOT assume React-Flow-style APIs (`[nodes]`, `[edges]`, `setNodes()`, `addEdge()`). Those do not exist.

## The seven non-negotiables

Skipping any of these produces silent failures: missing visuals, degraded performance, or wrong positioning. All seven were learned the hard way — do not relitigate them, apply them.

### 1. Unique connector IDs per direction

`fInputId` and `fOutputId` on the same node MUST be different strings. Canonical pattern:

```html
<div fNode [fNodeId]="node.id">
  <div fNodeInput  [fInputId]="node.id + '-in'"></div>
  <div fNodeOutput [fOutputId]="node.id + '-out'"></div>
</div>
```

Reusing `node.id` for both silently drops every edge — the connection matcher finds ambiguous endpoints and renders nothing. If edges do not show and the console is clean, this is the first thing to check.

### 2. Wire the theme — either the global `default.scss` OR per-view SCSS mixins

Connections and markers render as invisible SVG without the theme. Two supported paths:

**Path A — global import via `angular.json` (what skill-map uses today):**

Wire `../node_modules/@foblex/flow/styles/default.scss` as the first entry in the `styles` array. Two gotchas:

- **Workspace hoisting**: this repo uses npm workspaces. `@foblex/flow` hoists to the repo-root `node_modules/`, not `ui/node_modules/`. The `../` is required — a literal `node_modules/@foblex/flow/...` resolves relative to `ui/` and fails.
- **Package `exports` blocks subpaths**: `@foblex/flow`'s `package.json` declares `exports` that only expose `.` and `./package.json`. A package-resolution specifier (`@foblex/flow/styles/default.scss`) is rejected by modern resolvers. The raw filesystem path via `../node_modules/...` bypasses exports and works.

`angular.json` changes do NOT hot-reload — dev server restart required.

**Path B — per-view SCSS mixins (what every official `libs/f-examples/*` does):**

```scss
@use '@foblex/flow/styles' as flow-theme;

::ng-deep { @include flow-theme.theme-tokens(); }          // CSS vars (--ff-*)

::ng-deep f-flow {
  @include flow-theme.flow($scoped: false);                // base styles
  @include flow-theme.connection($scoped: false);          // connections
  @include flow-theme.connection-markers($scoped: false);  // markers
  // …only the features this view uses
}

@include flow-theme.node($selectorless: false);
```

Available mixins: `theme-tokens`, `flow`, `node`, `group`, `connector`, `connection`, `connection-markers`, `drag-handle`, `resize-handle`, `rotate-handle`, `minimap`, `selection-area`, `background`, `grid-system`. Use this path when you need a feature only in one view (smaller CSS, no angular.json surgery), or when debugging theme drift — it makes it obvious which mixins the view depends on. Examples: `references/examples/` → any `example.scss`.

### 3. Never animate or override properties Foblex controls via inline styles

Foblex applies `transform: translate(x, y)` inline on every `[fNode]` element (from `fNodePosition`) and on `.f-canvas` (from zoom/pan). App-level CSS that touches those transforms fights the library. Do NOT write:

- `transition: transform ...` on a node class — every position update gets smoothed for the transition duration; connection paths recalculate mid-interpolation → visible lag on zoom/pan/drag.
- `:hover { transform: translateY(-1px) }` on a `[fNode]` — overwrites Foblex's position translate; hovered nodes snap to the viewport origin.
- Any `transform` or `transition: transform` on `.f-canvas` — zoom stutter.
- `will-change: transform` on `[fNode]` — redundant and can burn GPU memory.

For hover/focus affordances use `background`, `border`, `border-color`, `border-radius`, `box-shadow`, `color`, `padding`. Those are safe to animate. If you feel the urge to animate a position yourself, you are duplicating Foblex's job — use `centerGroupOrNode(id, animated)`, `setScale(scale, pivot, animated)` etc. instead.

### 4. Use Foblex's own connection markers — never hand-roll `<svg><defs><marker>`

Foblex ships `<f-connection-marker-arrow>` and `<f-connection-marker-circle>` that project inside `<f-connection>`. They follow the theme (`--ff-marker-color` defaults to `--ff-connection-color`) and automatically participate in selection and snap states.

```html
<f-connection [fOutputId]="..." [fInputId]="..." class="my-edge-kind">
  <f-connection-marker-arrow type="end" />
</f-connection>
```

For custom shapes (diamonds, triangles, anything beyond an arrow) use the `fMarker` directive on an inline `<svg>` with your own `<path>`. See `references/api-reference.md` §Connection Markers.

If you catch yourself writing `<svg class="defs"><marker id="...">...</marker></svg>` and `marker-end: url(#id)` in CSS, stop — you are reinventing the library.

### 5. Per-kind connection styling goes through theme tokens, not `::ng-deep`

The default theme reads `--ff-connection-color`, `--ff-connection-width`, `--ff-marker-color` (see `@foblex/flow/styles/tokens/_ff-aliases.scss`). Override the tokens on a class attached to `<f-connection>`:

```css
.f-conn--supersedes {
  --ff-connection-color: var(--sm-edge-supersedes);
  --ff-connection-width: 2.5px;
  --ff-marker-color: var(--sm-edge-supersedes);
}
```

CSS custom properties inherit through Angular's emulated encapsulation, so **no `::ng-deep` is needed** for this.

When a property has no theme token (e.g. `stroke-dasharray`) or you need to hide something the library renders, fall back to `::ng-deep` **scoped to a wrapper element you own, in the view's component CSS**. View-specific Foblex overrides belong in the view's stylesheet, not global `src/styles.css`. Canonical pattern:

```css
/* graph-view.css */
.graph__canvas-wrap ::ng-deep .f-conn--related .f-connection-path {
  stroke-dasharray: 4 3;
}
```

`.graph__canvas-wrap` bounds the reach; `::ng-deep` pierces into Foblex's rendered SVG. `::ng-deep` is deprecated in Angular but still the officially documented escape hatch — and Foblex's own examples use it. Use it narrowly, one rule at a time, under a wrapper class you own.

### 6. Foblex separates interaction from rendering — disabling behavior does NOT hide the visual

Example: `<f-connection [fReassignDisabled]="true">` prevents drag-to-reassign but the theme still paints the endpoint drag-handle circles (blue rings by default, from `--ff-color-accent`). Read-only views must both disable the interaction via input AND suppress the visual. For suppression:

- **Prefer token overrides** when the theme exposes one. Drag-handle ring → `--ff-connection-drag-handle-stroke`:
  ```css
  .graph__canvas-wrap {
    --ff-connection-drag-handle-stroke: transparent;
  }
  ```
  Custom properties inherit through Foblex's SVG, so the `<circle>` stays in the DOM (preserves the library's layout and hit-testing) but renders invisible. Zero `::ng-deep`.
- When no token exists, override `fill` / `stroke` directly via `::ng-deep` scoped to a wrapper you own. **Prefer `fill: transparent` / `stroke: transparent` over `display: none`** — the library often depends on the element existing for internal calculations.

### 7. `::ng-deep` is Foblex's documented escape hatch, not a hack

Foblex's own reference examples (e.g. `apps/example-apps/uml-diagram` in Foblex/f-flow) style connections, markers, drag handles and minimaps with `::ng-deep <component-host-tag> { ... }`. It is deprecated in Angular but still functional and is the documented path when a theme token does not exist. Rules of use in this repo:

1. Prefer token overrides (rule 5) whenever the property has one.
2. When `::ng-deep` is the only option, scope it under the view's component host or a wrapper class you own.
3. Keep each rule narrow — single concern, minimal properties.
4. The rule lives in the view's component CSS, NOT in `src/styles.css`. Globals are for rules that are genuinely app-wide.

## Antipattern checklist

If you catch yourself typing any of these, stop and re-read the rule in parentheses:

- `<svg ...><marker id="..."` — use `<f-connection-marker-arrow>` (rule 4)
- `marker-end: url(#...)` in CSS — use `<f-connection-marker-arrow>` (rule 4)
- `::ng-deep .f-connection-path { stroke: ...; stroke-width: ... }` — override `--ff-connection-color` / `--ff-connection-width` on the `<f-connection>` class (rule 5)
- `::ng-deep .f-canvas` with any rule — almost certainly wrong; the canvas transform is library-controlled (rule 3)
- `transition: transform ...` or `transform: ...` on `[fNode]` / `.f-canvas` (rule 3)
- `display: none` on a library-rendered element — use `fill: transparent` / `stroke: transparent` instead (rule 6)
- View-specific Foblex CSS in `src/styles.css` — move to the view's component CSS (rules 5 and 7)
- Custom class names prefixed with `f-` — that prefix is reserved by Foblex. Our nodes use `sm-gnode` for this reason. Pick a project prefix (`sm-`) for your own classes

## Canonical patterns

### Read-only graph (no editing, no reassign, no selection)

```html
<f-flow fDraggable>
  <f-canvas fZoom [fZoomStep]="0.06" [fZoomDblClickStep]="0.35">
    <f-connection
      [fOutputId]="edge.from + '-out'"
      [fInputId]="edge.to + '-in'"
      fType="segment"
      fBehavior="fixed"
      [fReassignDisabled]="true"
      [fSelectionDisabled]="true"
      [class]="'f-conn--' + edge.kind"
    >
      <f-connection-marker-arrow type="end" />
    </f-connection>
    <!-- nodes omitted -->
  </f-canvas>
</f-flow>
```

```css
.graph__canvas-wrap {
  /* Token overrides: hide reassign rings, let library keep the DOM intact */
  --ff-connection-drag-handle-stroke: transparent;
}
.f-conn--supersedes {
  --ff-connection-color: var(--sm-edge-supersedes);
  --ff-connection-width: 2.5px;
  --ff-marker-color: var(--sm-edge-supersedes);
}
/* stroke-dasharray has no token — scoped ::ng-deep, component CSS only */
.graph__canvas-wrap ::ng-deep .f-conn--related .f-connection-path {
  stroke-dasharray: 4 3;
}
```

### Smooth wheel zoom

The wheel zoom has no easing option; the library has no "animated" wheel. Smoothness comes from step size. `fZoomStep` defaults to `0.1` which feels abrupt. For graph views with up to ~100 nodes, `0.04–0.08` gives a continuous feel.

- Default: `0.1`
- Abrupt: >`0.1`
- Balanced: `0.06`
- Very fine: `0.03` (can feel slow on tall viewports)

Double-click zoom (`fZoomDblClickStep`) uses a larger step by default (`0.5`). `0.25–0.35` is usually right when the wheel is already fine.

## Useful patterns from the official examples

These are not non-negotiables — they are canonical shapes that repeat across `libs/f-examples/*`. Full catalog and code in [`references/examples/README.md`](references/examples/README.md).

- **Post-render viewport setup**: wire `(fLoaded)` or `(fFullRendered)` on `<f-flow>` and call `FCanvasComponent.resetScaleAndCenter(animated)` once the graph is measured. Use `(fFullRendered)` when the next step needs real connector geometry.
- **Per-connector side overrides**: `fOutputConnectableSide` / `fInputConnectableSide` on the connector element pin the edge to `top | right | bottom | left | auto` per connector — independent of `fConnectableSide` on `<f-connection>`. Useful when the graph direction is known at author time (e.g. left-to-right skill map).
- **Markers catalog**: use `<f-connection-marker-arrow>` / `<f-connection-marker-circle>` for the defaults, and `svg[fMarker]` for custom geometry. The `EFMarkerType` enum covers `START`, `END`, `SELECTED_START`, `SELECTED_END`, `START_ALL_STATES`, `END_ALL_STATES` — use `*_ALL_STATES` unless selection needs a different glyph.
- **Signals + OnPush + standalone** is the default authoring shape in every example. Stick with it.

## Full API reference

Every directive, component, input, output, method, event, CSS class, token, and enum lives in [`references/api-reference.md`](references/api-reference.md). Load that file when you need:

- Exact input/output signatures of a directive or component
- The full list of CSS classes (`.f-canvas`, `.f-connection-*`, `.f-gnode-*`, markers, drag handles)
- The theme token catalog (`--ff-*` variables and what consumes them)
- Event payload shapes (`FCanvasChangeEvent`, node/connection events)
- Enums: `EFConnectableSide`, `EFConnectionType`, `EFConnectionBehavior`, `EFMarkerType`, `EFZoomDirection`
- SCSS mixin map for manual theme composition

## Official examples

Verbatim copies of every official `libs/f-examples/*` split by category under [`references/examples/`](references/examples/). Load the matching category file when touching that feature:

- [`examples/nodes.md`](references/examples/nodes.md) — node composition, drag handles, selection, resize, rotate, grouping, stress tests.
- [`examples/connectors.md`](references/examples/connectors.md) — `fNodeInput` / `fNodeOutput`, connectable side, rules, outlets, limiting connections.
- [`examples/connections.md`](references/examples/connections.md) — `f-connection` types / behaviours / markers / content / waypoints and the drag-to-connect / reassign / snap lifecycle.
- [`examples/extensions.md`](references/examples/extensions.md) — background, grid, zoom, auto-pan, minimap, magnetic guides, palette, selection area.
- [`examples/plugins.md`](references/examples/plugins.md) — Dagre and ELK layout plugins + the shared `utils/` helpers.
- [`examples/advanced.md`](references/examples/advanced.md) — copy/paste, undo/redo, drag lifecycle, custom event triggers.
- [`examples/reference-apps.md`](references/examples/reference-apps.md) — pointers to the full-app demos (UML Diagram, Schema Designer, Tournament Bracket, Call Center, AI Low-Code Platform).

**Rule**: if our code disagrees with the corresponding example, the example wins. The Foblex team ships these to demonstrate the canonical shape.

## When something does not work and the console is clean

In order of likelihood:

1. **Edges missing** → rule 1 (connector IDs collide between in/out).
2. **Connections invisible, everything else fine** → rule 2 (theme not imported, or wrong path for monorepo).
3. **Zoom/pan lags, connectors "chase" nodes** → rule 3 (we animate a transform the library controls).
4. **Hovered node jumps to origin** → rule 3 (`:hover { transform: ... }` on a `[fNode]`).
5. **Blue circles at connection endpoints** → rule 6 (drag-handle ring; reassign disabled does not hide it; override `--ff-connection-drag-handle-stroke`).
6. **Arrow marker has wrong shape or wrong color** → rule 4 (check if we are rolling our own SVG markers) + rule 5 (check `--ff-marker-color` override).
7. **Anything else** → open the matching file under [`references/examples/`](references/examples/) and diff our shape against the canonical one. If our code does not match, align it before inventing a workaround.
