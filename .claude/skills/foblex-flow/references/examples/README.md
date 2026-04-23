# Foblex Flow — Official Examples Index

Verbatim copies of every example under [`libs/f-examples/`](https://github.com/Foblex/f-flow/tree/main/libs/f-examples) in the upstream repo, organized by category. Each file lists every example in its category with the full `example.html`, `example.ts`, and `example.scss` from the source of truth.

**Use these as the ground truth.** When our code disagrees with an example, the example wins — the Foblex team ships these to demonstrate the canonical shape. When something in our graph view misbehaves and the console is clean, grep the relevant category file before inventing a workaround.

## Category files

| File | Examples | Read when… |
|---|---|---|
| [`nodes.md`](nodes.md) | `custom-nodes`, `drag-handle`, `drag-to-group`, `draggable-flow`, `grouping`, `node-selection`, `resize-handle`, `rotate-handle`, `stress-test`, `stress-test-with-connections` | Working on the node template, drag UX, selection, grouping, or performance. |
| [`connectors.md`](connectors.md) | `connectable-side`, `connection-rules`, `connector-inside-node`, `connector-outlet`, `limiting-connections`, `node-as-connector` | Deciding where inputs/outputs live, constraining which connectors can connect, per-connector side overrides. |
| [`connections.md`](connections.md) | `drag-to-connect`, `drag-to-reassign`, `create-node-on-connection-drop`, `remove-connection-on-drop`, `assign-node-to-connection-on-drop`, `auto-snap`, `connection-types`, `custom-connection-type`, `connection-behaviours`, `connection-markers`, `connection-content`, `connection-waypoints`, `connection-connectable-side`, `custom-connections` | Any edge rendering or interaction question: markers, types, behaviours, content projection, waypoints, drag lifecycle. |
| [`extensions.md`](extensions.md) | `add-node-from-palette`, `auto-pan`, `background-example`, `grid-system`, `help-in-positioning`, `magnetic-lines`, `magnetic-rects`, `minimap-example`, `selection-area`, `zoom` | Canvas-level extensions: background, grid, pan, zoom, minimap, magnetic guides, selection box. |
| [`plugins.md`](plugins.md) | `dagre-layout`, `dagre-layout-auto`, `elk-layout`, `elk-layout-auto`, plus the shared `utils/` helpers | Using Dagre or ELK to auto-layout the graph. |
| [`advanced.md`](advanced.md) | `copy-paste`, `custom-event-triggers`, `drag-start-end-events`, `undo-redo`, `undo-redo-v2` | Undo/redo stacks, clipboard, drag lifecycle events, imperative event triggers. |
| [`reference-apps.md`](reference-apps.md) | `ai-low-code-platform`, `schema-designer`, `call-center`, `uml-diagram`, `tournament-bracket` | Pointers only — these are full Angular apps. Jump to GitHub. |

## Canonical patterns found across the examples

Six patterns repeat across nearly every example. If you catch yourself doing something different, stop and check.

### 1. Standalone component + OnPush + signals

```ts
import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { FCanvasComponent, FFlowModule } from '@foblex/flow';

@Component({
  selector: 'example',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule],
})
export class Example {
  private readonly _canvas = viewChild.required(FCanvasComponent);
  // ...
}
```

### 2. Post-render viewport setup with `(fLoaded)` or `(fFullRendered)`

Foblex exposes two lifecycle events on `<f-flow>`:

- `(fLoaded)` — fires once after the initial synchronous render.
- `(fFullRendered)` — fires after everything (nodes, connections, measurements) has stabilized. Use this when the next step depends on real connector positions.

Both are commonly wired to `FCanvasComponent.resetScaleAndCenter(animated: boolean)`:

```html
<f-flow fDraggable (fFullRendered)="loaded()">
```

```ts
protected loaded(): void {
  this._canvas()?.resetScaleAndCenter(true);
}
```

### 3. Theme wiring via SCSS mixins (per-view), not only the global `default.scss`

Every example under `libs/f-examples/` uses component-scoped theme mixins:

```scss
@use '@foblex/flow/styles' as flow-theme;

::ng-deep {
  @include flow-theme.theme-tokens();           // expose CSS vars (--ff-*)
}

::ng-deep f-flow {
  @include flow-theme.flow($scoped: false);     // base flow styles
  @include flow-theme.connection($scoped: false);
  @include flow-theme.connection-markers($scoped: false);
  @include flow-theme.minimap($scoped: false);  // only if the view uses the minimap
}

@include flow-theme.node($selectorless: false);
@include flow-theme.group($selectorless: false); // only when grouping is used
@include flow-theme.connector($selectorless: false);
```

This is the **per-feature** alternative to the global `default.scss` import documented in rule 2 of `SKILL.md`. Both work; the mixin path is more granular and lets you ship only what the view uses.

Available mixins (as seen across the examples): `theme-tokens`, `flow`, `node`, `group`, `connector`, `connection`, `connection-markers`, `drag-handle`, `resize-handle`, `rotate-handle`, `minimap`, `selection-area`, `background`, `grid-system`.

### 4. Per-connector side overrides (`fOutputConnectableSide` / `fInputConnectableSide`)

The `fConnectableSide` on `<f-connection>` sets the side at the connection level. But the connector elements themselves can override it, forcing the edge to exit/enter a specific side of the connector:

```html
<div fNode fNodeOutput fOutputId="1" fOutputConnectableSide="right">…</div>
<div fNode fNodeInput  fInputId="2"  fInputConnectableSide="left">…</div>
```

Values: `top | right | bottom | left | auto` (auto = library picks based on geometry).

### 5. Built-in markers over hand-rolled SVG

Nearly every example that draws edges uses one of:

- `<f-connection-marker-arrow [type]="eMarkerType.END_ALL_STATES" />`
- `<f-connection-marker-circle [type]="eMarkerType.START_ALL_STATES" />`
- `<svg fMarker [type]="..." viewBox="..." [refX]="..." [refY]="...">...custom path...</svg>`

The `EFMarkerType` enum supports per-state markers: `START`, `SELECTED_START`, `END`, `SELECTED_END`, `START_ALL_STATES`, `END_ALL_STATES`. Only use the multi-variant form when the selected edge needs a different glyph — otherwise `*_ALL_STATES` is enough.

### 6. `fBehavior="fixed"` vs `"floating"` is a design choice, not a default

Most read-only, layout-driven graphs use `fBehavior="fixed"` with a chosen `fType` (`segment`, `straight`, `bezier`). The interactive examples that need smart routing around nodes use `fBehavior="floating"`.
