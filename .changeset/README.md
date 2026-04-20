# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets). Every PR that modifies a published package (currently `@skill-map/spec`; `@skill-map/kernel` lands at Step 0b) **must** include a changeset.

## Creating a changeset

```bash
npm run changeset
```

Pick the affected packages, the bump type (`patch` / `minor` / `major`), and write a one-paragraph summary. The tool writes a markdown file in this folder; commit it with your change.

## Policy

- **Breaking change** → `major` (pre-1.0 rules apply: breaking goes in `minor` until v1.0.0; see `spec/versioning.md`).
- **Additive change** → `minor`.
- **Fix / docs / internal** → `patch`.
- **No user-visible change** (e.g. workspace tooling) → no changeset needed; CI is configured to allow PRs without one when no published file is touched.

## What happens next

1. PR CI verifies the changeset exists and is well-formed.
2. On merge to `main`, the `release` workflow opens (or updates) a **"Version Packages"** PR that consumes the pending changesets, bumps versions, and updates CHANGELOGs.
3. Merging that PR publishes to npm and tags the release.

Full flow: `CONTRIBUTING.md`.
