# `hello-world` — skill-map reference plugin

The smallest viable plugin. One detector, no storage, one test that uses `@skill-map/testkit`.

Read the [Plugin author guide](../../spec/plugin-author-guide.md) for the full picture; this example is a working starting point you can copy.

## What it does

The `hello-world-greet` detector scans node bodies for tokens of the form `[[greet:<name>]]` and emits one `references` link per distinct name. It is intentionally trivial — the goal is to demonstrate the smallest shape of a real detector, not to do anything useful at runtime.

```markdown
---
name: my-agent
---

Talk to [[greet:architect]] or [[greet:sre]] when in doubt.
```

scanning the file above produces two links: `→ architect` and `→ sre`.

> **Why a wikilink-style pattern?** The intuitive choice — `@greet:<name>` — collides with the built-in `at-directive` detector that fires on any `@token` in the body. Two detectors emitting the same trigger with different `target` shapes is exactly what `trigger-collision` flags as an `error`. A non-`@`, non-`/` prefix avoids the collision; pick a syntax that doesn't overlap with built-ins for any new detector you write.

## File layout

```text
hello-world/
├── plugin.json
├── README.md
└── extensions/
    └── greet-detector.mjs
```

`plugin.json` declares one extension and pins to `^1.0.0` of the spec. `extensions/greet-detector.mjs` is the runtime instance — its `default` export carries both the manifest fields and the `detect` method.

## Try it locally

```bash
# 1. Drop the example under your project's plugin directory.
mkdir -p .skill-map/plugins
cp -r path/to/hello-world .skill-map/plugins/

# 2. Verify the kernel can load it.
sm plugins list
# expected: ok    hello-world@1.0.0 · detector:hello-world/hello-world-greet

# 3. Plant a fixture node and scan.
mkdir -p .claude/agents
cat > .claude/agents/sample.md <<'EOF'
---
name: sample
description: Reference fixture.
---

Talk to [[greet:architect]] or [[greet:sre]].
EOF
sm scan
# the persisted scan now includes two `references` links sourced
# from `hello-world-greet`. Inspect with `sm show .claude/agents/sample.md`.
```

## Test it with `@skill-map/testkit`

The `test/` folder contains a Node test that drives the detector through `runDetectorOnFixture`. The test ships JS (no TypeScript) so you can run it without a build step.

```bash
# In a real plugin:
npm install --save-dev @skill-map/testkit
node --test test/greet-detector.test.mjs

# Inside this monorepo (where @skill-map/testkit is a workspace):
mkdir -p node_modules/@skill-map
ln -sfn ../../testkit node_modules/@skill-map/testkit
ln -sfn ../../src     node_modules/@skill-map/cli
node --test test/greet-detector.test.mjs
```

For a real plugin you would normally:

- write tests in `.test.ts` (or `.test.js`) and run them through `node --import tsx --test ...`,
- pin `@skill-map/testkit` and `@skill-map/cli` at exact versions,
- add the test command to `npm test`.

## What's NOT in this example

- **Storage** — this plugin has no state. For state, declare `"storage": { "mode": "kv" }` (simple key-value) or `"storage": { "mode": "dedicated", "tables": [...], "migrations": [...] }` (own SQL tables). See [`plugin-kv-api.md`](../../spec/plugin-kv-api.md).
- **Multiple extensions** — a plugin may declare any number of files under `extensions[]`, mixing kinds (e.g. one detector + one rule).
- **Probabilistic mode** — this detector is `deterministic` (default). For LLM-backed work, declare `"mode": "probabilistic"` and consume `ctx.runner` per [`architecture.md` §Execution modes](../../spec/architecture.md).
- **Trigger normalisation** — production detectors call `normalizeTrigger` from `@skill-map/cli` so the rules layer can match against `frontmatter.name`. See `src/extensions/detectors/slash/index.ts` in the cli source for a worked example.
