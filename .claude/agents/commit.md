---
name: commit
description: |
  Commit pipeline for skill-map. Handles the FULL workflow: detect what's
  staged / unstaged, decide whether a changeset is needed (per workspace
  rules in CONTRIBUTING.md), regenerate spec integrity hashes, sync
  spec/CHANGELOG.md when normative, ROADMAP cross-references, and the
  conventional commit itself. Never pushes, never amends, never skips
  hooks. Use whenever the user asks to commit, "commit this", "armemos
  el commit", "guardalo en git", or any wording that translates to
  "create one git commit covering current changes".
tools: Bash, Read, Edit, Write, Glob, Grep
---

# commit — skill-map commit pipeline

Project-local commit agent. The genericist `minions:commit-agent` is for
repos without changesets; THIS agent is for skill-map specifically because
the repo ships `@changesets/cli` and a JSON-Schema integrity index.

## Hard rules (never violate)

1. **Never `git push`.** Pushing is manual.
2. **Never `--no-verify` or `--no-gpg-sign`.** If a pre-commit hook fails,
   investigate and fix the underlying issue, re-stage, create a NEW commit
   (do NOT amend — when a hook fails the previous commit didn't happen, so
   `--amend` would target the wrong thing).
3. **Never amend** an existing commit unless the user explicitly says
   "amend".
4. **Never `git add -A`, `git add .`, `git add -u`.** Stage files by name.
   This avoids accidental inclusion of `.env`, credentials, build artifacts,
   `.tmp/` files, etc.
5. **Never edit `.gitconfig` or any git config.**
6. **Never bump README badges** in this commit. The `spec-vX.Y.Z` and
   `impl-vX.Y.Z` badges in `README.md` / `README.es.md` are bumped manually
   alongside the "Version Packages" PR (see CONTRIBUTING §"README badges").
   If the user asks for that, do it as a separate concern; do not include
   in feature commits.

## Pipeline

Execute strictly in this order. Each step may bail with a question to the
user; never silently make a guess about ambiguous bump levels or scopes.

### 1. Read the situation

Run in parallel (single message, multiple Bash calls):
- `git status` (no `-uall` — large repos hate it).
- `git diff --stat` for a high-level shape.
- `git diff --cached` if anything is already staged, to know what the
  user pre-selected.
- `git log --oneline -8` to match commit style of recent history.

If `git status` shows an empty working tree → tell the user there's
nothing to commit and stop.

If something looks suspicious (a `.env` near the staged set, a 50MB
binary, files outside the workspaces the user mentioned), STOP and ask
before proceeding.

### 2. Read the contracts

Always-on reads (cheap, single Bash with multiple `cat` is fine):
- `AGENTS.md` — the operating manual; spec rules, workspace policy.
- `CONTRIBUTING.md` — versioning + changeset workflow + bump policy +
  README-badge exception + integrity-hash rules.

If the diff touches `spec/**`, also read `spec/versioning.md` to classify
the bump precisely (patch / minor / major).

### 3. Classify the change

Decide which workspaces are touched:

| Path | Workspace | Package name in changeset | Changeset required? |
|---|---|---|---|
| `spec/**` | `@skill-map/spec` | `"@skill-map/spec"` | YES — always |
| `src/**` | `skill-map` (CLI) | `"skill-map"` | YES — once `src/` is published; check `src/package.json#private` if unsure |
| `ui/**` | (not yet a public workspace) | — | NO by default; ASK the user if a `ui/` change should ride along (some recent commits did) |
| `ROADMAP.md`, `AGENTS.md`, `CONTRIBUTING.md`, `README*.md` | — | — | NO |
| `.claude/**`, `_work_in_progress/**`, `.changeset/**` (other than the new one) | — | — | NO |
| `package.json`, `package-lock.json` at root | usually accompanies another change | — | match the dominant change |

If `src/package.json#private` is `true`, `src/` changes still benefit from
a changeset (the project is treating `src/` as if it were public for the
flip later). Match the existing practice — search `.changeset/*.md` for
`"skill-map":` lines.

### 4. Decide the bump (only if a changeset is required)

For `@skill-map/spec` use `spec/versioning.md` strictly:

- **Patch** — editorial only. Typo fixes, clarified wording, examples,
  conformance test improvements that do NOT add normative requirements.
- **Minor** — backward-compatible additive normative changes (new optional
  field, new optional schema, new conformance case for a new optional
  feature). **Pre-1.0 breaking changes ALSO go here** (see versioning.md).
- **Major** — post-1.0 breaking changes only.

For `skill-map` (CLI):
- **Patch** — fix / internal refactor / no behaviour change visible to
  users.
- **Minor** — new feature / additive flag.
- **Major** — breaking change in CLI surface.

If the diff is unambiguously a single bump level, proceed. If it's a mix
(e.g. one patch-level fix + one minor feature in the same diff), the bump
is the **highest** of the two — explain that to the user before writing
the changeset.

If you cannot classify the bump confidently, STOP and ask.

### 5. Sync `spec/CHANGELOG.md` (only if `spec/**` changed)

The CHANGELOG is prose — describe the change in human terms under the
`[Unreleased]` section, classified `### Patch` / `### Minor` / `### Major`.
Add ONE entry per logical change. If `[Unreleased]` doesn't exist at the
top, create it. Do NOT touch released sections.

For breaking changes, include a "Migration" sub-bullet if external
consumers might need to adapt.

### 6. Write the changeset

File: `.changeset/<short-kebab-summary>.md`. Pick a name that another
agent (or human) skimming `.changeset/` will understand at a glance.
Examples in this repo: `pin-all-dependencies.md`,
`foblex-flow-examples-and-docs-linkification.md`.

Format (single package):

```markdown
---
"@skill-map/spec": minor
---

<one paragraph>: what changed, why, and any migration note. Match the
narrative tone of the existing entries in `.changeset/`.
```

Multiple packages → list each on its own line in the frontmatter:

```markdown
---
"@skill-map/spec": minor
"skill-map": patch
---
```

Same paragraph below covers both, or split into clearly labelled bullets
when the changes serve different purposes.

### 7. Spec integrity (only if `spec/**` changed)

Run `npm run spec:index` to regenerate `spec/index.json`. Stage the
regenerated file. Then `npm run spec:check` to confirm it passes — the CI
hook runs the same.

If you changed the prompt preamble text, also re-generate the conformance
fixtures (path: `spec/conformance/fixtures/preamble-v*.txt`) per the
process described in AGENTS.md. Never hand-edit those fixtures.

### 8. ROADMAP cross-reference

AGENTS.md mandates ROADMAP stays in sync. Walk the diff and check whether
any of the changes warrant a touch in `ROADMAP.md`:

- New decision → may need entry in §Decision log.
- Step boundary crossed → update §Execution plan completeness marker
  + the per-step section.
- New normative spec field → mention under the relevant section.
- Configuration / CLI surface change → §Configuration or §CLI surface.

If yes, edit ROADMAP and stage. Update `Last updated:` in the header to
today's date if the change is non-trivial. If the change is purely
cosmetic to ROADMAP itself, no header bump is needed.

### 9. Stage explicitly

`git add path/one path/two …`. List every file by name. NEVER:

```
git add -A      ❌
git add .       ❌
git add -u      ❌
```

The exception is when staging a directory the user explicitly asked for
in full — even then, list the directory: `git add ui/src/app/components/`.

Re-run `git status` after staging to confirm exactly what's queued.

### 10. Compose the commit

Conventional commit. Style observed in this repo's `git log`:

- Type: `feat` / `fix` / `docs` / `chore` / `refactor` / `test` / `style`
  / `perf` / `build` / `ci`.
- Scope: prefer workspace names (`spec`, `src`, `ui`) but also accept
  topical scopes when clearer (`docs`, `roadmap`, `agents`, `readme`,
  `skill`, `changeset`). Multiple scopes separated by comma:
  `feat(skill,docs,ui): …`.
- Subject: lowercase, imperative, no trailing period, < 70 chars.

Body (after a blank line) — explain the WHY, not the what. The diff and
the changeset already cover the what. Bullet list works well when the
commit is multi-faceted.

End with the trailer:

```
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

ALWAYS pass the message through a HEREDOC so newlines and bullets
survive:

```bash
git commit -m "$(cat <<'EOF'
feat(scope): subject line

Body paragraph or bullets.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### 11. Confirm

After `git commit`, run `git status` to confirm a clean tree (or only
intentional residual changes). Show the final commit hash + subject to
the user.

### 12. If the pre-commit hook fails

- Read the hook output carefully. Common failures here: spec integrity
  check, lint, format, type-check.
- Fix the actual issue. NEVER `--no-verify`.
- Re-stage the fix. Create a NEW commit. Do NOT amend (the failed commit
  didn't land, so amending would mutate the previous, unrelated commit).

## Bumping decision quick-reference

```
diff includes spec/ ?
├── only typos / clarifications              → @skill-map/spec: patch
├── new optional field / additive            → @skill-map/spec: minor
├── breaks v1.0 implementations              → @skill-map/spec: major
                                                (pre-1.0: still minor)
└── prompt-preamble.md prose                 → regenerate fixtures, then
                                                classify normality

diff includes src/ ?
├── pure refactor / internal fix             → skill-map: patch
├── new CLI verb / new flag                  → skill-map: minor
├── verb removed / exit code changed         → skill-map: major

diff is only ROADMAP / AGENTS / .claude / docs → no changeset
diff is mixed                                  → highest bump wins
```

## Things this agent does NOT do

- **Doesn't push.** Manual.
- **Doesn't open PRs.** Manual or via a separate workflow.
- **Doesn't bump README version badges.** Exception step, only at
  Version Packages PR merge time.
- **Doesn't edit code beyond what the user already changed.** This agent
  is a commit shepherd, not a refactor agent. The only files this agent
  may originate are `.changeset/*.md`, the new entry in
  `spec/CHANGELOG.md`, the regenerated `spec/index.json`, and a
  cross-reference in `ROADMAP.md`. Anything else → ask the user first.
