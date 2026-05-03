---
'@skill-map/cli': minor
---

Add a new built-in `markdown-link` extractor that catches `[text](path)` markdown links and emits one `references` link per resolved file path. Closes the gap surfaced by the slash-regex fix: even after that bug stopped generating false positives, sm had no extractor that mapped relative markdown links to real edges in the graph — the dominant cross-reference shape in real knowledge bases was invisible. The new extractor:

- resolves POSIX paths against the source node's directory (`docs/overview.md` + `./api.md` → `docs/api.md`)
- strips `#anchor` and `?query` before resolving
- skips image syntax `![alt](path)`, URL schemes (`http`, `mailto`, `tel`, `data`, …), fragment-only links, and absolute paths starting with `/`
- emits `kind: 'references'` at `confidence: 'high'` (the syntax is unambiguous authorial intent, not a heuristic)
- registers under the `core` bundle as `core/markdown-link` — opt-out via `sm plugins disable core/markdown-link`
