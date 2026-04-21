---
"@skill-map/spec": minor
---

Align the frontmatter tools story with Claude Code's own conventions (the audit pass surfaced that the spec had `tools` on agent only and no equivalent for skills, while `ROADMAP.md` decision #55 referenced a non-existent `expected-tools` field).

**`spec/schemas/frontmatter/base.schema.json` — two new top-level optional fields:**

- `tools: string[]` — **allowlist**. When present, the host MUST restrict the node to exactly these tools. Matches Claude Code's subagent `tools` frontmatter. Kind-specific interpretation: an `agent` uses it to lock the spawned subagent; a `skill` uses it as a declarative hint (skills typically inherit their parent's tools, but the field is carried for parity and discovery); other kinds use it as information only.
- `allowedTools: string[]` — **pre-approval**. Tools the host MAY use without per-use permission prompts while the node is active. Distinct from `tools`: every other tool remains callable, governed by the host's normal permission settings. Matches Claude Code's skill `allowed-tools` frontmatter. Accepts argument-scoped patterns where the host supports them (e.g. `Bash(git add *)`).

**`spec/schemas/frontmatter/agent.schema.json`:** `tools` removed from the kind-specific body because it now lives on `base` and is inherited via `allOf`. The agent schema's title/description updated to reflect that only `model` remains kind-specific. Consumers reading `tools` from an agent frontmatter see no behavioural change — the field is still there, just sourced from `base`.

`expectedTools` on `extensions/action.schema.json` is unchanged. That field is a hint from an action template to the runner (which tools the rendered prompt expects access to) — a distinct semantics from the node-level `tools` / `allowedTools` pair, and the name difference preserves the distinction.

Classification: minor per §Pre-1.0. Additions to `base` are optional fields in a permissive schema (no break for existing frontmatter). Removing `tools` from the agent schema's own properties is compatible because `allOf: [base]` continues to supply it — any document that validated before still validates, any document that used `additionalProperties: true` is unaffected. Matching `ROADMAP.md` updates (§Frontmatter standard, decision #55) land in the same change.
