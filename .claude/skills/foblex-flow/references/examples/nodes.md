# Examples — Nodes

Node composition, selection, drag handles, resizing, rotation, grouping, and performance scenes. Covers the core building blocks: `fNode`, `fNodePosition`, `fDragHandle`, `fResizeHandle`, `fRotateHandle`, `fGroup`, and the selection API.

Every example below is a verbatim copy of the official Foblex Flow example at `libs/f-examples/nodes/<name>/` in the upstream repo. Prefer the upstream links when in doubt.

---

## custom-nodes

Demo: https://flow.foblex.com/examples/custom-nodes  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/nodes/custom-nodes

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()">
  <f-canvas fZoom (fCanvasChange)="canvasChanged($event)">
    <f-connection
      [fReassignDisabled]="true"
      fOutputId="fOutput1"
      fInputId="fInput1"
      fType="bezier"
    />
    <f-connection
      [fReassignDisabled]="true"
      fOutputId="fOutput2"
      fInputId="fInput2"
      fType="segment"
    />

    <div
      class="simple-node"
      fNode
      fDragHandle
      [fNodePosition]="{ x: -300, y: 200 }"
      fNodeOutput
      fOutputId="fOutput1"
      fOutputConnectableSide="right"
    >
      <example-select value="option1" [options]="options" />
    </div>

    <mat-card
      class="node-with-card"
      appearance="outlined"
      fNode
      [fNodePosition]="{ x: 24, y: 24 }"
      fDragHandle
      fNodeInput
      fInputId="fInput1"
      fInputConnectableSide="left"
      fNodeOutput
      fOutputId="fOutput2"
      fOutputConnectableSide="right"
    >
      <mat-card-header>
        <div mat-card-avatar class="example-header-image"></div>
        <mat-card-title>Shiba Inu</mat-card-title>
        <mat-card-subtitle>Dog Breed</mat-card-subtitle>
      </mat-card-header>
      <img
        mat-card-image
        src="https://material.angular.io/assets/img/examples/shiba2.jpg"
        alt="Photo of a Shiba Inu"
      />
      <mat-card-content>
        <p>
          The Shiba Inu is the smallest of the six original and distinct spitz breeds of dog from
          Japan. A small, agile dog that copes very well with mountainous terrain, the Shiba Inu was
          originally bred for hunting.
        </p>
      </mat-card-content>
      <mat-card-actions>
        <button mat-button>LIKE</button>
        <button mat-button>SHARE</button>
      </mat-card-actions>
    </mat-card>

    <div
      class="simple-node"
      fNode
      fDragHandle
      [fNodePosition]="{ x: 500, y: 200 }"
      fNodeInput
      fInputId="fInput2"
      fInputConnectableSide="left"
    >
      <video width="320" height="240" controls autoplay muted>
        <source src="./example.mov" type="video/mp4" />
        Your browser does not support the video tag.
      </video>
    </div>
  </f-canvas>
</f-flow>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, inject, OnDestroy, viewChild } from '@angular/core';
import { FCanvasChangeEvent, FCanvasComponent, FFlowModule, FZoomDirective } from '@foblex/flow';
import { MatCardModule } from '@angular/material/card';
import { MatButton } from '@angular/material/button';
import { PointExtensions } from '@foblex/2d';
import { DOCUMENT } from '@angular/common';
import { ExampleSelect } from '@foblex/portal-ui';

@Component({
  selector: 'custom-nodes',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, MatCardModule, MatButton, FZoomDirective, ExampleSelect],
})
export class Example implements OnDestroy {
  private readonly _canvas = viewChild(FCanvasComponent);
  private readonly _document = inject(DOCUMENT);

  protected readonly options = [
    { key: 'option1', value: 'Option 1' },
    { key: 'option2', value: 'Option 2' },
    { key: 'option3', value: 'Option 3' },
  ];

  protected loaded(): void {
    this._canvas()?.fitToScreen(PointExtensions.initialize(100, 100), false);
  }

  protected canvasChanged(event: FCanvasChangeEvent): void {
    // Sets a CSS variable to scale Material Design controls within the canvas
    this._document.documentElement.style.setProperty('--flow-scale', `${event.scale}`);
  }

  public ngOnDestroy(): void {
    // Removes the CSS variable to prevent scaling effects outside the canvas context
    this._document.documentElement.style.removeProperty('--flow-scale');
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

.mat-mdc-card {
  max-width: 300px;
  color: var(--ff-node-color);
  background: var(--ff-node-background-color);
  cursor: move;

  .mat-mdc-card-subtitle {
    color: var(--ff-node-color);
  }

  &:active {
    box-shadow: var(--ff-node-shadow);
  }
}

.example-header-image {
  background-image: url('https://material.angular.io/assets/img/examples/shiba1.jpg');
  background-size: cover;
}

.simple-node {
  @include flow-theme.node($selectorless: true);
  width: unset;
}

img {
  pointer-events: none;
  margin-bottom: 16px;
}
```

---

## drag-handle

Demo: https://flow.foblex.com/examples/drag-handle  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/nodes/drag-handle

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()" (fMoveNodes)="moveNodes($event)">
  <f-canvas>
    <div fNode fDragHandle
         [fNodePosition]="{ x: 0, y: 0 }" (fNodePositionChange)="positionChanged($event)">
      Node is the drag handle
    </div>

    <div fNode
         [fNodePosition]="{ x: 120, y: 100 }" class="drag-handle-inside" (fNodePositionChange)="positionChanged($event)">
      <span fDragHandle class="f-icon f-drag-handle-icon"></span>
      Only the icon is the drag handle
    </div>

    <div fNode
         [fNodePosition]="{ x: 350, y: 0 }" class="drag-handle-outside" (fNodePositionChange)="positionChanged($event)">
      <div fDragHandle>
        <span class="f-icon f-drag-handle-icon"></span>
      </div>
      Only the icon is the drag handle
    </div>

    <div fNode
         [fNodePosition]="{ x: 130, y: 200 }" (fNodePositionChange)="positionChanged($event)">
      Only the image is the drag handle
      <div fDragHandle>
        <img src="https://material.angular.io/assets/img/examples/shiba2.jpg">
      </div>
    </div>
  </f-canvas>
</f-flow>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { FCanvasComponent, FFlowModule, FMoveNodesEvent } from '@foblex/flow';
import { IPoint } from '@foblex/2d';

@Component({
  selector: 'drag-handle',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule],
})
export class Example {
  private readonly _canvas = viewChild(FCanvasComponent);

  /**
   * Triggered after the <f-flow> component is fully loaded.
   * Resets the canvas scale and centers the view without animation.
   */
  protected loaded(): void {
    this._canvas()?.resetScaleAndCenter(true);
  }

  /**
   * Called when one or more nodes are moved.
   * Can be used to track movements or persist state.
   *
   * @param _event - Node movement event containing affected nodes and delta.
   */
  protected moveNodes(_event: FMoveNodesEvent): void {
    // Handle node movement.
  }

  /**
   * Called when a single node's position changes.
   *
   * @param _position - The new position of the node.
   */
  protected positionChanged(_position: IPoint): void {
    // Handle node position change.
  }
}
```

### Styles (`example.scss`)

```scss
@use '@foblex/flow/styles' as flow-theme;

::ng-deep {
  @include flow-theme.theme-tokens();
}

@include flow-theme.drag-handle();

.f-node {
  @include flow-theme.node($selectorless: true);
  width: unset;

  img {
    width: 150px;
  }
}

.drag-handle-inside {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: 6px;
}

.f-icon {
  display: block;
  width: 28px;
  min-width: 28px;
  height: 28px;
  mask-repeat: no-repeat;
}

.drag-handle-outside {
  .f-drag-handle {
    background-color: var(--ff-node-background-color);
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    left: -50px;
    padding: 4px;
    border: 0.5px solid var(--ff-node-border-color);
    border-radius: var(--ff-node-border-radius);
  }
}
```

---

## drag-to-group

Demo: https://flow.foblex.com/examples/drag-to-group  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/nodes/drag-to-group

### Template (`example.html`)

```html
<f-flow
  fDraggable
  (fLoaded)="loaded()"
  (fDropToGroup)="dropToGroup($event)"
  (fCreateNode)="createNode($event)"
>
  <f-canvas fZoom>
    @for (group of groups(); track group.id) {
    <div
      fGroup
      fDragHandle
      [fGroupId]="group.id"
      [fGroupParentId]="group.parentId"
      [fIncludePadding]="includePaddings()"
      [fAutoSizeToFitChildren]="autoSizeToFitChildren()"
      [fAutoExpandOnChildHit]="autoExpandOnChildHit()"
      [fGroupPosition]="group.position"
    >
      Drag to Group
    </div>
    } @for (node of nodes(); track node.id) {
    <div
      fNode
      fDragHandle
      [fNodeId]="node.id"
      [fNodeParentId]="node.parentId"
      [fIncludePadding]="includePaddings()"
      [fAutoSizeToFitChildren]="autoSizeToFitChildren()"
      [fAutoExpandOnChildHit]="autoExpandOnChildHit()"
      [fNodePosition]="node.position"
    >
      Drag to Group
    </div>
    }
  </f-canvas>
</f-flow>
<example-external-palette>
  <div fExternalItem>Drag to Group</div>
</example-external-palette>
<example-toolbar>
  <f-checkbox [checked]="includePaddings()" (change)="changePaddings()"
    >Include Paddings</f-checkbox
  >
  <f-checkbox [checked]="autoSizeToFitChildren()" (change)="changeSizeToFitChildren()"
    >Auto Size to Fit Children</f-checkbox
  >
  <f-checkbox [checked]="autoExpandOnChildHit()" (change)="changeExpandOnChildHit()"
    >Auto Expand on Child Hit</f-checkbox
  >
</example-toolbar>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { FCanvasComponent, FCreateNodeEvent, FDropToGroupEvent, FFlowModule } from '@foblex/flow';
import { FCheckboxComponent } from '@foblex/m-render';
import { ExampleExternalPalette, ExampleToolbar } from '@foblex/portal-ui';

interface INode {
  id: string;
  position: { x: number; y: number };
  parentId?: string;
}

@Component({
  selector: 'drag-to-group',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, FCheckboxComponent, ExampleToolbar, ExampleExternalPalette],
})
export class Example {
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected readonly includePaddings = signal<boolean>(true);
  protected readonly autoSizeToFitChildren = signal<boolean>(true);
  protected readonly autoExpandOnChildHit = signal<boolean>(true);

  protected readonly groups = signal<INode[]>([
    {
      id: 'g1',
      position: { x: 0, y: 0 },
    },
    {
      id: 'g2',
      position: { x: 0, y: 250 },
    },
  ]);

  protected readonly nodes = signal<INode[]>([
    {
      id: 'n1',
      position: { x: 250, y: 0 },
    },
    {
      id: 'n2',
      position: { x: 250, y: 250 },
    },
  ]);

  protected loaded(): void {
    this._canvas()?.resetScaleAndCenter(false);
  }

  protected changePaddings(): void {
    this.includePaddings.set(!this.includePaddings());
  }

  protected changeSizeToFitChildren(): void {
    this.autoSizeToFitChildren.set(!this.autoSizeToFitChildren());
  }

  protected changeExpandOnChildHit(): void {
    this.autoExpandOnChildHit.set(!this.autoExpandOnChildHit());
  }

  protected dropToGroup(event: FDropToGroupEvent): void {
    if (!event.targetGroupId) {
      return;
    }

    const groups = this.groups();
    const nodes = this.nodes();

    event.nodeIds.forEach((id) => {
      const group = groups.find((x) => x.id === id);
      if (group) {
        group.parentId = event.targetGroupId;
      } else {
        const node = nodes.find((x) => x.id === id);
        if (node) {
          node.parentId = event.targetGroupId;
        }
      }
    });
    this.groups.set([...groups]);
    this.nodes.set([...nodes]);
  }

  protected createNode(event: FCreateNodeEvent): void {
    const newNode: INode = {
      id: 'n' + (this.nodes().length + 1),
      position: event.externalItemRect,
      parentId: event.targetContainerId,
    };

    this.nodes.set([...this.nodes(), newNode]);
  }
}
```

### Styles (`example.scss`)

```scss
@use '@foblex/flow/styles' as flow-theme;

::ng-deep {
  @include flow-theme.theme-tokens();
  @include flow-theme.flow($scoped: true);
}

@include flow-theme.external-item-all($scoped: false);
@include flow-theme.node-group($scoped: false);
@include flow-theme.grouping($scoped: false);
```

---

## draggable-flow

Demo: https://flow.foblex.com/examples/draggable-flow  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/nodes/draggable-flow

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()">
  <f-canvas>
    <f-connection fOutputId="output1" fInputId="input1" />
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 0, y: 0 }"
      fNodeOutput
      fOutputId="output1"
      fOutputConnectableSide="right"
    >
      Node 1
    </div>
    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 250, y: 0 }"
      fNodeInput
      fInputId="input1"
      fInputConnectableSide="left"
    >
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
  selector: 'draggable-flow',
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
@use '../../../f-flow/styles' as flow-theme;

::ng-deep {
  @include flow-theme.theme-tokens();
}

::ng-deep f-flow {
  @include flow-theme.connection($scoped: false);
}

.f-node {
  @include flow-theme.node($selectorless: true);
}
```

---

## grouping

Demo: https://flow.foblex.com/examples/grouping  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/nodes/grouping

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()">
  <f-canvas fZoom>
    <f-connection [fReassignDisabled]="true" fType="bezier" fOutputId="node1output" fInputId="node2input"/>
    <f-connection [fReassignDisabled]="true" fType="bezier" fOutputId="node1output" fInputId="group2input"/>
    <f-connection [fReassignDisabled]="true" fType="bezier" fOutputId="node2output" fInputId="group3input"/>
    <f-connection [fReassignDisabled]="true" fType="bezier" fOutputId="group1output" fInputId="node3input"/>

    <div fNode fDragHandle fNodeId="node1"
         [fNodePosition]="{ x: 180, y: -100 }">
      <div fNodeOutput fOutputConnectableSide="bottom" class="bottom"
           fOutputId="node1output"></div>
      Node 1
    </div>

    <div fNode fDragHandle fNodeId="node2"
         [fNodePosition]="{ x: 440, y: 20 }">
      <div fNodeInput fInputConnectableSide="top" class="top" fInputId="node2input"></div>
      <div fNodeOutput fOutputConnectableSide="bottom" class="bottom" fOutputId="node2output"></div>
      Node 2
    </div>

    <div fGroup fDragHandle fGroupId="group1"
         [fGroupPosition]="{ x: 10, y: 100 }">
      <div fNodeOutput fOutputConnectableSide="bottom" class="bottom" fOutputId="group1output"></div>
      Group 1
    </div>

    <div fGroup fDragHandle fGroupId="group2"
         [fIncludePadding]="includePaddings()"
         [fAutoSizeToFitChildren]="autoSizeToFitChildren()"
         [fAutoExpandOnChildHit]="autoExpandOnChildHit()"
         (fGroupSizeChange)="sizeChanged($event)"
         [fGroupPosition]="{ x: 220, y: 190 }">
      <div fNodeInput fInputConnectableSide="top" class="top" fInputId="group2input"></div>
      Group 2
    </div>


    <div fGroup fDragHandle fGroupId="group3" fGroupParentId="group2"
         [fGroupPosition]="{ x: 350, y: 300 }">
      <div fNodeInput fInputConnectableSide="top" class="top" fInputId="group3input"></div>
      Group 3
    </div>

    <div fNode fDragHandle fNodeId="node3" fNodeParentId="group2"
         [fIncludePadding]="includePaddings()"
         [fAutoSizeToFitChildren]="autoSizeToFitChildren()"
         [fAutoExpandOnChildHit]="autoExpandOnChildHit()"
         (fNodeSizeChange)="sizeChanged($event)"
         [fNodePosition]="{ x: 160, y: 140 }">
      <div fNodeInput fInputConnectableSide="left" class="left" fInputId="node3input"></div>
      Node 3
    </div>

    <div fNode fDragHandle fNodeId="node4" fNodeParentId="node3"
         [fNodePosition]="{ x: 160, y: 140 }">
      Node 4
    </div>
  </f-canvas>
</f-flow>
<example-toolbar>
  <f-checkbox [checked]="includePaddings()" (change)="changePaddings()">Include Paddings</f-checkbox>
  <f-checkbox [checked]="autoSizeToFitChildren()" (change)="changeSizeToFitChildren()">Auto Size to Fit Children</f-checkbox>
  <f-checkbox [checked]="autoExpandOnChildHit()" (change)="changeExpandOnChildHit()">Auto Expand on Child Hit</f-checkbox>
</example-toolbar>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { FCanvasComponent, FFlowModule } from '@foblex/flow';
import { FCheckboxComponent } from '@foblex/m-render';
import { IRect } from '@foblex/2d';
import { ExampleToolbar } from '@foblex/portal-ui';

@Component({
  selector: 'grouping',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, FCheckboxComponent, ExampleToolbar],
})
export class Example {
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected readonly includePaddings = signal<boolean>(true);
  protected readonly autoSizeToFitChildren = signal<boolean>(true);
  protected readonly autoExpandOnChildHit = signal<boolean>(true);

  protected loaded(): void {
    this._canvas()?.resetScaleAndCenter(false);
  }

  protected changePaddings(): void {
    this.includePaddings.set(!this.includePaddings());
  }

  protected changeSizeToFitChildren(): void {
    this.autoSizeToFitChildren.set(!this.autoSizeToFitChildren());
  }

  protected changeExpandOnChildHit(): void {
    this.autoExpandOnChildHit.set(!this.autoExpandOnChildHit());
  }

  protected sizeChanged(_event: IRect): void {
    // This event is emitted only when a child node or group movement
    // actually changes (resizes) the boundaries of its parent.
    // Typical scenarios:
    //  - A child is dragged toward the edge and triggers auto-expand.
    //  - Children layout causes auto-size to recalculate the parent bounds.
    // If no real size change occurs, the event is not fired.
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
  @include flow-theme.flow($scoped: false);
  @include flow-theme.connection($scoped: false);
}

@include flow-theme.node($scoped: false);
@include flow-theme.group($scoped: false);
@include flow-theme.connector($scoped: false);
```

---

## node-selection

Demo: https://flow.foblex.com/examples/node-selection  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/nodes/node-selection

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()" (fSelectionChange)="selectionChanged($event)">
  <f-canvas>
    <f-connection
      fOutputId="output1"
      fInputId="input1"
      fBehavior="floating"
      fConnectionId="connection1"
    />
    <f-connection fOutputId="output1" fInputId="input2" fBehavior="floating" />
    <div fNode [fNodePosition]="{ x: 24, y: 24 }" fDragHandle fNodeId="node1">
      <div
        fNodeOutput
        [isSelfConnectable]="false"
        fOutputConnectableSide="right"
        class="right"
        fOutputId="output1"
      ></div>
      I'm a node
    </div>
    <div fNode [fNodePosition]="{ x: 244, y: 24 }" fDragHandle fNodeId="node2">
      <div fNodeInput fInputConnectableSide="left" class="left" fInputId="input1"></div>
      I'm a node
    </div>
    <div
      fNode
      [fNodePosition]="{ x: 144, y: 154 }"
      fDragHandle
      [fNodeSelectionDisabled]="true"
      fNodeId="node3"
    >
      <div fNodeInput fInputConnectableSide="top" class="top" fInputId="input2"></div>
      Disabled selection
    </div>
  </f-canvas>
</f-flow>
<example-toolbar align="start" fDragBlocker>
  <button class="f-button primary" (click)="selectNode()">Select Node</button>
  <button class="f-button primary" (click)="selectConnection()">Select Connection</button>
</example-toolbar>

<example-overlay>
  <div>Events:</div>
  @for (item of events(); track item) {
  <div>Selection changed: {{ item }}</div>
  }
</example-overlay>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { FCanvasComponent, FFlowComponent, FFlowModule, FSelectionChangeEvent } from '@foblex/flow';
import { ExampleOverlay, ExampleToolbar } from '@foblex/portal-ui';

@Component({
  selector: 'node-selection',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, ExampleToolbar, ExampleOverlay],
})
export class Example {
  private readonly _flow = viewChild(FFlowComponent);
  private readonly _canvas = viewChild(FCanvasComponent);

  protected readonly events = signal<string[][]>([]);

  protected loaded(): void {
    this._canvas()?.resetScaleAndCenter(false);
  }

  protected selectionChanged(event: FSelectionChangeEvent): void {
    this.events.update((x) => {
      return [...x, [...event.nodeIds, ...event.connectionIds]];
    });
  }

  protected selectNode(): void {
    this._flow()?.select(['node1'], []);
  }

  protected selectConnection(): void {
    this._flow()?.select([], ['connection1']);
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

@include flow-theme.node($scoped: false);
@include flow-theme.connector($scoped: false);

```

---

## resize-handle

Demo: https://flow.foblex.com/examples/resize-handle  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/nodes/resize-handle

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()">
  <f-canvas>
    <f-connection
      fOutputId="output1"
      fInputId="input1"
      fType="bezier"
      fBehavior="fixed"
    ></f-connection>
    <f-connection
      fOutputId="output1"
      fInputId="input2"
      fType="bezier"
      fBehavior="fixed"
    ></f-connection>

    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: -20, y: -20 }"
      [fNodeSize]="{ width: 120, height: 150 }"
      [fIncludePadding]="false"
      (fNodeSizeChange)="nodeSizeChanged($event)"
    >
      <div
        fNodeOutput
        [isSelfConnectable]="false"
        fOutputConnectableSide="right"
        class="right"
        fOutputId="output1"
      ></div>
      <div fResizeHandle [fResizeHandleType]="eResizeHandleType.LEFT_TOP"></div>
      <div class="node-content">Node with Left Top ResizeHandle</div>
    </div>

    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 300, y: 0 }"
      (fNodeSizeChange)="nodeSizeChanged($event)"
      class="resize-when-selected"
    >
      <div fNodeInput fInputConnectableSide="left" class="left" fInputId="input1"></div>
      <div fResizeHandle [fResizeHandleType]="eResizeHandleType.RIGHT_TOP"></div>
      <div class="node-content">Resize when selected</div>
    </div>

    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 0, y: 200 }"
      (fNodeSizeChange)="nodeSizeChanged($event)"
    >
      <div fResizeHandle [fResizeHandleType]="eResizeHandleType.BOTTOM"></div>
      <div class="node-content">Node with Bottom ResizeHandle</div>
    </div>

    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 300, y: 200 }"
      (fNodeSizeChange)="nodeSizeChanged($event)"
    >
      <mat-icon
        fResizeHandle
        [fResizeHandleType]="eResizeHandleType.LEFT_BOTTOM"
        class="resize-icon"
      >
        open_in_full
      </mat-icon>
      <div class="node-content">Resize icon</div>
    </div>

    <div
      fNode
      fDragHandle
      [fNodePosition]="{ x: 150, y: 100 }"
      fNodeInput
      fInputConnectableSide="top"
      fInputId="input2"
      (fNodeSizeChange)="nodeSizeChanged($event)"
    >
      <div fResizeHandle [fResizeHandleType]="eResizeHandleType.LEFT"></div>
      <div fResizeHandle [fResizeHandleType]="eResizeHandleType.LEFT_TOP"></div>
      <div fResizeHandle [fResizeHandleType]="eResizeHandleType.RIGHT_TOP"></div>
      <div fResizeHandle [fResizeHandleType]="eResizeHandleType.RIGHT"></div>
      <div fResizeHandle [fResizeHandleType]="eResizeHandleType.RIGHT_BOTTOM"></div>
      <div fResizeHandle [fResizeHandleType]="eResizeHandleType.BOTTOM"></div>
      <div fResizeHandle [fResizeHandleType]="eResizeHandleType.LEFT_BOTTOM"></div>
      <div class="node-content">Node with all ResizeHandles</div>
    </div>
  </f-canvas>
</f-flow>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { EFResizeHandleType, FCanvasComponent, FFlowModule } from '@foblex/flow';
import { IRect } from '@foblex/2d';
import { MatIcon } from '@angular/material/icon';

@Component({
  selector: 'resize-handle',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, MatIcon],
})
export class Example {
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected readonly eResizeHandleType = EFResizeHandleType;

  protected loaded(): void {
    this._canvas().resetScaleAndCenter(false);
  }

  protected nodeSizeChanged(_rect: IRect): void {
    //process data
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
  min-height: unset;
  padding: 0;

  &.resize-when-selected {
    .f-resize-handle {
      display: none;
    }

    &.f-selected {
      .f-resize-handle {
        display: block;
      }
    }
  }
}
@include flow-theme.connector($scoped: false);
@include flow-theme.resize-handle($scoped: false);
```

---

## rotate-handle

Demo: https://flow.foblex.com/examples/rotate-handle  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/nodes/rotate-handle

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()">
  <f-canvas fZoom>
    @for (connection of connections; track connection.id) {
    <f-connection
      [fConnectionId]="connection.id"
      [fOutputId]="connection.source"
      [fInputId]="connection.target"
      fBehavior="floating"
      fType="straight"
      [fSelectionDisabled]="true"
    >
      <svg
        viewBox="0 0 700 700"
        fMarker
        [type]="eMarkerType.START"
        class="connection-marker"
        [height]="5"
        [width]="5"
        [refX]="2.5"
        [refY]="2.5"
        markerUnits="strokeWidth"
      >
        <circle cx="350" cy="350" r="350" />
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
    </f-connection>
    } @for (node of nodes; track node.id; let index = $index) {
    <div
      fNode
      [fNodePosition]="node.position"
      [fNodeRotate]="node.rotate"
      fDragHandle
      (fNodeRotateChange)="rotateChanged($event)"
    >
      {{ node.text }}
      <div fRotateHandle></div>
      <div
        fNodeInput
        fInputId="{{node.id}}-input-{{index}}"
        fInputConnectableSide="left"
        class="left"
      ></div>
      <div
        fNodeOutput
        fOutputId="{{node.id}}-output-{{index}}"
        [isSelfConnectable]="false"
        fOutputConnectableSide="top"
        class="top"
      ></div>
      <div
        fNodeInput
        fInputId="{{node.id}}-input-{{index+1}}"
        fInputConnectableSide="right"
        class="right"
      ></div>
      <div
        fNodeOutput
        fOutputId="{{node.id}}-output-{{index+1}}"
        [isSelfConnectable]="false"
        fOutputConnectableSide="bottom"
        class="bottom"
      ></div>
    </div>
    }
  </f-canvas>
</f-flow>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { EFMarkerType, FCanvasComponent, FFlowModule } from '@foblex/flow';

@Component({
  selector: 'rotate-handle',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule],
})
export class Example {
  protected readonly eMarkerType = EFMarkerType;

  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected nodes = [
    {
      id: '1',
      position: { x: 0, y: 200 },
      rotate: 45,
      text: 'Node 1',
    },
    {
      id: '2',
      position: { x: 400, y: 200 },
      rotate: 0,
      text: 'Node 2',
    },
  ];

  protected connections = [
    {
      id: '1',
      source: '1-output-0',
      target: '2-input-1',
    },
  ];

  protected loaded(): void {
    this._canvas().resetScaleAndCenter(false);
  }

  protected rotateChanged(_rotate: number): void {
    ///process data
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

@include flow-theme.node($scoped: false);
@include flow-theme.connector($scoped: false);
@include flow-theme.rotate-handle($scoped: false);
```

---

## stress-test

Demo: https://flow.foblex.com/examples/stress-test  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/nodes/stress-test

### Template (`example.html`)

```html
@if (cells()) {
<f-flow fDraggable (fLoaded)="loaded()" [fCache]="cache()">
  <f-selection-area />

  <f-canvas fZoom>
    @if (virtualization()) {
    <ng-container ngProjectAs="[fNodes]" *fVirtualFor="let cell of cells();">
      <div
        fNode
        [fNodePosition]="{ x: 160 * cell.cIndex, y: cell.rIndex * 120 }"
        fDragHandle
        fNodeInput
        [fInputId]="cell.node"
        fNodeOutput
        [fOutputId]="cell.node"
      >
        Node
      </div>
    </ng-container>
    } @else {
    <ng-container ngProjectAs="[fNodes]">
      @for (cell of cells(); track $index) {
      <div
        fNode
        [fNodePosition]="{ x: 160 * cell.cIndex, y: cell.rIndex * 120 }"
        fDragHandle
        fNodeInput
        [fInputId]="cell.node"
        fNodeOutput
        [fOutputId]="cell.node"
      >
        Node
      </div>
      }
    </ng-container>
    }

    <ng-container ngProjectAs="[fConnections]">
      @if (showConnections()) { @for (connection of connections(); track connection) {
      <f-connection
        fType="adaptive-curve"
        fBehavior="fixed"
        [fInputId]="connection.target"
        [fOutputId]="connection.source"
        fInputSide="calculate"
        fOutputSide="calculate"
      />
      } }
    </ng-container>
  </f-canvas>
</f-flow>
<example-toolbar>
  <f-checkbox [checked]="cache()" (change)="toggleCache()">Cache</f-checkbox>
  <f-checkbox [checked]="virtualization()" (change)="toggleVirtualization()"
    >Virtualization</f-checkbox
  >
  <f-checkbox [checked]="showConnections()" (change)="toggleConnections()"
    >Show Connections</f-checkbox
  >
  <example-select label="Number" [(value)]="totalNodes" [options]="totals" />
</example-toolbar>
}
```

### Component (`example.ts`)

```ts
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FCanvasComponent, FFlowComponent, FFlowModule, FZoomDirective } from '@foblex/flow';
import { PointExtensions } from '@foblex/2d';
import { FCheckboxComponent } from '@foblex/m-render';
import { ExampleSelect, ExampleToolbar } from '@foblex/portal-ui';

type Edge = { source: number; target: number };

type Cell = {
  node: number;
  cIndex: number;
  rIndex: number;
};

@Component({
  selector: 'stress-test',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, FZoomDirective, FCheckboxComponent, ExampleToolbar, ExampleSelect],
})
export class Example {
  private readonly _canvas = viewChild.required(FCanvasComponent);
  private readonly _flow = viewChild(FFlowComponent);

  protected readonly totals = [200, 500, 1000, 2000, 5000];

  protected readonly showConnections = signal(false);
  protected readonly virtualization = signal(false);
  protected readonly cache = signal(false);

  protected readonly totalNodes = signal(200);

  protected readonly cells = computed<readonly Cell[]>(() => {
    const total = this.totalNodes();

    const cols = Math.ceil(Math.sqrt(total));
    const nodesPerCol = Math.ceil(total / cols);

    untracked(() => this._flow()?.reset());

    const result: Cell[] = new Array(total);

    for (let i = 0; i < total; i++) {
      const node = i + 1;
      const cIndex = Math.floor(i / nodesPerCol);
      const rIndex = i - cIndex * nodesPerCol;

      result[i] = { node, cIndex, rIndex };
    }

    return result;
  });

  protected readonly connections = computed<Edge[]>(() => {
    const total = this.totalNodes();
    const edges: Edge[] = [];
    for (let i = 1; i < total; i++) {
      edges.push({ source: i, target: i + 1 });
    }

    return edges;
  });

  protected loaded(): void {
    this._canvas()?.fitToScreen(PointExtensions.initialize(300, 300), false);
  }

  protected toggleConnections(): void {
    this.showConnections.update((x) => !x);
  }

  protected toggleVirtualization(): void {
    this._flow()?.reset();
    this.virtualization.update((x) => !x);
  }

  protected toggleCache(): void {
    this.cache.update((x) => !x);
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

## stress-test-with-connections

Demo: https://flow.foblex.com/examples/stress-test-with-connections  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/nodes/stress-test-with-connections

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()">
  <f-canvas fZoom>
    @for (node of nodes(); track node.id) {
    <div
      fNode
      [fNodePosition]="node.position"
      fDragHandle
      fNodeInput
      [fInputId]="node.id"
      [fInputConnectableSide]="node.side"
    >
      Node {{ node.id }}
    </div>
    }

    <div
      fNode
      class="main-node"
      [fNodePosition]="{ x: 0, y: 0 }"
      fDragHandle
      fNodeOutput
      fOutputId="0"
    >
      Move me
    </div>

    @for (node of nodes(); track node.position; let index = $index) {
    <f-connection
      [fType]="type()"
      [fBehavior]="behavior()"
      fOutputId="0"
      [fInputId]="node.id"
      fReassignDisabled="true"
      fSelectionDisabled="true"
      fOutputSide="calculate"
      fInputSide="calculate"
    >
      <svg
        viewBox="0 0 700 700"
        fMarker
        [type]="eMarkerType.START"
        class="connection-marker"
        [height]="5"
        [width]="5"
        [refX]="2.5"
        [refY]="2.5"
        markerUnits="strokeWidth"
      >
        <circle cx="350" cy="350" r="350" />
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
    </f-connection>
    }
  </f-canvas>
</f-flow>
<example-toolbar>
  <example-select label="Number" [(value)]="count" [options]="counts" />
  <example-select label="Behavior" [(value)]="behavior" [options]="behaviors" />
  <example-select label="Type" [(value)]="type" [options]="types" />
</example-toolbar>
```

### Component (`example.ts`)

```ts
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  EFConnectableSide,
  EFConnectionBehavior,
  EFConnectionType,
  EFMarkerType,
  FCanvasComponent,
  FFlowModule,
  FZoomDirective,
} from '@foblex/flow';
import { IPoint, PointExtensions } from '@foblex/2d';
import { ExampleSelect, ExampleToolbar } from '@foblex/portal-ui';

@Component({
  selector: 'stress-test-with-connections',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, FZoomDirective, ExampleToolbar, ExampleSelect],
})
export class Example {
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected readonly eMarkerType = EFMarkerType;
  protected readonly counts = [25, 50, 75, 100, 150];
  protected readonly behaviors: string[] = [
    EFConnectionBehavior.FIXED,
    EFConnectionBehavior.FIXED_CENTER,
    EFConnectionBehavior.FLOATING,
  ];
  protected readonly types: string[] = [
    EFConnectionType.STRAIGHT,
    EFConnectionType.SEGMENT,
    EFConnectionType.BEZIER,
    EFConnectionType.ADAPTIVE_CURVE,
  ];

  protected readonly count = signal(50);
  protected readonly behavior = signal(EFConnectionBehavior.FLOATING);
  protected readonly type = signal(EFConnectionType.STRAIGHT);

  protected readonly nodes = computed(() => {
    const count = this.count();

    return untracked(() => this._generateNodes(count));
  });

  protected loaded(): void {
    this._canvas()?.fitToScreen(PointExtensions.initialize(20, 20), false);
  }

  private _generateNodes(
    nodeCount: number,
    spacing: number = 10,
  ): { id: number; position: IPoint; side: EFConnectableSide }[] {
    const result: { id: number; position: IPoint; side: EFConnectableSide }[] = [];

    const nodeSize = 100;
    const baseRadius = 150;

    const sides: EFConnectableSide[] = [
      EFConnectableSide.BOTTOM,
      EFConnectableSide.LEFT,
      EFConnectableSide.TOP,
      EFConnectableSide.RIGHT,
    ];
    const nodesPerSide = Math.ceil(nodeCount / 4);

    for (let i = 0; i < nodeCount; i++) {
      const side = sides[i % 4];

      let x = 0;
      let y = 0;
      const radius = baseRadius + Math.floor(i / 4) * (nodeSize + spacing);

      switch (side) {
        case EFConnectableSide.BOTTOM:
          x =
            (i % nodesPerSide) * (nodeSize + spacing) -
            ((nodesPerSide - 1) * (nodeSize + spacing)) / 2;
          y = -radius;
          break;
        case EFConnectableSide.LEFT:
          x = radius;
          y =
            (i % nodesPerSide) * (nodeSize + spacing) -
            ((nodesPerSide - 1) * (nodeSize + spacing)) / 2;
          break;
        case EFConnectableSide.TOP:
          x =
            (i % nodesPerSide) * (nodeSize + spacing) -
            ((nodesPerSide - 1) * (nodeSize + spacing)) / 2;
          y = radius;
          break;
        case EFConnectableSide.RIGHT:
          x = -radius;
          y =
            (i % nodesPerSide) * (nodeSize + spacing) -
            ((nodesPerSide - 1) * (nodeSize + spacing)) / 2;
          break;
      }

      result.push({ id: i + 1, position: { x, y }, side });
    }

    return result;
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

.f-node {
  @include flow-theme.node($selectorless: true);

  &.main-node {
    background: var(--ff-node-background-color-inverse);
    color: var(--ff-node-background-color);
  }
}
```

---
