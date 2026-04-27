---
'@skill-map/cli': patch
---

Runtime catch-up — thread `mode: 'deterministic'` explicitly through the built-in detectors and rules

The execution-modes spec lift (separate changeset, `@skill-map/spec` major)
defined the per-kind capability matrix and added the optional `mode` field
to `Detector` / `Rule` schemas with default `deterministic`. Manifests stayed
valid without an update because the field is optional, but the project
policy is to thread the mode explicitly so a future probabilistic extension
is a visible deviation, not a silent flip of the default.

**Runtime changes**:

- `src/kernel/types.ts` — new exported type
  `TExecutionMode = 'deterministic' | 'probabilistic'` mirroring
  `spec/architecture.md` §Execution modes. Re-exported from
  `src/kernel/extensions/index.ts` so plugin authors importing from the
  kernel barrel get it.
- `src/kernel/extensions/detector.ts` — `IDetector` gains optional
  `mode?: TExecutionMode`. Optional matches the schema (default
  `deterministic`); existing third-party detectors compile unchanged.
- `src/kernel/extensions/rule.ts` — `IRule` gains optional
  `mode?: TExecutionMode`. Same defaulting story; the prior "rules MUST
  be deterministic" claim in the doc-comment dropped to match the schema
  rewrite.
- All four built-in detectors (`frontmatter`, `slash`, `at-directive`,
  `external-url-counter`) and all four built-in rules
  (`trigger-collision`, `broken-ref`, `superseded`, `link-conflict`) now
  declare `mode: 'deterministic'` explicitly.
- `validate-all` audit, `claude` adapter, and `ascii` renderer are
  intentionally untouched — audits derive mode from `composes[]` at load
  time, and adapters / renderers are deterministic-only at the system
  boundaries (the schemas forbid the field on those three kinds).

**New test** (`src/test/built-ins-modes.test.ts`, 5 cases) asserts the
invariant: every built-in detector and rule declares
`mode: 'deterministic'`; the audit / adapter / renderer manifests do NOT
declare the field. Locks the project policy as a compile-time + runtime
guarantee. Test count: 341 → **346** (+5).

**No behavioural change**: the orchestrator does not yet consult
`mode` — every built-in is already deterministic, and the kernel routing
that rejects probabilistic extensions from scan-time hooks lands with
the first probabilistic extension at Step 10. Today the field is
metadata that consumers (`sm plugins doctor`, future `sm extensions
list --mode probabilistic`, the UI inspector) can read.

**Why patch (not minor)**: pure runtime catch-up to a spec change that
already shipped. No new public API, no new verb, no new behaviour. The
optional `mode?` on `IDetector` / `IRule` is a backwards-compatible
additive widen — existing code that constructs these objects keeps
compiling without an update.
