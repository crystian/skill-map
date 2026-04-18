# skill-map

> Map, inspect and manage collections of interconnected Markdown files — especially skills, agents, commands, hooks and documents that compose AI agent ecosystems.

**Status**: pre-implementation. See [ROADMAP.md](./ROADMAP.md) for full design, architecture decisions, and execution plan.

## In a sentence

A graph explorer for Markdown-based AI agent ecosystems (Claude Code, Codex, Gemini, Copilot and others). Detects references between files, trigger collisions, orphans, external dependencies, and token/byte weight. CLI-first, fully deterministic offline, with optional LLM layer for semantic analysis.

## Non-negotiables

- **Kernel-first** from day zero — six extension kinds (Detector, Adapter, Rule, Action, Audit, Renderer). Kernel never contains platform-specific logic.
- **Spec as a public standard** — JSON Schemas + conformance suite live in `spec/`. Any implementation (CLI, UI, bindings in other languages) consumes the spec, not the reference implementation.
- **Deterministic by default** — LLM is never required. Full product works offline up to the LLM layer milestone.
- **Test suite from commit 1** — contract, unit, integration, self-scan, CLI, snapshot.
- **CLI-first** — every feature exposed via `sm` / `skill-map`. Web UI is a consumer of the same surface.

## Links

- Full design and roadmap: [ROADMAP.md](./ROADMAP.md)
- License: [MIT](./LICENSE)

## License

MIT © Crystian
