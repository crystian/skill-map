# skill-map

> Map, inspect and manage collections of interconnected Markdown files — especially skills, agents, commands, hooks and documents that compose AI agent ecosystems.

**Status**: Steps **0a** (spec bootstrap) and **0b** (reference-implementation bootstrap) are **complete**. The `@skill-map/spec` npm package is live (currently `0.1.1`); the `skill-map` CLI ships a stub scan verb and boots cleanly. Next up: **0c — UI prototype**. See [ROADMAP.md](./ROADMAP.md) for the completeness marker and full execution plan.

## In a sentence

A graph explorer for Markdown-based AI agent ecosystems (Claude Code, Codex, Gemini, Copilot and others). Detects references between files, trigger collisions, orphans, external dependencies, and token/byte weight. CLI-first, fully deterministic offline, with optional LLM layer for semantic analysis.

## Non-negotiables

- **Kernel-first** from day zero — six extension kinds (Detector, Adapter, Rule, Action, Audit, Renderer). Kernel never contains platform-specific logic.
- **Spec as a public standard** — JSON Schemas + conformance suite live in `spec/`. Any implementation (CLI, UI, bindings in other languages) consumes the spec, not the reference implementation.
- **Deterministic by default** — LLM is never required. Full product works offline up to the LLM layer milestone.
- **Test suite from commit 1** — contract, unit, integration, self-scan, CLI, snapshot.
- **CLI-first** — every feature exposed via `sm` / `skill-map`. Web UI is a consumer of the same surface.

## Specification

The specification lives in [`spec/`](./spec/) and is the source of truth. It is separated from the reference implementation from day zero so third parties can build alternative implementations using only `spec/`.

- Canonical URL: **[skill-map.dev](https://skill-map.dev)** (schemas served at `https://skill-map.dev/spec/v0/<path>.schema.json`).
- npm package: [`@skill-map/spec`](https://www.npmjs.com/package/@skill-map/spec) (live; version tracked in `spec/package.json` and `spec/CHANGELOG.md`).
- Contents:
  - 21 JSON Schemas (draft 2020-12): domain (`node`, `link`, `issue`, `scan-result`, …), frontmatter (`base` + 5 kinds), summaries (5 kinds), plus `conformance-case`.
  - 7 prose contracts: `architecture`, `cli-contract`, `job-lifecycle`, `job-events`, `prompt-preamble`, `db-schema`, `plugin-kv-api`.
  - 1 interface: `security-scanner`.
  - Conformance suite stub: fixtures + 1 declarative case.

## Repo layout

```
skill-map/
├── spec/                      specification (schemas + prose + conformance)
├── scripts/build-site.mjs     builds the public site from spec/
├── Dockerfile                 Caddy-based image deployed to Railway
├── Caddyfile                  serves schemas at the canonical URLs
├── .github/workflows/         spec-validate CI (JSON parse + $id alignment)
├── AGENTS.md                  agent conventions + current bootstrap status
├── CLAUDE.md                  persona activation (alias of AGENTS.md)
├── ROADMAP.md                 design narrative (decisions, phases, deferred)
└── CHANGELOG.md               project-wide change log
```

## Links

- Full design and roadmap: [ROADMAP.md](./ROADMAP.md)
- Spec surface and maintenance rules: [AGENTS.md](./AGENTS.md) (section "Spec bootstrap status")
- Spec changelog: [spec/CHANGELOG.md](./spec/CHANGELOG.md) (versioned independently from this repo)
- License: [MIT](./LICENSE)

## License

MIT © Crystian
