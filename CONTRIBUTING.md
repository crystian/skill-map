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

## Versioning — changesets + integrity hashes

Every PR that touches a workspace (`spec/` today; `src/` later) **must** include a changeset. CI blocks the merge otherwise.

### Creating a changeset

```bash
npm run changeset
```

Pick the affected package(s), the bump type, and write a one-paragraph summary. Commit the generated `.changeset/*.md` with your change.

Bump policy:

- **Breaking change** → `major` (pre-1.0: breaking lands in `minor` until v1.0.0; see `spec/versioning.md`).
- **Additive change** → `minor`.
- **Fix / internal** → `patch`.

### What happens on merge

1. PR to `main` → CI checks changeset presence + `spec/index.json` integrity.
2. Merge to `main` → `release` workflow opens (or updates) a **"Version Packages"** PR that bumps `package.json`, consumes the changesets, and updates CHANGELOGs.
3. Merge the Version Packages PR → publishes to npm and creates a git tag.

Nothing ships to npm without an explicit merge of the Version Packages PR.

### Integrity hashes

`spec/index.json` carries a sha256 per file shipped. Regenerate after any change under `spec/`:

```bash
npm run spec:index          # regenerate
npm run spec:check          # verify (used by CI)
```

A CI step runs `spec:check` on every PR. Drift → red build.

### Version Packages PR exception

The bot-opened branch `changeset-release/*` is exempt from the "changeset required" check — it consumes changesets rather than adding them.

## License

By contributing you agree that your contributions will be licensed under the [MIT License](./LICENSE).
