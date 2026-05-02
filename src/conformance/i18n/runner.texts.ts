/**
 * Strings emitted by the conformance runner (`conformance/index.ts`).
 * Same `tx(template, vars)` convention as every other `*.texts.ts` peer.
 *
 * Reasons surface in `IAssertionResult.reason` — visible to anyone
 * reading the runner output (CI logs, `sm conformance run --json`).
 * Keeping them in the catalog unblocks a future Transloco migration and
 * keeps the wording in one place.
 */

export const CONFORMANCE_RUNNER_TEXTS = {
  priorScanFailed:
    'setup.priorScans step `{{fixture}}` failed with exit {{exit}}: {{stderr}}',

  pathMustBeRelative:
    'conformance: {{label}} path "{{path}}" must be relative to its anchor ({{anchor}})',

  pathEscapesAnchor:
    'conformance: {{label}} path "{{path}}" escapes its anchor ({{anchor}})',

  expectedExitCode:
    'expected exit {{expected}}, got {{actual}}',

  fileNotFound:
    'file not found: {{path}}',

  targetNotFound:
    'target not found: {{path}}',

  targetMissingFixture:
    'target does not contain fixture {{fixture}} verbatim',

  fileMatchesSchemaUnimplemented:
    'file-matches-schema not yet implemented (requires ajv; lands with Step 2)',

  stderrDidNotMatch:
    'stderr did not match /{{pattern}}/',

  stdoutNotJson:
    'stdout is not valid JSON: {{message}}',

  unsupportedJsonPath:
    'unsupported jsonpath: {{path}}',

  expectedArrayAtPath:
    'expected array at {{path}}',

  cannotTraverseSegment:
    "cannot traverse {{type}} at segment '{{segment}}'",

  jsonPathEqualsMismatch:
    '{{path}} = {{actual}}, expected {{expected}}',

  jsonPathNotGreaterThan:
    '{{path}} not > {{value}}',

  jsonPathNotLessThan:
    '{{path}} not < {{value}}',

  jsonPathDidNotMatch:
    '{{path}} did not match /{{pattern}}/',

  jsonPathNoComparator:
    'no comparator on json-path assertion',

  specRootMissingIndex:
    'spec root missing index.json at {{specRoot}}',
} as const;
