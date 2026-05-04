---
---

Monorepo tooling reorganization: every npm script in the root now follows the `componente:acción` pattern (`bff:dev`, `cli:build`, `ui:dev`, `ui:build`, `e2e:dev`, `web:dev`, `web:build`, `demo:dev`, `demo:build`, `release:changeset` / `release:version` / `release:publish`), each workspace exposes a self-contained `validate` script, and the root orchestrator runs them via `npm run validate --workspaces --if-present`. New private workspaces `examples/hello-world` and `web` join the tree; demo / local-scope fixtures move from `ui/fixtures/` to `fixtures/` (no longer UI-specific), and `e2e/scripts/serve-demo.js` moves to `scripts/serve-demo.js`.

Empty changeset: `@skill-map/spec` and `@skill-map/cli` are touched only in their `package.json#scripts` field — no impact on the published surface (schemas, prose contracts, conformance suite, CLI binary, verbs, flags, kernel exports are unchanged). Per the `.changeset/README.md` "non-semver-relevant" guidance, this commit ships an empty changeset to satisfy the `check-changeset.js` CI gate without bumping any version. The convention itself is documented in the new `context/scripts.md` annex.
