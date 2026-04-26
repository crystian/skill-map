---
"@skill-map/spec": patch
"@skill-map/cli": patch
---

Move the auto-generated CLI reference from `docs/cli-reference.md` to
`context/cli-reference.md`. Spec change is editorial: `cli-contract.md`
references the file path in three spots (`--format md` description, the
NORMATIVE introspection section, and the "Related" link list); all three
updated to the new location. No schema or behavioural change.

Reference impl: `scripts/build-cli-reference.mjs` writes to the new path,
the `cli:reference` / `cli:check` npm scripts point there, and `sm help`
output (which embeds the path in the `--format md` flag description) is
regenerated. The `docs/` folder is gone.
