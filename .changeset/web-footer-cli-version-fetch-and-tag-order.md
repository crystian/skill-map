---
"@skill-map/web": patch
"@skill-map/cli": patch
---

Two coordinated landings on the landing footer plus a whitespace cleanup:

1. **`web/app.js`** — fix the runtime CLI version fetch. The `/latest` endpoint at `https://registry.npmjs.org/@skill-map/cli/latest` is unreliable for scoped packages — the request fired but the footer tag stayed at the `cli v—` placeholder. Switched to the package metadata endpoint (`https://registry.npmjs.org/@skill-map/cli`) and read `dist-tags.latest`. Added three diagnostic `console.warn` lines so a future failure surfaces the cause (registry status, missing dist-tags, fetch exception) instead of failing silently.
2. **`web/index.html`** — reorder the three footer version tags from `spec → web → cli` to `cli → spec → web`. The CLI is the primary product surface, spec is the contract behind it, web is metadata about the site itself.

The `@skill-map/cli` `patch` bump covers a whitespace-only cleanup in `src/kernel/index.ts` (one redundant blank line removed between the `Kernel` interface and the `createKernel()` factory). No runtime behavior change; bumped per the workspace-touch changeset policy.
