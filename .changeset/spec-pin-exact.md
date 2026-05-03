---
'@skill-map/cli': patch
---

Pin `@skill-map/spec` to an exact version instead of the wildcard `"*"`. The wildcard let `npm install -g @skill-map/cli@X.Y` resolve the spec dep to whatever was newest in the registry at install time — not necessarily the version the CLI was tested against. End users could end up running an `X.Y` CLI binary against a spec it had never seen, producing the "code is one version, spec is OTA" symptom (renamed config keys rejected, documented flags missing, conformance suite drifting).

The pin is now exact and is automatically retagged to the current spec version on every `chore: version packages` PR via a new `scripts/sync-spec-pin.js` step wired into `changeset:version`. CI runs `--check` mode in `validate:all` so a drifted pin fails the pipeline.

Local dev is unaffected — npm prefers workspace symlinks to registry resolutions when a workspace match exists, so `npm install` in the monorepo continues to link `node_modules/@skill-map/spec` to `spec/` regardless of the exact version string.
