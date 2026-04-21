---
"@skill-map/spec": patch
---

Clarify the comment in `spec/README.md` §"Use — load a schema": `specIndex.specVersion` is the payload shape version baked into `index.json`, not the npm package version. The two may drift — bumping the npm package does not bump `specVersion` unless the shape of `index.json` itself changes.
