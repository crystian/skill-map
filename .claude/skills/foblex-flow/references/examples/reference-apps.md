# Examples — Reference Apps

Full example applications showing how Foblex Flow is used end-to-end. These are **not** embedded here because each is a multi-file Angular app; load them directly from the upstream repo when the scenario matches.

| App | Demo | Source | What to crib |
|---|---|---|---|
| AI Low-Code Platform | https://flow.foblex.com/examples/ai-low-code-platform | [`libs/f-examples/external-apps/ai-low-code-platform/`](https://github.com/Foblex/f-flow/tree/main/libs/f-examples/external-apps/ai-low-code-platform) | Node palette, property panel, dynamic node creation, typed connectors. |
| Schema Designer | https://flow.foblex.com/examples/schema-designer | [`apps/example-apps/schema-designer/`](https://github.com/Foblex/f-flow/tree/main/apps/example-apps/schema-designer) | Database-table nodes, per-row connectors (`fInputId` / `fOutputId` per field), typed connection rules. |
| Call Center Flow | https://flow.foblex.com/examples/call-center | [`apps/example-apps/call-center/`](https://github.com/Foblex/f-flow/tree/main/apps/example-apps/call-center) | Decision-tree flow builder, branch-typed connections, inline editing inside nodes. |
| UML Diagram | https://flow.foblex.com/examples/uml-diagram-example | [`apps/example-apps/uml-diagram/`](https://github.com/Foblex/f-flow/tree/main/apps/example-apps/uml-diagram) | Multiple connection kinds (inheritance, association, aggregation, composition) each with custom SVG markers, per-kind `::ng-deep` overrides, `fMarker` directive usage. |
| Tournament Bracket | https://flow.foblex.com/examples/tournament-bracket | [`apps/example-apps/tournament-bracket/`](https://github.com/Foblex/f-flow/tree/main/apps/example-apps/tournament-bracket) | Static, read-only layout, hierarchical positioning, minimal interaction (good reference for skill-map's read-only graph). |

## How to read these

1. Start with the app's `README.md` on GitHub — it lists the key features.
2. The main component (`<app-name>.component.ts` + `.html` + `.scss`) holds the Foblex wiring. Directives, inputs, and events live there.
3. Custom node / connection components live under `src/app/components/` (varies by app).
4. Theme wiring is in the app's `styles.scss` or the main component's SCSS — look for `@use '@foblex/flow/styles'` or for `../node_modules/@foblex/flow/styles/default.scss` in `angular.json`.

## For skill-map specifically

- **Tournament Bracket** is the closest shape to `graph-view/`: static layout, read-only, no palette, no multi-select-driven editing. If you are polishing the read-only view, start there.
- **UML Diagram** is the reference for per-kind connection styling and custom SVG markers (our `f-conn--supersedes`, `f-conn--related`, `f-conn--relates-to` mapping mirrors its approach).
- **Schema Designer** is the reference if we ever render per-field connectors on a node (e.g. a task node exposing one input port per subtask).
