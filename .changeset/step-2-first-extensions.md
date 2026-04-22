---
"skill-map": minor
---

Step 2 — First extension instances.

Ships the reference implementation's eight built-in extensions and the orchestrator wiring that turns `sm scan` from a zero-filled stub into a real pipeline.

**Runtime contracts** (`src/kernel/extensions/`): five TypeScript interfaces mirroring the six extension-kind manifest schemas — `IAdapter`, `IDetector`, `IRule`, `IRenderer`, `IAudit`. A plugin's default export IS the runtime instance: the manifest fields (`id`, `kind`, `version`, `stability`, …) and the callable method(s) (`walk`, `detect`, `evaluate`, `render`, `run`) live on the same object, so ESM dynamic imports don't need a `new` dance.

**Shared utility `trigger-normalize`**: the six-step Unicode pipeline (NFD → strip `Mn` → lowercase → separator unification → whitespace collapse → trim) from `spec/architecture.md` §Detector trigger normalization. Every detector that emits invocation-style links uses it; the `trigger-collision` rule keys on its output.

**Adapter: `claude`.** Walks Claude Code's on-disk conventions (`.claude/agents/`, `.claude/commands/`, `.claude/hooks/`, `.claude/skills/<name>/SKILL.md`, plus `notes/**/*.md` and a catch-all → `note`), parses frontmatter via js-yaml (tolerant of malformed YAML), uses an async iterator so large scopes don't buffer, and honours a default ignore set (`.git`, `node_modules`, `dist`, `.skill-map`) plus any extras the caller passes.

**Detectors: `frontmatter`, `slash`, `at-directive`.** Frontmatter extracts structured refs from `metadata.supersedes[]`, `supersededBy` (inverted so the edge points from the new node), `requires[]`, `related[]`. Slash matches `/<command>` tokens in the body with namespace support (`/skill-map:explore`), dedupes on normalized trigger. At-directive matches `@<handle>` with email filtering (`foo@bar.com` skipped) and both scope/name and ns:verb namespaces.

**Rules: `trigger-collision`, `broken-ref`, `superseded`.** Trigger-collision buckets links by `trigger.normalizedTrigger` and emits error for any bucket with ≥2 distinct targets. Broken-ref resolves path-style targets against `node.path` and trigger-style targets against `frontmatter.name` (normalized, with the leading sigil stripped) — warn severity because authors commonly reference external artifacts. Superseded surfaces every `metadata.supersededBy` as an info finding on the source node.

**Renderer: `ascii`.** Plain-text dump grouped by node kind, then links, then issues. Minimal — mermaid/dot live as later drop-ins.

**Audit: `validate-all`.** Post-scan consistency check via AJV against `node.schema.json` / `link.schema.json` / `issue.schema.json`. Plugin manifests are already validated at load time by the PluginLoader (Step 1b), so this audit focuses on user content.

**Orchestrator wire-up.** `runScan()` now actually iterates: for each adapter, walk roots → classify → build Node (sha256 body/frontmatter hashes, triple-split bytes, stability/version/author denormalised), feed scope-appropriate detectors, collect links, denormalise `linksOutCount` / `linksInCount`, then run every rule over the graph. Links emitting a kind outside the detector's declared `emitsLinkKinds` allowlist are silently dropped.

**`sm scan`** defaults to the built-in set and exits 1 when the scan surfaces issues (per `cli-contract.md` §Exit codes). A new `--no-built-ins` flag reproduces the kernel-empty-boot zero-filled parity for conformance.

**Drop-in proof.** The orchestrator iterates `registry.all('<kind>')` — adding a 4th detector is one new file under `src/extensions/detectors/` plus one entry in `src/extensions/built-ins.ts`. Zero kernel edits. Step 3's `external-url-counter` ships as the live proof.

**Tests.** 52 new tests across normalization, claude adapter, three detectors, three rules, ascii renderer, validate-all audit, and an end-to-end scan against a fixture — 88 of 88 passing. The test glob widened to pick up the colocated `extensions/**/*.test.ts` and `kernel/**/*.test.ts` files that match the `src/extensions/README.md` convention ("each extension is a directory with a manifest + implementation + a sibling `*.test.ts`").

**Side touches.** `js-yaml` now runs on both sides of the workspace boundary (ui had it since Step 0c; the adapter brings it to src). `docs/cli-reference.md` regenerated to reflect the new `--no-built-ins` flag on `sm scan`.

Classification: minor per `spec/versioning.md` §Pre-1.0. Fourth feature surface after Steps 1a / 1b / 1c; `skill-map` bumps to the next minor.
