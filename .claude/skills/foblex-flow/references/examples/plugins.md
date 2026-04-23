# Examples — Plugins

Optional layout engines (Dagre, ELK) wired as plugins. Auto variants re-run layout on graph change. The `utils/` dir contains shared helpers (graph generation, layout-connection-sides, controls) also included below.

Every example below is a verbatim copy of the official Foblex Flow example at `libs/f-examples/plugins/<name>/` in the upstream repo. Prefer the upstream links when in doubt.

---

## dagre-layout

Demo: https://flow.foblex.com/examples/dagre-layout  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/plugins/dagre-layout

### Template (`example.html`)

```html
<f-flow fDraggable (fFullRendered)="loaded()">
  <f-canvas fZoom>
    @for (connection of connections(); track connection.id) {
    <f-connection
      [fConnectionId]="connection.id"
      [fOutputId]="connection.source"
      [fInputId]="connection.target"
      [fOutputSide]="connectionSides().source"
      [fInputSide]="connectionSides().target"
      fType="segment"
      fBehavior="fixed"
    >
      <f-connection-marker-circle />
      <f-connection-marker-arrow />
    </f-connection>
    } @for (node of nodes(); track node.id) {
    <div
      fNode
      [fNodeId]="node.id"
      [fNodePosition]="node.position!"
      fDragHandle
      fNodeInput
      [fInputId]="node.id"
      fNodeOutput
      [fOutputId]="node.id"
    >
      {{ node.label }}
    </div>
    }
  </f-canvas>
</f-flow>
<example-toolbar>
  <example-select label="Direction" [(value)]="direction" [options]="directions" />
  <example-select label="Algorithm" [(value)]="algorithm" [options]="algorithms" />
  <example-select label="Spacing" [(value)]="spacing" [options]="spacings" />
  <button class="f-button primary" (click)="addNode()">Add Node</button>
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
  Injector,
  OnInit,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  EFLayoutDirection,
  EFLayoutMode,
  FCanvasComponent,
  FFlowComponent,
  FFlowModule,
  IFLayoutCalculationOptions,
  provideFLayout,
} from '@foblex/flow';
import { PointExtensions } from '@foblex/2d';
import { ExampleSelect, ExampleToolbar } from '@foblex/portal-ui';
import { map, Observable, take } from 'rxjs';
import {
  DagreLayoutEngine,
  EDagreLayoutAlgorithm,
  IDagreLayoutEngineOptions,
} from '@foblex/flow-dagre-layout';
import { applyLayout } from '../utils/apply-layout';
import {
  DEFAULT_NODE_SIZE,
  generateGraph,
  IConnection,
  IGraph,
  INode,
} from '../utils/generate-graph';
import {
  DAGRE_LAYOUT_ALGORITHM_OPTIONS,
  ELayoutSpacingPreset,
  LAYOUT_DIRECTION_OPTIONS,
  LAYOUT_SPACING_OPTIONS,
  LAYOUT_SPACING_PRESETS,
} from '../utils/layout-controls';
import { getDirectionalLayoutConnectionSides } from '../utils/layout-connection-sides';
import { fromPromise } from 'rxjs/internal/observable/innerFrom';

@Component({
  selector: 'dagre-layout',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, ExampleToolbar, ExampleSelect],
  providers: [
    provideFLayout(DagreLayoutEngine, {
      mode: EFLayoutMode.MANUAL,
    }),
  ],
})
export class Example implements OnInit {
  private readonly _layout = inject(DagreLayoutEngine);
  private readonly _injector = inject(Injector);

  private readonly _flow = viewChild(FFlowComponent);
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected readonly directions = LAYOUT_DIRECTION_OPTIONS;
  protected readonly algorithms = DAGRE_LAYOUT_ALGORITHM_OPTIONS;
  protected readonly spacings = LAYOUT_SPACING_OPTIONS;

  // The template renders the fully calculated graph from these signals.
  protected readonly nodes = signal<INode[]>([]);
  protected readonly connections = signal<IConnection[]>([]);

  // Toolbar state is the single source of truth for graph generation and relayout.
  protected readonly direction = signal(EFLayoutDirection.TOP_BOTTOM);
  protected readonly algorithm = signal<EDagreLayoutAlgorithm>(
    EDagreLayoutAlgorithm.NETWORK_SIMPLEX,
  );
  protected readonly spacing = signal(ELayoutSpacingPreset.SPACIOUS);
  protected readonly connectionSides = computed(() =>
    getDirectionalLayoutConnectionSides(this.direction()),
  );

  private readonly _nodeCount = signal(10);

  public ngOnInit(): void {
    this._listenToolbarChanges();
  }

  private _listenToolbarChanges(): void {
    effect(
      () => {
        // Any toolbar change or node-count change rebuilds the whole example graph.
        this._nodeCount();
        this.direction();
        this.algorithm();
        this.spacing();

        untracked(() => {
          // Rebuild writes to other signals, so we keep those writes outside the effect graph.
          this._rebuildGraph();
        });
      },
      { injector: this._injector },
    );
  }

  private _rebuildGraph(): void {
    this._buildLayoutGraph()
      .pipe(take(1))
      .subscribe((graph) => this._showGraph(graph));
  }

  private _buildLayoutGraph(): Observable<IGraph> {
    const { nodes, connections } = generateGraph(this._nodeCount(), DEFAULT_NODE_SIZE);

    // Dagre returns only layout positions. We merge them back into the example graph
    // so the template keeps working with the same node and connection shape.
    return fromPromise(
      this._layout.calculate(nodes, connections, this._calculateLayoutOptions()),
    ).pipe(map((layout) => applyLayout({ nodes, connections }, layout)));
  }

  private _calculateLayoutOptions(): IFLayoutCalculationOptions<IDagreLayoutEngineOptions> {
    const spacingPreset = LAYOUT_SPACING_PRESETS[this.spacing()];

    // Translate toolbar selections into Dagre-specific layout options.
    return {
      direction: this.direction(),
      layerGap: spacingPreset.layerGap,
      nodeGap: spacingPreset.nodeGap,
      algorithm: this.algorithm(),
    };
  }

  private _showGraph(graph: IGraph): void {
    // Reset Flow so the next render emits `fFullRendered` again and refits the canvas.
    // This example recreates the graph for every change, so a full rerender is expected here.
    this._flow()?.reset();

    // Publish the next laid-out graph to the template.
    this.nodes.set(graph.nodes);
    this.connections.set(graph.connections);
  }

  protected loaded(): void {
    // Fit the graph after each completed render.
    this._fitToScreen();
  }

  protected addNode(): void {
    // Node count drives graph generation, so incrementing it is enough to trigger relayout.
    this._nodeCount.update((x) => x + 1);
  }

  private _fitToScreen(): void {
    this._canvas()?.fitToScreen(PointExtensions.initialize(150, 150), true);
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

## dagre-layout-auto

Demo: https://flow.foblex.com/examples/dagre-layout-auto  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/plugins/dagre-layout-auto

### Template (`example.html`)

```html
<f-flow fDraggable (fFullRendered)="loaded()">
  <f-canvas fZoom>
    @for (connection of connections(); track connection.id) {
    <f-connection
      [fConnectionId]="connection.id"
      [fOutputId]="connection.source"
      [fInputId]="connection.target"
      [fOutputSide]="connectionSides().source"
      [fInputSide]="connectionSides().target"
      fType="segment"
      fBehavior="fixed"
    >
      <f-connection-marker-circle></f-connection-marker-circle>
      <f-connection-marker-arrow></f-connection-marker-arrow>
    </f-connection>
    } @for (node of nodes(); track node.id) {
    <div
      fNode
      [fNodeId]="node.id"
      [fNodePosition]="node.position!"
      fDragHandle
      fNodeInput
      [fInputId]="node.id"
      fNodeOutput
      [fOutputId]="node.id"
    >
      {{ node.label }}
    </div>
    }
  </f-canvas>
</f-flow>
<example-toolbar>
  <example-select label="Direction" [(value)]="direction" [options]="directions" />
  <example-select label="Algorithm" [(value)]="algorithm" [options]="algorithms" />
  <example-select label="Spacing" [(value)]="spacing" [options]="spacings" />
  <button class="f-button primary" (click)="addNode()">Add Node</button>
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
  Injector,
  OnInit,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { PointExtensions } from '@foblex/2d';
import {
  EFLayoutDirection,
  EFLayoutMode,
  FCanvasComponent,
  FFlowComponent,
  FFlowModule,
  IFLayoutWritebackPayload,
  provideFLayout,
} from '@foblex/flow';
import { DagreLayoutEngine, EDagreLayoutAlgorithm } from '@foblex/flow-dagre-layout';
import { ExampleSelect, ExampleToolbar } from '@foblex/portal-ui';
import { applyLayout } from '../utils/apply-layout';
import { IConnection, IGraph, INode, generateGraph } from '../utils/generate-graph';
import { getDirectionalLayoutConnectionSides } from '../utils/layout-connection-sides';
import {
  DAGRE_LAYOUT_ALGORITHM_OPTIONS,
  ELayoutSpacingPreset,
  LAYOUT_DIRECTION_OPTIONS,
  LAYOUT_SPACING_OPTIONS,
  LAYOUT_SPACING_PRESETS,
  getLayoutSpacingPreset,
} from '../utils/layout-controls';

@Component({
  selector: 'dagre-layout-auto',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, ExampleToolbar, ExampleSelect],
  providers: [
    provideFLayout(DagreLayoutEngine, {
      mode: EFLayoutMode.AUTO,
      options: {
        nodeGap: LAYOUT_SPACING_PRESETS[ELayoutSpacingPreset.SPACIOUS].nodeGap,
        layerGap: LAYOUT_SPACING_PRESETS[ELayoutSpacingPreset.SPACIOUS].layerGap,
      },
    }),
  ],
})
export class Example implements OnInit {
  private readonly _layout = inject(DagreLayoutEngine);
  private readonly _injector = inject(Injector);

  private readonly _flow = viewChild(FFlowComponent);
  private readonly _canvas = viewChild.required(FCanvasComponent);

  private readonly _nodeCount = signal(10);

  protected readonly directions = LAYOUT_DIRECTION_OPTIONS;
  protected readonly algorithms = DAGRE_LAYOUT_ALGORITHM_OPTIONS;
  protected readonly spacings = LAYOUT_SPACING_OPTIONS;

  // The template still renders application-owned graph state.
  // Auto mode does not replace your state model, it only updates positions for it.
  protected readonly nodes = signal<INode[]>([]);
  protected readonly connections = signal<IConnection[]>([]);

  // The toolbar remains the source of truth for demo configuration.
  // Unlike the manual example, these controls do not call `calculate(...)` directly.
  protected readonly direction = signal<EFLayoutDirection>(
    this._layout.interactiveOptions().direction,
  );
  protected readonly algorithm = signal<EDagreLayoutAlgorithm>(
    this._layout.interactiveOptions().algorithm,
  );
  protected readonly spacing = signal<ELayoutSpacingPreset>(
    getLayoutSpacingPreset(
      this._layout.interactiveOptions().nodeGap,
      this._layout.interactiveOptions().layerGap,
    ),
  );
  protected readonly connectionSides = computed(() =>
    getDirectionalLayoutConnectionSides(this.direction()),
  );

  public ngOnInit(): void {
    // `writeback` is the official bridge from auto layout back into application state.
    this._configureLayoutWriteback();

    // Any toolbar change rebuilds the rendered graph, just like in the manual example.
    // The difference is that the actual layout pass now happens inside Flow automatically.
    this._listenToolbarChanges();
  }

  protected loaded(): void {
    this._fitToScreen();
  }

  protected addNode(): void {
    // Changing graph structure is enough for auto mode.
    // Flow will detect the new node after render and request a new layout pass.
    this._nodeCount.update((value) => value + 1);
  }

  private _configureLayoutWriteback(): void {
    this._layout.setWriteback((payload) => this._applyLayoutWriteback(payload));
  }

  private _listenToolbarChanges(): void {
    effect(
      () => {
        // The demo intentionally rebuilds the whole graph on every toolbar change so the
        // auto example stays conceptually close to the manual one.
        this._nodeCount();
        this.direction();
        this.algorithm();
        this.spacing();

        untracked(() => {
          this._rebuildGraph();
        });
      },
      { injector: this._injector },
    );
  }

  private _applyLayoutWriteback(payload: IFLayoutWritebackPayload): void {
    // Auto mode writes calculated positions back through the engine callback.
    // We merge those positions into the current graph so the component state remains authoritative.
    const nextGraph = applyLayout(this._getCurrentGraph(), {
      nodes: [...payload.nodes, ...payload.groups],
    });

    this.nodes.set(nextGraph.nodes);
  }

  private _getCurrentGraph(): IGraph {
    return {
      nodes: this.nodes(),
      connections: this.connections(),
    };
  }

  private _createGraph(): IGraph {
    // We intentionally do not pass `size` here.
    // In auto mode Flow reads the real rendered node size from the DOM via `getState({ measuredSize: true })`
    // before the engine calculates positions. The engine fallback size is only used when no measurement exists.
    return generateGraph(this._nodeCount());
  }

  private _rebuildGraph(): void {
    // Toolbar options still come from the component, but the layout itself is delegated to auto mode.
    // We update engine options, render the fresh graph, and let Flow trigger Dagre afterwards.
    this._layout.setInteractiveOptions(this._calculateLayoutOptions());
    this._showGraph(this._createGraph());
  }

  private _calculateLayoutOptions() {
    const spacingPreset = LAYOUT_SPACING_PRESETS[this.spacing()];

    return {
      direction: this.direction(),
      algorithm: this.algorithm(),
      nodeGap: spacingPreset.nodeGap,
      layerGap: spacingPreset.layerGap,
    };
  }

  private _showGraph(graph: IGraph): void {
    // Resetting Flow allows `fFullRendered` to fire again for the freshly rendered graph.
    this._flow()?.reset();

    // After this render completes, auto mode measures nodes, runs Dagre, and updates positions via `writeback`.
    this.nodes.set(graph.nodes);
    this.connections.set(graph.connections);
  }

  private _fitToScreen(): void {
    // Fit the viewport after each full render/re-layout cycle.
    this._canvas()?.fitToScreen(PointExtensions.initialize(150, 150), true);
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

## elk-layout

Demo: https://flow.foblex.com/examples/elk-layout  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/plugins/elk-layout

### Template (`example.html`)

```html
<f-flow fDraggable (fFullRendered)="loaded()">
  <f-canvas fZoom>
    @for (connection of connections(); track connection.id) {
    <f-connection
      [fConnectionId]="connection.id"
      [fOutputId]="connection.source"
      [fInputId]="connection.target"
      [fOutputSide]="connectionSides().source"
      [fInputSide]="connectionSides().target"
      fType="segment"
      fBehavior="fixed"
    >
      <f-connection-marker-circle></f-connection-marker-circle>
      <f-connection-marker-arrow></f-connection-marker-arrow>
    </f-connection>
    } @for (node of nodes(); track node.id) {
    <div
      fNode
      [fNodeId]="node.id"
      [fNodePosition]="node.position!"
      fDragHandle
      fNodeInput
      [fInputId]="node.id"
      fNodeOutput
      [fOutputId]="node.id"
    >
      {{ node.label }}
    </div>
    }
  </f-canvas>
</f-flow>
<example-toolbar>
  <example-select label="Direction" [(value)]="direction" [options]="directions" />
  <example-select label="Algorithm" [(value)]="algorithm" [options]="algorithms" />
  <example-select label="Spacing" [(value)]="spacing" [options]="spacings" />
  <button class="f-button primary" (click)="addNode()">Add Node</button>
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
  Injector,
  OnInit,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  EFLayoutDirection,
  FCanvasComponent,
  FFlowComponent,
  FFlowModule,
  FZoomDirective,
  IFLayoutCalculationOptions,
  provideFLayout,
} from '@foblex/flow';
import { PointExtensions } from '@foblex/2d';
import { ExampleSelect, ExampleToolbar } from '@foblex/portal-ui';
import { map, Observable, take } from 'rxjs';
import {
  EElkLayoutAlgorithm,
  ElkLayoutEngine,
  IElkLayoutEngineOptions,
} from '@foblex/flow-elk-layout';
import { applyLayout } from '../utils/apply-layout';
import {
  DEFAULT_NODE_SIZE,
  generateGraph,
  IConnection,
  IGraph,
  INode,
} from '../utils/generate-graph';
import {
  ELayoutSpacingPreset,
  ELK_LAYOUT_ALGORITHM_OPTIONS,
  LAYOUT_DIRECTION_OPTIONS,
  LAYOUT_SPACING_OPTIONS,
  LAYOUT_SPACING_PRESETS,
} from '../utils/layout-controls';
import { getElkLayoutConnectionSides } from '../utils/layout-connection-sides';
import { fromPromise } from 'rxjs/internal/observable/innerFrom';

@Component({
  selector: 'elk-layout',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, FZoomDirective, ExampleToolbar, ExampleSelect],
  providers: [provideFLayout(ElkLayoutEngine)],
})
export class Example implements OnInit {
  private readonly _layout = inject(ElkLayoutEngine);
  private readonly _injector = inject(Injector);

  private readonly _flow = viewChild(FFlowComponent);
  private readonly _canvas = viewChild.required(FCanvasComponent);

  protected readonly directions = LAYOUT_DIRECTION_OPTIONS;
  protected readonly algorithms = ELK_LAYOUT_ALGORITHM_OPTIONS;
  protected readonly spacings = LAYOUT_SPACING_OPTIONS;

  // The template renders the fully calculated graph from these signals.
  protected readonly nodes = signal<INode[]>([]);
  protected readonly connections = signal<IConnection[]>([]);

  // Toolbar state is the single source of truth for graph generation and relayout.
  protected readonly direction = signal(EFLayoutDirection.TOP_BOTTOM);
  protected readonly algorithm = signal<EElkLayoutAlgorithm>(EElkLayoutAlgorithm.LAYERED);
  protected readonly spacing = signal(ELayoutSpacingPreset.SPACIOUS);
  protected readonly connectionSides = computed(() =>
    getElkLayoutConnectionSides(this.direction(), this.algorithm()),
  );
  private readonly _nodeCount = signal(10);

  public ngOnInit(): void {
    this._listenToolbarChanges();
  }

  private _listenToolbarChanges(): void {
    effect(
      () => {
        // Any toolbar change or node-count change rebuilds the whole example graph.
        this._nodeCount();
        this.direction();
        this.algorithm();
        this.spacing();

        untracked(() => {
          // Rebuild writes to other signals, so we keep those writes outside the effect graph.
          this._rebuildGraph();
        });
      },
      { injector: this._injector },
    );
  }

  private _rebuildGraph(): void {
    this._buildLayoutGraph()
      .pipe(take(1))
      .subscribe((graph) => this._showGraph(graph));
  }

  private _buildLayoutGraph(): Observable<IGraph> {
    const { nodes, connections } = generateGraph(this._nodeCount(), DEFAULT_NODE_SIZE);

    // ELK returns only layout positions. We merge them back into the example graph
    // so the template keeps working with the same node and connection shape.
    return fromPromise(
      this._layout.calculate(nodes, connections, this._calculateLayoutOptions()),
    ).pipe(map((layout) => applyLayout({ nodes, connections }, layout)));
  }

  private _calculateLayoutOptions(): IFLayoutCalculationOptions<IElkLayoutEngineOptions> {
    const spacingPreset = LAYOUT_SPACING_PRESETS[this.spacing()];

    // Translate toolbar selections into ELK-specific layout options.
    return {
      algorithm: this.algorithm(),
      direction: this.direction(),
      layerGap: spacingPreset.layerGap,
      nodeGap: spacingPreset.nodeGap,
    };
  }

  private _showGraph(graph: IGraph): void {
    // Reset Flow so the next render emits `fFullRendered` again and refits the canvas.
    // This example recreates the graph for every change, so a full rerender is expected here.
    this._flow()?.reset();

    // Publish the next laid-out graph to the template.
    this.nodes.set(graph.nodes);
    this.connections.set(graph.connections);
  }

  protected loaded(): void {
    // Fit the graph after each completed render.
    this._fitToScreen();
  }

  protected addNode(): void {
    // Node count drives graph generation, so incrementing it is enough to trigger relayout.
    this._nodeCount.update((x) => x + 1);
  }

  private _fitToScreen(): void {
    this._canvas()?.fitToScreen(PointExtensions.initialize(150, 150), true);
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

## elk-layout-auto

Demo: https://flow.foblex.com/examples/elk-layout-auto  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/plugins/elk-layout-auto

### Template (`example.html`)

```html
<f-flow fDraggable (fFullRendered)="loaded()">
  <f-canvas fZoom>
    @for (connection of connections(); track connection.id) {
    <f-connection
      [fConnectionId]="connection.id"
      [fOutputId]="connection.source"
      [fInputId]="connection.target"
      [fOutputSide]="connectionSides().source"
      [fInputSide]="connectionSides().target"
      fType="segment"
      fBehavior="fixed"
    >
      <f-connection-marker-circle></f-connection-marker-circle>
      <f-connection-marker-arrow></f-connection-marker-arrow>
    </f-connection>
    } @for (node of nodes(); track node.id) {
    <div
      fNode
      [fNodeId]="node.id"
      [fNodePosition]="node.position!"
      fDragHandle
      fNodeInput
      [fInputId]="node.id"
      fNodeOutput
      [fOutputId]="node.id"
    >
      {{ node.label }}
    </div>
    }
  </f-canvas>
</f-flow>
<example-toolbar>
  <example-select label="Direction" [(value)]="direction" [options]="directions" />
  <example-select label="Algorithm" [(value)]="algorithm" [options]="algorithms" />
  <example-select label="Spacing" [(value)]="spacing" [options]="spacings" />
  <button class="f-button primary" (click)="addNode()">Add Node</button>
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
  Injector,
  OnInit,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { PointExtensions } from '@foblex/2d';
import {
  EFLayoutDirection,
  EFLayoutMode,
  FCanvasComponent,
  FFlowComponent,
  FFlowModule,
  FZoomDirective,
  IFLayoutWritebackPayload,
  provideFLayout,
} from '@foblex/flow';
import { EElkLayoutAlgorithm, ElkLayoutEngine } from '@foblex/flow-elk-layout';
import { ExampleSelect, ExampleToolbar } from '@foblex/portal-ui';
import { applyLayout } from '../utils/apply-layout';
import { IConnection, IGraph, INode, generateGraph } from '../utils/generate-graph';
import { getElkLayoutConnectionSides } from '../utils/layout-connection-sides';
import {
  ELayoutSpacingPreset,
  ELK_LAYOUT_ALGORITHM_OPTIONS,
  LAYOUT_DIRECTION_OPTIONS,
  LAYOUT_SPACING_OPTIONS,
  LAYOUT_SPACING_PRESETS,
  getLayoutSpacingPreset,
} from '../utils/layout-controls';

@Component({
  selector: 'elk-layout-auto',
  styleUrls: ['./example.scss'],
  templateUrl: './example.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FFlowModule, FZoomDirective, ExampleToolbar, ExampleSelect],
  providers: [
    provideFLayout(ElkLayoutEngine, {
      mode: EFLayoutMode.AUTO,
      options: {
        nodeGap: LAYOUT_SPACING_PRESETS[ELayoutSpacingPreset.SPACIOUS].nodeGap,
        layerGap: LAYOUT_SPACING_PRESETS[ELayoutSpacingPreset.SPACIOUS].layerGap,
      },
    }),
  ],
})
export class Example implements OnInit {
  private readonly _layout = inject(ElkLayoutEngine);
  private readonly _injector = inject(Injector);

  private readonly _flow = viewChild(FFlowComponent);
  private readonly _canvas = viewChild.required(FCanvasComponent);

  private readonly _nodeCount = signal(10);

  protected readonly directions = LAYOUT_DIRECTION_OPTIONS;
  protected readonly algorithms = ELK_LAYOUT_ALGORITHM_OPTIONS;
  protected readonly spacings = LAYOUT_SPACING_OPTIONS;

  // The template still renders application-owned graph state.
  // Auto mode does not own your graph, it only recalculates positions for it.
  protected readonly nodes = signal<INode[]>([]);
  protected readonly connections = signal<IConnection[]>([]);

  // The toolbar remains the source of truth for demo configuration.
  // Unlike the manual example, these controls do not call `calculate(...)` directly.
  protected readonly direction = signal<EFLayoutDirection>(
    this._layout.interactiveOptions().direction,
  );
  protected readonly algorithm = signal<EElkLayoutAlgorithm>(
    this._layout.interactiveOptions().algorithm,
  );
  protected readonly spacing = signal<ELayoutSpacingPreset>(
    getLayoutSpacingPreset(
      this._layout.interactiveOptions().nodeGap,
      this._layout.interactiveOptions().layerGap,
    ),
  );
  protected readonly connectionSides = computed(() =>
    getElkLayoutConnectionSides(this.direction(), this.algorithm()),
  );

  public ngOnInit(): void {
    // `writeback` is the official bridge from auto layout back into application state.
    this._configureLayoutWriteback();

    // Any toolbar change rebuilds the rendered graph, just like in the manual example.
    // The difference is that the actual layout pass now happens inside Flow automatically.
    this._listenToolbarChanges();
  }

  protected loaded(): void {
    this._fitToScreen();
  }

  protected addNode(): void {
    // Changing graph structure is enough for auto mode.
    // Flow will detect the new node after render and request a new layout pass.
    this._nodeCount.update((value) => value + 1);
  }

  private _configureLayoutWriteback(): void {
    this._layout.setWriteback((payload) => this._applyLayoutWriteback(payload));
  }

  private _listenToolbarChanges(): void {
    effect(
      () => {
        // The demo intentionally rebuilds the whole graph on every toolbar change so the
        // auto example stays conceptually close to the manual one.
        this._nodeCount();
        this.direction();
        this.algorithm();
        this.spacing();

        untracked(() => {
          this._rebuildGraph();
        });
      },
      { injector: this._injector },
    );
  }

  private _applyLayoutWriteback(payload: IFLayoutWritebackPayload): void {
    // Auto mode writes calculated positions back through the engine callback.
    // We merge those positions into the current graph so the component state remains authoritative.
    const nextGraph = applyLayout(this._getCurrentGraph(), {
      nodes: [...payload.nodes, ...payload.groups],
    });

    this.nodes.set(nextGraph.nodes);
  }

  private _getCurrentGraph(): IGraph {
    return {
      nodes: this.nodes(),
      connections: this.connections(),
    };
  }

  private _createGraph(): IGraph {
    // We intentionally do not pass `size` here.
    // In auto mode Flow reads the real rendered node size from the DOM via `getState({ measuredSize: true })`
    // before the engine calculates positions. The engine fallback size is only used when no measurement exists.
    return generateGraph(this._nodeCount());
  }

  private _rebuildGraph(): void {
    // Toolbar options still come from the component, but the layout itself is delegated to auto mode.
    // We update engine options, render the fresh graph, and let Flow trigger ELK.js afterwards.
    this._layout.setInteractiveOptions(this._calculateLayoutOptions());
    this._showGraph(this._createGraph());
  }

  private _calculateLayoutOptions() {
    const spacingPreset = LAYOUT_SPACING_PRESETS[this.spacing()];

    return {
      direction: this.direction(),
      algorithm: this.algorithm(),
      nodeGap: spacingPreset.nodeGap,
      layerGap: spacingPreset.layerGap,
    };
  }

  private _showGraph(graph: IGraph): void {
    // Resetting Flow allows `fFullRendered` to fire again for the freshly rendered graph.
    this._flow()?.reset();

    // After this render completes, auto mode measures nodes, runs ELK.js, and updates positions via `writeback`.
    this.nodes.set(graph.nodes);
    this.connections.set(graph.connections);
  }

  private _fitToScreen(): void {
    // Fit the viewport after each full render/re-layout cycle.
    this._canvas()?.fitToScreen(PointExtensions.initialize(150, 150), true);
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

## utils

Demo: https://flow.foblex.com/examples/utils  
Source: https://github.com/Foblex/f-flow/tree/main/libs/f-examples/plugins/utils

---
