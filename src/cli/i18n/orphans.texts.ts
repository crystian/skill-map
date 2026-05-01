/**
 * Strings emitted by `cli/commands/orphans.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const ORPHANS_TEXTS = {
  noIssues: 'No orphan / auto-rename issues.\n',
  aborted: 'Aborted.\n',
  // --- reconcile ---------------------------------------------------------
  reconcileTargetNotFound:
    'sm orphans reconcile: target node "{{path}}" not found in scan_nodes.\n',
  reconcileNoActiveIssue:
    'sm orphans reconcile: no active orphan issue found for "{{path}}".\n',
  reconcileSummary:
    'Reconciled {{from}} → {{to}}. Migrated {{rows}} state rows ' +
    '(jobs:{{jobs}}, execs:{{execs}}, summaries:{{summaries}}, ' +
    'enrichments:{{enrichments}}, kv:{{kv}}).\n',
  reconcileWouldMigrate:
    '(dry-run) Would reconcile {{from}} → {{to}}. Would migrate {{rows}} state rows ' +
    '(jobs:{{jobs}}, execs:{{execs}}, summaries:{{summaries}}, ' +
    'enrichments:{{enrichments}}, kv:{{kv}}).\n',
  reconcileCollisionsNote:
    'Note: {{count}} composite-PK collision(s); destination rows preserved ' +
    '(see spec/db-schema.md §Rename detection).\n',
  reconcileCollisionsNoteDryRun:
    '(dry-run) Note: {{count}} composite-PK collision(s) would be skipped; ' +
    'destination rows would be preserved.\n',
  // --- undo-rename -------------------------------------------------------
  undoNoActiveIssue:
    'sm orphans undo-rename: no active auto-rename issue targets "{{path}}".\n',
  undoMultipleActive:
    'sm orphans undo-rename: {{count}} active auto-rename issues target "{{path}}"; ' +
    'the rename heuristic should have produced at most one. Run `sm scan` and retry.\n',
  undoMediumMissingFrom:
    'sm orphans undo-rename: auto-rename-medium issue is missing data.from; ' +
    'cannot revert without --from.\n',
  undoMediumFromMismatch:
    'sm orphans undo-rename: --from "{{from}}" does not match auto-rename-medium ' +
    'data.from "{{dataFrom}}".\n',
  undoAmbiguousRequiresFrom:
    'sm orphans undo-rename: --from <old.path> is REQUIRED for auto-rename-ambiguous ' +
    '(pick one of data.candidates).\n',
  undoAmbiguousNotInCandidates:
    'sm orphans undo-rename: --from "{{from}}" not in auto-rename-ambiguous candidates.\n',
  undoConfirmPrompt:
    'Undo auto-rename: migrate state_* FKs from {{newPath}} back to {{from}}?',
  undoSummary:
    'Reverted {{newPath}} → {{from}}. Migrated {{rows}} state rows; ' +
    'new orphan issue emitted on {{from}}.\n',
  undoWouldMigrate:
    '(dry-run) Would revert {{newPath}} → {{from}}. Would migrate {{rows}} state rows; ' +
    'would emit a new orphan issue on {{from}}.\n',
  /**
   * Message persisted into `scan_issues.message` for the orphan issue
   * emitted after `sm orphans undo-rename`. The string lands in DB rows
   * and travels through `--json`, `sm check`, and downstream consumers,
   * so localising it requires a kernel-side template (not just a CLI
   * catalog) — kept here for now so the wording lives in one greppable
   * place even if the layering is imperfect.
   */
  undoRenameOrphanMessage:
    'Orphan history: {{toPath}} (was reverted from auto-rename to {{newPath}}).',
  // --- shared ------------------------------------------------------------
  invalidKind:
    '--kind: invalid value "{{kind}}". Allowed: orphan, medium, ambiguous.\n',
} as const;
