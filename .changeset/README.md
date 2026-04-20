# Changesets — cheat sheet

This folder is managed by [changesets](https://github.com/changesets/changesets). Every PR that modifies a workspace package (`@skill-map/spec`, `skill-map`) **must** include a `.md` file here declaring the intended bump.

> Full policy in `CONTRIBUTING.md`. This README is the operational cheat sheet — commands and common scenarios.

---

## 1. Everyday flow (99% of PRs)

Run this **before pushing**:

```bash
npm run changeset
```

Interactive prompt:

1. **Which packages should get a major bump?** → usually none (pre-1.0). Press enter.
2. **Which packages should get a minor bump?** → use space to toggle, enter to confirm. Breaking changes go here while we're pre-1.0.
3. **Which packages should get a patch bump?** → for fixes / docs / internal.
4. **Summary** → one paragraph. User-visible language, not git-speak. This ends up verbatim in the CHANGELOG.

The tool writes a file like `.changeset/brave-pigs-sing.md`. **Commit it** with your code.

### Bump selection guide

| Change | Bump |
|---|---|
| New feature, additive schema field, new schema/case | `minor` |
| Bugfix, clarification in prose, internal refactor, tooling | `patch` |
| Breaking change **while pre-1.0** | `minor` (NOT `major` — pre-1.0 policy in `spec/versioning.md`) |
| Breaking change post-1.0 | `major` |
| PR doesn't touch any workspace file (root tooling, `.github/*`, root docs) | **no changeset** — CI `changeset` job won't ask for one |

If you're unsure, pick smaller — patch. CI doesn't validate semantic correctness of the bump, only that a changeset exists.

---

## 2. Inspecting state

```bash
npx changeset status              # show pending bumps per package
ls .changeset/                    # list pending .md files
cat .changeset/<name>.md          # read one
```

Example output:

```
🦋  info Packages to be bumped at minor:
🦋    - @skill-map/spec
🦋    - skill-map
```

Nothing means no changesets pending.

---

## 3. What happens when you merge to `main`

**You do not run `version` or `publish` manually.** CI handles it:

1. PR lands on `main` (your changeset is part of the diff).
2. `.github/workflows/release.yml` runs `changesets/action` on `main`.
3. If there are pending changesets, the action opens (or updates) a **"Version Packages" PR**:
   - Bumps `version` in every affected `package.json`.
   - Writes the summary into each affected `CHANGELOG.md`.
   - Deletes the consumed `.changeset/*.md` files.
4. You review that PR. When you merge it, the action runs `publish`:
   - `@skill-map/spec` goes to npm (public).
   - `skill-map` is `private: true` → skipped, but its version still bumps.
   - Git tags are created (`@skill-map/spec@0.1.0`, etc.).

**Key property**: nothing reaches npm without you explicitly merging the Version Packages PR. That is the human gate.

---

## 4. Manual commands (rarely needed)

You normally never run these. CI does. But if you need to simulate locally:

```bash
# Preview what Version Packages PR would look like:
npx changeset version
git diff --stat            # see the bumps + CHANGELOG changes
git checkout .             # REVERT before committing. Don't push this.

# Preview npm publish (after a real version bump):
npx changeset publish --dry-run
```

⚠️ `changeset version` deletes the `.md` files in this folder. If you ran it by accident:

```bash
# Tracked files (package.json, CHANGELOG.md):
git checkout package.json */package.json spec/CHANGELOG.md

# Untracked files (new changesets you hadn't committed):
# Those are LOST. Recreate them with `npm run changeset` or restore by memory.
```

---

## 5. The `changeset-release/*` branch

When the bot opens the Version Packages PR, it pushes to a branch named `changeset-release/main`. `scripts/check-changeset.mjs` **exempts** this branch from the "changeset required" gate — the Version Packages PR consumes changesets, it doesn't add new ones.

Don't manually create branches with that prefix.

---

## 6. Troubleshooting

**`Error: Found changeset X for package Y which is not in the workspace`**
The changeset references a package name not declared in root `package.json` `workspaces`. Fix: add the package to workspaces, or fix the `"..."` field in the changeset `.md`.

**CI's changeset job fails on my PR**
You didn't include a `.md`. Run `npm run changeset`, commit, push.

**I want to skip the changeset requirement for this PR**
If the PR genuinely touches no workspace files (e.g. root `README.md`, `.github/*`), the CI gate already skips. If you're touching a workspace file but the change is truly non-semver-relevant (e.g. comment-only), add an empty changeset:

```bash
npx changeset --empty
```

Commit the generated file. The gate will pass and no version will bump.
