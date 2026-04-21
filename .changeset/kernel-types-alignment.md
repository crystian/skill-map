---
"skill-map": patch
---

Align kernel domain types with `spec/schemas/`. The Step 0b stub types for `Node`, `Link`, `Issue`, `Extension`, and `PluginManifest` were invented names that diverged from the normative schemas; they compiled only because the `runScan` stub never materialized any instance. This patch closes the drift before Step 3 starts consuming the types in earnest.

- **`Node`** now matches `node.schema.json`: `path`, `kind`, `adapter`, `bodyHash`, `frontmatterHash`, `bytes` (triple-split `{ frontmatter, body, total }`), `linksOutCount`, `linksInCount`, `externalRefsCount` required; `title`, `description`, `stability`, `version`, `author`, `frontmatter`, `tokens` optional. Removed ad-hoc `name` / `metadata`.
- **`Link`** now matches `link.schema.json`: `source` (was `from`), `target` (was `to`), `kind` (new discriminator `invokes | references | mentions | supersedes`), `confidence: 'high' | 'medium' | 'low'` (was `exact | fuzzy`), `sources: string[]` (was singular `detector`), `trigger: { originalTrigger, normalizedTrigger } | null` (was flat top-level), plus optional `location`, `raw`.
- **`Issue`** now matches `issue.schema.json`: `ruleId` (was `rule`), `severity: 'error' | 'warn' | 'info'` (was `'warning'`), `nodeIds` (was `nodes`), plus optional `linkIndices`, `detail`, `fix`, `data`. Removed top-level `id` (DB-only autoincrement, not in the schema).
- **`Extension`** extended with `version` (required), plus optional `description`, `stability`, `preconditions`, `entry` — matches `spec/schemas/extensions/base.schema.json`.
- **`PluginManifest`** renamed `entries` → `extensions` (string paths); added `description`, `storage` (`oneOf` `kv | dedicated`), `author`, `license`, `homepage`, `repository` — matches `spec/schemas/plugins-registry.schema.json`.
- New exported types: `NodeKind`, `LinkKind`, `Confidence`, `Severity`, `Stability`, `TripleSplit`, `LinkTrigger`, `LinkLocation`, `IssueFix`, `PluginStorage`.
- **Tests**: imports normalized from `.ts` → `.js` (runtime-correct with `verbatimModuleSyntax`). `tsconfig.include` now lists `test/**/*`; `exclude` no longer skips `test` — typecheck covers tests going forward. Added coverage for `sm scan <roots...> --json` passing custom roots through. Dead copy-paste (`void k`) removed from the ISO-8601 test.
- **Conformance runner cleanup**: removed `PATH_SEP` re-export (consumers import `sep` from `node:path` directly) and `caseFixturePath` helper (dead parameter, zero consumers). `assertSpecRoot` retained as defensive API.

Classification: patch. Public types were unreleased Step 0b stubs; no consumer relied on the old shapes. The changes are corrections toward the already-published spec contract, not new behaviour.
