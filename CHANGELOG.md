# Changelog

All notable changes to the project as a whole. The specification and the reference CLI have their own changelogs tracked separately:

- Spec: [`spec/CHANGELOG.md`](./spec/CHANGELOG.md) — versioned as `spec-vX.Y.Z`.
- CLI: `<src>/CHANGELOG.md` (lands with Step 0b) — versioned as `cli-vX.Y.Z`.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Added

- Initial project scaffolding: README, LICENSE (MIT), ROADMAP, CHANGELOG, CONTRIBUTING.
- **Spec bootstrap (Step 0a)** — `spec/v0.0.1`:
  - 21 JSON Schemas under `spec/schemas/` (draft 2020-12, camelCase): 10 top-level, 6 frontmatter (`base` + 5 kinds), 5 summaries.
  - 7 prose contracts: `architecture`, `cli-contract`, `dispatch-lifecycle`, `job-events`, `prompt-preamble`, `db-schema`, `plugin-kv-api`.
  - 1 interface: `interfaces/security-scanner.md`.
  - Conformance stub: `spec/conformance/` with `README.md`, a `minimal-claude` fixture (5 MDs, one per kind), `preamble-v1.txt` (verbatim-matched to `prompt-preamble.md`), and a first case `basic-scan.json`.
  - `@skill-map/spec` package skeleton: `spec/package.json`, `spec/index.json` machine-readable manifest.
  - Full bootstrap details and maintenance rules in [`AGENTS.md`](./AGENTS.md) under "Spec bootstrap status".
- **Public site infrastructure**:
  - `scripts/build-site.mjs` — Node ESM zero-dep builder. Copies schemas to `site/spec/v0/…` and verifies every `$id` equals its served URL (hard-fail on drift).
  - `Dockerfile` + `Caddyfile` — multi-stage Caddy-based image. Schemas served with `Content-Type: application/schema+json` and CORS `*`. Hardening headers (HSTS, `X-Content-Type-Options`, `Referrer-Policy`).
  - `.github/workflows/spec-validate.yml` — CI on every push/PR touching `spec/`. JSON parse check + build + `$id` verification.
  - Deployment: Railway reads the `Dockerfile`, DNS at Vercel points `skill-map.dev` at Railway.
