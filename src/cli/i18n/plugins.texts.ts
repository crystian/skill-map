/**
 * CLI strings emitted by `sm plugins` (`cli/commands/plugins.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const PLUGINS_TEXTS = {
  // --- enable / disable error guidance --------------------------------
  // Spec § A.7 — granularity validation. The CLI rejects mismatched ids
  // up front (instead of silently writing a config_plugins row that the
  // runtime would later ignore) so the user learns the model immediately.
  granularityBundleRejectsQualified:
    "'{{bundleId}}' has granularity=bundle. Use `sm plugins {{verb}} {{bundleId}}` to {{verb}} the whole bundle, " +
    "not `{{bundleId}}/{{extId}}` — individual extensions inside a bundle-granularity plugin cannot be toggled.",

  granularityExtensionRejectsBundleId:
    "'{{bundleId}}' has granularity=extension. Use `sm plugins {{verb}} {{bundleId}}/<ext-id>` to {{verb}} a single " +
    'extension; the bundle id alone is not toggle-able. Run `sm plugins list` for the per-extension qualified ids.',

  pluginNotFound:
    "Plugin not found: {{id}}. Run `sm plugins list` for discovered ids and the qualified extension ids.",

  qualifiedIdNotFound:
    "Qualified extension id not found: {{id}}. The owning bundle '{{bundleId}}' does not declare an extension with id '{{extId}}'. " +
    'Run `sm plugins list` to see what each bundle ships.',

  qualifiedIdUnknownBundle:
    "Qualified extension id references unknown bundle: {{bundleId}}. Run `sm plugins list` for known bundle ids.",

  // Spec § A.10 — `applicableKinds` filter on Detectors. When a detector
  // declares a kind that no installed Adapter / Provider emits, the load
  // succeeds (the Provider may arrive later) but `sm plugins doctor`
  // surfaces a non-blocking warning so the author sees the typo / missing
  // dependency. Exit code is NOT promoted by this warning.
  doctorApplicableKindUnknown:
    "Detector '{{detectorId}}' declares applicableKinds including '{{unknownKind}}', but no installed Provider declares that kind. " +
    "The detector is loaded but will never fire on that kind.",
} as const;
