---
'@skill-map/spec': major
---

Spec — Execution modes (deterministic / probabilistic) lifted to a first-class architectural property

Frames a meta-property of skill-map that was previously implicit and scattered:
**every analytical extension is one of two modes** — `deterministic` (pure code,
runs in scan-time pipelines) or `probabilistic` (invokes an LLM through
`RunnerPort`, runs only as queued jobs). The dual-mode capability now spans four
of the six extension kinds; Adapter and Renderer remain locked to deterministic
because they sit at the system boundaries (filesystem and graph-to-string) where
non-determinism would break boot reproducibility and snapshot diffing.

**Spec changes:**

- `architecture.md` — new top-level section **§Execution modes** before
  §Extension kinds. Defines the two modes, the per-kind capability matrix
  (Detector / Rule / Action dual-mode by manifest declaration; Audit dual-mode
  with mode **derived** from `composes[]`; Adapter / Renderer deterministic-only),
  the runtime separation (`deterministic` runs in `sm scan` / `sm check`;
  `probabilistic` runs only via `sm job submit <kind>:<id>`), and the
  `RunnerPort` injection contract for probabilistic extensions.
- `architecture.md` §Extension kinds — table updated: each row clarifies the
  mode posture (Adapter / Renderer marked deterministic-only; Detector / Rule /
  Action marked dual-mode; Audit marked derived-mode).
- `architecture.md` §Stability — new clause: execution modes and the per-kind
  capability matrix are stable as of v1.0.0; adding a third mode, changing
  which kinds are dual-mode, or changing the audit's derivation rule is a major
  bump.

**Schema changes:**

- `schemas/extensions/detector.schema.json`:
  - New optional `mode` field (`deterministic` | `probabilistic`, default
    `deterministic`). Omitting is equivalent to deterministic — keeps existing
    detectors valid without an update.
  - Description updated to spell out the dual-mode contract.
- `schemas/extensions/rule.schema.json`:
  - Same shape: new optional `mode` field with default `deterministic`.
  - Description rewritten — the previous "Rules MUST be deterministic" claim
    moved into the deterministic-mode contract; probabilistic rules are now
    explicitly allowed and run only as queued jobs.
- `schemas/extensions/action.schema.json`:
  - **Breaking** — `mode` enum renamed: `local` → `deterministic`,
    `invocation-template` → `probabilistic`. Pre-1.0; no consumers depend on
    the old values (no third-party action plugins shipped). Description, the
    two `if/then` branches, and the `expectedDurationSeconds` /
    `promptTemplateRef` field descriptions updated accordingly.
  - **Bug fix** — the schema previously declared `allOf` twice at the root
    (lines 6–8 and 71–80); the second silently overrode the first, dropping
    `$ref: base.schema.json`. Both blocks are now merged into a single `allOf`
    so the action schema actually composes the base shape.
- `schemas/extensions/audit.schema.json`:
  - Description rewritten — the "deterministic workflow" claim is replaced by
    the **derived-mode** rule: the audit's effective mode is computed from
    `composes[]` at load time. If every composed primitive is deterministic,
    the audit is deterministic; if any is probabilistic, the audit is
    probabilistic and dispatches as a job. Declaring `mode` directly is a
    load-time error.
  - `composes[]` description updated to mention that each primitive's mode
    participates in derivation; dangling references stay a load-time error.
  - `reportSchemaRef` description updated: probabilistic audits MUST extend
    `report-base.schema.json` (carries `safety` / `confidence`); deterministic
    audits MAY extend it but are not required to.
- `schemas/extensions/adapter.schema.json`:
  - Description updated to state explicitly that adapters are deterministic-only
    and that `mode` MUST NOT appear. Recommendation for users who want
    LLM-assisted classification: write a probabilistic Detector that emits
    classification hints as `Link[]`.
- `schemas/extensions/renderer.schema.json`:
  - Description updated to state that renderers are deterministic-only and
    that `mode` MUST NOT appear. Probabilistic narrators of the graph belong
    in jobs and emit Findings, not in renderer manifests.

**Why major (despite pre-1.0 minor norm):**

Renaming the `Action.mode` enum (`local` → `deterministic`,
`invocation-template` → `probabilistic`) is breaking by definition. No
third-party Actions exist yet, but the rename touches the canonical surface and
deserves the bump. New optional fields on Detector / Rule and the new derived-
mode contract on Audit are additive and would have been minor on their own.

**Implementation work intentionally NOT included here:**

- `src/extensions/built-ins.ts` and the per-extension TS files keep working
  unchanged because the new `mode` is optional with `deterministic` default.
  Explicitly threading `mode: 'deterministic'` through every built-in is a
  follow-up.
- `RunnerPort` injection through `ctx.runner` for probabilistic extensions is
  spec'd here; the actual context plumbing lands with the first probabilistic
  extension (Step 10 — first summarizer). `MockRunner` continues to satisfy
  tests until then.
- Conformance case `extension-mode-derivation` (audit composes mixed
  primitives → derives `probabilistic`) is mentioned in `architecture.md` and
  pending under `spec/conformance/coverage.md` for the next release.
- ROADMAP.md rephrase of Steps 10–11 (from "summarizers" to "wave 2:
  probabilistic extensions") and a positioning section in `README.md` follow
  in separate commits to keep this changeset spec-only.
