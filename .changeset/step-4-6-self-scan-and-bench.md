---
"@skill-map/cli": patch
---

Add Step 4.6 acceptance coverage: a self-scan test and a 500-MD
performance benchmark.

`src/test/self-scan.test.ts` runs `runScan` directly against the
project repo (no persistence — never writes `.skill-map/skill-map.db`)
with the full built-in pipeline and asserts: `schemaVersion === 1`;
every node, link, and issue conforms to its authoritative spec
schema (mirrors the `validate-all` audit's per-element strategy);
nodes count > 0; the expected node kinds appear (relaxed to allow
`command` and `hook` as missing today since neither
`.claude/commands/` nor `.claude/hooks/` exists in the working tree
— the tolerated-missing set auto-tightens the moment either grows
a real file); no `error`-severity issues survive; tokens are
populated for ≥ 1 node (Step 4.2 smoke test); `externalRefsCount > 0`
for ≥ 1 node (Step 4.3 smoke test). Failures print actionable detail
(missing kinds present, full per-issue dump) so a regression is
diagnosable without re-running with extra logging.

`src/test/scan-benchmark.test.ts` materialises 500 synthetic
markdown files under `<repo>/.tmp/scan-bench-<random>/` (gitignored,
project-local per AGENTS.md) — 100 each of agents, commands, hooks,
skills (with `SKILL.md` per-skill subdir), and notes — each carrying
a slash invocation, an `@`-directive, and an http URL so every
detector fires. Ten agents share the same `name` so
`trigger-collision` has work to do; some commands cross-reference
each other through `metadata.related[]`. Asserts the full scan
(tokenize + 4 detectors + 3 rules) completes within a 2000 ms
budget (measured ~930 ms locally), `nodesCount === 500`, and
`linksCount > 0`. Always prints a `[bench] 500 nodes / N links / M
issues in Tms` line to stderr so a CI failure surfaces the actual
measurement, not a bare assertion. Comment above the threshold
documents the escape hatch (profile cl100k_base cold-start before
bumping; never disable).

Adds `.tmp` to the `claude` adapter's `DEFAULT_IGNORE` set so the
walker never traverses transient AI/test artifacts. Without this,
the benchmark's fixture would appear in the self-scan and races
between the two tests would flake the suite. The convention is
already enforced everywhere else (gitignore, AGENTS.md), so the
adapter now matches.

Both tests run inside the standard `npm test` / `npm run test:ci`
flow; no separate `bench` script is needed (runtime delta well under
a second).
