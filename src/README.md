# skill-map

Map, inspect, and manage collections of interrelated Markdown files — skills, agents, commands, hooks, and notes that compose AI-agent ecosystems (Claude Code, Codex, Gemini, Copilot, docs sites).

**Status**: pre-1.0, active development. Steps 0a–9 are complete (spec, kernel, plugin loader, full CLI surface, plugin author UX). Step 14 (Full Web UI) is in progress with sub-steps 14.1–14.4 closed (Hono BFF + REST + WebSocket broadcaster + reactive UI); 14.5–14.7 (polish + bundle budgets + responsive scope) still pending. The full deterministic scan, check, history, orphans, plugin authoring, and `sm serve` are live; the optional LLM layer (Phase B / `v0.8.0`) lands after Step 14 closes. See [`ROADMAP.md`](../ROADMAP.md) for the canonical completeness marker and full execution plan. Releases follow the standard changeset flow.

## Requirements

- **Node.js ≥ 24.0** (active LTS since October 2025). Older versions are unsupported.
- Any platform Node 24 supports (Linux, macOS, Windows).

`skill-map` checks the runtime version at the first `sm` invocation and exits with a human-readable message if Node is too old — no silent partial runs.

If your system is on Node 22 or 20, install the latest LTS from [nodejs.org](https://nodejs.org) (or via `nvm`, `fnm`, `volta`, …) before installing this package.

## Install

```bash
# Global
npm install --global @skill-map/cli

# Or run without installing
npx @skill-map/cli --version
```

Both `sm` (short, daily use) and `skill-map` (full name, scripts) are registered as binaries after install. The package name is scoped (`@skill-map/cli`) to sit alongside `@skill-map/spec` under the same npm org; the binaries keep the unprefixed names for ergonomics.

## Interactive tutorial (recommended starting point)

If you use [Claude Code](https://claude.ai/code), `sm tutorial` is the fastest way to learn the CLI and the live UI without committing your real project to anything:

```bash
mkdir try-skill-map && cd try-skill-map
sm tutorial                  # writes sm-tutorial.md into the empty dir
claude                       # open Claude Code in the same dir
# Inside Claude:
ejecutá @sm-tutorial.md
```

Claude loads the SKILL.md and runs the demo (~7 min): fixture, `sm init`, live UI, four "reveals" that show the watcher in action, plus the `.skillmapignore` hide-a-file flow. An optional deep-dive (~30-40 min) covers the rest of the CLI surface (`list`, `graph`, `export`, `orphans`, `plugins`, `db ops`).

The verb `sm tutorial` writes a single self-contained file; the SKILL.md ships inside this package, so no extra install needed.

## Usage

```bash
sm --version                    # single-line version
sm version                      # multi-line matrix (sm / kernel / spec / runtime / db-schema)
sm --help                       # top-level help
sm init                         # scaffold .skill-map/ in the current scope, run first scan
sm scan [roots...] [--json]     # walk roots, persist scan_* tables; pretty or JSON
sm list / sm show / sm check    # read-side reporters over the persisted scan
sm graph [--format <name>]      # render the graph (ascii / mermaid / dot when shipped)
sm export <query> --format ...  # filtered subgraph export (json / md)
sm watch [roots...]             # incremental scans on file change (chokidar)
sm serve [--port N]             # boot the bundled Web UI + Hono BFF (loopback-only)
sm plugins list / doctor / ...  # plugin discovery + diagnostics
sm db migrate / backup / ...    # DB management
```

For development inside the monorepo, two extra scripts are wired:

```bash
npm test          # full Node test suite (kernel + CLI + adapters + integration)
npm run lint      # ESLint flat config across every workspace that opts in
npm run build     # tsup → dist/ (bundles + types)
npm run validate  # alias for "all static checks"; CI runs this
```

Exit codes follow [`spec/cli-contract.md`](../spec/cli-contract.md):

| Code | Meaning |
|---|---|
| `0` | OK |
| `1` | Issues found at error severity |
| `2` | Operational error (bad flags, missing DB, unreadable file, runtime too old) |
| `3` | Duplicate job conflict |
| `4` | Nonce mismatch |
| `5` | Resource not found |

## Spec

This binary implements the [skill-map spec](https://www.npmjs.com/package/@skill-map/spec). The spec package ships JSON Schemas, conformance cases, and prose contracts; `skill-map` conforms to a declared range via its `specCompat`.

## Security: untrusted repositories

`sm scan` (and the verbs that include a scan: `refresh`, `watch`, `init`) auto-loads JavaScript plugins from `<cwd>/.skill-map/plugins/` by default. Running these commands inside a repository you do not control is equivalent to running `node ./.skill-map/plugins/*/index.js` — the plugin code executes with your user permissions.

If you cloned an untrusted repository, run with `--no-plugins` to disable third-party plugin loading, or audit the contents of `.skill-map/plugins/` before scanning.

A workspace-trust prompt is on the roadmap; until then this is an accepted risk.

## License

MIT. See [`LICENSE`](../LICENSE).
