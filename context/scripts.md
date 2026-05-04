# context/scripts.md — npm scripts and workspaces

Conventions for npm scripts in the skill-map monorepo. Same authority level as `AGENTS.md`. Required reading when touching `package.json` (root or workspace) or any `scripts/*` invoked from an npm script.

## Naming pattern

`component:action` for every root-level shortcut: `bff:dev`, `cli:build`, `ui:dev`, `ui:build`, `e2e:dev`, `web:dev`, `web:build`, `demo:dev`, `demo:build`, `release:changeset`, `release:version`, `release:publish`. **No exceptions** for new root scripts.

## What lives in root, what lives in a workspace

**Root exposes only**:

- Daily shortcuts `component:dev` and `component:build` per component. "Daily" = something a dev uses several times per session. If it's sporadic (analyze, coverage, etc.), it doesn't belong here.
- Cross-workspace orchestrators: `lint`, `lint:fix`, `validate`.
- Release tooling: `release:changeset`, `release:version`, `release:publish`.
- Cross-workspace combos that no single workspace covers on its own: `demo:build` (UI + scripts + fixtures), `demo:dev`.

**Everything else lives in its workspace**: typecheck, test, test:ci, test:coverage, lint, build, secondary dev modes, bundle-analyze, watch builds, clean. Invoke with `npm run X --workspace=Y` or by entering the workspace.

## The `validate` contract

Each workspace exposes its own self-contained `validate` — it runs whatever makes sense to validate for that component, without depending on prior root-level steps.

| Workspace | `validate` |
|---|---|
| `@skill-map/spec` | `spec:check` (index + coverage) + `pin:check` |
| `@skill-map/cli` | `typecheck` + `lint` + `build` + `test:ci` + `reference:check` |
| `ui` | `test:ci` + `build` |
| `@skill-map/testkit` | `typecheck` + `build` + `test:ci` |
| `skill-map-e2e` | `test:ci` (with `prevalidate` that prepares demo + browsers) |
| `@skill-map/example-hello-world` | `test:ci` |
| `@skill-map/web` | `build` |

Root orchestrates with `npm run validate --workspaces --if-present`. CI runs only this command — the individual steps in the `validate` job are removed as each workspace adopts its own `validate`.

### Consumer workspaces and `prevalidate`

When a workspace depends on external artifacts to validate (e.g. e2e needs `web/demo/` built + Playwright browsers), use the npm `prevalidate` hook to self-prepare. Example in `e2e/package.json`:

```json
"prevalidate": "npm run install:browsers && npm --prefix .. run demo:build",
"validate": "npm run test:ci"
```

The root orchestrator does not know nor need to know the order — each workspace declares its prerequisites via `prevalidate`.

## Special cases (intentional asymmetries)

- **BFF** is not a workspace (it lives embedded in `src/server/` and ships as part of the CLI). But `bff:dev` exists at root because iterating on the BFF has its own mental identity.
- **Demo** is a cross-workspace artifact (built UI + scripts + fixtures), not a workspace. Its root shortcuts reflect the artifact's reality.
- **`start`** stays at root but is pending redesign: the end target is to bring up BFF + UI in parallel.

## Anti-patterns

- ❌ **Root scripts that delegate to a single specific workspace.** Skews the monorepo and breaks symmetry. If it only applies to one workspace, it lives in the workspace. Exception: genuine cross-workspace combos like `demo:build`.
- ❌ **Scripts duplicated with the orchestrator.** Root `validate` covers lint + test + build + typecheck per workspace; a redundant root `lint` alongside `validate` is noise. Keeping `lint`/`lint:fix` at root is justified only as a quick-iteration shortcut (not orchestration).
- ❌ **Root npm scripts that invoke a workspace's own `.js`.** If the `.js` belongs to the workspace, the npm script that invokes it lives in the workspace. Root only invokes via `npm run X --workspace=Y` (not via `node workspace/scripts/foo.js`).
- ❌ **Aliases that break `component:action`.** `start`, `web` (no action), `site:build` (made-up "site" component), `smoke:demo` (action first) — all removed or renamed. Do not reintroduce them.

## Policy for scripts in root `scripts/`

A `.js` in root `scripts/` is justified only if **it is genuinely cross-workspace** (CI invokes it directly, or ≥2 workspaces use it). If it belongs to a workspace, move it inside and expose it via that workspace's npm script.

**Current state** (pending migration):

| Script | Natural home |
|---|---|
| `build-spec-index.js`, `sync-spec-pin.js`, `check-coverage.js` | `spec/` |
| `build-cli-reference.js`, `dev-serve.js` | `src/` (CLI) |
| `dev-server.js`, `build-site.js`, `build-demo-dataset.js`, `patch-demo-mode.js`, `serve-demo.js` | `web/` (site + demo) |
| `open-sqlite-browser.js` | disappears when `sqlite` migrates to a CLI sub-command |
| `check-changeset.js` | cross-cutting utility (CI-only); stays at root |

`check-coverage.js` also depends on cwd (uses `resolve('spec/...')` without an anchor) — migrating it fixes that.

## Railway deploy with paths filter

The public site (`skill-map.dev`) runs on Railway via Docker. The standard GitHub ↔ Railway integration deploys on every push to `main`, which generates unnecessary deploys when the commit doesn't touch what the site exposes (changes to `src/`, `testkit/`, `e2e/`, etc. don't alter the deployed output).

The policy: **deploy only when something the site actually publishes changes**. Implemented in `.github/workflows/deploy-web.yml` with a GitHub Actions `paths:` filter. If no file in the filter changes, the workflow doesn't fire and Railway receives nothing.

### Paths that trigger a deploy

| Path | Reason |
|---|---|
| `web/**` | landing page source |
| `ui/**` | Angular bundle served under `/demo/` |
| `spec/**` | schemas served under `/spec/v0/` (canonical URL) |
| `fixtures/demo-scope/**` | input to the demo dataset build |
| `Dockerfile`, `Caddyfile` | deploy and server config |
| `package.json`, `package-lock.json` (root) | deps installed by the Docker build |

Changes outside that list (`src/`, `testkit/`, `e2e/`, `examples/`, `context/`, `.claude/`, root docs, etc.) do **not** trigger a deploy.

### Accepted edge cases

- In-flight changes to `spec/` that aren't a release still trigger a deploy. Deliberate: the site is the canonical URL for the schemas and must reflect the `main` branch.
- CLI changes (`src/`) that may affect what `build-demo-dataset.js` emits do not trigger a deploy. We accept that the demo's `data.json` regenerates on the next legitimate deploy.

### One-time manual setup

All under GitHub repo Settings → Secrets and variables → Actions:

1. **Secrets** tab → New repository secret `RAILWAY_TOKEN` with a token generated from the Railway dashboard (Project → Settings → Tokens).
2. **Variables** tab → New repository variable `RAILWAY_SERVICE` with the service name as it appears in Railway (what `--service` expects).
3. In the Railway dashboard, **disconnect the GitHub ↔ Railway integration** (otherwise there's a double path: Railway's auto-deploy + the workflow). The workflow is the only official deploy path.

### How to modify the filter

When the deploy gains or loses a dependency on a new path, update the `paths:` block in `.github/workflows/deploy-web.yml` and the table above. Keep them in sync.

### Site versioning

`@skill-map/web` (private workspace) is versioned separately from spec and CLI. The version is the deploy tag:

- **GitHub Actions** shows the dynamic job name (`v0.1.0`) read from `web/package.json` at runtime.
- **Changeset rule**: any PR that touches `web/` must declare a changeset that bumps `@skill-map/web` (same as spec/cli/ui).

### Versions in the landing footer

Three tags in the footer, with two distinct policies depending on what each version represents:

| Tag | Source | Policy | Reason |
|---|---|---|---|
| `spec v…` | `spec/package.json` | **build-time** (`{{SPEC_VERSION}}` placeholder) | The site serves the schemas itself at `/spec/v0/`. The version shown in the footer MUST match what the site delivers — otherwise it would be misleading. |
| `web v…` | `web/package.json` | **build-time** (`{{WEB_VERSION}}` placeholder) | This is the site's own version. Build-time is trivially correct. |
| `cli v…` | `https://registry.npmjs.org/@skill-map/cli/latest` | **runtime fetch** (`web/app.js`) | The site does NOT serve the CLI (it's installed via `npm i -g @skill-map/cli`). The footer reports "the latest published on npm", not something the site delivers. Build-time would go stale between deploys. If the fetch fails (offline, npm down), the `cli v—` placeholder stays in place. |

**To add a new build-time version** (e.g. `testkit`): add it to `versions = {…}` in `web/scripts/build-site.js`, add the `replaceAll('{{X_VERSION}}', versions.x)`, and put the span in the HTML footer.

**To add a new runtime version** (e.g. another npm package): copy the `app.js` snippet with another `data-x-version` selector.

## Git hooks

`.githooks/pre-commit` runs the `validate` of the `@skill-map/spec` workspace when the commit touches `spec/` (silent otherwise). Catches the case where a file under `spec/` is modified and regenerating `spec/index.json` is forgotten — the sha256 integrity would be out of date and CI would fail on another branch.

The hook hooks itself in automatically: the root `package.json` `prepare` script runs `git config core.hooksPath .githooks` every time someone runs `npm install`. No manual setup per contributor.

To add other checks to the hook (e.g. cli-reference when the CLI changes), add the matching branch in `.githooks/pre-commit` following the existing pattern.

## When to add / move / remove

- **Add a root script**: only if it's a daily `component:action` shortcut for a component that already has a workspace, or if it's a genuine cross-workspace orchestrator. When in doubt, it goes in the workspace.
- **Add a workspace script**: free, following npm convention (`build`, `dev`, `test`, `test:ci`, `lint`, `validate`).
- **Move a script from root to a workspace**: update every reference (CI, docs, other scripts), run `npm run validate` before committing.
- **Remove a script**: same, and verify it doesn't break `release.yml` (release scripts are invoked by name from the Changesets action).
