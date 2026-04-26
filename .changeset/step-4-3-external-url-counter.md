---
"@skill-map/cli": patch
---

Add `external-url-counter` detector and orchestrator-level segregation for
external pseudo-links.

The new detector scans node bodies for `http(s)://` URLs, normalizes them
(lowercase host, drop fragment, preserve scheme / port / path / query),
dedupes per node, and emits one `references` pseudo-link per distinct URL
at `low` confidence. URL parsing uses Node's built-in WHATWG `URL` — no
new dependency.

`runScan` now partitions emitted links into internal (graph) and external
(URL pseudo-link) sets by checking `target.startsWith('http://')` or
`'https://'`. Internal links flow through the rules layer, populate
`linksOutCount` / `linksInCount`, and land in `result.links` and
`scan_links` as before. External pseudo-links are counted into
`node.externalRefsCount` and then dropped — they never reach rules,
never appear in `result.links`, and never persist to `scan_links`. This
keeps the spec's `link.kind` enum locked and `scan_links` semantically
clean (graph relations only) while giving the inspector a cheap "external
references" badge.

This is the drop-in proof from Step 2: the kernel boots, detectors plug
in, and a new built-in extension lands without spec or migration changes.
