---
"@skill-map/spec": minor
---

Trim `frontmatter/base.schema.json` to the truly universal contract: `name` + `description` are the only required fields, every node on every Provider, and `additionalProperties: true` lets vendor-specific keys flow through silently.

The previous base inadvertently curated a Claude-flavored shape (`tools`, `allowedTools`, full `metadata` block with `version` required, etc.). skill-map AGGREGATES vendor specs, it does not curate them — so per-vendor frontmatter shapes belong in the Provider that emits the kind. The Anthropic-specific catalog now lives entirely under `src/built-in-plugins/providers/claude/schemas/` and absorbs Anthropic's documented frontmatter verbatim (see the matching `@skill-map/cli` changeset).

The future home for skill-map-only annotation fields (provenance, cross-vendor metadata, source URL, supersedes/supersededBy) is a deferred decision — sidecar file vs in-frontmatter block — tracked separately. Existing files that carry `metadata: { version, ... }` continue to validate without any change because of `additionalProperties: true`; nothing breaks at the consumer edge.

Decision #55 (full metadata block in the universal base) is superseded by this change.

Breaking but greenfield-permitted per `versioning.md` § Pre-1.0: ships as a minor bump because `@skill-map/spec` is still 0.x and Decision #55 had not reached any released consumer that mandates the prior shape. Stays minor; the first 1.0.0 is a deliberate stabilization moment, not a side-effect of this PR.
