# skill-map

Map, inspect, and manage collections of interrelated Markdown files — skills, agents, commands, hooks, and notes that compose AI-agent ecosystems (Claude Code, Codex, Gemini, Copilot, Obsidian vaults, docs sites).

**Status**: pre-MVP / preview release. Steps 0a (spec), 0b (kernel shell), 0c (UI prototype), 1a-1c (kernel + registry + orchestrator), 2 (first extensions), and 3 (UI design refinement) are complete; the CLI currently exposes `sm scan` as a stub (full scan lands at Step 4). See [`ROADMAP.md`](../ROADMAP.md) for the full execution plan and the canonical completeness marker. Subsequent versions follow the standard changeset flow.

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

## Usage

```bash
sm --version                    # single-line version
sm version                      # multi-line matrix (sm / kernel / spec / runtime / db-schema)
sm --help                       # top-level help
sm scan [roots...] [--json]     # stub in 0b; full scan in Step 4
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

## License

MIT. See [`LICENSE`](../LICENSE).
