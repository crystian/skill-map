# Examples — Connections

Edges between connectors. Covers `f-connection` types, behaviours, markers (`f-connection-marker-arrow`, `f-connection-marker-circle`, `svg[fMarker]`), content projection, waypoints, and the drag-to-connect / reassign / snap lifecycle.

Every example below is a verbatim copy of the official Foblex Flow example at `libs/f-examples/connections/<name>/` in the upstream repo. Prefer the upstream links when in doubt.

---

## assign-node-to-connection-on-drop

Demo: https://flow.foblex.com/examples/assign-node-to-connection-on-drop  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/connections/assign-node-to-connection-on-drop

### Template (`example.html`)

```html
<f-flow
  fDraggable
  (fLoaded)="loaded()"
  fEmitOnNodeIntersect
  (fNodeIntersectedWithConnections)="nodeIntersectedWithConnection($event)"
>
  <f-canvas>
    @for (connection of connections(); track $index) {
    <f-connection
      [fReassignDisabled]="false"
      fBehavior="floating"
      [fConnectionId]="connection.id"
      [fOutputId]="connection.source"
      [fInputId]="connection.target"
    >
    </f-connection>
    } @for (node of nodes; track node.id) {
    <div fNode [fNodeId]="node.id" fDragHandle [fNodePosition]="node.position">
      <div fNodeInput [fInputId]="node.id" class="left"></div>
      <div fNodeOutput [fOutputId]="node.id" class="right"></div>
      @if (node.connected) { I'm connected node } @else { Drag me to connection }
    </div>
    }
  </f-canvas>
</f-flow>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { FCanvasComponent, FFlowModule, FNodeIntersectedWithConnections } from '@foblex/flow';

@Component({
  selector: 'assign-node-to-connection-on-drop',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule],
})
export class Example {
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected readonly nodes = [
    {
      id: '1',
      connected: true,
      position: { x: 0, y: 0 },
    },
    {
      id: '2',
      connected: true,
      position: { x: 400, y: 0 },
    },
    {
      id: '3',
      position: { x: 200, y: 200 },
    },
  ];

  protected readonly connections = signal([
    { id: '1', source: this.nodes[0].id, target: this.nodes[1].id },
  ]);

  protected nodeIntersectedWithConnection({
    fNodeId,
    fConnectionIds,
  }: FNodeIntersectedWithConnections): void {
    const connectionId = fConnectionIds?.[0];
    if (!connectionId) {
      throw new Error('Connection not found');
    }

    const node = this.nodes.find((x) => x.id === fNodeId);
    if (!node) {
      throw new Error('Node not found');
    }

    const lastTarget = this._updateCurrentConnection(connectionId, fNodeId);

    this.connections.update((x) => [
      ...x,
      {
        id: '2',
        source: fNodeId,
        target: lastTarget,
      },
    ]);

    node.connected = true;
  }

  private _updateCurrentConnection(id: string, newTarget: string): string {
    let lastTarget = '';
    this.connections.update((x) => {
      const connection = x.find((c) => c.id === id);
      if (!connection) {
        throw new Error('Connection not found');
      }
      lastTarget = connection.target;
      connection.target = newTarget;

      return x;
    });

    return lastTarget;
  }

  protected loaded(): void {
    this._canvas()?.resetScaleAndCenter(false);
  }
}
```

### Styles (`example.scss`)

```scss
@use '@foblex/flow/styles' as flow-theme;

::ng-deep {
  @include flow-theme.theme-tokens();
}

::ng-deep f-flow {
  @include flow-theme.connection($scoped: false);
}

@include flow-theme.node($selectorless: false);
@include flow-theme.connector($scoped: false);
```

---

## auto-snap

Demo: https://flow.foblex.com/examples/auto-snap  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/connections/auto-snap

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="onLoaded()" (fCreateConnection)="addConnection($event)">
  <f-canvas fZoom>
    <f-connection-for-create fType="segment"></f-connection-for-create>
    <f-snap-connection [fSnapThreshold]="50" fType="segment"></f-snap-connection>

    @for (connection of connections; track connection.inputId)  {
      <f-connection [fReassignDisabled]="true" fType="segment"
                    [fOutputId]="connection.outputId" [fInputId]="connection.inputId">
      </f-connection>
    }

    <div fNode fDragHandle [fNodePosition]="{ x: 0, y: 24 }">
      <div fNodeOutput fOutputConnectableSide="top" class="top"></div>
      <div fNodeOutput fOutputConnectableSide="right" class="right"></div>
      <div fNodeOutput fOutputConnectableSide="bottom" class="bottom"></div>
      I'm a node
    </div>
    <div fNode fDragHandle [fNodePosition]="{ x: 300, y: 24 }">
      <div fNodeInput fInputConnectableSide="left" class="left"></div>
      <div fNodeInput fInputConnectableSide="top" class="top"></div>
      <div fNodeInput fInputConnectableSide="bottom" class="bottom"></div>
      I'm a node
    </div>

  </f-canvas>
</f-flow>
<example-toolbar>
  <button class="f-button primary" (click)="onDeleteConnections()">Delete Connections</button>
</example-toolbar>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ViewChild } from '@angular/core';
import { FCanvasComponent, FCreateConnectionEvent, FFlowModule, FZoomDirective } from '@foblex/flow';
import { ExampleToolbar } from '@foblex/portal-ui';

@Component({
  selector: 'auto-snap',
  styleUrls: [ './example.scss' ],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    FFlowModule,
    FZoomDirective,
    ExampleToolbar
  ]
})
export class Example {

  @ViewChild(FCanvasComponent, { static: true })
  public fCanvas!: FCanvasComponent;

  public connections: { outputId: string, inputId: string }[] = [];

  constructor(
    private changeDetectorRef: ChangeDetectorRef
  ) {
  }

  public addConnection(event: FCreateConnectionEvent): void {
    if(!event.fInputId) {
      return;
    }
    this.connections.push({ outputId: event.fOutputId, inputId: event.fInputId });
    this.changeDetectorRef.detectChanges();
  }

  public onLoaded(): void {
    this.fCanvas.resetScaleAndCenter(false);
  }

  public onDeleteConnections(): void {
    this.connections = [];
    this.changeDetectorRef.detectChanges();
  }
}
```

### Styles (`example.scss`)

```scss
@use '@foblex/flow/styles' as flow-theme;

::ng-deep {
  @include flow-theme.theme-tokens();
}

::ng-deep f-flow {
  @include flow-theme.connection($scoped: false);
}

@include flow-theme.node($selectorless: false);
@include flow-theme.connector($scoped: false);
```

---

## connection-behaviours

Demo: https://flow.foblex.com/examples/connection-behaviours  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/connections/connection-behaviours

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()">
  <f-canvas>
    <f-connection [fReassignDisabled]="true" fBehavior="fixed" fOutputId="1" fInputId="2">
      <div fConnectionContent align="along">fixed</div>
    </f-connection>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 0, y: 0 }"
      fNodeOutput
      fOutputId="1"
      fOutputConnectableSide="right"
    >
      I'm a node
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 300, y: 0 }"
      fNodeInput
      fInputId="2"
      fInputConnectableSide="left"
    >
      I'm a node
    </div>

    <f-connection [fReassignDisabled]="true" fBehavior="fixed_center" fOutputId="3" fInputId="4">
      <div fConnectionContent align="along">fixed_center</div>
    </f-connection>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 0, y: 150 }"
      fNodeOutput
      fOutputId="3"
      fOutputConnectableSide="right"
    >
      I'm a node
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 300, y: 150 }"
      fNodeInput
      fInputId="4"
      fInputConnectableSide="left"
    >
      I'm a node
    </div>

    <f-connection [fReassignDisabled]="true" fBehavior="floating" fOutputId="5" fInputId="6">
      <div fConnectionContent align="along">floating</div>
    </f-connection>

    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 0, y: 300 }"
      fNodeOutput
      fOutputId="5"
      fOutputConnectableSide="right"
    >
      I'm a node
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 300, y: 300 }"
      fNodeInput
      fInputId="6"
      fInputConnectableSide="left"
    >
      I'm a node
    </div>
  </f-canvas>
</f-flow>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { FCanvasComponent, FFlowModule } from '@foblex/flow';

@Component({
  selector: 'connection-behaviours',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule],
})
export class Example {
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected loaded(): void {
    this._canvas()?.resetScaleAndCenter(false);
  }
}
```

### Styles (`example.scss`)

```scss
@use '@foblex/flow/styles' as flow-theme;

::ng-deep {
  @include flow-theme.theme-tokens();
}

::ng-deep f-flow {
  @include flow-theme.connection($scoped: false);
}

.f-node {
  @include flow-theme.node($selectorless: true);
  opacity: 0.8;
}
```

---

## connection-connectable-side

Demo: https://flow.foblex.com/examples/connection-connectable-side  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/connections/connection-connectable-side

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()">
  <f-canvas>
    <f-connection
      fOutputId="1"
      fInputId="2"
      fBehavior="fixed"
      fType="bezier"
      [fOutputSide]="connection1SourceSide()"
      [fInputSide]="connection1TargetSide()"
    >
      <div fConnectionContent position="0.2" align="along">{{ connection1SourceSide()}}</div>
      <div fConnectionContent position="0.8" align="along">{{ connection1TargetSide()}}</div>
    </f-connection>
    <f-connection
      fOutputId="1"
      fInputId="3"
      fBehavior="fixed"
      fType="bezier"
      [fOutputSide]="connection2SourceSide()"
      [fInputSide]="connection2TargetSide()"
    >
      <div fConnectionContent position="0.2" align="along">{{ connection2SourceSide()}}</div>
      <div fConnectionContent position="0.8" align="along">{{ connection2TargetSide()}}</div>
    </f-connection>
    <f-connection
      fOutputId="1"
      fInputId="4"
      fBehavior="fixed"
      fType="bezier"
      [fOutputSide]="connection3SourceSide()"
      [fInputSide]="connection3TargetSide()"
    >
      <div fConnectionContent position="0.2" align="along">{{ connection3SourceSide()}}</div>
      <div fConnectionContent position="0.8" align="along">{{ connection3TargetSide()}}</div>
    </f-connection>

    <div fNode fDragHandle [fNodePosition]="{ x: 250, y: 0 }" fNodeOutput fOutputId="1">Node1</div>

    <div fNode fDragHandle [fNodePosition]="{ x: 0, y: 150 }" fNodeInput fInputId="2">Node2</div>
    <div fNode fDragHandle [fNodePosition]="{ x: 250, y: 300 }" fNodeInput fInputId="3">Node3</div>
    <div fNode fDragHandle [fNodePosition]="{ x: 500, y: 150 }" fNodeInput fInputId="4">Node4</div>
  </f-canvas>
</f-flow>
<example-toolbar>
  <button class="f-button primary" (click)="switchSides()" [disabled]="calculateSides()">
    Switch Sides
  </button>
</example-toolbar>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import {
  EFConnectionConnectableSide,
  FCanvasComponent,
  FConnectionContent,
  FFlowModule,
} from '@foblex/flow';
import { ExampleToolbar } from '@foblex/portal-ui';

@Component({
  selector: 'connectable-connectable-side',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, FConnectionContent, ExampleToolbar],
})
export class Example {
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected readonly calculateSides = signal(false);

  protected readonly connection1SourceSide = signal(EFConnectionConnectableSide.TOP);
  protected readonly connection1TargetSide = signal(EFConnectionConnectableSide.RIGHT);
  protected readonly connection2SourceSide = signal(EFConnectionConnectableSide.BOTTOM);
  protected readonly connection2TargetSide = signal(EFConnectionConnectableSide.LEFT);
  protected readonly connection3SourceSide = signal(EFConnectionConnectableSide.CALCULATE);
  protected readonly connection3TargetSide = signal(EFConnectionConnectableSide.CALCULATE_VERTICAL);

  protected loaded(): void {
    this._canvas()?.resetScaleAndCenter(false);
  }

  protected switchSides(): void {
    this.connection1SourceSide.update((x) => this._updateSide(x));
    this.connection1TargetSide.update((x) => this._updateSide(x));
    this.connection2SourceSide.update((x) => this._updateSide(x));
    this.connection2TargetSide.update((x) => this._updateSide(x));
    this.connection3SourceSide.update((x) => this._updateSide(x));
    this.connection3TargetSide.update((x) => this._updateSide(x));
  }

  private _updateSide(currentSide: EFConnectionConnectableSide): EFConnectionConnectableSide {
    const sides = Object.values(EFConnectionConnectableSide);
    const index = sides.indexOf(currentSide);

    return sides[(index + 1) % sides.length];
  }
}
```

### Styles (`example.scss`)

```scss
@use '@foblex/flow/styles' as flow-theme;

::ng-deep {
  @include flow-theme.theme-tokens();
}

::ng-deep f-flow {
  @include flow-theme.connection($scoped: false);
}

@include flow-theme.node($selectorless: false);
```

---

## connection-content

Demo: https://flow.foblex.com/examples/connection-content  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/connections/connection-content

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()">
  <f-canvas fZoom>
    <f-connection
      [fReassignDisabled]="true"
      fOutputId="1"
      fInputId="2"
      fBehavior="fixed"
      fType="segment"
    >
      <div fConnectionContent [position]="position()" [align]="align()" [offset]="offset()">
        Any Content
      </div>
    </f-connection>
    <f-connection
      [fReassignDisabled]="true"
      fOutputId="3"
      fInputId="4"
      fBehavior="fixed"
      fType="bezier"
    >
      <div fConnectionContent [position]="position()" [align]="align()" [offset]="offset()">
        Any Content
      </div>
    </f-connection>
    <f-connection
      [fReassignDisabled]="true"
      fOutputId="5"
      fInputId="6"
      fBehavior="fixed"
      fType="straight"
    >
      <div fConnectionContent [position]="position()" [align]="align()" [offset]="offset()">
        Any Content
      </div>
    </f-connection>
    <f-connection
      [fReassignDisabled]="true"
      fOutputId="7"
      fInputId="8"
      fBehavior="fixed"
      fType="adaptive-curve"
    >
      <div fConnectionContent [position]="position()" [align]="align()" [offset]="offset()">
        Any Content
      </div>
    </f-connection>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 0, y: 0 }"
      fNodeOutput
      fOutputId="1"
      fOutputConnectableSide="bottom"
    >
      Node 1
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 300, y: 0 }"
      fNodeInput
      fInputId="2"
      fInputConnectableSide="top"
    >
      Node 2
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 0, y: 150 }"
      fNodeOutput
      fOutputId="3"
      fOutputConnectableSide="bottom"
    >
      Node 3
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 300, y: 150 }"
      fNodeInput
      fInputId="4"
      fInputConnectableSide="top"
    >
      Node 4
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 0, y: 300 }"
      fNodeOutput
      fOutputId="5"
      fOutputConnectableSide="bottom"
    >
      Node 5
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 300, y: 300 }"
      fNodeInput
      fInputId="6"
      fInputConnectableSide="top"
    >
      Node 6
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 0, y: 450 }"
      fNodeOutput
      fOutputId="7"
      fOutputConnectableSide="bottom"
    >
      Node 7
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 300, y: 450 }"
      fNodeInput
      fInputId="8"
      fInputConnectableSide="top"
    >
      Node 8
    </div>
  </f-canvas>
</f-flow>
<example-toolbar>
  <example-select [(value)]="position" [options]="positions" label="Position" />
  <example-select [(value)]="align" [options]="aligns" label="Align" />
  <example-select [(value)]="offset" [options]="offsets" label="Offset" />
</example-toolbar>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, model, signal, viewChild } from '@angular/core';
import {
  PolylineContentAlign,
  FCanvasComponent,
  FConnectionContent,
  FFlowModule,
} from '@foblex/flow';
import { KeyValue } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ExampleSelect, ExampleToolbar } from '@foblex/portal-ui';

@Component({
  selector: 'connection-content',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, FConnectionContent, FormsModule, ExampleToolbar, ExampleSelect],
})
export class Example {
  protected readonly positions: KeyValue<number, string>[] = [
    { key: 0.1, value: '10%' },
    { key: 0.25, value: '25%' },
    { key: 0.3, value: '30%' },
    { key: 0.5, value: '50%' },
    { key: 0.75, value: '75%' },
    { key: 1, value: '100%' },
  ];
  protected readonly position = model<number>(0.5);

  protected readonly aligns: KeyValue<PolylineContentAlign, string>[] = [
    { key: PolylineContentAlign.NONE, value: 'None' },
    { key: PolylineContentAlign.ALONG, value: 'Along' },
  ];
  protected readonly align = model<PolylineContentAlign>(PolylineContentAlign.NONE);

  protected readonly offsets: KeyValue<number, string>[] = [
    { key: 0, value: '0px' },
    { key: -25, value: '-25px' },
    { key: 25, value: '25px' },
    { key: -50, value: '-50px' },
    { key: 50, value: '50px' },
  ];
  protected readonly offset = signal(0);

  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected loaded(): void {
    this._canvas()?.resetScaleAndCenter(false);
  }
}
```

### Styles (`example.scss`)

```scss
@use '@foblex/flow/styles' as flow-theme;

::ng-deep {
  @include flow-theme.theme-tokens();
}

::ng-deep f-flow {
  @include flow-theme.connection($scoped: false);
}

@include flow-theme.node($selectorless: false);
```

---

## connection-markers

Demo: https://flow.foblex.com/examples/connection-markers  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/connections/connection-markers

### Template (`example.html`)

```html
<f-flow fDraggable (fFullRendered)="loaded()">
  <f-canvas>
    <!-- Built-in markers are the quickest option when the default circle and arrow are enough. -->
    <f-connection [fReassignDisabled]="true" fOutputId="1" fInputId="2" fBehavior="floating">
      <f-connection-marker-circle [type]="eMarkerType.START_ALL_STATES" />
      <f-connection-marker-arrow [type]="eMarkerType.END_ALL_STATES" />
    </f-connection>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 0, y: 0 }"
      fNodeOutput
      fOutputId="1"
      fOutputConnectableSide="right"
    >
      I'm a node
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 300, y: 0 }"
      fNodeInput
      fInputId="2"
      fInputConnectableSide="left"
    >
      I'm a node
    </div>

    <!-- Use svg[fMarker] when marker geometry, viewBox, and dimensions must be fully custom. -->
    <f-connection [fReassignDisabled]="true" fOutputId="3" fInputId="4" fBehavior="floating">
      <svg
        viewBox="0 0 9 9"
        fMarker
        [type]="eMarkerType.START_ALL_STATES"
        class="connection-marker"
        [height]="9"
        [width]="9"
        [refX]="1.5"
        [refY]="4.2"
        markerUnits="strokeWidth"
      >
        <rect y="4.24219" width="6" height="6" transform="rotate(-45 0 4.24219)" />
      </svg>
      <svg
        viewBox="0 0 6 7"
        fMarker
        [type]="eMarkerType.END_ALL_STATES"
        class="connection-marker"
        [height]="7"
        [width]="6"
        [refX]="5.5"
        [refY]="3.5"
        markerUnits="strokeWidth"
        orient="auto"
      >
        <path d="M5.99961 7L0 3.5L5.99961 0V7Z" />
      </svg>
    </f-connection>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 0, y: 150 }"
      fNodeOutput
      fOutputId="3"
      fOutputConnectableSide="right"
    >
      I'm a node
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 300, y: 150 }"
      fNodeInput
      fInputId="4"
      fInputConnectableSide="left"
    >
      I'm a node
    </div>

    <!-- Define separate normal and selected markers only when selected connections need their own visuals. -->
    <f-connection [fReassignDisabled]="true" fOutputId="5" fInputId="6" fBehavior="floating">
      <svg
        viewBox="0 0 6 7"
        fMarker
        [type]="eMarkerType.START"
        class="connection-marker"
        [height]="7"
        [width]="6"
        [refX]="0.5"
        [refY]="3.5"
        markerUnits="strokeWidth"
        orient="auto"
      >
        <path d="M0.000391006 0L6 3.5L0.000391006 7L0.000391006 0Z" />
      </svg>
      <svg
        viewBox="0 0 6 7"
        fMarker
        [type]="eMarkerType.SELECTED_START"
        class="connection-marker"
        [height]="7"
        [width]="6"
        [refX]="0.5"
        [refY]="3.5"
        markerUnits="strokeWidth"
        orient="auto"
      >
        <path d="M0.000391006 0L6 3.5L0.000391006 7L0.000391006 0Z" />
      </svg>
      <svg
        viewBox="0 0 6 7"
        fMarker
        [type]="eMarkerType.END"
        class="connection-marker"
        [height]="7"
        [width]="6"
        [refX]="5.5"
        [refY]="3.5"
        markerUnits="strokeWidth"
        orient="auto"
      >
        <path d="M0.000391006 0L6 3.5L0.000391006 7L0.000391006 0Z" />
      </svg>
      <svg
        viewBox="0 0 6 7"
        fMarker
        [type]="eMarkerType.SELECTED_END"
        class="connection-marker"
        [height]="7"
        [width]="6"
        [refX]="5.5"
        [refY]="3.5"
        markerUnits="strokeWidth"
        orient="auto"
      >
        <path d="M0.000391006 0L6 3.5L0.000391006 7L0.000391006 0Z" />
      </svg>
    </f-connection>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 0, y: 300 }"
      fNodeOutput
      fOutputId="5"
      fOutputConnectableSide="right"
    >
      I'm a node
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 300, y: 300 }"
      fNodeInput
      fInputId="6"
      fInputConnectableSide="left"
    >
      I'm a node
    </div>
  </f-canvas>
</f-flow>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { EFMarkerType, FCanvasComponent, FFlowModule } from '@foblex/flow';

@Component({
  selector: 'connection-markers',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule],
})
export class Example {
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected readonly eMarkerType = EFMarkerType;

  // Wait for the full render so the animated viewport reset runs
  // after both nodes and connection paths are ready.
  protected loaded(): void {
    this._canvas()?.resetScaleAndCenter(true);
  }
}
```

### Styles (`example.scss`)

```scss
@use '@foblex/flow/styles' as flow-theme;

::ng-deep {
  @include flow-theme.theme-tokens();
}

::ng-deep f-flow {
  @include flow-theme.connection($scoped: false);
  @include flow-theme.connection-markers($scoped: false);
}

@include flow-theme.node($selectorless: false);
```

---

## connection-types

Demo: https://flow.foblex.com/examples/connection-types  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/connections/connection-types

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()">
  <f-canvas>
    <f-connection [fReassignDisabled]="true" fType="straight" fOutputId="1" fInputId="2"/>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 0, y: 0 }"
      fNodeOutput
      fOutputId="1"
      fOutputConnectableSide="right"
    >
      Node
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 200, y: 50 }"
      fNodeInput
      fInputId="2"
      fInputConnectableSide="left"
    >
      Node
    </div>

    <f-connection [fReassignDisabled]="true" fType="segment" fOutputId="3" fInputId="4"/>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 0, y: 150 }"
      fNodeOutput
      fOutputId="3"
      fOutputConnectableSide="right"
    >
      Node
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 200, y: 200 }"
      fNodeInput
      fInputId="4"
      fInputConnectableSide="left"
    >
      Node
    </div>

    <f-connection [fReassignDisabled]="true" fType="bezier" fOutputId="5" fInputId="6"/>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 0, y: 300 }"
      fNodeOutput
      fOutputId="5"
      fOutputConnectableSide="right"
    >
      Node
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 200, y: 350 }"
      fNodeInput
      fInputId="6"
      fInputConnectableSide="left"
    >
      Node
    </div>

    <f-connection [fReassignDisabled]="true" fType="adaptive-curve" fOutputId="7" fInputId="8"/>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 0, y: 450 }"
      fNodeOutput
      fOutputId="7"
      fOutputConnectableSide="right"
    >
      Node
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 200, y: 500 }"
      fNodeInput
      fInputId="8"
      fInputConnectableSide="left"
    >
      Node
    </div>
  </f-canvas>
</f-flow>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { FCanvasComponent, FFlowModule } from '@foblex/flow';

@Component({
  selector: 'connection-types',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule],
})
export class Example {
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected loaded(): void {
    this._canvas()?.resetScaleAndCenter(false);
  }
}
```

### Styles (`example.scss`)

```scss
@use '@foblex/flow/styles' as flow-theme;

::ng-deep {
  @include flow-theme.theme-tokens();
}

::ng-deep f-flow {
  @include flow-theme.connection($scoped: false);
}

@include flow-theme.node($selectorless: false);
```

---

## connection-waypoints

Demo: https://flow.foblex.com/examples/connection-waypoints  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/connections/connection-waypoints

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()" (fConnectionWaypointsChanged)="changed($event)">
  <f-canvas>
    <f-connection [fReassignDisabled]="true" fType="straight" fOutputId="1" fInputId="2">
      @if (waypointsOn()) {
        <f-connection-waypoints [(waypoints)]="waypointsStraight" radius="8" [visibility]="waypointsVisibility()"/>
      }
    </f-connection>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: -150, y: 0 }"
      fNodeOutput
      fOutputId="1"
      fOutputConnectableSide="right"
    >
      Node
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 200, y: 0 }"
      fNodeInput
      fInputId="2"
      fInputConnectableSide="left"
    >
      Node
    </div>

    <f-connection [fReassignDisabled]="true" fType="segment" fOutputId="3" fInputId="4">
      @if (waypointsOn()) {
        <f-connection-waypoints [(waypoints)]="waypointsSegment" radius="4" [visibility]="waypointsVisibility()"/>
      }
    </f-connection>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: -150, y: 150 }"
      fNodeOutput
      fOutputId="3"
      fOutputConnectableSide="right"
    >
      Node
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 250, y: 200 }"
      fNodeInput
      fInputId="4"
      fInputConnectableSide="left"
    >
      Node
    </div>

    <f-connection [fReassignDisabled]="true" fType="bezier" fOutputId="5" fInputId="6">
      @if (waypointsOn()) {
        <f-connection-waypoints [(waypoints)]="waypointsBezier" radius="6" [visibility]="waypointsVisibility()"/>
      }
    </f-connection>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: -150, y: 300 }"
      fNodeOutput
      fOutputId="5"
      fOutputConnectableSide="right"
    >
      Node
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 200, y: 350 }"
      fNodeInput
      fInputId="6"
      fInputConnectableSide="left"
    >
      Node
    </div>

    <f-connection [fReassignDisabled]="true" fType="adaptive-curve" fOutputId="7" fInputId="8">
      @if (waypointsOn()) {
        <f-connection-waypoints [(waypoints)]="waypointsAdaptiveCurve" [visibility]="waypointsVisibility()"/>
      }
    </f-connection>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: -150, y: 450 }"
      fNodeOutput
      fOutputId="7"
      fOutputConnectableSide="right"
    >
      Node
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 250, y: 500 }"
      fNodeInput
      fInputId="8"
      fInputConnectableSide="left"
    >
      Node
    </div>
  </f-canvas>
</f-flow>

<example-toolbar>
  <f-checkbox (change)="toggleWaypointsVisibility()" [checked]="waypointsVisibility()">
    Show waypoints
  </f-checkbox>
  <f-checkbox (change)="toggleWaypointsOn()" [checked]="waypointsOn()">
    Enable waypoints
  </f-checkbox>
</example-toolbar>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { FCanvasComponent, FConnectionWaypointsChangedEvent, FFlowModule } from '@foblex/flow';
import { FCheckboxComponent } from '@foblex/m-render';
import { ExampleToolbar } from '@foblex/portal-ui';

@Component({
  selector: 'connection-waypoints',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, FCheckboxComponent, ExampleToolbar],
})
export class Example {
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected waypointsStraight = [
    { x: 50, y: 60 },
    { x: 100, y: 0 },
    { x: 150, y: 30 },
  ];
  protected waypointsSegment = [
    { x: 120, y: 100 },
    { x: 300, y: 150 },
  ];
  protected waypointsBezier = [
    { x: 50, y: 350 },
    { x: 100, y: 400 },
    { x: 150, y: 350 },
  ];
  protected waypointsAdaptiveCurve = [
    { x: 50, y: 450 },
    { x: 100, y: 500 },
    { x: 150, y: 550 },
    { x: 200, y: 500 },
  ];

  protected readonly waypointsVisibility = signal(true);
  protected readonly waypointsOn = signal(true);

  protected loaded(): void {
    this._canvas()?.fitToScreen({ x: 100, y: 100 }, false);
  }

  protected changed({ connectionId, waypoints }: FConnectionWaypointsChangedEvent): void {
    console.log('Connection waypoints changed', connectionId, waypoints);
  }

  protected toggleWaypointsVisibility(): void {
    this.waypointsVisibility.update((x) => !x);
  }

  protected toggleWaypointsOn(): void {
    this.waypointsOn.update((x) => !x);
  }
}
```

### Styles (`example.scss`)

```scss
@use '@foblex/flow/styles' as flow-theme;

::ng-deep {
  @include flow-theme.theme-tokens();
}

::ng-deep f-flow {
  @include flow-theme.connection($scoped: false);
  @include flow-theme.connection-waypoints($scoped: false);
}

@include flow-theme.node($selectorless: false);
```

---

## create-node-on-connection-drop

Demo: https://flow.foblex.com/examples/create-node-on-connection-drop  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/connections/create-node-on-connection-drop

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="onLoaded()" (fCreateConnection)="onConnectionDropped($event)">
  <f-canvas>
    <f-connection-for-create></f-connection-for-create>

    @for (connection of connections; track connection.inputId)  {
      <f-connection [fReassignDisabled]="true"
                    fBehavior="floating"
                    [fOutputId]="connection.outputId" [fInputId]="connection.inputId">
      </f-connection>
    }

    <div fNode fDragHandle [fNodePosition]="{ x: 24, y: 24 }">
      I'm a node
      <div fNodeOutput fOutputConnectableSide="left" [fOutputMultiple]="true" class="left"></div>
      <div fNodeOutput fOutputConnectableSide="top" [fOutputMultiple]="true" class="top"></div>
      <div fNodeOutput fOutputConnectableSide="right" [fOutputMultiple]="true" class="right"></div>
      <div fNodeOutput fOutputConnectableSide="bottom" [fOutputMultiple]="true" class="bottom"></div>
    </div>

    @for (node of nodes; track node.id) {
      <div fNode fDragHandle [fNodePosition]="node.position"
           fNodeInput [fInputId]="node.id" fInputConnectableSide="left">
        I'm a node
      </div>
    }

  </f-canvas>
</f-flow>
<example-toolbar>
  <button class="f-button primary" (click)="onDeleteConnections()">Delete Connections</button>
</example-toolbar>
```

### Component (`example.ts`)

```ts
import {ChangeDetectionStrategy, ChangeDetectorRef, Component, viewChild, ViewChild} from '@angular/core';
import { FCanvasComponent, FCreateConnectionEvent, FFlowComponent, FFlowModule } from '@foblex/flow';
import { IPoint } from '@foblex/2d';
import { generateGuid } from '@foblex/utils';
import { ExampleToolbar } from '@foblex/portal-ui';

//This example demonstrates how to create a new node in position where a connection was dropped.
@Component({
  selector: 'create-node-on-connection-drop',
  styleUrls: [ './example.scss' ],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    FFlowModule,
    ExampleToolbar
  ]
})
export class Example {

  private readonly _canvas = viewChild.required(FCanvasComponent);
  private readonly _flow = viewChild.required(FFlowComponent);

  public connections: { outputId: string, inputId: string }[] = [];

  public nodes: { id: string, position: IPoint }[] = [];

  constructor(
    private changeDetectorRef: ChangeDetectorRef
  ) {
  }

  public onConnectionDropped(event: FCreateConnectionEvent): void {
    if(!event.fInputId) {
      this.createNode(event.fOutputId, event.fDropPosition);
    } else {
      this.createConnection(event.fOutputId, event.fInputId);
    }
    this.changeDetectorRef.detectChanges();
  }

  private createNode(outputId: string, position: IPoint): void {
    this.nodes.push({ id: generateGuid(), position: this._flow().getPositionInFlow(position) });
    this.createConnection(outputId, this.nodes[this.nodes.length - 1].id);
  }

  private createConnection(outputId: string, inputId: string): void {
    this.connections.push({ outputId: outputId, inputId: inputId });
  }

  public onDeleteConnections(): void {
    this.connections = [];
    this.changeDetectorRef.detectChanges();
  }

  public onLoaded(): void {
    this._canvas().resetScaleAndCenter(false);
  }
}
```

### Styles (`example.scss`)

```scss
@use '@foblex/flow/styles' as flow-theme;

::ng-deep {
  @include flow-theme.theme-tokens();
}

::ng-deep f-flow {
  @include flow-theme.connection($scoped: false);
}

@include flow-theme.node($selectorless: false);
@include flow-theme.connector($scoped: false);
```

---

## custom-connection-type

Demo: https://flow.foblex.com/examples/custom-connection-type  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/connections/custom-connection-type

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="onLoaded()">
  <f-canvas>
    <f-connection [fReassignDisabled]="true" fType="offset_straight" fOutputId="1" fInputId="2">
    </f-connection>
    <div fNode fDragHandle [fNodePosition]="{ x: 0, y: 0 }" fNodeOutput fOutputId="1" fOutputConnectableSide="right">
      I'm a node
    </div>
    <div fNode fDragHandle [fNodePosition]="{ x: 200, y: 50 }" fNodeInput fInputId="2" fInputConnectableSide="left">
      I'm a node
    </div>

    <f-connection [fReassignDisabled]="true" fType="circle" fOutputId="3" fInputId="4">
    </f-connection>
    <div fNode fDragHandle [fNodePosition]="{ x: 0, y: 150 }" fNodeOutput fOutputId="3" fOutputConnectableSide="right">
      I'm a node
    </div>
    <div fNode fDragHandle [fNodePosition]="{ x: 200, y: 200 }" fNodeInput fInputId="4" fInputConnectableSide="left">
      I'm a node
    </div>
  </f-canvas>
</f-flow>
```

### Component (`example.ts`)

```ts
// eslint-disable-next-line max-classes-per-file
import { ChangeDetectionStrategy, Component, ViewChild } from '@angular/core';
import {
  F_CONNECTION_BUILDERS,
  FCanvasComponent,
  FFlowModule,
  IFConnectionBuilder,
  IFConnectionBuilderRequest,
  IFConnectionBuilderResponse,
} from '@foblex/flow';
import { IPoint, PointExtensions } from '@foblex/2d';

class OffsetStraightBuilder implements IFConnectionBuilder {
  public handle(request: IFConnectionBuilderRequest): IFConnectionBuilderResponse {
    const { source, target } = request;
    const path = `M ${source.x} ${source.y} L ${source.x + 20} ${source.y} L ${target.x - 20} ${target.y} L ${target.x} ${target.y}`;

    return {
      path,
      penultimatePoint: PointExtensions.initialize(target.x - 20, target.y),
      secondPoint: PointExtensions.initialize(source.x + 20, source.y),
      points: [
        source,
        PointExtensions.initialize(source.x + 20, source.y),
        PointExtensions.initialize(target.x - 20, target.y),
        target,
      ],
      candidates: [],
    };
  }
}

class CircleConnectionBuilder implements IFConnectionBuilder {
  public handle(request: IFConnectionBuilderRequest): IFConnectionBuilderResponse {
    const { source, target } = request;
    const d = this._getD(request);
    const path = `M ${source.x} ${source.y} S${d.x} ${d.y} ${target.x} ${target.y}`;

    return {
      path,
      penultimatePoint: d,
      secondPoint: d,
      points: [source, d, target],
      candidates: [],
    };
  }

  private _getD(request: IFConnectionBuilderRequest): IPoint {
    const offset: number = request.offset;
    const cx: number = (request.source.x + request.radius + request.target.x) / 2;
    const cy: number = (request.source.y + request.radius + request.target.y) / 2;
    const dx: number =
      cx +
        (offset * (request.source.y - request.target.y)) /
          Math.sqrt(
            Math.pow(request.source.x - request.target.x, 2) +
              Math.pow(request.source.y - request.target.y, 2),
          ) || cx;
    const dy: number =
      cy -
        (offset * (request.source.x - request.target.x)) /
          Math.sqrt(
            Math.pow(request.source.x - request.target.x, 2) +
              Math.pow(request.source.y - request.target.y, 2),
          ) || cy;

    return { x: dx, y: dy };
  }
}

const connectionBuilders = {
  ['offset_straight']: new OffsetStraightBuilder(),
  ['circle']: new CircleConnectionBuilder(),
};

@Component({
  selector: 'custom-connection-type',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  providers: [{ provide: F_CONNECTION_BUILDERS, useValue: connectionBuilders }],
  imports: [FFlowModule],
})
export class Example {
  @ViewChild(FCanvasComponent, { static: true })
  public fCanvas!: FCanvasComponent;

  public onLoaded(): void {
    this.fCanvas.resetScaleAndCenter(false);
  }
}
```

### Styles (`example.scss`)

```scss
@use '@foblex/flow/styles' as flow-theme;

::ng-deep {
  @include flow-theme.theme-tokens();
}

::ng-deep f-flow {
  @include flow-theme.connection($scoped: false);
}

@include flow-theme.node($selectorless: false);
```

---

## custom-connections

Demo: https://flow.foblex.com/examples/custom-connections  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/connections/custom-connections

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="onLoaded()">
  <f-canvas>
    <f-connection
      [fReassignDisabled]="true"
      fOutputId="1"
      fInputId="2"
      fBehavior="fixed"
      fType="segment"
    >
      <f-connection-gradient [fStartColor]="startColor()" [fEndColor]="endColor()" />
    </f-connection>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 0, y: 0 }"
      fNodeOutput
      fOutputId="1"
      fOutputConnectableSide="bottom"
    >
      I'm a node
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 300, y: 0 }"
      fNodeInput
      fInputId="2"
      fInputConnectableSide="top"
    >
      I'm a node
    </div>

    <f-connection [fReassignDisabled]="true" fOutputId="3" fInputId="4" fBehavior="floating" />
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 0, y: 150 }"
      fNodeOutput
      fOutputId="3"
      fOutputConnectableSide="right"
    >
      I'm a node
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 300, y: 150 }"
      fNodeInput
      fInputId="4"
      fInputConnectableSide="left"
    >
      I'm a node
    </div>
  </f-canvas>
</f-flow>

<example-toolbar>
  <example-select [(value)]="startColor" [options]="colorOptions" label="Gradient Start" />
  <example-select [(value)]="endColor" [options]="colorOptions" label="Gradient End" />
</example-toolbar>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { FCanvasComponent, FFlowModule } from '@foblex/flow';
import { ExampleSelect, ExampleToolbar } from '@foblex/portal-ui';
import { KeyValue } from '@angular/common';

@Component({
  selector: 'connection-gradients',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, ExampleToolbar, ExampleSelect],
})
export class Example {
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected readonly colorOptions: KeyValue<string, string>[] = [
    { value: 'Red', key: '#ef4444' },
    { value: 'Green', key: '#22c55e' },
    { value: 'Sky', key: '#0ea5e9' },
    { value: 'Amber', key: '#f59e0b' },
    { value: 'Rose', key: '#e11d48' },
    { value: 'Violet', key: '#7c3aed' },
    { value: 'Slate', key: '#334155' },
  ];

  protected readonly startColor = signal(this.colorOptions[0].key);

  protected readonly endColor = signal(this.colorOptions[1].key);

  protected onLoaded(): void {
    this._canvas().resetScaleAndCenter(false);
  }
}
```

### Styles (`example.scss`)

```scss
@use '@foblex/flow/styles' as flow-theme;

::ng-deep {
  @include flow-theme.theme-tokens();
}

::ng-deep f-flow {
  @include flow-theme.connection($scoped: false);
  .f-connection {
    .f-connection-selection {
      stroke-width: 20;
    }

    .f-connection-path {
      stroke-width: 6;
    }

    &:not(.gradient-color) {
      .f-connection-path {
        stroke: #db2777;
      }
    }

    &:hover {
      .f-connection-selection {
        stroke: var(--ff-node-border-color);
      }
    }
  }
}

@include flow-theme.node($selectorless: false);
```

---

## drag-to-connect

Demo: https://flow.foblex.com/examples/drag-to-connect  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/connections/drag-to-connect

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()" (fCreateConnection)="createConnection($event)">
  <f-canvas>
    <f-connection-for-create/>

    @for (connection of connections(); track $index) {
      <f-connection
        [fReassignDisabled]="true"
        [fOutputId]="connection.source"
        [fInputId]="connection.target"
      />
    }

    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 24, y: 24 }"
      fNodeOutput
      fOutputConnectableSide="right"
    >
      drag me
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 244, y: 24 }"
      fNodeInput
      fInputConnectableSide="left"
    >
      to me
    </div>
  </f-canvas>
</f-flow>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { FCanvasComponent, FCreateConnectionEvent, FFlowModule } from '@foblex/flow';

@Component({
  selector: 'drag-to-connect',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule],
})
export class Example {
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected readonly connections = signal<{ source: string; target: string }[]>([]);

  protected createConnection(event: FCreateConnectionEvent): void {
    const target = event.fInputId;
    if (!target) {
      return;
    }
    this.connections.update((x) => [...x, { source: event.fOutputId, target }]);
  }

  protected loaded(): void {
    this._canvas()?.resetScaleAndCenter(false);
  }
}
```

### Styles (`example.scss`)

```scss
@use '@foblex/flow/styles' as flow-theme;

::ng-deep {
  @include flow-theme.theme-tokens();
}

::ng-deep f-flow {
  @include flow-theme.connection($scoped: false);
}

@include flow-theme.node($selectorless: false);
```

---

## drag-to-reassign

Demo: https://flow.foblex.com/examples/drag-to-reassign  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/connections/drag-to-reassign

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()" (fReassignConnection)="reassignConnection($event)">
  <f-canvas>
    @for (connection of connections(); track connection.id) {
    <f-connection
      fBehavior="floating"
      [fReassignableStart]="reassignableStart()"
      [fConnectionId]="connection.id"
      [fOutputId]="connection.source"
      [fInputId]="connection.target"
    />
    }

    <div fNode fDragHandle [fNodePosition]="{ x: 0, y: 0 }" fNodeOutput fOutputId="1">Output</div>
    <div fNode fDragHandle [fNodePosition]="{ x: 0, y: 150 }" fNodeOutput fOutputId="2">Output</div>
    <div fNode fDragHandle [fNodePosition]="{ x: 250, y: 0 }" fNodeInput fInputId="3">Input</div>
    <div fNode fDragHandle [fNodePosition]="{ x: 250, y: 150 }" fNodeInput fInputId="4">Input</div>
  </f-canvas>
</f-flow>

<example-toolbar>
  <f-checkbox (change)="reassignStartChange()" [checked]="reassignableStart()">
    Enable Reassign Start
  </f-checkbox>
</example-toolbar>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { FCanvasComponent, FFlowModule, FReassignConnectionEvent } from '@foblex/flow';
import { FCheckboxComponent } from '@foblex/m-render';
import { ExampleToolbar } from '@foblex/portal-ui';

@Component({
  selector: 'drag-to-reassign',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, FCheckboxComponent, ExampleToolbar],
})
export class Example {
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected readonly reassignableStart = signal(false);
  protected readonly connections = signal([{ id: '1', source: '1', target: '3' }]);

  protected loaded(): void {
    this._canvas()?.resetScaleAndCenter(false);
  }

  protected reassignConnection(event: FReassignConnectionEvent): void {
    if (!event.newTargetId && !event.newSourceId) {
      return;
    }
    this.connections.update((x) => {
      const connection = x.find(
        (c) => c.source === event.oldSourceId && c.target === event.oldTargetId,
      );
      if (!connection) {
        throw new Error('Connection not found');
      }
      connection.source = event.newSourceId || connection.source;
      connection.target = event.newTargetId || connection.target;

      return [...x];
    });
  }

  protected reassignStartChange(): void {
    this.reassignableStart.update((x) => !x);
  }
}
```

### Styles (`example.scss`)

```scss
@use '@foblex/flow/styles' as flow-theme;

::ng-deep {
  @include flow-theme.theme-tokens();
}

::ng-deep f-flow {
  @include flow-theme.connection($scoped: false);
  @include flow-theme.connection-drag-handles-visible($scoped: false);
}

@include flow-theme.node($selectorless: false);
```

---

## remove-connection-on-drop

Demo: https://flow.foblex.com/examples/remove-connection-on-drop  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/connections/remove-connection-on-drop

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="onLoaded()" (fReassignConnection)="onConnectionDropped($event)">
  <f-canvas>
    @for (connection of connections; track connection.inputId)  {
      <f-connection [fReassignDisabled]="false"
                    fBehavior="floating"
                    [fOutputId]="connection.outputId" [fInputId]="connection.inputId">
      </f-connection>
    }

    @for (node of nodes; track node.id) {
      <div fNode fDragHandle [fNodePosition]="node.position"
           fNodeOutput [fOutputId]="node.id"
           fNodeInput [fInputId]="node.id">
        I'm a node
      </div>
    }
  </f-canvas>
</f-flow>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, inject, ViewChild } from '@angular/core';
import {
  FCanvasComponent,
  FFlowComponent,
  FFlowModule,
  FReassignConnectionEvent
} from '@foblex/flow';
import { IPoint } from '@foblex/2d';

@Component({
  selector: 'remove-connection-on-drop',
  styleUrls: [ './example.scss' ],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    FFlowModule
  ]
})
export class Example {

  private _elementReference = inject(ElementRef);
  private _changeDetectorRef = inject(ChangeDetectorRef);

  @ViewChild(FCanvasComponent, { static: true })
  public fCanvas!: FCanvasComponent;

  @ViewChild(FFlowComponent, { static: true })
  public fFlowComponent!: FFlowComponent;

  public nodes: { id: string, position: IPoint }[] = [{
    id: '1',
    position: { x: 0, y: 0 }
  }, {
    id: '2',
    position: { x: 200, y: 100 }
  }, {
    id: '3',
    position: { x: 400, y: 100 }
  }];

  public connections: { outputId: string, inputId: string }[] = [
    { outputId: this.nodes[0].id, inputId: this.nodes[1].id },
    { outputId: this.nodes[1].id, inputId: this.nodes[2].id }
  ];

  public onConnectionDropped(event: FReassignConnectionEvent): void {
    if (!event.newTargetId) {
      this.removeConnection(event);
    } else {
      this.reassignConnection(event);
    }
    this._changeDetectorRef.detectChanges();
  }

  private removeConnection(event: FReassignConnectionEvent): void {
    const connectionIndex = this.findConnectionIndex(event.oldSourceId, event.oldTargetId);
    if (connectionIndex === -1) {
      throw new Error('Connection not found');
    }
    this.connections.splice(connectionIndex, 1);
  }

  private findConnectionIndex(outputId: string, inputId: string): number {
    return this.connections.findIndex(x => x.outputId === outputId && x.inputId === inputId);
  }

  private reassignConnection(event: FReassignConnectionEvent): void {
    this.removeConnection(event);
    this.connections.push({ outputId: event.oldSourceId, inputId: event.newTargetId! });
  }

  public onLoaded(): void {
    this.fCanvas.resetScaleAndCenter(false);
  }
}
```

### Styles (`example.scss`)

```scss
@use '@foblex/flow/styles' as flow-theme;

::ng-deep {
  @include flow-theme.theme-tokens();
}

::ng-deep f-flow {
  @include flow-theme.connection($scoped: false);
  @include flow-theme.connection-drag-handles-visible($scoped: false);
}

@include flow-theme.node($selectorless: false);
@include flow-theme.connector($scoped: false);
```

---
