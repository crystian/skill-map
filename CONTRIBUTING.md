# Contributing to skill-map

Thanks for your interest in `skill-map`. The project is in active pre-1.0 development — Steps 0a–9 are complete, Step 14 (Full Web UI) is in progress, and wave 2 (job subsystem + LLM verbs) follows. See [ROADMAP.md](./ROADMAP.md) for the full design narrative, decision log, and the canonical completeness marker.

## Before contributing

- Read [ROADMAP.md](./ROADMAP.md) end-to-end. It captures the architectural non-negotiables (kernel-first, spec as public standard, deterministic by default, CLI-first, tests from commit 1).
- Read [AGENTS.md](./AGENTS.md) for the day-to-day operating rules (changeset discipline, version-bump policy, kernel boundaries, sanitization, i18n, lint).
- Check the decision log in the roadmap before proposing something that was already considered and deferred / discarded.

## Contribution channels

- **Bug reports + feature proposals**: [GitHub Issues](https://github.com/crystian/skill-map/issues). For non-trivial proposals, open an issue first to align on shape before writing code.
- **Pull requests**: against `main`, with a `.changeset/*.md` describing the bump (see below).

## Code standards

- TypeScript strict mode, Node ESM, Node ≥ 24.0.
- Every extension ships a sibling `*.test.ts`. Missing test → contract check fails → tool does not boot.
- No feature is added without updating `spec/` first (when normative). Spec > ROADMAP > AGENTS, in that authority order.
- Lint clean: `npm run lint` (CI runs it via `npm run validate`). Both errors AND warnings block CI — there are no `warn` rules in the config.
- All artifacts in English (code, commits, PRs, docs). Conversation language follows the activation rule in AGENTS.md.

## Versioning — changesets + integrity hashes

Every PR that touches a published workspace (`spec/`, `src/`, `testkit/`, and `ui/` once it flips public) **must** include a changeset. CI blocks the merge otherwise.

### Creating a changeset

```bash
npm run changeset
```

Pick the affected package(s), the bump type, and write a one-paragraph summary. Commit the generated `.changeset/*.md` with your change.

### Bump policy

- **Breaking change**:
  - Post-1.0: `major`.
  - **Pre-1.0** (workspace still in `0.Y.Z`): `minor`. Per [`spec/versioning.md`](./spec/versioning.md) § Pre-1.0, breakings are allowed inside minor bumps pre-1; the first `1.0.0` is a deliberate stabilization moment, not a side-effect of a normal PR. If a changeset proposes `major` while the workspace is pre-1, downgrade it to `minor` and document the breaking change in the workspace `CHANGELOG.md`.
- **Additive change** → `minor`.
- **Fix / internal** → `patch`.

### What happens on merge

1. PR to `main` → CI checks changeset presence + `spec/index.json` integrity + `context/cli-reference.md` integrity + lint + build + tests.
2. Merge to `main` → `release` workflow opens (or updates) a **"Version Packages"** PR that bumps `package.json` files, consumes the changesets, and updates CHANGELOGs.
3. Merge the Version Packages PR → publishes to npm and creates a git tag.

Nothing ships to npm without an explicit merge of the Version Packages PR.

### Integrity hashes

`spec/index.json` carries a sha256 per file shipped. Regenerate after any change under `spec/`:

```bash
npm run spec:index          # regenerate
npm run spec:check          # verify (used by CI)
```

A CI step runs `spec:check` on every PR. Drift → red build.

Same discipline applies to the auto-generated CLI reference at `context/cli-reference.md`:

```bash
npm run cli:reference       # regenerate from `sm help --format md`
npm run cli:check           # verify (used by CI)
```

### Version Packages PR exception

The bot-opened branch `changeset-release/*` is exempt from the "changeset required" check — it consumes changesets rather than adding them.

## See also

- [ROADMAP.md](./ROADMAP.md) — design narrative, decisions, execution plan.
- [AGENTS.md](./AGENTS.md) — operating manual for AI agents, spec editing rules, maintenance checklist, kernel boundary invariants.
- [spec/versioning.md](./spec/versioning.md) — semver policy for the spec (patch/minor/major definitions).
- [spec/CHANGELOG.md](./spec/CHANGELOG.md) — spec-specific release history.

## License

By contributing you agree that your contributions will be licensed under the [MIT License](./LICENSE).
