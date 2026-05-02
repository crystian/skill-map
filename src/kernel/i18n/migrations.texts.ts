/**
 * Kernel-side strings emitted by `kernel/adapters/sqlite/migrations.ts`.
 * Same `tx(template, vars)` convention as every other
 * `kernel/i18n/*.texts.ts` peer.
 *
 * These messages bubble up via `Error.message`. Some surface verbatim to
 * the user through `cli/commands/db.ts` (which formats them as
 * `{{reason}}` in its templates) and through any other consumer that
 * formats migration failures.
 */

export const MIGRATIONS_TEXTS = {
  duplicateVersion:
    'Duplicate migration version {{version}} in {{dir}}: {{firstPath}} and {{secondPath}}',

  invalidVersion:
    'Migration version must be a non-negative integer ≤ 9999, got {{value}}',

  applyFailed:
    'Migration {{name}} failed: {{reason}}',
} as const;
