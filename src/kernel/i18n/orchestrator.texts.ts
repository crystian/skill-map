/**
 * Kernel-side strings emitted by `kernel/orchestrator.ts`.
 *
 * Convention: every entry is a flat string with `{{name}}` placeholders
 * (Mustache / Handlebars / Transloco compatible). The `tx` helper at
 * `kernel/util/tx.ts` does the interpolation. Plural / conditional
 * logic lives in the caller — pick the right template, don't branch
 * inside one.
 */

export const ORCHESTRATOR_TEXTS = {
  frontmatterInvalid:
    'Frontmatter for {{path}} ({{kind}}) failed schema validation: {{errors}}',

  frontmatterMalformedPasteWithIndent:
    'Frontmatter fence in {{path}} appears indented; YAML frontmatter MUST start with `---` ' +
    'at column 0. The file was scanned as body-only — the metadata block was silently lost. ' +
    'Move the `---` lines to the start of the line.',

  frontmatterMalformedByteOrderMark:
    'Frontmatter fence in {{path}} is preceded by a UTF-8 byte-order mark (BOM); the file ' +
    'was scanned as body-only. Re-save the file as UTF-8 without BOM. The metadata block ' +
    'was silently lost.',

  frontmatterMalformedMissingClose:
    'Frontmatter in {{path}} opens with `---` but never closes — no matching `---` line ' +
    'at column 0 was found. The file was scanned as body-only and every metadata field was ' +
    'silently lost. Add a closing `---` line below the metadata block.',

  extensionErrorLinkKindNotDeclared:
    'Detector "{{detectorId}}" emitted a link of kind "{{linkKind}}" outside its ' +
    'declared `emitsLinkKinds` set [{{declaredKinds}}]. Link dropped.',

  extensionErrorIssueInvalidSeverity:
    'Rule "{{ruleId}}" emitted an issue with invalid severity {{severity}} ' +
    "(allowed: 'error' | 'warn' | 'info'). Issue dropped.",

  runScanRootEmptyArray:
    'runScan: roots must contain at least one path (spec requires minItems: 1)',

  runScanRootMissing: "runScan: root path '{{root}}' does not exist or is not a directory",
} as const;
