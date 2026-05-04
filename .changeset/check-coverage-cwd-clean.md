---
---

Follow-up to the script reorganization in `1f24334`: anchors `scripts/check-coverage.js` paths via `import.meta.url` (matching `build-spec-index.js`, `sync-spec-pin.js`, `serve-demo.js`, and `build-cli-reference.js`), drops the `cd ..` workaround from all four `spec/` workspace scripts (`spec`, `spec:check`, `pin`, `pin:check`), and relocates the `source-map-explorer` devDep from root to `ui/` where its only consumer (`ui:bundle-analyze`) lives. Same pin (`2.5.3`).

Empty changeset: `@skill-map/spec` is touched only in `index.json` (regenerated to catch up the `conformance/coverage.md` hash that `1f24334` mutated without re-running `spec:index`) and `package.json#scripts` (not in `files:`). No published surface changes — schemas, prose contracts, conformance suite, and CLI binary are unchanged. `@skill-map/cli` and `@skill-map/testkit` are untouched. Per the `.changeset/README.md` "non-semver-relevant" guidance, this ships an empty changeset to satisfy the `check-changeset.js` gate without bumping any version.
