---
'@skill-map/testkit': minor
'@skill-map/cli': patch
---

Step 9.3 — `@skill-map/testkit` lands as a separate workspace + npm
package (per the Arquitecto's pick of independent versioning over a
subpath export). Plugin authors install it alongside `@skill-map/cli`
and use it to unit-test detectors, rules, renderers, and audits
without spinning up the full skill-map runtime.

New surface (all stable through v1.0 except the runner stand-in,
flagged `experimental` until Step 10 lands the job subsystem
contract):

- **Builders** — `node()`, `link()`, `issue()`, `scanResult()` produce
  spec-aligned domain objects with sensible defaults. Override only
  the fields a given test cares about.
- **Context factories** — `makeDetectContext`, `makeRuleContext`,
  `makeRenderContext`, `detectContextFromBody`. Per-kind context shapes
  the kernel injects into extension methods.
- **Fakes** — `makeFakeStorage` (in-memory KV stand-in for `ctx.store`,
  matches the Storage Mode A surface) and `makeFakeRunner` (queue +
  history `RunnerPort` stand-in for probabilistic extensions).
- **Run helpers** — `runDetectorOnFixture(detector, opts)`,
  `runRuleOnGraph(rule, opts)`, `runRendererOnGraph(renderer, opts)`.
  Most plugin tests reduce to one line: build the fixture, call the
  helper, assert on the result.

Collateral on `@skill-map/cli`: `src/kernel/index.ts` now re-exports
the extension-kind interfaces (`IDetector`, `IRule`, `IRenderer`,
`IAdapter`, `IAudit` and their context shapes) so plugin authors can
type-check their extensions against the same surface the kernel
consumes. Patch-level bump because the change is purely additive.

The testkit workspace ships its own `tsup` build (5 KB of runtime,
10 KB of types) and pins every dep at exact versions per the
monorepo policy. `@skill-map/cli` is marked `external` in the bundle
so the published testkit stays a thin layer over the user's installed
cli version.

30 new tests under `testkit/test/*.test.ts` cover builder defaults +
overrides, context factory shapes, KV stand-in semantics (set / get /
list-by-prefix / delete), fake-runner queueing + history + reset, and
the three high-level run helpers. Tests run in their own
`npm test --workspace=@skill-map/testkit` step (independent from cli's
test command).

Out of scope for 9.3, picked up in 9.4:

- Plugin author guide (`spec/plugin-author-guide.md`) referencing the
  testkit by example.
- Reference plugin under `examples/hello-world/` (Arquitecto's pick:
  in the principal repo, not a separate one).
- Diagnostics polish on the loader's `reason:` strings.
