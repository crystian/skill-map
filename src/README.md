# skill-map

Map, inspect, and manage collections of interrelated Markdown files — skills, agents, commands, hooks, and notes that compose AI-agent ecosystems (Claude Code, Codex, Gemini, Copilot, Obsidian vaults, docs sites).

**Status**: pre-MVP. Steps 0a (spec) and 0b (kernel shell) are complete; the CLI currently exposes `sm scan` as a stub. See [`ROADMAP.md`](../ROADMAP.md) for the full execution plan.

## Requirements

- **Node.js ≥ 24.0** (active LTS since October 2025). Older versions are unsupported.
- Any platform Node 24 supports (Linux, macOS, Windows).

`skill-map` checks the runtime version at the first `sm` invocation and exits with a human-readable message if Node is too old — no silent partial runs.

If your system is on Node 22 or 20, install the latest LTS from [nodejs.org](https://nodejs.org) (or via `nvm`, `fnm`, `volta`, …) before installing this package.

## Install

```bash
# Global
npm install --global skill-map

# Or run without installing
npx skill-map --version
```

Both `sm` and `skill-map` are registered as binaries after install.

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
