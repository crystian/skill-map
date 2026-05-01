/**
 * Kernel-side strings emitted by `kernel/adapters/sqlite/*` and the
 * scan-query parser (`kernel/scan/query.ts`). Same `tx(template, vars)`
 * convention as every other `kernel/i18n/*.texts.ts` peer.
 *
 * These are error messages from the storage adapter and the export-
 * query parser. Some of them surface as user-visible CLI errors via
 * `cli/commands/*` `formatErrorMessage(err)` paths; keeping them in
 * the catalog makes the future translator pipeline trivial.
 */

export const STORAGE_TEXTS = {
  scanPersistInvalidScannedAt:
    'persistScanResult: invalid scannedAt {{value}} (expected non-negative integer ms)',

  findNodesInvalidSortBy:
    'findNodes: invalid sortBy "{{sortBy}}". Allowed: {{allowed}}.',

  findNodesInvalidLimit:
    'findNodes: invalid limit {{value}}; expected positive integer.',
} as const;

export const QUERY_TEXTS = {
  exportQueryInvalidToken:
    'invalid token "{{token}}": expected key=value (e.g. kind=skill, has=issues, path=foo/*).',

  exportQueryDuplicateKey:
    'key "{{key}}" appears more than once; combine values with a comma instead (e.g. kind=skill,agent).',

  exportQueryEmptyValues: 'key "{{key}}" has no values.',

  exportQueryUnknownKey:
    'unknown key "{{key}}". Valid keys: kind, has, path.',

  exportQueryEmptyKind:
    'kind="" is not a valid node kind (empty).',

  exportQueryUnsupportedHas:
    'has="{{value}}" is not supported. Valid: {{allowed}}. (findings / summary land at Steps 10 / 11.)',
} as const;
