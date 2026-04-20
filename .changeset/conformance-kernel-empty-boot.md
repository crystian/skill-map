---
"@skill-map/spec": minor
---

Add conformance case `kernel-empty-boot`:

- New file: `spec/conformance/cases/kernel-empty-boot.json`.
- Exercises the boot invariant from `architecture.md`: with every adapter, detector, and rule disabled, scanning an empty scope MUST return a valid `ScanResult` with `schemaVersion: 1` and zero-filled stats.
- Referenced in `conformance/README.md` (§"Cases explicitly referenced elsewhere in the spec"). Entry moved from "pending" to "current" in the case inventory.
- Registered in `spec/index.json` and the integrity block (SHA256 regenerated).

The second pending case, `preamble-bitwise-match`, is deferred to Step 9 (requires `sm job preview` from the job subsystem).
