---
"@skill-map/cli": patch
---

Compute per-node token counts via `js-tiktoken`.

`runScan` now populates `node.tokens` (frontmatter / body / total) using
the `cl100k_base` BPE — the modern OpenAI tokenizer used by
GPT-4 / GPT-3.5-turbo. The encoder is constructed once per scan and
reused across nodes (the BPE table is heavyweight to load). Tokens are
computed against the raw frontmatter bytes (not the parsed YAML
object) so the count stays reproducible from on-disk content.

The new `sm scan --no-tokens` flag opts out of tokenization; `node.tokens`
is left undefined, which is spec-valid because the field is optional in
`spec/schemas/node.schema.json`. Persistence already handles the absence
(maps to NULL across `tokens_frontmatter` / `tokens_body` / `tokens_total`).
