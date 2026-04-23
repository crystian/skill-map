# Examples — Extensions

Built-in extensions applied as directives on `f-flow` or `f-canvas`: background, grid, zoom, auto-pan, selection area, magnetic lines/rects, minimap, palette drop.

Every example below is a verbatim copy of the official Foblex Flow example at `libs/f-examples/extensions/<name>/` in the upstream repo. Prefer the upstream links when in doubt.

---

## add-node-from-palette

Demo: https://flow.foblex.com/examples/add-node-from-palette  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/extensions/add-node-from-palette

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="onLoaded()" (fCreateNode)="onCreateNode($event)">
  <f-canvas fZoom>
    @for (node of nodes(); track node.id) {
      <div fNode [fNodePosition]="node.position" fDragHandle>{{ node.text }}</div>
    }
  </f-canvas>
</f-flow>
<example-toolbar>
  <f-checkbox [checked]="matchSize()" (change)="previewMatchSizeChange($event)"
    >Is preview match size</f-checkbox
  >
</example-toolbar>

<example-external-palette>
  <div fExternalItem fData="Data 1" [fPreviewMatchSize]="matchSize()">External item with data</div>
  <div fExternalItem [fPreviewMatchSize]="matchSize()">External item</div>
  <div fExternalItem [fPreviewMatchSize]="matchSize()">
    With placeholder
    <div *fExternalItemPlaceholder>Placeholder</div>
  </div>
  <div fExternalItem [fPlaceholder]="placeholderTemplate" [fPreviewMatchSize]="matchSize()">
    With placeholder 2
  </div>
  <div fExternalItem [fPreviewMatchSize]="matchSize()">
    With preview
    <div *fExternalItemPreview>Preview</div>
  </div>
  <div fExternalItem [fPreview]="previewTemplate" [fPreviewMatchSize]="matchSize()">
    With preview 2
  </div>
</example-external-palette>

<ng-template #placeholderTemplate>
  <div class="external-item-placeholder">Placeholder 2</div>
</ng-template>
<ng-template #previewTemplate>
  <div class="external-item-preview">Preview 2</div>
</ng-template>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import {
  FCanvasComponent,
  FCreateNodeEvent,
  FExternalItem,
  FExternalItemPlaceholder,
  FExternalItemPreview,
  FFlowModule,
} from '@foblex/flow';
import { generateGuid } from '@foblex/utils';
import { FCheckboxComponent } from '@foblex/m-render';
import { ExampleExternalPalette, ExampleToolbar } from '@foblex/portal-ui';

@Component({
  selector: 'add-node-from-palette',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    FFlowModule,
    FExternalItem,
    FExternalItemPlaceholder,
    FExternalItemPreview,
    FCheckboxComponent,
    ExampleToolbar,
    ExampleExternalPalette,
  ],
})
export class Example {
  protected readonly nodes = signal([
    {
      id: generateGuid(),
      text: 'node 1',
      position: { x: 0, y: 0 },
    },
    {
      id: generateGuid(),
      text: 'node 2',
      position: { x: 200, y: 0 },
    },
  ]);

  protected readonly matchSize = signal(false);
  private readonly _canvas = viewChild(FCanvasComponent);

  protected onLoaded(): void {
    this._canvas()?.resetScaleAndCenter(false);
  }

  protected onCreateNode(event: FCreateNodeEvent): void {
    this.nodes.set([
      ...this.nodes(),
      {
        id: generateGuid(),
        text: event.data || 'node ' + (this.nodes().length + 1),
        position: event.rect,
      },
    ]);
  }

  protected previewMatchSizeChange(checked: boolean): void {
    this.matchSize.set(checked);
  }
}
```

### Styles (`example.scss`)

```scss
@use '@foblex/flow/styles' as flow-theme;

::ng-deep {
  @include flow-theme.theme-tokens();
}

@include flow-theme.node($selectorless: false);

@include flow-theme.external-item-all();

.external-panel {
  background-color: var(--ff-node-background-color);
  width: 170px;
  border-radius: 4px;
  padding: 4px;
  position: absolute;
  left: 10px;
  top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
```

---

## auto-pan

Demo: https://flow.foblex.com/examples/auto-pan  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/extensions/auto-pan

### Template (`example.html`)

```html
<f-flow
  fDraggable
  (fCreateConnection)="createConnection($event)"
  (fReassignConnection)="reassignConnection($event)"
  (fLoaded)="loaded()"
>
  @if (enabled()) {
  <f-auto-pan
    [fEdgeThreshold]="edgeThreshold()"
    [fSpeed]="speed()"
    [fAcceleration]="acceleration()"
  />
  }
  <f-selection-area />
  <f-canvas fZoom>
    <f-connection-for-create />

    @for (connection of connections(); track $index) {
    <f-connection
      fInputSide="calculate"
      fOutputSide="calculate"
      [fOutputId]="connection.source"
      [fInputId]="connection.target"
    />
    }

    <div
      fNode
      fDragHandle
      fNodeInput
      fInputId="input1"
      [fNodePosition]="{ x: 24, y: 120 }"
      fNodeOutput
      fOutputId="output1"
    >
      Node 1
    </div>

    <div
      fNode
      fDragHandle
      fNodeInput
      fInputId="input2"
      [fNodePosition]="{ x: 24, y: 320 }"
      fNodeOutput
      fOutputId="output2"
    >
      Node 2
    </div>

    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 360, y: 320 }"
      fNodeInput
      fInputId="input3"
      fNodeOutput
      fOutputId="output3"
    >
      Node 3
    </div>
  </f-canvas>
</f-flow>

<example-toolbar>
  <f-checkbox [checked]="enabled()" (change)="onEnabledChange($event)">Enable Auto Pan</f-checkbox>
  <f-checkbox [checked]="acceleration()" (change)="onAccelerationChange($event)">
    Acceleration
  </f-checkbox>

  <example-input label="Edge Threshold" [(value)]="edgeThreshold" />
  <example-input label="Speed" [(value)]="speed" />
</example-toolbar>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import {
  FCanvasComponent,
  FCreateConnectionEvent,
  FFlowModule,
  FReassignConnectionEvent,
} from '@foblex/flow';
import { FCheckboxComponent } from '@foblex/m-render';
import { ExampleInput, ExampleToolbar } from '@foblex/portal-ui';

interface SourceTarget {
  source?: string;
  target?: string;
}

@Component({
  selector: 'auto-pan',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, FCheckboxComponent, ExampleToolbar, ExampleInput],
})
export class Example {
  private readonly _canvas = viewChild(FCanvasComponent);

  protected readonly enabled = signal(true);
  protected readonly edgeThreshold = signal(20);
  protected readonly speed = signal(8);
  protected readonly acceleration = signal(true);

  protected readonly connections = signal<SourceTarget[]>([
    { source: 'output1', target: 'input2' },
  ]);

  protected loaded(): void {
    this._canvas()?.resetScaleAndCenter(false);
  }

  protected createConnection({ sourceId, targetId }: FCreateConnectionEvent): void {
    if (!targetId) {
      return;
    }

    const exists = this._hasConnection(sourceId, targetId);
    if (exists) {
      return;
    }

    this.connections.update((x) => [
      ...x,
      {
        source: sourceId,
        target: targetId,
      },
    ]);
  }

  private _hasConnection(source: string, target: string): boolean {
    return this.connections().some((connection) => {
      return connection.source === source && connection.target === target;
    });
  }

  protected reassignConnection(event: FReassignConnectionEvent): void {
    if (!event.nextTargetId && !event.nextSourceId) {
      return;
    }

    this.connections.update((connections) => {
      const connection = connections.find((item) => {
        return item.source === event.previousSourceId && item.target === event.previousTargetId;
      });
      if (!connection) {
        throw new Error('Connection not found');
      }

      connection.source = event.nextSourceId || connection.source;
      connection.target = event.nextTargetId || connection.target;

      return [...connections];
    });
  }

  protected onEnabledChange(checked: boolean): void {
    this.enabled.set(checked);
  }

  protected onAccelerationChange(checked: boolean): void {
    this.acceleration.set(checked);
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
@include flow-theme.selection-area();
```

---

## background-example

Demo: https://flow.foblex.com/examples/background  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/extensions/background-example

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()">
  @switch (background()) {
    @case ('circle') {
      <f-background>
        <f-circle-pattern />
      </f-background>
    }
    @case ('rect') {
      <f-background>
        <f-rect-pattern />
      </f-background>
    }
    @case ('custom') {
      <f-background>
        <custom-background-example />
      </f-background>
    }
  }
  <f-canvas fZoom>
    <f-connection fOutputId="output1" fInputId="input1" fBehavior="floating" />
    <div fNode [fNodePosition]="{ x: 0, y: 0 }" fDragHandle>
      <div fNodeOutput fOutputId="output1" class="right"></div>
      I'm a node
    </div>
    <div fNode [fNodePosition]="{ x: 200, y: 0 }" fDragHandle>
      <div fNodeInput fInputId="input1" class="left"></div>
      I'm a node
    </div>
  </f-canvas>
</f-flow>
<example-toolbar>
  <example-select [(value)]="background" [options]="backgroundOptions" label="Select Background" />
</example-toolbar>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { FCanvasComponent, FFlowModule } from '@foblex/flow';
import { MatSelectModule } from '@angular/material/select';
import { FlowBackground } from './custom-background-example/custom-background-example';
import { ExampleSelect, ExampleToolbar } from '@foblex/portal-ui';

@Component({
  selector: 'background-example',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, MatSelectModule, FlowBackground, ExampleToolbar, ExampleSelect],
})
export class Example {
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected readonly background = signal('custom');

  protected readonly backgroundOptions = ['circle', 'rect', 'custom', 'none'];

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
  @include flow-theme.background($scoped: false);
}

@include flow-theme.node($selectorless: false);
@include flow-theme.connector($scoped: false);
```

---

## grid-system

Demo: https://flow.foblex.com/examples/grid-system  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/extensions/grid-system

### Template (`example.html`)

```html
<f-flow fDraggable
        [vCellSize]="32"
        [hCellSize]="32"
        [fCellSizeWhileDragging]="adjustCellSizeWhileDragging()"
        (fLoaded)="onLoaded()">
  <f-background>
    <f-rect-pattern [vSize]="32" [hSize]="32"></f-rect-pattern>
  </f-background>
  <f-canvas fZoom>
    <f-connection fOutputId="output1" fInputId="input1" fBehavior="floating"></f-connection>
    <div fNode [fNodePosition]="{ x: 32, y: 32 }" fNodeOutput fOutputId="output1" fDragHandle>I'm a node</div>
    <div fNode [fNodePosition]="{ x: 192, y: 96 }" fNodeInput fInputId="input1" fDragHandle>I'm a node</div>
  </f-canvas>
</f-flow>
<example-toolbar>
  <f-checkbox [checked]="adjustCellSizeWhileDragging()"
              (change)="onAdjustCellSizeWhileDraggingChange($event)">
    Adjust cell size while dragging
  </f-checkbox>
</example-toolbar>
```

### Component (`example.ts`)

```ts
import {ChangeDetectionStrategy, Component, signal, viewChild, ViewChild} from '@angular/core';
import { FCanvasComponent, FFlowModule, FZoomDirective } from '@foblex/flow';
import { FCheckboxComponent } from '@foblex/m-render';
import { ExampleToolbar } from '@foblex/portal-ui';

@Component({
  selector: 'grid-system',
  styleUrls: [ './example.scss' ],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    FFlowModule,
    FCheckboxComponent,
    FZoomDirective,
    ExampleToolbar,
  ]
})
export class Example {

  protected adjustCellSizeWhileDragging = signal(false)

  protected readonly fCanvas = viewChild(FCanvasComponent);

  protected onLoaded(): void {
    this.fCanvas()?.resetScaleAndCenter(false);
  }

  protected onAdjustCellSizeWhileDraggingChange(event: boolean): void {
    this.adjustCellSizeWhileDragging.set(event);
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
  @include flow-theme.background($scoped: false);
}

@include flow-theme.node($selectorless: false);
```

---

## help-in-positioning

Demo: https://flow.foblex.com/examples/help-in-positioning  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/extensions/help-in-positioning

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="onLoaded()">
  <f-line-alignment [fAlignThreshold]="40"></f-line-alignment>
  <f-canvas>
    <f-connection fOutputId="output1" fInputId="input1" fBehavior="floating"></f-connection>
    <div fNode [fNodePosition]="{ x: 0, y: 0 }" fDragHandle>
      <div fNodeOutput fOutputId="output1" class="right"></div>
      I'm a node
    </div>
    <div fNode [fNodePosition]="{ x: 200, y: 100 }"  fDragHandle>
      <div fNodeInput fInputId="input1" class="left"></div>
      I'm a node
    </div>
  </f-canvas>
</f-flow>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, ViewChild } from '@angular/core';
import { FCanvasComponent, FFlowModule } from '@foblex/flow';

@Component({
  selector: 'help-in-positioning',
  styleUrls: [ './example.scss' ],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    FFlowModule,
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
  @include flow-theme.plugins($scoped: false);
}

@include flow-theme.node($selectorless: false);
@include flow-theme.connector($scoped: false);
```

---

## magnetic-lines

Demo: https://flow.foblex.com/examples/magnetic-lines  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/extensions/magnetic-lines

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()">
  <f-magnetic-lines [threshold]="40" />
  <f-canvas>
    <f-connection fOutputId="output1" fInputId="input1" fBehavior="floating" />
    <div fNode [fNodePosition]="{ x: 0, y: 0 }" fDragHandle fNodeOutput fOutputId="output1">
      Node 1
    </div>
    <div fNode [fNodePosition]="{ x: 200, y: 100 }" fDragHandle fNodeInput fInputId="input1">
      Node 2
    </div>
  </f-canvas>
</f-flow>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { FCanvasComponent, FFlowModule } from '@foblex/flow';

@Component({
  selector: 'magnetic-lines',
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
  @include flow-theme.plugins($scoped: false);
}

@include flow-theme.node($selectorless: false);
```

---

## magnetic-rects

Demo: https://flow.foblex.com/examples/magnetic-rects  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/extensions/magnetic-rects

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()">
  <f-magnetic-rects alignThreshold="40" spacingThreshold="40" />
  <f-canvas>
    <div fNode [fNodePosition]="{ x: 0, y: 0 }" fDragHandle>Node 1</div>
    <div fNode [fNodePosition]="{ x: 150, y: 0 }" fDragHandle>Node 2</div>
    <div fNode [fNodePosition]="{ x: 300, y: 0 }" fDragHandle>Node 3</div>
    <div fNode [fNodePosition]="{ x: 450, y: 0 }" fDragHandle>Node 4</div>
    <div fNode [fNodePosition]="{ x: 300, y: 150 }" fDragHandle>Node 5</div>
    <div fNode [fNodePosition]="{ x: 450, y: 150 }" fDragHandle>Node 6</div>
    <div fNode [fNodePosition]="{ x: 450, y: 300 }" fDragHandle>Node 7</div>
    <div fNode [fNodePosition]="{ x: 0, y: 300 }" fDragHandle>Node 8</div>
  </f-canvas>
</f-flow>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { FCanvasComponent, FFlowModule } from '@foblex/flow';

@Component({
  selector: 'magnetic-rects',
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
  @include flow-theme.plugins($scoped: false);
}

@include flow-theme.node($selectorless: false);
```

---

## minimap-example

Demo: https://flow.foblex.com/examples/minimap  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/extensions/minimap-example

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="onLoaded()">
  <f-canvas fZoom>
    <f-connection fOutputId="output1" fInputId="input1" fBehavior="floating" />
    <div fNode [fNodePosition]="{ x: 24, y: 24 }" fNodeOutput fOutputId="output1" fDragHandle>
      I'm a node
    </div>
    <div fNode [fNodePosition]="{ x: 244, y: 24 }" fNodeInput fInputId="input1" fDragHandle>
      I'm a node
    </div>
    <div
      [fMinimapClass]="['custom-class-for-minimap']"
      fNode
      [fNodePosition]="{ x: 244, y: 164 }"
      fDragHandle
    >
      I'm a node
    </div>
  </f-canvas>
  <div class="any-container-or-without-container">
    <f-minimap [fMinSize]="2000" />
  </div>
</f-flow>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { FCanvasComponent, FFlowModule } from '@foblex/flow';

@Component({
  selector: 'minimap-example',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule],
})
export class Example {
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected onLoaded(): void {
    this._canvas().resetScaleAndCenter(false);
  }

  public onFitToScreen(): void {
    this._canvas().fitToScreen();
  }

  public onOneToOne(): void {
    this._canvas().resetScaleAndCenter();
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
  @include flow-theme.minimap($scoped: false);

  .custom-class-for-minimap {
    fill: var(--ff-color-danger) !important;

    &.f-selected {
      fill: var(--ff-minimap-node-selected-color) !important;
    }
  }
}

@include flow-theme.node($selectorless: false);
```

---

## selection-area

Demo: https://flow.foblex.com/examples/selection-area  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/extensions/selection-area

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="onLoaded()">
  <f-selection-area />
  <f-canvas fZoom>
    <f-connection fOutputId="output1" fInputId="input1" fBehavior="floating"></f-connection>
    <div fNode [fNodePosition]="{ x: 0, y: 0 }" fDragHandle>
      <div fNodeOutput fOutputId="output1" class="right"></div>
      I'm a node
    </div>
    <div fNode [fNodePosition]="{ x: 200, y: 0 }" fDragHandle>
      <div fNodeInput fInputId="input1" class="left"></div>
      I'm a node
    </div>
  </f-canvas>
</f-flow>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, ViewChild } from '@angular/core';
import { FCanvasComponent, FFlowModule } from '@foblex/flow';

@Component({
  selector: 'selection-area',
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

@include flow-theme.selection-area();
```

---

## zoom

Demo: https://flow.foblex.com/examples/zoom  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/extensions/zoom

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="onLoaded()">
  <f-canvas [fZoom]="isZoomEnabled">
    <f-connection fOutputId="output1" fInputId="input1" fBehavior="floating"></f-connection>
    <div fNode [fNodePosition]="{ x: 0, y: 0 }" fDragHandle>
      <div fNodeOutput fOutputId="output1" class="right"></div>
      I'm a node
    </div>
    <div fNode [fNodePosition]="{ x: 200, y: 0 }"  fDragHandle>
      <div fNodeInput fInputId="input1" class="left"></div>
      I'm a node
    </div>
  </f-canvas>
</f-flow>
<example-toolbar>
  <button class="f-button primary" (click)="onZoomIn()">Zoom In</button>
  <button class="f-button primary" (click)="onZoomOut()">Zoom Out</button>
  <f-checkbox [checked]="isZoomEnabled" (change)="onZoomOnMouseWheelChanged($event)">Enable Wheel and Dbl Click</f-checkbox>
</example-toolbar>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, ViewChild } from '@angular/core';
import { FCanvasComponent, FFlowModule, FZoomDirective } from '@foblex/flow';
import { FCheckboxComponent } from '@foblex/m-render';
import { ExampleToolbar } from '@foblex/portal-ui';

@Component({
  selector: 'zoom',
  styleUrls: [ './example.scss' ],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    FFlowModule,
    FCheckboxComponent,
    FZoomDirective,
    ExampleToolbar
  ]
})
export class Example {

  @ViewChild(FCanvasComponent, { static: true })
  protected fCanvas!: FCanvasComponent;

  @ViewChild(FZoomDirective, { static: true })
  protected fZoom!: FZoomDirective;

  protected isZoomEnabled: boolean = true;

  protected onLoaded(): void {
    this.fCanvas.resetScaleAndCenter(false);
  }

  protected onZoomIn(): void {
    this.fZoom.zoomIn();
  }

  protected onZoomOut(): void {
    this.fZoom.zoomOut();
  }

  protected onZoomOnMouseWheelChanged(checked: boolean): void {
    this.isZoomEnabled = checked;
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
