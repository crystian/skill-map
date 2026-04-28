---
'@skill-map/spec': patch
'@skill-map/cli': patch
---

Step 9.4 — plugin author guide + reference plugin + diagnostics polish.
**Step 9 fully closed** with this changeset.

### Spec — plugin author guide (additive prose)

New document at `spec/plugin-author-guide.md` covering:

- Discovery roots (`<project>/.skill-map/plugins/`,
  `~/.skill-map/plugins/`, `--plugin-dir <path>`).
- Manifest fields with the normative schema reference.
- `specCompat` strategy — narrow ranges pre-`v1.0.0`, `^1.0.0`
  recommendation post-`v1.0.0`.
- The six extension kinds with one minimal worked example each
  (detector, rule, renderer in full; adapter / audit / action flagged
  for later expansion alongside Step 10).
- Storage choice (KV vs Dedicated) cross-linking `plugin-kv-api.md`
  and the Step 9.2 triple-protection rule.
- Execution modes (deterministic / probabilistic) cross-linking
  `architecture.md`.
- Testkit usage with `runDetectorOnFixture`, `runRuleOnGraph`,
  `runRendererOnGraph`, `makeFakeRunner`.
- The five plugin statuses (`loaded` / `disabled` / `incompatible-spec`
  / `invalid-manifest` / `load-error`) and how to read them.
- Stability section (document is stable; widening additions are minor
  bumps; breaking edits are major).

`spec/package.json#files` updated to ship the new doc; `spec/index.json`
regenerated (57 → 58 hashed files). `coverage.md` unchanged because the
guide is prose, not a schema.

### Reference plugin — `examples/hello-world/`

Smallest viable plugin in the principal repo (Arquitecto's pick: in
the main repo, not separate). One detector (`hello-world-greet`)
emitting `references` links per `@greet:<name>` token in node bodies.
Includes:

- `plugin.json` declaring one extension and pinning `specCompat: ^1.0.0`.
- `extensions/greet-detector.mjs` — runtime instance with both
  manifest fields and the `detect` method.
- `README.md` — what it does, file layout, three-step "try it
  locally" recipe, what's intentionally missing (storage,
  multi-extension, probabilistic mode), pointers for production-grade
  patterns.
- `test/greet-detector.test.mjs` — four-assertion test using
  `@skill-map/testkit`, runnable via `node --test` with no build step.

Verified end-to-end: the example plugin loads cleanly under
`sm plugins list`, scans contribute its links to the persisted graph,
and the testkit-based test passes. The example is **not** registered
as a workspace — it's intentionally standalone so users can copy it.

### CLI — diagnostics polish on `PluginLoader.reason`

Each failure-mode reason string now carries an actionable hint:

- `invalid-manifest` (JSON parse): names the manifest path, suggests
  validating the JSON.
- `invalid-manifest` (AJV): names the manifest path AND points at
  `spec/schemas/plugins-registry.schema.json#/$defs/PluginManifest`.
- `invalid-manifest` (specCompat not a valid range): suggests a range
  shape (`"^1.0.0"`).
- `incompatible-spec`: suggests two remediations (update the plugin's
  `specCompat`, or pin sm to a compatible spec version).
- `load-error` (extension file not found): includes the absolute
  resolved path, pointer to `plugin.json#/extensions`.
- `load-error` (default export missing kind): lists the valid kinds.
- `load-error` (unknown kind): lists the valid kinds.
- `load-error` (extension manifest schema fails): names the
  per-kind schema (`spec/schemas/extensions/<kind>.schema.json`).

6 new tests under `test/plugin-loader.test.ts` (`Step 9.4 diagnostics
polish` describe block) assert each hint shape is present without
pinning the full text. Test count 437 → **443 cli + 30 testkit = 473**.

### Step 9 closed

The four sub-steps — 9.1 (plugin runtime wiring), 9.2 (plugin
migrations + triple protection), 9.3 (`@skill-map/testkit` workspace),
9.4 (author guide + reference plugin + diagnostics polish) — together
turn `skill-map` plugins from "discovered but inert" into a
first-class authoring surface with documentation, tests, and a
working reference. Next step: **Step 10 — job subsystem + first
probabilistic extension** (wave 2 begins).
