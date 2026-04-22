---
"@skill-map/spec": patch
---

Fix the extension-kind schemas so they actually validate against real extension manifests.

The six kind schemas (`schemas/extensions/action.schema.json`, `adapter.schema.json`, `audit.schema.json`, `detector.schema.json`, `renderer.schema.json`, `rule.schema.json`) used `additionalProperties: false` together with `allOf: [{ $ref: "base.schema.json" }]` — a classic JSON Schema Draft 2020-12 footgun. `additionalProperties` is evaluated independently per schema in an `allOf`, so when a consumer validated `{ id, kind, version, emitsLinkKinds, defaultConfidence }` against `detector.schema.json`, detector's `additionalProperties: false` rejected `id` / `version` / `description` (defined only on `base`) and base's own `additionalProperties: false` would have rejected `emitsLinkKinds` / `defaultConfidence` — the union of both closures is empty. No real extension could ever pass validation.

Discovered during Step 1b while wiring the AJV validators in `skill-map` (kernel plugin loader). The right fix is `unevaluatedProperties: false` — it sees through `allOf` composition and only rejects keys that no sibling schema declared.

Changes:

- Every kind schema: `additionalProperties: false` → `unevaluatedProperties: false` at the manifest level. Nested `additionalProperties: false` declarations inside `$defs` / `properties` were likewise replaced with `unevaluatedProperties: false` where they participate in `allOf` composition (e.g. `action.schema.json#/$defs/Parameter`, `audit.schema.json` nested items).
- `extensions/base.schema.json`: closure removed entirely. Closed-content is now enforced only on the kind schemas, which see base's properties as "evaluated" through the `allOf` — adding closure to base too would force every kind to re-list every base key to stay valid.
- `base.schema.json` description updated to spell out the new composition rule so a future reader does not accidentally re-introduce the footgun.

Classification: patch. No normative shape changes — every manifest that was *supposed* to pass under the old schemas still passes under the new ones, and the authored intent (closed content on kind manifests, additive base fields) is preserved. Consumers that never wired strict JSON Schema validation see zero behavioural change.
