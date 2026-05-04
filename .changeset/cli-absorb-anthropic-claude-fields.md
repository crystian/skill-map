---
"@skill-map/cli": minor
---

Absorb Anthropic Claude's documented frontmatter verbatim into the Claude Provider's per-kind schemas, drop the obsolete `hook` node kind.

- `agent.schema.json` declares all 14 vendor-specific fields from https://code.claude.com/docs/en/agents.md (`tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `effort`, `isolation`, `color`, `initialPrompt`). camelCase preserved.
- New `skill-base.schema.json` carries the 13 shared fields from https://code.claude.com/docs/en/skills.md (Anthropic merged custom commands into skills): `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `model`, `effort`, `context`, `agent`, `hooks`, `paths`, `shell`. Naming reproduced verbatim — mix of kebab-case, snake_case, and camelCase. `skill.schema.json` and `command.schema.json` are thin `allOf` extensions of the new base; kept SPLIT (not aliased) because the registry differentiates them in `IProviderKind.ui` and the qualified `defaultRefreshAction`. No kind-only fields today; ready for divergence.
- `hook.schema.json` deleted. `.claude/hooks/*.md` is NOT an Anthropic convention — hooks live in `settings.json` or as sub-objects of agent / skill frontmatter (https://code.claude.com/docs/en/hooks.md). Files at the old path now classify as `note` via the Provider's fallback. `NodeKind` shrinks from `'skill' | 'agent' | 'command' | 'hook' | 'note'` to `'skill' | 'agent' | 'command' | 'note'`.
- New runtime field `IProvider.schemas?: unknown[]` lets a Provider declare auxiliary JSON Schemas its per-kind schemas `$ref` by `$id`. `buildProviderFrontmatterValidator` registers them via `addSchema` BEFORE compiling per-kind schemas, so cross-file `$ref` resolution succeeds. Used by the Claude Provider to register `skill-base.schema.json`. Runtime-only — does NOT appear in spec's `provider.schema.json` manifest.
- Conformance: `minimal-claude/hooks/` deleted; `basic-scan` now asserts 4 nodes (one per kind: agent, command, skill, note) instead of 5; `coverage.md` updated.

UI alignment ships in a follow-up PR — `ui/src/models/node.ts` carries an `ISummaryHook` shape and a `kind: 'hook'` literal that belong to a separate scope. Today's UI bundle still compiles and tests pass because the UI's `TNodeKind = string` (open) and never imported the kernel's narrowed `NodeKind`.

Breaking but greenfield-permitted per `versioning.md` § Pre-1.0: ships as a minor bump because `@skill-map/cli` is still 0.x and the only released consumers (the demo scope, the e2e fixtures) all carry `name`+`description` and no longer-required `metadata` keys (those flow through via `additionalProperties: true`). The frontmatter contract stays compatible at the consumer edge for every node that already validated. Stays minor; the first 1.0.0 is a deliberate stabilization moment, not a side-effect of this PR.
