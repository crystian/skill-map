# Examples — Connectors

Input/output connector composition and validation. Covers `fNodeInput` / `fNodeOutput`, `fOutputConnectableSide` / `fInputConnectableSide`, `fCanBeConnectedInputs`, and connector outlets.

Every example below is a verbatim copy of the official Foblex Flow example at `libs/f-examples/connectors/<name>/` in the upstream repo. Prefer the upstream links when in doubt.

---

## connectable-side

Demo: https://flow.foblex.com/examples/connectable-side  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/connectors/connectable-side

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()">
  <f-canvas>
    <f-connection fOutputId="1" fInputId="2" fBehavior="fixed" fType="segment" />
    <f-connection fOutputId="1" fInputId="3" fBehavior="fixed" fType="segment" />
    <f-connection fOutputId="1" fInputId="4" fBehavior="fixed" fType="segment" />

    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 250, y: 0 }"
      fNodeOutput
      fOutputId="1"
      [fOutputConnectableSide]="node1Side()"
    >
      <b>{{ node1Side() }}</b> connectable side
    </div>

    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 0, y: 150 }"
      fNodeInput
      fInputId="2"
      [fInputConnectableSide]="node2Side()"
    >
      <b>{{ node2Side() }}</b> connectable side
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 250, y: 300 }"
      fNodeInput
      fInputId="3"
      [fInputConnectableSide]="node3Side()"
    >
      <b>{{ node3Side() }}</b> connectable side
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 500, y: 150 }"
      fNodeInput
      fInputId="4"
      [fInputConnectableSide]="node4Side()"
    >
      <b>{{ node4Side() }}</b> connectable side
    </div>
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
import { EFConnectableSide, FCanvasComponent, FFlowModule } from '@foblex/flow';
import { ExampleToolbar } from '@foblex/portal-ui';

@Component({
  selector: 'connectable-side',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, ExampleToolbar],
})
export class Example {
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected readonly calculateSides = signal(false);

  protected readonly node1Side = signal(EFConnectableSide.CALCULATE);
  protected readonly node2Side = signal(EFConnectableSide.TOP);
  protected readonly node3Side = signal(EFConnectableSide.RIGHT);
  protected readonly node4Side = signal(EFConnectableSide.BOTTOM);

  protected loaded(): void {
    this._canvas()?.resetScaleAndCenter(false);
  }

  protected switchSides(): void {
    this.node1Side.update((x) => this._updateSide(x));
    this.node2Side.update((x) => this._updateSide(x));
    this.node3Side.update((x) => this._updateSide(x));
    this.node4Side.update((x) => this._updateSide(x));
  }

  private _updateSide(currentSide: EFConnectableSide): EFConnectableSide {
    const sides = Object.values(EFConnectableSide);
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

.f-node {
  @include flow-theme.node($selectorless: true);
  width: 200px;
}
```

---

## connection-rules

Demo: https://flow.foblex.com/examples/connection-rules  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/connectors/connection-rules

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()" (fCreateConnection)="createConnection($event)">
  <f-canvas>
    <f-connection-for-create fBehavior="floating" />

    @for (connection of connections(); track connection.to) {
    <f-connection
      [fReassignDisabled]="true"
      [fOutputId]="connection.from"
      [fInputId]="connection.to"
      fBehavior="floating"
    />
    }

    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 0, y: 150 }"
      fNodeOutput
      [fOutputMultiple]="true"
      [fCanBeConnectedInputs]="[category(), input()]"
    >
      Node
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 250, y: 0 }"
      fNodeInput
      fInputId="input1"
      fInputCategory="A"
    >
      Node 1 Category A
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 250, y: 150 }"
      fNodeInput
      fInputId="input2"
      fInputCategory="B"
    >
      Node 2 Category B
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 250, y: 300 }"
      fNodeInput
      fInputId="input3"
      fInputCategory="C"
    >
      Node 3 Category C
    </div>
  </f-canvas>
</f-flow>
<example-toolbar>
  <example-select [(value)]="input" [options]="inputs()" label="Can be connected to Input" />
  <example-select
    [(value)]="category"
    [options]="categories()"
    label="Can be connected to Category"
  />
  <button class="f-button primary" (click)="deleteConnections()">Delete Connections</button>
</example-toolbar>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, model, signal, viewChild } from '@angular/core';
import { FCanvasComponent, FCreateConnectionEvent, FFlowModule } from '@foblex/flow';
import { ExampleSelect, ExampleToolbar } from '@foblex/portal-ui';

@Component({
  selector: 'connection-rules',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, ExampleToolbar, ExampleSelect],
})
export class Example {
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected readonly connections = signal<{ from: string; to: string }[]>([]);

  protected readonly categories = signal(['A', 'B', 'C']);
  protected readonly category = model('A');

  protected readonly inputs = signal(['input1', 'input2', 'input3']);
  protected readonly input = model('input1');

  protected loaded(): void {
    this._canvas()?.resetScaleAndCenter(false);
  }

  protected createConnection(event: FCreateConnectionEvent): void {
    if (!event.targetId) {
      return;
    }
    this.connections().push({ from: event.sourceId, to: event.targetId });
  }

  protected deleteConnections(): void {
    this.connections.set([]);
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

.f-connections-dragging {
  .f-node-input {
    &:not(.f-connector-connectable) {
      background-color: var(--ff-connector-disabled-color);
    }
  }
}
```

---

## connector-inside-node

Demo: https://flow.foblex.com/examples/connector-inside-node  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/connectors/connector-inside-node

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="onLoaded()">
  <f-canvas>

    <f-connection [fReassignDisabled]="true"
                  fOutputId="fOutput1" fInputId="fInput2"
                  fBehavior="floating">
    </f-connection>

    <f-connection [fReassignDisabled]="true"
                  fOutputId="fOutput2" fInputId="fInput3"
                  fBehavior="floating">
    </f-connection>

    <f-connection [fReassignDisabled]="true"
                  fOutputId="fOutput3" fInputId="fInput4"
                  fBehavior="floating">
    </f-connection>


    <f-connection [fReassignDisabled]="true"
                  fOutputId="fOutput4" fInputId="fInput1"
                  fBehavior="floating">
    </f-connection>

    <div fNode fDragHandle [fNodePosition]="{ x: 0, y: 0 }">
      I'm node
      <div fNodeOutput fOutputId="fOutput1" class="right"></div>
      <div fNodeInput fInputId="fInput1" class="left"></div>
    </div>

    <div fNode fDragHandle [fNodePosition]="{ x: 200, y: 0 }" >
      I'm node
      <div fNodeOutput fOutputId="fOutput2" class="right"></div>
      <div fNodeInput fInputId="fInput2" class="left"></div>
    </div>

    <div fNode fDragHandle [fNodePosition]="{ x: 400, y: 0 }">
      I'm node
      <div fNodeOutput fOutputId="fOutput3" class="bottom"></div>
      <div fNodeInput fInputId="fInput3" class="top"></div>
    </div>

    <div fNode fDragHandle [fNodePosition]="{ x: 200, y: 200 }" fNodeOutput fOutputId="fOutput4">
      I'm node with host connector
      <div fNodeInput fInputId="fInput4" class="top"></div>
    </div>
  </f-canvas>
</f-flow>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, ViewChild } from '@angular/core';
import { FCanvasComponent, FFlowModule } from '@foblex/flow';

@Component({
  selector: 'connector-inside-node',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
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
@include flow-theme.connector($scoped: false);
```

---

## connector-outlet

Demo: https://flow.foblex.com/examples/connector-outlet  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/connectors/connector-outlet

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="onLoaded()" (fCreateConnection)="onCreateConnection($event)">
  <f-canvas>
    <f-connection-for-create fBehavior="floating"></f-connection-for-create>

    @for (connection of connections; track connection.to) {
      <f-connection [fReassignDisabled]="true"
                    [fOutputId]="connection.from" [fInputId]="connection.to"
                    fBehavior="floating">
      </f-connection>
    }

    <div fNode fDragHandle [fNodePosition]="{ x: 0, y: 80 }" >
      <div fNodeOutput fOutputId="1" class="top-right"></div>
      <div fNodeOutput fOutputId="2" class="right"></div>
      <div fNodeOutput fOutputId="3" class="bottom-right"></div>
      I'm node with outlet
      <div fNodeOutlet [isConnectionFromOutlet]="isConnectionFromOutlet">
        <mat-icon>arrow_forward</mat-icon>
      </div>
    </div>

    <div fNode fDragHandle [fNodePosition]="{ x: 300, y: 0 }" fNodeInput fInputId="1">I'm node</div>
    <div fNode fDragHandle [fNodePosition]="{ x: 300, y: 100 }" fNodeInput fInputId="2">I'm node</div>
    <div fNode fDragHandle [fNodePosition]="{ x: 300, y: 200 }" fNodeInput fInputId="3">I'm node</div>

  </f-canvas>
</f-flow>
<example-toolbar>
  <button class="f-button primary" (click)="onDeleteConnections()">Delete Connections</button>
  <f-checkbox [checked]="isConnectionFromOutlet" (change)="onConnectionFromOutletChange($event)">Draw connection from outlet
  </f-checkbox>
</example-toolbar>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ViewChild } from '@angular/core';
import { FCanvasComponent, FCreateConnectionEvent, FFlowModule } from '@foblex/flow';
import { FCheckboxComponent } from '@foblex/m-render';
import { MatIcon } from '@angular/material/icon';
import { ExampleToolbar } from '@foblex/portal-ui';

@Component({
  selector: 'connector-outlet',
  styleUrls: [ './example.scss' ],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    FFlowModule,
    FCheckboxComponent,
    MatIcon,
    ExampleToolbar
  ]
})
export class Example {

  @ViewChild(FCanvasComponent, { static: true })
  public fCanvas!: FCanvasComponent;

  public connections: { from: string, to: string }[] = [];

  public isConnectionFromOutlet: boolean = false;

  constructor(
    private changeDetectorRef: ChangeDetectorRef
  ) {
  }

  public onLoaded(): void {
    this.fCanvas.resetScaleAndCenter(false);
  }

  public onCreateConnection(event: FCreateConnectionEvent): void {
    if (!event.fInputId) {
      return;
    }
    this.connections.push({ from: event.fOutputId, to: event.fInputId });
  }

  public onDeleteConnections(): void {
    this.connections = [];
    this.changeDetectorRef.detectChanges();
  }

  public onConnectionFromOutletChange(checked: boolean): void {
    this.isConnectionFromOutlet = checked;
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

.f-node-outlet {
  position: absolute;
  border: 0.2px solid var(--ff-node-border-color);
  background-color: var(--ff-node-background-color);
  top: 50%;
  right: -90px;
  transform: translateY(-50%);
  border-radius: 2px;

  .mat-icon {
    display: block;
  }
}
```

---

## limiting-connections

Demo: https://flow.foblex.com/examples/limiting-connections  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/connectors/limiting-connections

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()" (fCreateConnection)="createConnection($event)">
  <f-canvas>
    <f-connection-for-create fBehavior="floating" />

    @for (connection of connections(); track connection.to) {
      <f-connection
        [fReassignDisabled]="true"
        [fOutputId]="connection.from"
        [fInputId]="connection.to"
        fBehavior="floating"
      />
    }

    <div fNode fDragHandle [fNodePosition]="{ x: 0, y: 75 }">
      <div fNodeOutput fOutputId="1" class="right"></div>
      Connect to one input only
    </div>

    <div fNode fDragHandle [fNodePosition]="{ x: 0, y: 225 }">
      <div fNodeOutput fOutputId="2" class="right" [fOutputMultiple]="true"></div>
      Connect to multiple inputs
    </div>

    <div fNode fDragHandle [fNodePosition]="{ x: 300, y: 0 }">
      <div fNodeInput fInputId="1" [fInputMultiple]="false" class="left"></div>
      Connect to one output only
    </div>
    <div fNode fDragHandle [fNodePosition]="{ x: 300, y: 150 }">
      <div fNodeInput fInputId="2" [fInputMultiple]="true" class="left"></div>
      Connect to multiple outputs
    </div>
    <div fNode fDragHandle [fNodePosition]="{ x: 300, y: 300 }">
      <div fNodeInput fInputId="3" [fInputMultiple]="true" class="left"></div>
      Connect to multiple outputs
    </div>
  </f-canvas>
</f-flow>
<example-toolbar>
  <button class="f-button primary" (click)="deleteConnections()">Delete Connections</button>
</example-toolbar>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { FCanvasComponent, FCreateConnectionEvent, FFlowModule } from '@foblex/flow';
import { ExampleToolbar } from '@foblex/portal-ui';

@Component({
  selector: 'limiting-connections',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, ExampleToolbar],
})
export class Example {
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected readonly connections = signal<
    {
      from: string;
      to: string;
    }[]
  >([]);

  protected loaded(): void {
    this._canvas()?.resetScaleAndCenter(false);
  }

  protected createConnection(event: FCreateConnectionEvent): void {
    if (!event.targetId) {
      return;
    }
    this.connections.update((x) => x.concat({ from: event.sourceId, to: event.targetId! }));
  }

  protected deleteConnections(): void {
    this.connections.set([]);
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
  width: 160px;
}

@include flow-theme.connector($scoped: false);
```

---

## node-as-connector

Demo: https://flow.foblex.com/examples/node-as-connector  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/connectors/node-as-connector

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="onLoaded()">
  <f-canvas>
    <f-connection [fReassignDisabled]="true" fOutputId="1" fInputId="2" fBehavior="floating">
    </f-connection>

    <div fNode fDragHandle [fNodePosition]="{ x: 0, y: 0 }" fNodeOutput fOutputId="1">I'm node</div>
    <div fNode fDragHandle [fNodePosition]="{ x: 200, y: 400 }" fNodeInput fInputId="2">
      I'm node
    </div>
  </f-canvas>
</f-flow>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, ViewChild } from '@angular/core';
import { FCanvasComponent, FFlowModule } from '@foblex/flow';

@Component({
  selector: 'node-as-connector',
  styleUrls: [ './example.scss' ],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    FFlowModule
  ]
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
