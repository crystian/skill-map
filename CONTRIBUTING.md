# Contributing to skill-map

Thanks for your interest in `skill-map`. This project is in pre-implementation stage — see [ROADMAP.md](./ROADMAP.md) for the full design, current phase, and what is being built.

## Before contributing

- Read [ROADMAP.md](./ROADMAP.md) end-to-end. It captures the architectural non-negotiables (kernel-first, spec as public standard, deterministic by default, CLI-first, tests from commit 1).
- Check the decision log in the roadmap before proposing something that was already considered and deferred / discarded.

## Contribution channels

Until v0.1.0 ships, contributions are best raised as **GitHub Issues** for discussion. Once the MVP is out, a full contributor guide will replace this stub.

## Code standards (when code starts)

- TypeScript strict mode, Node ESM.
- Every extension ships a sibling `*.test.ts`. Missing test → contract check fails → tool does not boot.
- No feature is added without updating the `spec/` first.

## License

By contributing you agree that your contributions will be licensed under the [MIT License](./LICENSE).
