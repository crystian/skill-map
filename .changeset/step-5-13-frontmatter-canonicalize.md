---
"@skill-map/cli": patch
---

Step 5.13 — `frontmatter_hash` is now computed over a CANONICAL YAML
form of the parsed frontmatter, not over the raw text bytes.

**Why**: a YAML formatter pass on the user's editor (Prettier YAML,
IDE autoformat, manual indent fix, key reordering) used to silently
break the medium-confidence rename heuristic — two files with
identical logical frontmatter but different YAML formatting got
different `frontmatter_hash` values, so the heuristic saw them as
"different frontmatter" and demoted what should have been a
medium-confidence rename to an `orphan` issue. Surfaced during the
end-to-end walkthrough (the `cat <<EOF` output didn't byte-match the
file written via the Write tool, even though both blocks looked
identical to a human).

**How**: new `canonicalFrontmatter(parsed, raw)` helper in
`kernel/orchestrator.ts`. Re-emits the parsed frontmatter via
`yaml.dump` with deterministic options:

- `sortKeys: true` — keys in lexicographic order regardless of
  declaration order.
- `lineWidth: -1` — no auto-wrap.
- `noRefs: true` — no `*alias` shorthand.
- `noCompatMode: true` — modern YAML 1.2 output.

Comments are lost (they're not semantic). Hash is then `sha256` of
that canonical string instead of `raw.frontmatterRaw`.

**Fallback**: when the adapter's parse failed silently (yields
`parsed = {}` for non-empty `raw`), we fall back to hashing the raw
text so a malformed-YAML file still hashes deterministically against
itself across rescans. Without this, every malformed file would
collapse to the same `sha256(yaml.dump({}))` and erroneously match
each other for rename.

**Migration impact**: existing DBs have `frontmatter_hash` values
computed over raw text. After this lands, the next `sm scan` will
see every file as "frontmatter changed" (cache miss in `--changed`
mode; otherwise cosmetic). No data loss. `state_*` rows aren't
affected — they key on `node.path`, not on `frontmatter_hash`. Once
the new hashes settle, behaviour stabilises.

Tests: 2 new in `src/test/scan-mutation.test.ts`:

- "two files with the same logical frontmatter but DIFFERENT YAML
  formatting hash to the same fm_hash" — exercises key reordering,
  quote-style change, trailing-newline change, all in one fixture
  pair.
- "logically-different frontmatters still produce different
  fm_hashes" — guard against canonicalization collapsing distinct
  values.

Test count: 211 → 213.
