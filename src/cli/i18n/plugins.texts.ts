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
    'not `{{bundleId}}/{{extId}}` — individual extensions inside a bundle-granularity plugin cannot be toggled.',

  granularityExtensionRejectsBundleId:
    "'{{bundleId}}' has granularity=extension. Use `sm plugins {{verb}} {{bundleId}}/<ext-id>` to {{verb}} a single " +
    'extension; the bundle id alone is not toggle-able. Run `sm plugins list` for the per-extension qualified ids.',

  pluginNotFound:
    'Plugin not found: {{id}}. Run `sm plugins list` for discovered ids and the qualified extension ids.',

  qualifiedIdNotFound:
    "Qualified extension id not found: {{id}}. The owning bundle '{{bundleId}}' does not declare an extension with id '{{extId}}'. " +
    'Run `sm plugins list` to see what each bundle ships.',

  qualifiedIdUnknownBundle:
    'Qualified extension id references unknown bundle: {{bundleId}}. Run `sm plugins list` for known bundle ids.',

  // Spec § A.10 — `applicableKinds` filter on Extractors. When an extractor
  // declares a kind that no installed Provider emits, the load succeeds
  // (the Provider may arrive later) but `sm plugins doctor` surfaces a
  // non-blocking warning so the author sees the typo / missing dependency.
  // Exit code is NOT promoted by this warning.
  doctorApplicableKindUnknown:
    "Extractor '{{extractorId}}' declares applicableKinds including '{{unknownKind}}', but no installed Provider declares that kind. " +
    'The extractor is loaded but will never fire on that kind.',

  // Provider explorationDir validation. Each Provider declares a filesystem
  // directory where its content lives (e.g. `~/.claude` for the Claude
  // Provider). `sm plugins doctor` checks the directory exists and surfaces
  // a non-blocking warning when missing — the user may legitimately not
  // have installed that platform yet, so the warning is informational.
  doctorProviderExplorationDirMissing:
    "Provider '{{providerId}}' declares explorationDir '{{explorationDir}}', but the resolved path '{{resolvedPath}}' does not exist. " +
    'The Provider is loaded but will yield no nodes from that directory until it appears.',

  // --- list verb -------------------------------------------------------
  listEmpty: 'No plugins discovered.\n',

  // --- doctor verb -----------------------------------------------------
  doctorDiscoveredHeader:
    'Discovered {{total}} plugin(s) ({{builtInCount}} built-in bundles, {{userCount}} user):\n',
  doctorCountRow: '  {{status}} {{count}}\n',
  doctorWarningsHeader: '\nWarnings:\n',
  doctorWarningLine: '  [warn] {{message}}\n',
  doctorIssuesHeader: '\nIssues:\n',
  doctorIssueLine: '  [{{status}}] {{id}} — {{reason}}\n',

  // --- enable / disable -----------------------------------------------
  toggleBothIdAndAll: 'Pass either an <id> or --all, not both.\n',
  toggleNeitherIdNorAll: 'Pass <id> or --all.\n',
  toggleResolveError: '{{error}}\n',
  toggleAppliedSingle: '{{verbPast}}: {{id}}\n',
  toggleAppliedManyHeader: '{{verbPast}}: {{count}} plugin(s)\n',
  toggleAppliedManyRow: '  - {{id}}\n',

  // --- list / show renderers ------------------------------------------
  rowStatusOk: 'ok',
  rowStatusOff: 'off',
  rowStatusOkPad: 'ok  ',
  rowStatusOffPad: 'off ',
  builtInBundleHeader: '{{status}}     {{id}}@built-in (granularity={{granularity}})',
  builtInBundleKindsLine: '         {{kinds}}',
  builtInExtensionRow: '{{stat}}       {{kind}}:{{qualifiedId}}@{{version}}',
  pluginRow: '{{statusIcon}} {{id}}@{{version}}{{granularitySuffix}}{{tail}}',
  pluginRowGranularitySuffix: ' (granularity={{granularity}})',
  pluginRowTailEnabled: ' · {{kinds}}',
  pluginRowTailDisabled: ' · {{reason}}',
  detailIdRow: 'id:           {{id}}',
  detailPathRow: 'path:         {{path}}',
  detailPathBuiltIn: 'path:         (built-in)',
  detailStatusRow: 'status:       {{status}}',
  detailVersionRow: 'version:      {{version}}',
  detailCompatRow: 'compat:       {{compat}}',
  detailGranularityRow: 'granularity:  {{granularity}}',
  detailGranularityUnknown: '(unknown — manifest invalid)',
  detailSummaryRow: 'summary:      {{description}}',
  detailReasonRow: 'reason:       {{reason}}',
  detailExtensionsHeader: 'extensions:',
  detailExtensionRow: '  - {{kind}}:{{qualifiedId}}@{{version}}{{tag}}',
  detailExtensionTag: ' [{{state}}]',
  detailExtensionTagOn: 'on',
  detailExtensionTagOff: 'off',
  detailStatusEnabled: 'enabled',
  detailStatusDisabled: 'disabled',
  detailVersionUnknown: '?',
  detailCompatUnknown: '?',
} as const;
