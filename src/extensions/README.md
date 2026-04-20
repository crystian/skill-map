# Built-in extensions

Bundled extensions ship here. Each is a directory with a manifest + implementation + a sibling `*.test.ts`.

**Step 0b**: empty on purpose. The kernel boots with zero extensions (see the `kernel-empty-boot` conformance case) — this directory exists as a contract marker for Step 2, which adds:

- Adapter: `claude`.
- Detectors: `frontmatter`, `slash`, `at-directive`, `external-url-counter`.
- Rules: `trigger-collision`, `broken-ref`, `superseded`.
- Renderer: `ascii`.
- Audit: `validate-all`.

See `ROADMAP.md` §Execution plan for the full schedule.
