---
'@skill-map/cli': patch
---

Tutorial audit pass:

- Inviolable rule #7 dropped the contradictory "Argentine Spanish" claim and now points at the §Tone bullet (neutral Spanish, `tú` form, no rioplatense).
- Beat B blockquote rewritten in English (was Spanish + voseo with English inline comments — violated the bilingual ban). The agent translates the whole block at runtime when the tester speaks Spanish.
- L1 (deep-dive) no longer promises an orphan reveal that L4 doesn't deliver — L4 plants a broken-ref, which is a different rule scope.
- "Start over" in resume mode is now safer: refuses to wipe when `tutorial-state.yml`'s saved `cwd` doesn't match `pwd`; lists the exact paths it will delete; requires a literal `yes, wipe` confirmation; never recursively deletes `.claude/` or `notes/` as directories.
- Side-by-side intro trimmed (no longer re-explains the chat terminal already covered by the two-terminals block).
- Demo time estimate bumped from ~7 min to ~10 min (more realistic for a non-technical tester walking through 5 sub-steps with confirmations).
- Reveal 3's `frontmatter` gloss removed (already glossed in Reveal 1, per the once-per-session rule).
- Port-in-use edge case clarifies bare `sm` doesn't accept flags — the tester switches to `sm serve --port 4243`.
- Resume detection order is explicit: check raw `ls -A` for `tutorial-state.yml` first, only then apply the ignored-items filter.

Vocabulary unification — the SKILL now uses one word ("step") with hierarchical numbering instead of three different terms:

- Stage L1..L5 → Step 4..8 (continuous numbering, no L prefix).
- Reveal 1..5 (Step 2 internals) → Step 2.1..2.5.
- Beat A/B/C (Step 2.5 internals) → Step 2.5.1..2.5.3.
- `tutorial-state.yml`: `long_stages` → `long_steps`, IDs lose the L prefix (`L4-orphans` → `7-issues`).
- Resume copy off-by-one fixed (was "step N of 4", demo has 3 steps).
