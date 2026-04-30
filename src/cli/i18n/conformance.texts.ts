/**
 * CLI strings emitted by `sm conformance run` (`cli/commands/conformance.ts`).
 *
 * `sm conformance run` is the external-facing entry point for the
 * conformance suite — both the spec-owned cases (under `@skill-map/spec`)
 * and the per-Provider suites bundled with the reference impl (today
 * just `provider:claude`). Phase 5 / A.13 introduced the verb so
 * alt-impl authors and Provider authors can drive the suite without
 * reaching into bespoke scripts.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const CONFORMANCE_TEXTS = {
  // --- top-level summary ----------------------------------------------------
  scopeHeader:
    'Running conformance scope {{label}} ({{caseCount}} case(s)) ...\n',

  scopeEmpty:
    'Conformance scope {{label}} has no cases. Skipping.\n',

  caseOk: '  ok    {{caseId}}\n',
  caseFail: '  FAIL  {{caseId}}\n',

  caseFailureDetail: '        - [{{type}}] {{reason}}\n',

  caseFailureStdoutHeader: '        --- stdout ---\n',
  caseFailureStreamLine: '        {{line}}\n',
  caseFailureStderrHeader: '        --- stderr ---\n',

  scopeSummary:
    '{{label}}: {{passCount}}/{{caseCount}} passed.\n',

  totalSummary:
    'sm conformance: {{passCount}}/{{caseCount}} passed across {{scopeCount}} scope(s).\n',

  // --- failures -------------------------------------------------------------
  unknownScope: 'sm conformance: {{message}}\n',

  noBinary:
    'sm conformance: cannot locate the sm binary at {{binary}}. ' +
    'Run `npm run build --workspace=@skill-map/cli` first.\n',

  runtimeError: 'sm conformance: {{message}}\n',
} as const;
