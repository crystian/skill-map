---
"@skill-map/spec": minor
---

Promote the trigger-normalization pipeline (Decision #21) from implicit to normative in `spec/architecture.md`.

Before this change, `link.trigger` carried `originalTrigger` and `normalizedTrigger` fields (defined in `schemas/link.schema.json`), and the `trigger-collision` rule keyed on the normalized value — but no spec prose documented **how** to normalize. The pipeline lived only in `AGENTS.md §Decisions already locked` and in `ROADMAP.md` as a one-line Step 6 bullet. That left implementations free to diverge, which silently breaks the `trigger-collision` rule across implementations (two conforming CLIs could disagree on whether `hacer-review` and `Hacer Review` collide).

Added under `architecture.md §Extension kinds`, paralleling the existing `Adapter · defaultRefreshAction` subsection:

- **Detector · trigger normalization** — field contract, normative 6-step pipeline, and 8 worked examples.

Pipeline (applied in exactly this order):

1. Unicode NFD.
2. Strip Unicode `Mn` (diacritics).
3. Lowercase (locale-independent).
4. Separator unification: hyphen / underscore / any whitespace run → single ASCII space.
5. Collapse whitespace (run of ≥2 spaces → 1 space).
6. Trim leading/trailing whitespace.

Non-letter / non-digit characters outside the separator set (`/`, `@`, `:`, `.`, etc.) are **preserved** — stripping them is the detector's concern, not the normalizer's. This keeps namespaced invocations (`/skill-map:explore`, `@my-plugin/foo`) comparable in their intended form.

§Stability in `architecture.md` updated: adding a new step at the end is a minor bump; reordering, removing, or changing any existing step (including the character classes in step 4) is a major bump. Implementations that produce different `normalizedTrigger` output for equivalent input are non-conforming.

Classification: minor. The pipeline was always the intent (Decision #21 existed since the 2026-04-19 session) and `schemas/link.schema.json` already carried the fields, but this is the first time the spec prose binds implementations to a specific algorithm. A strict v0 implementation that did not normalize (or normalized differently) would begin failing conformance at the next spec release; worth a minor bump so plugin authors and alternative impls see it in the changelog.

Companion prose in `ROADMAP.md §Trigger normalization` (Decision #21 now points here for full rationale + examples).
