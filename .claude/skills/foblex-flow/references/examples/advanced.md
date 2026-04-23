# Examples — Advanced

Patterns that go beyond a single directive: copy/paste, undo/redo, drag lifecycle events, custom event triggers.

Every example below is a verbatim copy of the official Foblex Flow example at `libs/f-examples/advanced/<name>/` in the upstream repo. Prefer the upstream links when in doubt.

---

## copy-paste

Demo: https://flow.foblex.com/examples/copy-paste  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/advanced/copy-paste

### Template (`example.html`)

```html
<f-flow fDraggable (fLoaded)="loaded()" (fSelectionChange)="selectionChanged($event)">
  <f-canvas fZoom>
    @for (connection of model().connections; track connection.id) {
      <f-connection [fConnectionId]="connection.id"
                    [fOutputId]="connection.source"
                    [fInputId]="connection.target" fBehavior="fixed" fType="segment" fReassignDisabled>
        <svg viewBox="0 0 6 7" fMarker [type]="eMarkerType.END" class="connection-marker"
             [height]="7" [width]="6"
             [refX]="5.5" [refY]="3.5" markerUnits="strokeWidth" orient="auto">
          <path d="M0.000391006 0L6 3.5L0.000391006 7L0.000391006 0Z"/>
        </svg>
        <svg viewBox="0 0 6 7" fMarker [type]="eMarkerType.SELECTED_END" class="connection-marker"
             [height]="7" [width]="6"
             [refX]="5.5" [refY]="3.5" markerUnits="strokeWidth" orient="auto">
          <path d="M0.000391006 0L6 3.5L0.000391006 7L0.000391006 0Z"/>
        </svg>
      </f-connection>
    }
    @for (node of model().nodes; track node.id) {
      <div fNode
           [fNodePosition]="node.position"
           [fNodeId]="node.id"
           fDragHandle>{{ node.text }}
        <div fNodeInput fInputId="{{node.id}}input" fInputConnectableSide="top" class="top"></div>
        <div fNodeOutput fOutputId="{{node.id}}output" fOutputConnectableSide="bottom" class="bottom"></div>
      </div>
    }
  </f-canvas>
</f-flow>
<example-toolbar>
  <button class="f-button primary" (click)="cut()" [disabled]="!hasSelectedItems()">Cut</button>
  <button class="f-button primary" (click)="copy()" [disabled]="!hasSelectedItems()">Copy</button>
  <button class="f-button primary" (click)="paste()" [disabled]="!clipboard()">Paste</button>
</example-toolbar>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import {
  EFMarkerType,
  FCanvasComponent,
  FFlowComponent,
  FFlowModule,
  FSelectionChangeEvent,
} from '@foblex/flow';
import { IPoint } from '@foblex/2d';
import { generateGuid } from '@foblex/utils';
import { ExampleToolbar } from '@foblex/portal-ui';

interface INode {
  id: string;
  position: IPoint;
  text: string;
}

interface IConnection {
  id: string;
  source: string;
  target: string;
}

interface IState {
  nodes: INode[];
  connections?: IConnection[];
}

const STATE = {
  nodes: [
    {
      id: 'node1',
      position: { x: 0, y: 0 },
      text: 'Node 1',
    },
    {
      id: 'node2',
      position: { x: 0, y: 200 },
      text: 'Node 2',
    },
    {
      id: 'node3',
      position: { x: 0, y: 400 },
      text: 'Node 3',
    },
  ],
  connections: [
    {
      id: 'connection1',
      source: 'node1output',
      target: 'node2input',
    },
    {
      id: 'connection2',
      source: 'node2output',
      target: 'node3input',
    },
  ],
};

@Component({
  selector: 'copy-paste',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, ExampleToolbar],
})
export class Example {
  private readonly _flow = viewChild.required(FFlowComponent);
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected readonly clipboard = signal<IState | undefined>(undefined);
  protected readonly model = signal(STATE);
  protected readonly eMarkerType = EFMarkerType;

  protected readonly hasSelectedItems = signal<boolean>(false);

  protected loaded(): void {
    this._canvas()?.resetScaleAndCenter(false);
  }

  protected cut(): void {
    const selection = this._flow().getSelection();
    const nodeIds = selection.fNodeIds ?? [];
    const connectionIds = selection.fConnectionIds ?? [];
    if (!nodeIds.length && !connectionIds.length) return;

    // Copy current selection into clipboard before removal
    this._copyInternal(nodeIds, connectionIds);

    this.model.update((model) => {
      const removeNodeSet = new Set(nodeIds);
      const removeConnSet = new Set(connectionIds);

      const nodes = model.nodes.filter((n) => !removeNodeSet.has(n.id));

      const connections = (model.connections ?? [])
        // remove explicitly selected connections
        .filter((c) => !removeConnSet.has(c.id))
        // remove connections linked to deleted nodes
        .filter((c) => !removeNodeSet.has(this._ownerId(c.source)))
        .filter((c) => !removeNodeSet.has(this._ownerId(c.target)));

      return { ...model, nodes, connections };
    });

    this.hasSelectedItems.set(false);
  }

  protected copy(): void {
    const selection = this._flow().getSelection();
    const nodeIds = selection.fNodeIds ?? [];
    const connectionIds = selection.fConnectionIds ?? [];
    if (!nodeIds.length && !connectionIds.length) return;

    // Copy current selection into clipboard
    this._copyInternal(nodeIds, connectionIds);
  }

  protected paste(): void {
    const clip = this.clipboard();
    if (!clip?.nodes?.length) return;

    const offset = 40;

    // Map old node ids -> new generated ids
    const idMap = new Map<string, string>();
    for (const node of clip.nodes) {
      idMap.set(node.id, generateGuid());
    }

    // Create new nodes with offset
    const newNodes: INode[] = clip.nodes.map((n) => ({
      id: idMap.get(n.id)!,
      text: n.text,
      position: { x: n.position.x + offset, y: n.position.y + offset },
    }));

    // Create new connections only if both ends exist in clipboard
    const newConnections: IConnection[] = (clip.connections ?? [])
      .filter((c) => this._clipContainsBothEnds(c))
      .map((c) => {
        const newSourceOwner = idMap.get(this._ownerId(c.source))!;
        const newTargetOwner = idMap.get(this._ownerId(c.target))!;

        return {
          id: generateGuid(),
          source: `${newSourceOwner}output`,
          target: `${newTargetOwner}input`,
        };
      });

    // Update state
    this.model.update((m) => ({
      nodes: [...m.nodes, ...newNodes],
      connections: [...(m.connections ?? []), ...newConnections],
    }));

    // Select pasted items
    this._flow().select(
      newNodes.map((n) => n.id),
      newConnections.map((c) => c.id),
      false,
    );
    this.hasSelectedItems.set(true);
  }

  protected selectionChanged(event: FSelectionChangeEvent): void {
    // We only care about nodes here; copying connections alone is not useful
    this.hasSelectedItems.set((event.fNodeIds?.length ?? 0) > 0);
  }

  // ---------- helpers ----------

  /** Returns true if both source and target node owners are in the clipboard */
  private _clipContainsBothEnds(connection: IConnection): boolean {
    const clip = this.clipboard();
    if (!clip?.nodes?.length) return false;
    const ids = new Set(clip.nodes.map((n) => n.id));
    const srcOwner = this._ownerId(connection.source);
    const tgtOwner = this._ownerId(connection.target);

    return ids.has(srcOwner) && ids.has(tgtOwner);
  }

  /** Remove -input/-output suffix or plain 'input'/'output' at the end */
  private _removeOutputInputSuffix(port: string): string {
    if (port.endsWith('-output')) return port.slice(0, -'-output'.length);
    if (port.endsWith('-input')) return port.slice(0, -'-input'.length);
    if (port.endsWith('output')) return port.slice(0, -'output'.length);
    if (port.endsWith('input')) return port.slice(0, -'input'.length);

    return port;
  }

  /** Extract owner node id from port id like 'node1-output-0' or 'node1output' */
  private _ownerId(portId: string): string {
    const base = this._removeOutputInputSuffix(portId);
    const idx = base.indexOf('-');

    return idx === -1 ? base : base.slice(0, idx);
  }

  /** Copy selected nodes and connections into clipboard */
  private _copyInternal(nodeIds: string[], connectionIds: string[]): void {
    const nodes = this.model().nodes.filter((n) => nodeIds.includes(n.id));
    const allConns = this.model().connections ?? [];
    const connections = allConns.filter((c) => connectionIds.includes(c.id));
    this.clipboard.set(this._deepClone({ nodes, connections }));
  }

  /** Simple deep clone for plain objects */
  private _deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
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
@include flow-theme.connector($scoped: false);
```

---

## custom-event-triggers

Demo: https://flow.foblex.com/examples/custom-event-triggers  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/advanced/custom-event-triggers

### Template (`example.html`)

```html
<f-flow fDraggable
        [fNodeMoveTrigger]="nodeMoveTrigger"
        [fCreateConnectionTrigger]="connectionTrigger"
        (fLoaded)="onLoaded()"
        (fCreateConnection)="onConnectionCreated($event)"
        (fReassignConnection)="onConnectionReassigned($event)">
  <f-canvas fZoom [fWheelTrigger]="zoomTrigger">
    <f-connection-for-create fBehavior="fixed" fType="segment">
      <svg viewBox="0 0 700 700" fMarker [type]="eMarkerType.START" class="connection-marker"
           [height]="5" [width]="5"
           [refX]="2.5" [refY]="2.5" markerUnits="strokeWidth">
        <circle cx="350" cy="350" r="350"/>
      </svg>
      <svg viewBox="0 0 6 7" fMarker [type]="eMarkerType.END" class="connection-marker"
           [height]="7" [width]="6"
           [refX]="5.5" [refY]="3.5" markerUnits="strokeWidth" orient="auto">
        <path d="M0.000391006 0L6 3.5L0.000391006 7L0.000391006 0Z"/>
      </svg>

    </f-connection-for-create>
    @for (connection of connections; track connection.id) {
      <f-connection [fConnectionId]="connection.id"
                    [fOutputId]="connection.source"
                    [fInputId]="connection.target" fBehavior="fixed" fType="segment" [fSelectionDisabled]="true">
        <svg viewBox="0 0 700 700" fMarker [type]="eMarkerType.START" class="connection-marker"
             [height]="5" [width]="5"
             [refX]="2.5" [refY]="2.5" markerUnits="strokeWidth">
          <circle cx="350" cy="350" r="350"/>
        </svg>
        <svg viewBox="0 0 6 7" fMarker [type]="eMarkerType.END" class="connection-marker"
             [height]="7" [width]="6"
             [refX]="5.5" [refY]="3.5" markerUnits="strokeWidth" orient="auto">
          <path d="M0.000391006 0L6 3.5L0.000391006 7L0.000391006 0Z"/>
        </svg>
      </f-connection>
    }
    @for (node of nodes; track node.id; let index = $index) {
      <div fNode [fNodePosition]="node.position"
           fDragHandle (fNodePositionChange)="onNodeChanged(node.id, $event)">{{ node.text }}
        <div fNodeInput fInputId="{{node.id}}-input-{{index}}" fInputConnectableSide="left" class="left"></div>
        <div fNodeOutput fOutputId="{{node.id}}-output-{{index}}" [isSelfConnectable]="false" fOutputConnectableSide="top" class="top"></div>
        <div fNodeInput fInputId="{{node.id}}-input-{{index+1}}" fInputConnectableSide="right" class="right"></div>
        <div fNodeOutput fOutputId="{{node.id}}-output-{{index+1}}" [isSelfConnectable]="false" fOutputConnectableSide="bottom" class="bottom"></div>
      </div>
    }
  </f-canvas>
</f-flow>
```

### Component (`example.ts`)

```ts
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnDestroy,
  OnInit,
  Renderer2,
  viewChild,
} from '@angular/core';
import {
  EFMarkerType,
  FCanvasComponent,
  FCreateConnectionEvent,
  FFlowModule,
  FReassignConnectionEvent,
  FTriggerEvent,
  FZoomDirective,
} from '@foblex/flow';
import { IPoint } from '@foblex/2d';
import { generateGuid } from '@foblex/utils';
import { DOCUMENT } from '@angular/common';

@Component({
  selector: 'custom-event-triggers',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, FZoomDirective],
})
export class Example implements OnInit, OnDestroy {
  private _rendered = inject(Renderer2);
  private _document = inject(DOCUMENT);
  protected fCanvas = viewChild(FCanvasComponent);

  protected readonly eMarkerType = EFMarkerType;

  protected nodes = [
    {
      id: '1',
      position: { x: 0, y: 200 },
      text: 'Node 1',
    },
    {
      id: '2',
      position: { x: 200, y: 200 },
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

  protected zoomTrigger = (event: FTriggerEvent) => {
    return event.ctrlKey;
  };

  protected nodeMoveTrigger = (event: FTriggerEvent) => {
    return event.shiftKey;
  };

  protected connectionTrigger = (event: FTriggerEvent) => {
    return this._isFKeyPressed;
  };

  private _triggersListener: Function[] = [];
  private _isFKeyPressed = false;

  public ngOnInit(): void {
    this._triggersListener.push(
      this._rendered.listen(this._document, 'keydown', (event) => {
        if (event.key === 'F' || event.code === 'KeyF') {
          this._isFKeyPressed = true;
        }
      }),
    );
    this._triggersListener.push(
      this._rendered.listen(this._document, 'keyup', (event) => {
        if (event.key === 'F' || event.code === 'KeyF') {
          this._isFKeyPressed = false;
        }
      }),
    );
  }

  protected onLoaded(): void {
    this.fCanvas()?.resetScaleAndCenter(false);
  }

  protected onConnectionCreated(event: FCreateConnectionEvent): void {
    if (event.fInputId) {
      this._createConnection(event.fOutputId, event.fInputId);
    }
  }

  protected onConnectionReassigned(event: FReassignConnectionEvent): void {
    if (event.newTargetId) {
      this._removeConnection(event.connectionId);
      this._createConnection(event.oldSourceId, event.newTargetId);
    }
  }

  protected onNodeChanged(nodeId: string, position: IPoint): void {
    const node = this.nodes.find((x) => x.id === nodeId);
    if (node) {
      node.position = position;
    }
  }

  private _removeConnection(connectionId: string): void {
    const index = this.connections.findIndex((x) => x.id === connectionId);
    this.connections.splice(index, 1);
  }

  private _createConnection(source: string, target: string): void {
    this.connections.push({ id: generateGuid(), source, target });
  }

  private _disposeListeners(): void {
    this._triggersListener.forEach((listener) => listener());
    this._triggersListener = [];
  }

  public ngOnDestroy(): void {
    this._disposeListeners();
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
@include flow-theme.connector($scoped: false);
```

---

## drag-start-end-events

Demo: https://flow.foblex.com/examples/drag-start-end-events  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/advanced/drag-start-end-events

### Template (`example.html`)

```html
<f-flow fDraggable
        (fLoaded)="onLoaded()"
        (fDragStarted)="onDragStarted($event)"
        (fDragEnded)="onDragEnded()"
        (fCreateConnection)="onConnectionCreated($event)"
        (fReassignConnection)="onConnectionReassigned($event)">
  <f-canvas fZoom>
    <f-connection-for-create fBehavior="fixed" fType="segment">
      <svg viewBox="0 0 6 7" fMarker [type]="eMarkerType.END" class="connection-marker"
           [height]="7" [width]="6"
           [refX]="5.5" [refY]="3.5" markerUnits="strokeWidth" orient="auto">
        <path d="M0.000391006 0L6 3.5L0.000391006 7L0.000391006 0Z"/>
      </svg>
      <svg viewBox="0 0 6 7" fMarker [type]="eMarkerType.SELECTED_END" class="connection-marker"
           [height]="7" [width]="6"
           [refX]="5.5" [refY]="3.5" markerUnits="strokeWidth" orient="auto">
        <path d="M0.000391006 0L6 3.5L0.000391006 7L0.000391006 0Z"/>
      </svg>
    </f-connection-for-create>
    @for (connection of connections; track connection.id) {
      <f-connection [fConnectionId]="connection.id"
                    [fOutputId]="connection.source"
                    [fInputId]="connection.target" fBehavior="fixed" fType="segment">
        <svg viewBox="0 0 6 7" fMarker [type]="eMarkerType.END" class="connection-marker"
             [height]="7" [width]="6"
             [refX]="5.5" [refY]="3.5" markerUnits="strokeWidth" orient="auto">
          <path d="M0.000391006 0L6 3.5L0.000391006 7L0.000391006 0Z"/>
        </svg>
        <svg viewBox="0 0 6 7" fMarker [type]="eMarkerType.SELECTED_END" class="connection-marker"
             [height]="7" [width]="6"
             [refX]="5.5" [refY]="3.5" markerUnits="strokeWidth" orient="auto">
          <path d="M0.000391006 0L6 3.5L0.000391006 7L0.000391006 0Z"/>
        </svg>
      </f-connection>
    }
    @for (node of nodes; track node.id; let index = $index) {
      <div fNode [fNodePosition]="node.position"
           fDragHandle fConnectOnNode="false">{{ node.text }}
        <div fNodeInput fInputId="{{node.id}}-input-{{index}}" fInputConnectableSide="left" class="left"></div>
        <div fNodeOutput fOutputId="{{node.id}}-output-{{index}}" [isSelfConnectable]="false" fOutputConnectableSide="top" class="top"></div>
        <div fNodeInput fInputId="{{node.id}}-input-{{index+1}}" fInputConnectableSide="right" class="right"></div>
        <div fNodeOutput fOutputId="{{node.id}}-output-{{index+1}}" [isSelfConnectable]="false" fOutputConnectableSide="bottom" class="bottom"></div>
      </div>
    }
  </f-canvas>

</f-flow>
<example-overlay>
  <div>Event list:</div>
  @for (item of events(); track item) {
    <div>{{ item }}</div>
  }
</example-overlay>
```

### Component (`example.ts`)

```ts
import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import {
  EFMarkerType,
  FCanvasComponent,
  FCreateConnectionEvent,
  FFlowModule,
  FReassignConnectionEvent,
  FZoomDirective,
} from '@foblex/flow';
import { generateGuid } from '@foblex/utils';
import { FDragStartedEvent } from '@foblex/flow';
import { ExampleOverlay } from '@foblex/portal-ui';

@Component({
  selector: 'drag-start-end-events',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, FZoomDirective, ExampleOverlay],
})
export class Example {
  protected fCanvas = viewChild(FCanvasComponent);

  protected readonly eMarkerType = EFMarkerType;

  protected events = signal<string[]>([]);

  protected nodes = [
    {
      id: '1',
      position: { x: 0, y: 200 },
      text: 'Node 1',
    },
    {
      id: '2',
      position: { x: 200, y: 200 },
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

  protected onLoaded(): void {
    this.fCanvas()?.resetScaleAndCenter(false);
  }

  protected onDragStarted(event: FDragStartedEvent): void {
    this.events.update((x) => {
      x = x.concat(`EVENT: ${event.fEventType}, DATA: ${JSON.stringify(event.fData)}`);

      return x;
    });
  }

  protected onDragEnded(): void {
    this.events.update((x) => {
      x.push(`EVENT: drag-ended`);

      return x;
    });
  }

  protected onConnectionCreated(event: FCreateConnectionEvent): void {
    if (event.fInputId) {
      this._createConnection(event.fOutputId, event.fInputId);
    }
  }

  protected onConnectionReassigned(event: FReassignConnectionEvent): void {
    if (event.newTargetId) {
      this._removeConnection(event.connectionId);
      this._createConnection(event.oldSourceId, event.newTargetId);
    }
  }

  private _removeConnection(connectionId: string): void {
    const index = this.connections.findIndex((x) => x.id === connectionId);
    this.connections.splice(index, 1);
  }

  private _createConnection(source: string, target: string): void {
    this.connections.push({ id: generateGuid(), source, target });
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
@include flow-theme.connector($scoped: false);
```

---

## undo-redo

Demo: https://flow.foblex.com/examples/undo-redo  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/advanced/undo-redo

### Template (`example.html`)

```html
<f-flow fDraggable
        (fLoaded)="onLoaded()"
        (fCreateConnection)="onConnectionCreated($event)"
        (fReassignConnection)="onConnectionReassigned($event)"
        (fMoveNodes)="onMoveNodes($event)">
  <f-canvas fZoom [scale]="viewModel.scale"
            [position]="viewModel.position"
            [debounceTime]="fCanvasChangeEventDebounce"
            (fCanvasChange)="onCanvasChange($event)">
    <f-connection-for-create fBehavior="fixed" fType="segment">
      <svg viewBox="0 0 700 700" fMarker [type]="eMarkerType.START" class="connection-marker"
           [height]="5" [width]="5"
           [refX]="2.5" [refY]="2.5" markerUnits="strokeWidth">
        <circle cx="350" cy="350" r="350"/>
      </svg>
      <svg viewBox="0 0 6 7" fMarker [type]="eMarkerType.END" class="connection-marker"
           [height]="7" [width]="6"
           [refX]="5.5" [refY]="3.5" markerUnits="strokeWidth" orient="auto">
        <path d="M0.000391006 0L6 3.5L0.000391006 7L0.000391006 0Z"/>
      </svg>

    </f-connection-for-create>
    <f-snap-connection [fSnapThreshold]="100" fBehavior="fixed" fType="segment">
      <svg viewBox="0 0 700 700" fMarker [type]="eMarkerType.START" class="connection-marker"
           [height]="5" [width]="5"
           [refX]="2.5" [refY]="2.5" markerUnits="strokeWidth">
        <circle cx="350" cy="350" r="350"/>
      </svg>
      <svg viewBox="0 0 6 7" fMarker [type]="eMarkerType.END" class="connection-marker"
           [height]="7" [width]="6"
           [refX]="5.5" [refY]="3.5" markerUnits="strokeWidth" orient="auto">
        <path d="M0.000391006 0L6 3.5L0.000391006 7L0.000391006 0Z"/>
      </svg>

    </f-snap-connection>
    @for (connection of viewModel.connections; track connection.id) {
      <f-connection [fConnectionId]="connection.id"
                    [fOutputId]="connection.source"
                    [fInputId]="connection.target" fBehavior="fixed" fType="segment" [fSelectionDisabled]="true">
        <svg viewBox="0 0 700 700" fMarker [type]="eMarkerType.START" class="connection-marker"
             [height]="5" [width]="5"
             [refX]="2.5" [refY]="2.5" markerUnits="strokeWidth">
          <circle cx="350" cy="350" r="350"/>
        </svg>
        <svg viewBox="0 0 6 7" fMarker [type]="eMarkerType.END" class="connection-marker"
             [height]="7" [width]="6"
             [refX]="5.5" [refY]="3.5" markerUnits="strokeWidth" orient="auto">
          <path d="M0.000391006 0L6 3.5L0.000391006 7L0.000391006 0Z"/>
        </svg>
      </f-connection>
    }
    @for (node of viewModel.nodes; track node.id; let index = $index) {
      <div fNode [fNodePosition]="node.position"
           [fNodeId]="node.id"
           fDragHandle>{{ node.text }}
        <div fNodeInput fInputId="{{node.id}}-input-{{index}}" fInputConnectableSide="left" class="left"></div>
        <div fNodeOutput fOutputId="{{node.id}}-output-{{index}}" [isSelfConnectable]="false"
             fOutputConnectableSide="top"
             class="top"></div>
        <div fNodeInput fInputId="{{node.id}}-input-{{index+1}}" fInputConnectableSide="right" class="right"></div>
        <div fNodeOutput fOutputId="{{node.id}}-output-{{index+1}}" [isSelfConnectable]="false"
             fOutputConnectableSide="bottom" class="bottom"></div>
      </div>
    }
  </f-canvas>
</f-flow>
<example-toolbar>
  <button class="f-button primary" (click)="onUndoClick()" [disabled]="!isUndoEnabled">Undo</button>
  <button class="f-button primary" (click)="onRedoClick()" [disabled]="!isRedoEnabled">Redo</button>
</example-toolbar>
```

### Component (`example.ts`)

```ts
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
  viewChild,
} from '@angular/core';
import {
  EFMarkerType,
  FCanvasChangeEvent,
  FCanvasComponent,
  FCreateConnectionEvent,
  FFlowModule,
  FMoveNodesEvent,
  FReassignConnectionEvent,
} from '@foblex/flow';
import { IPoint } from '@foblex/2d';
import { generateGuid } from '@foblex/utils';
import { ExampleToolbar } from '@foblex/portal-ui';

interface INode {
  id: string;
  position: IPoint;
  text: string;
}

interface IConnection {
  id: string;
  source: string;
  target: string;
}

interface IState {
  scale?: number;
  position?: IPoint;
  nodes: INode[];
  connections: IConnection[];
}

const STORE: IState = {
  scale: 1,
  position: { x: 0, y: 0 },
  nodes: [
    {
      id: '1',
      position: { x: 0, y: 200 },
      text: 'Node 1',
    },
    {
      id: '2',
      position: { x: 200, y: 200 },
      text: 'Node 2',
    },
  ],
  connections: [
    {
      id: '1',
      source: '1-output-0',
      target: '2-input-1',
    },
  ],
};

@Component({
  selector: 'undo-redo',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, ExampleToolbar],
})
export class Example {
  private readonly _changeDetectorRef = inject(ChangeDetectorRef);
  private readonly _canvas = viewChild.required(FCanvasComponent);

  private _undoStates: IState[] = [];
  private _redoStates: IState[] = [];

  protected isRedoEnabled = false;
  protected isUndoEnabled = false;

  protected viewModel: IState = STORE;

  protected readonly eMarkerType = EFMarkerType;

  private _isFirstCanvasChange: boolean = true;

  // Debounce time for canvas change events. It helps to prevent excessive updates when zooming;
  protected fCanvasChangeEventDebounce = 200; // milliseconds

  protected onLoaded(): void {
    this._canvas()?.resetScaleAndCenter(false);
  }

  protected onCanvasChange(event: FCanvasChangeEvent): void {
    if (this._isFirstCanvasChange) {
      this._setCenteredFlowAsDefault(event);

      return;
    }

    this._stateChanged();
    this.viewModel.position = event.position;
    this.viewModel.scale = event.scale;
  }

  private _setCenteredFlowAsDefault(event: FCanvasChangeEvent): void {
    this._isFirstCanvasChange = false;
    this.viewModel.position = event.position;
    this.viewModel.scale = event.scale;
    this._changeDetectorRef.markForCheck();
  }

  protected onConnectionCreated(event: FCreateConnectionEvent): void {
    if (event.fInputId) {
      this._stateChanged();
      this._createConnection(event.fOutputId, event.fInputId);
    }
  }

  protected onConnectionReassigned(event: FReassignConnectionEvent): void {
    if (event.newTargetId) {
      this._stateChanged();
      this._removeConnection(event.connectionId);
      this._createConnection(event.oldSourceId, event.newTargetId);
    }
  }

  protected onMoveNodes(event: FMoveNodesEvent): void {
    this._stateChanged();
    event.fNodes.forEach((change) => {
      const node = this.viewModel.nodes.find((x) => x.id === change.id);
      if (node) {
        node.position = change.position;
      }
    });
  }

  private _removeConnection(connectionId: string): void {
    const index = this.viewModel.connections.findIndex((x) => x.id === connectionId);
    this.viewModel.connections.splice(index, 1);
  }

  private _createConnection(source: string, target: string): void {
    this.viewModel.connections.push({ id: generateGuid(), source, target });
  }

  private _stateChanged(): void {
    this._undoStates.push(this._deepClone(this.viewModel));
    this._redoStates = [];
    this._afterStateChanged();
    this._changeDetectorRef.markForCheck();
  }

  protected onUndoClick(): void {
    const currentState = this._deepClone(this.viewModel);
    this.viewModel = this._deepClone(this._undoStates.pop()!);
    this._redoStates.push(currentState);
    this._afterStateChanged();
  }

  protected onRedoClick(): void {
    this._undoStates.push(this._deepClone(this.viewModel));
    this.viewModel = this._deepClone(this._redoStates.pop()!);
    this._afterStateChanged();
  }

  private _afterStateChanged(): void {
    this.isRedoEnabled = this._redoStates.length > 0;
    this.isUndoEnabled = this._undoStates.length > 0;
  }

  private _deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
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
@include flow-theme.connector($scoped: false);
```

---

## undo-redo-v2

Demo: https://flow.foblex.com/examples/undo-redo-v2  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/advanced/undo-redo-v2

### Template (`example.html`)

```html
@let model = viewModel();
<f-flow
  fDraggable
  (fLoaded)="editorLoaded()"
  (fCreateConnection)="createConnection($event)"
  (fReassignConnection)="reassignConnection($event)"
  (fMoveNodes)="moveNodes($event)"
  (fSelectionChange)="changeSelection($event)"
>
  <f-canvas
    fZoom
    [scale]="model?.transform?.scale"
    [position]="model?.transform?.position"
    [debounceTime]="fCanvasChangeEventDebounce"
    (fCanvasChange)="changeCanvasTransform($event)"
  >
    <f-connection-for-create fBehavior="fixed" fType="segment">
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
        <path d="M0.000391006 0L6 3.5L0.000391006 7L0.000391006 0Z"/>
      </svg>
    </f-connection-for-create>

    <f-snap-connection [fSnapThreshold]="100" fBehavior="fixed" fType="segment">
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
        <path d="M0.000391006 0L6 3.5L0.000391006 7L0.000391006 0Z"/>
      </svg>
    </f-snap-connection>

    @for (connection of connections(); track connection.id) {
      <f-connection
        [fConnectionId]="connection.id"
        [fOutputId]="connection.source"
        [fInputId]="connection.target"
        fBehavior="fixed"
        fType="segment"
      >
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
          <path d="M0.000391006 0L6 3.5L0.000391006 7L0.000391006 0Z"/>
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
          <path d="M0.000391006 0L6 3.5L0.000391006 7L0.000391006 0Z"/>
        </svg>
      </f-connection>
    }
    @for (node of nodes(); track node.id; let index = $index) {
      <div fNode [fNodePosition]="node.position" [fNodeId]="node.id" fDragHandle>
        {{ node.text }}
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

<example-toolbar>
  <button class="f-button primary" (click)="state.undo()" [disabled]="!state.canUndo()">Undo</button>
  <button class="f-button primary" (click)="state.redo()" [disabled]="!state.canRedo()">Redo</button>
</example-toolbar>
```

### Component (`example.ts`)

```ts
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Injectable,
  Injector,
  OnInit,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  EFMarkerType,
  FCanvasChangeEvent,
  FCanvasComponent,
  FCreateConnectionEvent,
  FFlowComponent,
  FFlowModule,
  FMoveNodesEvent,
  FReassignConnectionEvent,
  FSelectionChangeEvent,
} from '@foblex/flow';
import { IPoint } from '@foblex/2d';
import { Mutator } from '@foblex/mutator';
import { generateGuid } from '@foblex/utils';
import { ExampleToolbar } from '@foblex/portal-ui';

interface INode {
  id: string;
  position: IPoint;
  text: string;
}

interface IConnection {
  id: string;
  source: string;
  target: string;
}

interface IState {
  nodes: Record<string, INode>;
  connections: Record<string, IConnection>;
  selection?: {
    nodes: string[];
    connections: string[];
  };
  transform?: {
    position: IPoint;
    scale: number;
  };
}

@Injectable()
class FlowState extends Mutator<IState> {}

const DEFAULT_STATE: IState = {
  nodes: {
    ['node1']: {
      id: 'node1',
      position: { x: 0, y: 200 },
      text: 'Node 1',
    },
    ['node2']: {
      id: 'node2',
      position: { x: 200, y: 200 },
      text: 'Node 2',
    },
  },
  connections: {
    ['connection1']: {
      id: 'connection1',
      source: 'node1-output-0',
      target: 'node2-input-1',
    },
  },
  transform: {
    position: { x: 0, y: 0 },
    scale: 1,
  },
};

@Component({
  selector: 'undo-redo-v2',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  providers: [FlowState],
  imports: [FFlowModule, ExampleToolbar],
})
export class Example implements OnInit {
  protected readonly state = inject(FlowState);
  private readonly _injector = inject(Injector);

  private readonly _flow = viewChild(FFlowComponent);
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected readonly eMarkerType = EFMarkerType;

  private _isChangeAfterLoadedResetAndCenter = true;

  // Debounce time for canvas change events. It helps to prevent excessive updates when zooming;
  protected fCanvasChangeEventDebounce = 200; // milliseconds

  protected readonly viewModel = signal<IState | undefined>(undefined);

  protected readonly nodes = computed(() => {
    return Object.values(this.viewModel()?.nodes || {});
  });

  protected readonly connections = computed(() => {
    return Object.values(this.viewModel()?.connections || {});
  });

  public ngOnInit(): void {
    this.state.initialize(DEFAULT_STATE);
    this._listenStateChanges();
  }

  private _listenStateChanges(): void {
    effect(
      () => {
        this.state.changes();
        untracked(() => this._applyChanges());
      },
      { injector: this._injector },
    );
  }

  private _applyChanges(): void {
    this.viewModel.set(this.state.getSnapshot());
    if (!this.viewModel()) {
      return;
    }
    this._reCenterCanvasIfUndedToFirstStep();
    this._applySelectionChanges(this.viewModel()!);
  }

  private _reCenterCanvasIfUndedToFirstStep(): void {
    if (!this.state.canUndo() && !this._isChangeAfterLoadedResetAndCenter) {
      this.editorLoaded();
    }
  }

  private _applySelectionChanges({ selection }: IState): void {
    this._flow()?.select(selection?.nodes || [], selection?.connections || [], false);
  }

  protected editorLoaded(): void {
    this._isChangeAfterLoadedResetAndCenter = true;
    this._canvas()?.resetScaleAndCenter(false);
  }

  protected changeCanvasTransform(event: FCanvasChangeEvent): void {
    this._ifCanvasChangedFromInitialReCenterUpdateInitialState(event);
  }

  private _ifCanvasChangedFromInitialReCenterUpdateInitialState(event: FCanvasChangeEvent): void {
    if (this._isChangeAfterLoadedResetAndCenter) {
      this._isChangeAfterLoadedResetAndCenter = false;
      this.state.patchBase({ transform: { ...event } });

      return;
    }
    this.state.update({
      transform: createTransformObject(event),
    });
  }

  protected createConnection(event: FCreateConnectionEvent): void {
    if (event.fInputId) {
      const connection = createConnectionObject(event);
      this.state.create({
        connections: {
          [connection.id]: connection,
        },
      });
    }
  }

  protected reassignConnection(event: FReassignConnectionEvent): void {
    if (event.newTargetId) {
      this.state.update({
        connections: {
          [event.connectionId]: { target: event.newTargetId },
        },
      });
    }
  }

  protected moveNodes(event: FMoveNodesEvent): void {
    this.state.update({
      nodes: createMoveNodesChangeObject(event.fNodes),
    });
  }

  protected changeSelection(event: FSelectionChangeEvent): void {
    this.state.update({
      selection: {
        nodes: [...event.fNodeIds],
        connections: [...event.fConnectionIds],
      },
    });
  }
}

function createTransformObject({ position, scale }: FCanvasChangeEvent) {
  return { position, scale };
}

function createConnectionObject({ fOutputId, fInputId }: FCreateConnectionEvent) {
  return {
    id: generateGuid(),
    source: fOutputId,
    target: fInputId!,
  };
}

function createMoveNodesChangeObject(nodes: { id: string; position: IPoint }[]) {
  return Object.fromEntries(nodes.map(({ id, position }) => [id, { position }]));
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
@include flow-theme.connector($scoped: false);
```

---
