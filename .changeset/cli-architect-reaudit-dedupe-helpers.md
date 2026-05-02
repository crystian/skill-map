---
'@skill-map/cli': patch
---

refactor: cli-architect re-audit follow-up — dedupe `dbPathForScope`, share `SKILL_MAP_DIR` const, fold trigger-collision joiner into the i18n template

Internal hygiene only. No spec changes, no public CLI surface change, no behavioural change to output bytes — every emitted string keeps its previous value (the test suite covers the affected paths and stays green); only the indirection moved.

**N1 — `dbPathForScope` helper dropped from `cli/util/plugin-runtime.ts`**

`buildEnabledResolver` was reimplementing the project=cwd vs global=homedir DB-path resolution that already lives in `resolveDbPath` (`cli/util/db-path.ts`). The local helper plus its private `DB_FILENAME` constant are removed; the resolver now calls `resolveDbPath({ global: scope === 'global', db: undefined, ...ctx })` directly. Single source of truth for the canonical `--db > --global > project` precedence.

**N2 — `SKILL_MAP_DIR` constant shared between `db-path.ts` and `init.ts`**

`cli/commands/init.ts` was constructing `join(scopeRoot, '.skill-map')` with the literal duplicated from the convention encoded in `cli/util/db-path.ts`. New exported const `SKILL_MAP_DIR = '.skill-map'` lands in `db-path.ts` with a docstring explaining the per-scope layout. `init.ts` imports and uses it; the internal `DEFAULT_PROJECT_DB` / `DEFAULT_GLOBAL_DB` constants now derive from `${SKILL_MAP_DIR}/${DB_FILENAME}` instead of re-typing the literal. Future changes to the directory convention happen in one place.

**N3 — Trigger-collision joiner moved inside the `tx()` template**

`built-in-plugins/i18n/trigger-collision.texts.ts` was exposing `partsJoiner: '; and '` as a separate key that the rule code stitched into the message via `parts.join(...)`. The joiner sat outside the template, which means a future `es` locale would need to patch rule code, not just the catalog. Replaced the `(message, partsJoiner)` pair with two templates: `messageOnePart` (`'Trigger "{{normalized}}" has {{part}}.'`) and `messageTwoParts` (`'Trigger "{{normalized}}" has {{first}}; and {{second}}.'`). `analyzeTriggerBucket` picks the template based on `parts.length` and a comment documents that `parts.length ∈ {1, 2}` by construction (advertiser-ambiguous and cross-kind-ambiguous are mutually exclusive — the latter requires `advertiserPaths.length === 1` — so the two-part path is exactly advertiser-ambiguous + invocation-ambiguous). The `'; and '` joiner now lives entirely inside the catalog; a future `'; y '` swap is a single-key edit.

**Validation**

`npm run -w src build` clean, `npm run lint` clean, `npm test -w src` 693/693 pass.
