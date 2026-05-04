---
name: foblex-flow
description: Authoritative guide for working with Foblex Flow (@foblex/flow) in the skill-map UI. Use whenever editing Angular code in ui/ that touches graph rendering — templates with f-flow / f-canvas / f-connection / fNode / fDraggable / fZoom / fMarker directives; TypeScript importing from @foblex/flow (FFlowModule, FCanvasComponent, EFConnectableSide, EFMarkerType, FConnectionMarkerArrow, etc.); CSS targeting .f-* classes or .sm-gnode; angular.json style configuration for the Foblex theme; or any task involving node layout, connector rendering, pan/zoom behavior, edge styling, drag handles, or performance of the graph view. Covers the nine non-negotiable rules learned the hard way, the antipattern checklist, and points at the full API reference for every directive and component.
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

## The nine non-negotiables

Skipping any of these produces silent failures: missing visuals, degraded performance, or wrong positioning. All nine were learned the hard way — do not relitigate them, apply them.

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

**Dark mode**: the shipped theme already paints a full dark palette under `.dark` and `[data-theme='dark']` (see `@foblex/flow/styles/tokens/_semantic.scss` — every `--ff-color-*` is redeclared in that block). Whatever class your app uses to flag dark mode (PrimeNG/Aura uses `.app-dark` here, registered via `darkModeSelector` in `app.config.ts`), make sure `.dark` is **also** toggled on `documentElement` so Foblex picks up its own dark tokens. The `ThemeService` in this repo flips both classes from a single signal.

Antipattern — do NOT redeclare `--ff-color-*` inside your own `.app-dark { ... }` block to "force" the graph into dark. That duplicates the package's palette, drifts the day Foblex updates a token, and is exactly the "papering over a missed setup step" pattern AGENTS.md prohibits. The fix is one line in the theme service, not a parallel token table.

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
- **Connector sockets** (the 16×16 circles painted on every `fNodeInput` / `fNodeOutput` by `_socket-frame` — blue when connected, neutral when idle, see `_connector.scss`) follow the same pattern. To suppress them entirely (e.g. for an "arrow only" read-only graph) override the four colour tokens at the wrapper level:
  ```css
  .graph__canvas-wrap {
    --ff-connector-background-color: transparent;
    --ff-connector-border-color: transparent;
    --ff-connector-connected-color: transparent;
    --ff-connector-node-ring-color: transparent;
  }
  ```
  The `<div fNodeInput>` / `<div fNodeOutput>` elements MUST stay in the DOM (they are the geometric anchors the connection layer reads to compute arrow endpoints — see rule 8 for the complementary positioning requirement). Painting them invisible keeps the geometry while removing the visual noise.
- When no token exists, override `fill` / `stroke` directly via `::ng-deep` scoped to a wrapper you own. **Prefer `fill: transparent` / `stroke: transparent` over `display: none`** — the library often depends on the element existing for internal calculations.

### 7. `::ng-deep` is Foblex's documented escape hatch, not a hack

Foblex's own reference examples (e.g. `apps/example-apps/uml-diagram` in Foblex/f-flow) style connections, markers, drag handles and minimaps with `::ng-deep <component-host-tag> { ... }`. It is deprecated in Angular but still functional and is the documented path when a theme token does not exist. Rules of use in this repo:

1. Prefer token overrides (rule 5) whenever the property has one.
2. When `::ng-deep` is the only option, scope it under the view's component host or a wrapper class you own.
3. Keep each rule narrow — single concern, minimal properties.
4. The rule lives in the view's component CSS, NOT in `src/styles.css`. Globals are for rules that are genuinely app-wide.

### 8. Connector sub-elements need explicit positioning — directives don't add orientation classes

`fNodeInput` / `fNodeOutput` apply fixed host classes (`f-component`, `f-node-input`, `f-node-output`) plus state classes (`f-node-input-connected`, `f-node-output-disabled`, `f-connector-connectable`, etc. — see `fesm2022/foblex-flow.mjs` host bindings). What they do **NOT** do is translate `fInputConnectableSide` / `fOutputConnectableSide` into orientation classes like `.top` / `.bottom` / `.left` / `.right`. Those orientation classes exist in `_socket-frame` (`@foblex/flow/styles/domains/_connector.scss`) as `&.top { top: calc(var(--ff-connector-size) / -2); ... }` etc., but the SCSS only fires when **you put the class on the element manually**.

The default theme applies `position: absolute` plus a 16×16 size to every connector socket via `_socket-frame`. Without an explicit `top` / `right` / `bottom` / `left` from your CSS, `position: absolute` defaults to the upper-left corner of the nearest positioned ancestor — i.e. **the connector renders at the card's top-left corner, and the connection's arrow follows it there.** Symptom: arrows appear "off to one side" of the card or partially behind it; nodes look fine until you eyeball where edges actually terminate.

This bites only when connectors are **sub-elements** of the node card. Two layout shapes:

**Sub-element pattern (skill-map):**

```html
<div fNode [fNodeId]="node.id" class="sm-gnode">
  <div fNodeInput
       [fInputId]="node.id + '-in'"
       [fInputConnectableSide]="'top'"
       class="sm-gnode__connector sm-gnode__connector--in"></div>
  <span>{{ node.label }}</span>
  <div fNodeOutput
       [fOutputId]="node.id + '-out'"
       [fOutputConnectableSide]="'bottom'"
       class="sm-gnode__connector sm-gnode__connector--out"></div>
</div>
```

```css
.sm-gnode { position: relative; /* …content… */ }
.sm-gnode__connector { position: absolute; pointer-events: none; }
.sm-gnode__connector--in {
  top: calc(var(--ff-connector-size) / -2);
  left: 50%;
  transform: translateX(-50%);
}
.sm-gnode__connector--out {
  bottom: calc(var(--ff-connector-size) / -2);
  left: 50%;
  transform: translateX(-50%);
}
```

The `calc(var(--ff-connector-size) / -2)` matches the math `_socket-frame` uses internally for `&.top` / `&.bottom`, so the socket centers exactly on the card's edge regardless of theme overrides to `--ff-connector-size`.

**Same-element pattern (every official example — bracket, call-center, uml-diagram):**

```html
<div class="bracket-node"
     fNode [fNodeId]="m.id"
     fNodeInput  [fInputId]="m.id" fInputConnectableSide="left"
     fNodeOutput [fOutputId]="m.id" fOutputConnectableSide="right">
  …
</div>
```

When the directives sit on the card itself, the card IS the connector — connection geometry anchors to the card's edges naturally and no extra positioning is needed. Worth knowing because the official examples take this shape and won't show you the sub-element trap.

If you're tempted to delete CSS rules positioning `[fNodeInput]` / `[fNodeOutput]` because "Foblex's `_socket-frame` covers it" — stop. The socket is positioned `absolute` but with no offsets; you own the offsets.

### 9. Foblex's drag directives consume `pointerup` — use `mouseup` for drag-end detection

`fDragHandle` and `fDraggable` capture the pointer for the drag lifecycle (likely via `setPointerCapture` + propagation handling). A `pointerup` listener registered on `document` — even with `{ capture: true, once: true }` and a `queueMicrotask` defer — does NOT reliably fire when a node drag ends. The event is consumed or rerouted internally before reaching the handler.

Symptom: you wire a `pointerdown` → `pointerup` pair on `document` to detect "drag ended" (e.g. to flush a buffer or persist final positions to localStorage), it works in isolation but never fires after a `[fNode]` drag. State silently never updates.

**Fix**: listen on `mouseup` instead. The browser fires both pointer and mouse events for the same physical interaction; Foblex intercepts pointer events but not mouse events. The middle-mouse pan in `graph-view.ts` (`onCanvasMouseDown` → `document.addEventListener('mouseup', …)`) has used this approach since day one — that was the hint.

```ts
onNodePointerDown(event: PointerEvent): void {
  this.pointerDownAt = { x: event.clientX, y: event.clientY };
  document.addEventListener('mouseup', this.onNodeMouseUp, { once: true });
}

private dragInProgress = false;
private dragBuffer: TNodePositions | null = null;

private readonly onNodeMouseUp = (): void => {
  // Defer one microtask so any final fNodePositionChange Foblex emits
  // synchronously around the up event lands in the buffer first.
  queueMicrotask(() => {
    if (!this.dragInProgress) { this.dragBuffer = null; return; }
    this.dragInProgress = false;
    if (this.dragBuffer) this.nodePositions.set(this.dragBuffer);
    this.dragBuffer = null;
    writeStoredNodePositions(this.nodePositions());
  });
};

onNodePositionChange(id: string, position: IPoint): void {
  // Buffer in a non-signal field. Writing the signal here would
  // invalidate the `graph` computed and force a full @for diff over
  // nodes/edges 60–120×/sec for nothing — Foblex already updates the
  // dragged node's DOM transform internally during drag.
  if (!this.dragBuffer) this.dragBuffer = { ...this.nodePositions() };
  this.dragBuffer[id] = { x: position.x, y: position.y };
  this.dragInProgress = true;
}
```

Two reinforcing perf wins land in this pattern, both hidden by a 120 fps rAF reading:

1. **Single signal write at drag-end** — not 60–120/sec during drag. Eliminates the `graph` computed invalidation cascade through the @for over nodes and edges.
2. **Single localStorage I/O at drag-end** — sync `setItem` calls during drag pile up as 1–5 ms stalls each (more on slow disks). The avg fps stays high but every frame during drag has a stall, producing perceivable jank.

If you reach for `pointerup` thinking it is the "modern pointer event API", read this rule first.

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
- Restoring a viewport with `canvas.setPosition(...)` + `canvas.setScale(...)` — use the `[position]` / `[scale]` input bindings on `<f-canvas>` instead (see "Persisted viewport" pattern)
- Binding `[position]` / `[scale]` to a **constant** (field-init literal, `readonly` value that never reassigns) — Foblex re-evaluates the inputs on every CD pass and reconciles against its internal viewport, so any user pan / zoom gets undone the next time the host re-renders. Bind to a signal that `(fCanvasChange)` writes (see "Persisted viewport" pattern)
- Redeclaring `--ff-color-*` inside your own `.app-dark { ... }` block — the package already ships dark defaults under `.dark` / `[data-theme='dark']`; toggle that class on the document root from your theme service instead (rule 2, "Dark mode")
- Deleting your own `position: absolute; top/bottom: ...` rules from connector sub-elements because "Foblex's `_socket-frame` already handles it" — it sets `position: absolute` and a 16×16 size, but no offsets; you own the offsets when connectors are sub-elements (rule 8)
- Expecting `fInputConnectableSide` / `fOutputConnectableSide` to add `.top` / `.bottom` / `.left` / `.right` classes automatically — they don't; the directive only stores the side as metadata, the orientation classes are SCSS sub-classes you place yourself (rule 8)
- Wrapping the `<div fNode>` inner DOM in a shared `<ng-template>` and projecting it with `<ng-container *ngTemplateOutlet>` for DRY-ness — Foblex's content queries on `[fNode]` don't reach into embedded views, so connectors disappear and every node renders at `(0,0)` in a redraw loop. Duplicate the markup in each branch instead (see "Performance levers from the stress-test example")
- Adding `<f-background>` and seeing the grid only at the edges (centre is solid colour) — `<f-canvas>` paints `--ff-canvas-background-color` opaque on top of the background layer. Override it to `transparent` at your wrapper (see "Background grid" canonical pattern)
- Painting an `:hover` / `:focus` outline using `border-color` change on `[fNode]` cards while a sibling-class state (`.sm-gnode--selected` / `.sm-gnode--highlighted`) sets the same property — the cascade fights between user gestures and selection state. Keep gesture state on a different property (`box-shadow`) so the two layers compose instead of conflict
- `document.addEventListener('pointerup', …)` to detect the end of a `[fNode]` drag — `fDragHandle` consumes pointerup; the listener never fires. Use `mouseup` instead (rule 9)
- Writing to a signal that feeds the `graph` computed (typically `nodePositions`) on every `(fNodePositionChange)` — invalidates the @for over nodes/edges 60–120×/sec. Buffer the position in a non-signal field and flush once at `mouseup` (rule 9)
- Calling `localStorage.setItem` (or any sync I/O) from inside `(fNodePositionChange)` — sync writes during drag stall the main thread per frame and produce visible jank even when rAF reads 120 fps. Defer to the `mouseup` flush (rule 9)

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

### Persisted viewport (localStorage / restore across reloads)

Restoring pan position and zoom is the ONE place where the intuitive imperative API (`setPosition` + `setScale`) produces silent, visually broken output. Symptoms: arrows missing on first paint, nodes rendered at an offset, and both only reconciling after the first user pan/zoom. Reason: the calls update the transform model out of phase with the connection measurement pass, so the SVG connection layer renders against stale geometry.

**Use the `[position]` and `[scale]` input bindings on `<f-canvas>` instead.** This is the pattern the official `libs/f-examples/advanced/undo-redo` uses — Foblex applies the transform once, atomically, on the first render.

**Critical**: bind to **signals**, NOT to field-initialized literals. Foblex re-evaluates `[position]` / `[scale]` on every change-detection pass; if the bound value drifts from the canvas's internal viewport (e.g. user pans → internal viewport moves; the bound literal stays at its boot value), Foblex re-applies the bound value to "reconcile" and snaps the canvas back to the boot position. Symptom: every re-render of the host (a WebSocket-driven `nodes` refresh, a filter toggle, anything that invalidates a parent computed) snaps the viewport back to wherever it was when the component mounted. Storing the viewport in signals that `(fCanvasChange)` writes keeps the binding always in sync with the canvas's own state, so reconciliation is a no-op.

A reproducible test for the bug: start the app, pan the canvas a bit, then trigger any state change that re-runs change detection on the host (e.g. WS push, filter toggle). If the canvas snaps back, the bindings are constants instead of signals — F5 "fixes" it because the field initializer re-runs and picks up the panned position from localStorage, which masks the underlying defect.

```ts
private readonly savedViewport = readStoredViewport(); // localStorage parse

// Signals — NOT field-init constants. (fCanvasChange) writes them on
// every pan / zoom so the binding stays in sync with the canvas's
// internal viewport, neutralising Foblex's reconcile-on-CD behaviour.
protected readonly viewportPosition = signal<IPoint>(
  this.savedViewport
    ? { x: this.savedViewport.x, y: this.savedViewport.y }
    : { x: 0, y: 0 },
);
protected readonly viewportScale = signal<number>(this.savedViewport?.scale ?? 1);

private hasCompletedInitialLayout = false;

constructor() {
  effect(() => {
    const data = this.graph();
    if (data.nodes.length === 0) return;
    queueMicrotask(() => {
      if (this.hasCompletedInitialLayout) {
        this.canvas()?.fitToScreen({ x: 40, y: 40 }, false); // filter-driven refit
        return;
      }
      this.hasCompletedInitialLayout = true;
      // If a viewport was restored, the [position] / [scale] bindings already
      // placed the canvas. Only auto-fit on a clean slate.
      if (!this.savedViewport) this.canvas()?.fitToScreen({ x: 40, y: 40 }, false);
    });
  });
}

onCanvasChange(event: FCanvasChangeEvent): void {
  // Mirror the canvas's internal viewport into our bound signals so a
  // future change-detection pass doesn't reconcile and snap back.
  this.viewportPosition.set({ x: event.position.x, y: event.position.y });
  this.viewportScale.set(event.scale);
  if (!this.hasCompletedInitialLayout) return;
  localStorage.setItem(KEY, JSON.stringify({
    x: event.position.x, y: event.position.y, scale: event.scale,
  }));
}
```

```html
<f-canvas
  fZoom
  [position]="viewportPosition()"
  [scale]="viewportScale()"
  [debounceTime]="150"
  (fCanvasChange)="onCanvasChange($event)"
>
```

Notes:

- Initialise the signals **in a field initializer** (not after `ngOnInit`) — the binding is evaluated on first template pass.
- `(fCanvasChange)` MUST write back into the signals. That is what keeps the bound value in sync with the canvas. Skipping the write is the bug.
- The `hasCompletedInitialLayout` guard is essential. Without it, the first auto-fired `fCanvasChange` (triggered by the initial binding) overwrites storage with `{0,0,1}` before the user has touched anything.
- Never mix: do NOT bind `[position]` / `[scale]` AND then call `setPosition()` / `setScale()` imperatively on the same mount. The library expects one source of truth per mount.
- `setPosition` / `setScale` are still valid for post-mount interactions (e.g. a middle-mouse pan handler that drives the canvas directly outside the binding loop); the restore path is the specific case where they fail.

### Selection-driven node + edge highlighting (click → light up neighbours)

Pattern lifted verbatim from `apps/example-apps/tournament-bracket` in Foblex/f-flow. Everything lives in component state — Foblex does not own selection here, the app does.

**State** (a single `selectedId` signal + a derived adjacency map):

```ts
readonly selectedNodeId = signal<string | null>(null);

private readonly adjacency = computed<Map<string, Set<string>>>(() => {
  const map = new Map<string, Set<string>>();
  for (const edge of this.graph().edges) {
    if (!map.has(edge.from)) map.set(edge.from, new Set());
    if (!map.has(edge.to)) map.set(edge.to, new Set());
    map.get(edge.from)!.add(edge.to);
    map.get(edge.to)!.add(edge.from);
  }
  return map;
});
```

**Pure helpers** (no side effects, drive the template classes):

```ts
isSelected(id: string)    { return this.selectedNodeId() === id; }
isHighlighted(id: string) { /* neighbour of selected */ }
isDimmed(id: string)      { /* selected exists, this is neither selected nor neighbour */ }
isEdgeHighlighted(e)      { /* one endpoint matches selected */ }
isEdgeDimmed(e)           { /* selected exists, neither endpoint matches */ }
```

**Template** (one click handler per node, deselect on canvas-empty click):

```html
<f-flow … >
  <f-canvas … >
    <ng-container ngProjectAs="[fConnections]">
      @for (edge of graph().edges; track edge.id) {
        <f-connection
          …
          [class.f-conn--highlighted]="isEdgeHighlighted(edge)"
          [class.f-conn--dimmed]="isEdgeDimmed(edge)"
        > … </f-connection>
      }
    </ng-container>

    <ng-container ngProjectAs="[fNodes]">
      @for (node of graph().nodes; track node.id) {
        <div fNode
             [class.sm-gnode--selected]="isSelected(node.id)"
             [class.sm-gnode--highlighted]="isHighlighted(node.id)"
             [class.sm-gnode--dimmed]="isDimmed(node.id)"
             (click)="selectNode(node, $event)"
             (dblclick)="openNode(node)">
          …
        </div>
      }
    </ng-container>
  </f-canvas>
</f-flow>
```

```css
.sm-gnode--selected   { border-color: var(--p-primary-color); box-shadow: …, 0 0 0 2px var(--p-primary-color); }
.sm-gnode--highlighted { border-color: var(--p-primary-color); }
.sm-gnode--dimmed     { opacity: 0.25; }

/* Edges — declared AFTER per-kind selectors so width override wins
   (both are single-class specificity, source order decides). */
.f-conn--highlighted { --ff-connection-width: 3px; }
.f-conn--dimmed      { opacity: 0.15; }
```

Notes:

- **Edge dim via host opacity**, not stroke alpha. The `<f-connection>` host has emulated encapsulation but `opacity` cascades to the SVG path it renders. No `::ng-deep`. Same trick the bracket SCSS uses.
- **Deselect** by listening for `(click)` on a wrapper around the canvas and ignoring clicks whose `event.target.closest('.sm-gnode')` (or any other interactive overlay) is non-null. Foblex's `<f-flow>` does not expose a "background-only click" event.
- **Single click selects, double click navigates** to the inspector. Same gesture as Finder / file managers; descoverable. Maintain a small drag-distance guard in the click handler so a node-drag doesn't fire `selectNode`.
- **Selection guard via effect**: when filters change and the selected node is no longer visible, clear the selection (`effect(() => { if (!this.graph().nodes.some(n => n.id === id)) this.selectedNodeId.set(null); })`). Avoids dangling highlight state.

### Background grid (with the canvas-opaque gotcha)

Drop `<f-background>` + a pattern component as a sibling of `<f-canvas>` inside `<f-flow>`:

```html
<f-flow fDraggable [fCache]="…">
  <f-background>
    <f-rect-pattern />   <!-- or <f-circle-pattern /> for dots -->
  </f-background>
  <f-canvas …> … </f-canvas>
</f-flow>
```

`FFlowModule` re-exports `FBackgroundComponent` and the pattern components — no extra imports. Line colour comes from `--ff-background-line-color` / `--ff-background-dot-color` which already track `.dark`. `<f-rect-pattern>` accepts `vSize` / `hSize` / `vColor` / `hColor` if you want to tune density or override colours per view.

**Gotcha — wired but invisible in the centre**. `_flow-canvas.scss` paints both `<f-flow>` AND `<f-canvas>` with solid backgrounds (`--ff-flow-background-color` and `--ff-canvas-background-color` resp.). Since `<f-canvas>` renders **above** `<f-background>` in the DOM order Foblex builds, its solid fill covers the grid wherever the canvas extends — i.e. exactly the centre region around your nodes, which is where the grid most matters. Override the canvas background to transparent at your wrapper:

```css
.graph__canvas-wrap {
  --ff-canvas-background-color: transparent;
}
```

`<f-flow>` keeps its colour as the "paper" layer behind the grid; node cards keep their own opaque fills. The grid is now visible across the whole pannable surface.

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
- **Performance levers from the stress-test example** (`libs/f-examples/nodes/stress-test`): three independent toggles to scale to thousands of nodes.
  1. **`[fCache]="true"` on `<f-flow>`**: enables Foblex's internal geometry cache. Connector positions and connection geometry are reused across redraws (pan / zoom / drag). Safe ON by default — the library invalidates the cache on relevant input changes.
  2. **`ngProjectAs="[fNodes]"` / `ngProjectAs="[fConnections]"`** on a `<ng-container>` wrapper around the iteration. Foblex defines content-projection slots for nodes and connections; using them clarifies the structure and is a **prerequisite for `*fVirtualFor`** (virtualization needs to know which slot it is feeding).
  3. **`*fVirtualFor`** (`FVirtualFor`, standalone directive — import explicitly, NOT bundled in `FFlowModule`). Virtualises node rendering: only nodes whose bounding box intersects the viewport plus a buffer end up in the DOM. Pays off around 300+ visible nodes; below that the bookkeeping cost outweighs the saved render cost. The stress-test ships it behind a checkbox for a reason — make it opt-in via a config flag in this repo too. Companion shape:
     ```html
     <ng-container ngProjectAs="[fNodes]" *fVirtualFor="let node of nodes()">
       <div fNode [fNodeId]="node.id" [fNodePosition]="node.position">…</div>
     </ng-container>
     ```
     `*fVirtualFor` does NOT support a `track` clause — it has its own `fVirtualForTrackBy` input if you need it.

  **Trap when supporting both branches (virtualization on/off)**: do NOT extract the `<div fNode>` body into a shared `<ng-template>` and reuse it via `<ng-container *ngTemplateOutlet>`. Foblex's `[fNode]` directive resolves `fNodeInput` / `fNodeOutput` / connectors via Angular **content queries** on direct view children. `*ngTemplateOutlet` renders the template into an *embedded view* that lives outside the host's content tree, so the queries return empty: the node has no inputs/outputs, geometry never resolves, and every node piles at `(0,0)` in a constant redraw loop. Symptoms: stack of cards at the canvas origin, blank canvas with shadows only, browser tab spinning. **Fix**: duplicate the full `<div fNode>...</div>` markup inline in each branch. The official stress-test does the same — it does NOT factor out the inner DOM.
  Skill-map wires these three behind `ui/src/app/views/graph-view/graph-view.config.ts` (`GRAPH_PERF_FLAGS`). The perf HUD bottom-left in the canvas (FPS, frame time, heap, cache age) is the feedback loop for deciding when to flip them.

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
7. **Restored viewport renders with arrow/node offset until first pan** → "Persisted viewport" canonical pattern (switch `setPosition`/`setScale` imperative calls to `[position]` / `[scale]` input bindings on `<f-canvas>`).
8. **Graph stays light when the rest of the app goes dark** → rule 2 "Dark mode": Foblex listens for `.dark` / `[data-theme='dark']`, not your PrimeNG/Aura selector. Toggle both classes from the theme service from a single signal.
9. **Connection arrows terminate at the wrong place — off to one side, behind the card, or far from where the connector should sit** → rule 8: connector sub-elements are `position: absolute` (set by `_socket-frame`) but get no top/right/bottom/left from the library. Without your own `top: calc(var(--ff-connector-size) / -2); left: 50%; transform: translateX(-50%)`, they collapse to `0,0` of the card and arrows follow them.
10. **All nodes pile up at canvas origin (0,0), canvas is mostly blank with only shadows, and the tab keeps redrawing** → the inner DOM of `[fNode]` was extracted to an `<ng-template>` and reused via `<ng-container *ngTemplateOutlet>`. Angular content queries don't cross into embedded views, so Foblex sees no `fNodeInput` / `fNodeOutput`, geometry never resolves, redraw runs forever. Duplicate the markup inline in each branch instead.
11. **Background grid renders only at the edges of the canvas wrap; centre region around the nodes is solid colour** → `<f-canvas>` is opaque (`--ff-canvas-background-color`) and covers `<f-background>` underneath. Override the canvas background to `transparent` at the wrapper (see "Background grid" canonical pattern).
12. **Filtering changes the layout — unmoved nodes jump and the viewport re-fits** → dagre is being run over the filtered subset on every change. Run dagre once over the FULL collection (cached `computed`) and only project to `visibleIds` at render time. Do not call `fitToScreen` from a filter-change effect; restrict it to the first render only and let the user use the explicit "Fit" toolbar button afterwards.
13. **Drag a node, release, refresh — the node is back at its previous position; pointerup-based persistence "just doesn't fire"** → `fDragHandle` consumes `pointerup` (rule 9). Switch the document listener to `mouseup`. Same fix applies to any one-off post-drag side effect (analytics, undo snapshot, etc.).
14. **Drag feels choppy even though the perf HUD reads 120 fps** → state is being written on every `(fNodePositionChange)`. Two compounding causes: (a) signal write invalidates the `graph` computed → @for diff over all nodes/edges 60–120×/sec; (b) sync `localStorage.setItem` per move adds 1–5 ms stalls per frame. Buffer the position in a non-signal field, flush at `mouseup` (rule 9).
15. **Pan / zoom snaps back to the boot position on every WS update / filter change / any host re-render — but a full F5 "fixes" it** → `[position]` / `[scale]` are bound to constants (field-init literals). Foblex re-evaluates the inputs on every CD pass and reconciles against its internal viewport, undoing the user's pan. F5 masks it because the field initializer re-runs and reads the panned position from localStorage. Bind to signals that `(fCanvasChange)` writes (see "Persisted viewport" canonical pattern).
16. **Anything else** → open the matching file under [`references/examples/`](references/examples/) and diff our shape against the canonical one. If our code does not match, align it before inventing a workaround.
