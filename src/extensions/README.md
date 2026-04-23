# Built-in extensions

Bundled extensions ship here. Each is a directory with a manifest + implementation + a sibling `*.test.ts`.

**Step 0b**: empty on purpose. The kernel boots with zero extensions (see the `kernel-empty-boot` conformance case) — this directory exists as a contract marker for the next two steps.

**Step 2** ships:

- Adapter: `claude`.
- Detectors: `frontmatter`, `slash`, `at-directive`.
- Rules: `trigger-collision`, `broken-ref`, `superseded`.
- Renderer: `ascii`.
- Audit: `validate-all`.

**Step 4** adds `external-url-counter` as the 4th detector (drop-in proof of Step 2's acceptance test). It feeds the `scan_nodes.external_refs_count` denormalization that also lands in Step 4.

See [`ROADMAP.md`](../../ROADMAP.md) §Execution plan for the full schedule. Extension kind contracts are defined in [`spec/architecture.md`](../../spec/architecture.md).
