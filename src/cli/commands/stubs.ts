/**
 * Clipanion stubs for every verb from `spec/cli-contract.md` that has no
 * real implementation yet. Each stub:
 *
 * 1. Registers the same paths as the final command will (so `sm help` sees
 *    the full surface today, and the CI drift check against
 *    `context/cli-reference.md` works).
 * 2. Advertises its future home via the `category` / `description` / `details`
 *    in the Usage block — this is what the Step 1c introspection layer
 *    serialises to json / md.
 * 3. On execute, writes a one-liner to stderr pointing at the Step that
 *    will implement it, and exits with code 2 (error / unhandled) per
 *    spec/cli-contract.md §Exit codes.
 *
 * When a later Step replaces a stub, the replacement class takes over the
 * same paths and this file loses the entry. The ordering here mirrors the
 * contract's section order so a grep → stub mapping is easy.
 */

import { Command, Option } from 'clipanion';

function notImplemented(cmd: Command, verb: string, step: string): number {
  cmd.context.stderr.write(`${verb}: not implemented (lands in Step ${step})\n`);
  return 2;
}

// ---------------------------------------------------------------------------
// Setup & state
// ---------------------------------------------------------------------------
//
// `sm init` left this file at Step 6.5; it lives in src/cli/commands/init.ts
// now. `sm doctor` remains a stub until Step 3 (or whenever doctor lands).

export class DoctorCommand extends Command {
  static override paths = [['doctor']];
  static override usage = Command.Usage({
    category: 'Setup',
    description: 'Diagnostic report: DB integrity, pending migrations, orphan rows, plugin status, runner availability.',
  });

  async execute(): Promise<number> {
    return notImplemented(this, 'doctor', '3');
  }
}

// ---------------------------------------------------------------------------
// Config — moved to ./config.ts at Step 6.3
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Browse
// ---------------------------------------------------------------------------
//
// `sm list`, `sm show`, `sm check` left this file in Step 4.5; they live
// in src/cli/commands/{list,show,check}.ts now. The remaining Browse
// stubs (findings / graph / export / orphans*) ship in later Steps.

export class FindingsCommand extends Command {
  static override paths = [['findings']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Probabilistic findings: injection, stale summaries, low confidence.',
  });
  kind = Option.String('--kind', { required: false });
  since = Option.String('--since', { required: false });
  threshold = Option.String('--threshold', { required: false });
  json = Option.Boolean('--json', false);

  async execute(): Promise<number> {
    return notImplemented(this, 'findings', '10');
  }
}

// GraphCommand moved to ./graph.ts at Step 8.1.
// ExportCommand moved to ./export.ts at Step 8.3.

// orphans / orphans reconcile / orphans undo-rename — moved to ./orphans.ts
// at Step 5.6

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export class ActionsListCommand extends Command {
  static override paths = [['actions', 'list']];
  static override usage = Command.Usage({
    category: 'Actions',
    description: 'Registered action types (manifest view).',
  });

  async execute(): Promise<number> {
    return notImplemented(this, 'actions list', '9');
  }
}

export class ActionsShowCommand extends Command {
  static override paths = [['actions', 'show']];
  static override usage = Command.Usage({
    category: 'Actions',
    description: 'Full action manifest, including preconditions and expected duration.',
  });
  id = Option.String({ required: true });

  async execute(): Promise<number> {
    return notImplemented(this, 'actions show', '9');
  }
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export class JobSubmitCommand extends Command {
  static override paths = [['job', 'submit']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Enqueue a single job or fan out to every matching node (--all).',
  });
  action = Option.String({ required: true });
  node = Option.String('-n', { required: false });
  all = Option.Boolean('--all', false);
  run = Option.Boolean('--run', false);
  force = Option.Boolean('--force', false);
  ttl = Option.String('--ttl', { required: false });
  priority = Option.String('--priority', { required: false });

  async execute(): Promise<number> {
    return notImplemented(this, 'job submit', '9');
  }
}

export class JobListCommand extends Command {
  static override paths = [['job', 'list']];
  static override usage = Command.Usage({ category: 'Jobs', description: 'List jobs.' });
  status = Option.String('--status', { required: false });
  action = Option.String('--action', { required: false });
  node = Option.String('--node', { required: false });

  async execute(): Promise<number> {
    return notImplemented(this, 'job list', '9');
  }
}

export class JobShowCommand extends Command {
  static override paths = [['job', 'show']];
  static override usage = Command.Usage({ category: 'Jobs', description: 'Job detail: state, claim time, TTL, runner, content hash.' });
  id = Option.String({ required: true });

  async execute(): Promise<number> {
    return notImplemented(this, 'job show', '9');
  }
}

export class JobPreviewCommand extends Command {
  static override paths = [['job', 'preview']];
  static override usage = Command.Usage({ category: 'Jobs', description: 'Render the job MD file without executing.' });
  id = Option.String({ required: true });

  async execute(): Promise<number> {
    return notImplemented(this, 'job preview', '9');
  }
}

export class JobClaimCommand extends Command {
  static override paths = [['job', 'claim']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Atomic primitive: return next queued job id, mark it running.',
  });
  filter = Option.String('--filter', { required: false });

  async execute(): Promise<number> {
    return notImplemented(this, 'job claim', '9');
  }
}

export class JobRunCommand extends Command {
  static override paths = [['job', 'run']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Full CLI-runner loop: claim + spawn + record.',
  });
  all = Option.Boolean('--all', false);
  max = Option.String('--max', { required: false });

  async execute(): Promise<number> {
    return notImplemented(this, 'job run', '9');
  }
}

export class JobStatusCommand extends Command {
  static override paths = [['job', 'status']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Counts (per status) or single-job status.',
  });
  id = Option.String({ required: false });

  async execute(): Promise<number> {
    return notImplemented(this, 'job status', '9');
  }
}

export class JobCancelCommand extends Command {
  static override paths = [['job', 'cancel']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Force a running job to failed with reason user-cancelled.',
  });
  id = Option.String({ required: false });
  all = Option.Boolean('--all', false);

  async execute(): Promise<number> {
    return notImplemented(this, 'job cancel', '9');
  }
}

// JobPruneCommand moved to ./jobs.ts (lands real in Step 7.3).

// ---------------------------------------------------------------------------
// Record (callback)
// ---------------------------------------------------------------------------

export class RecordCommand extends Command {
  static override paths = [['record']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Close a running job with success or failure. Nonce is the sole credential.',
  });
  id = Option.String('--id', { required: true });
  nonce = Option.String('--nonce', { required: true });
  status = Option.String('--status', { required: true });
  report = Option.String('--report', { required: false });
  tokensIn = Option.String('--tokens-in', { required: false });
  tokensOut = Option.String('--tokens-out', { required: false });
  durationMs = Option.String('--duration-ms', { required: false });
  model = Option.String('--model', { required: false });
  error = Option.String('--error', { required: false });

  async execute(): Promise<number> {
    return notImplemented(this, 'record', '9');
  }
}

// ---------------------------------------------------------------------------
// History — moved to ./history.ts at Step 5.3 / 5.4
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Plugins — enable/disable moved to ./plugins.ts at Step 6.6
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Audits
// ---------------------------------------------------------------------------

export class AuditListCommand extends Command {
  static override paths = [['audit', 'list']];
  static override usage = Command.Usage({ category: 'Audits', description: 'Registered audits.' });

  async execute(): Promise<number> {
    return notImplemented(this, 'audit list', '2');
  }
}

export class AuditRunCommand extends Command {
  static override paths = [['audit', 'run']];
  static override usage = Command.Usage({
    category: 'Audits',
    description: 'Execute an audit. --json emits the audit report per its declared shape.',
  });
  id = Option.String({ required: true });
  json = Option.Boolean('--json', false);

  async execute(): Promise<number> {
    return notImplemented(this, 'audit run', '2');
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export class ServeCommand extends Command {
  static override paths = [['serve']];
  static override usage = Command.Usage({
    category: 'Server',
    description: 'Start Hono + WebSocket for the Web UI. Single-port mandate: SPA + REST + WS under one listener.',
  });
  port = Option.String('--port', { required: false });
  host = Option.String('--host', { required: false });
  noOpen = Option.Boolean('--no-open', false);

  async execute(): Promise<number> {
    return notImplemented(this, 'serve', '12');
  }
}

// ---------------------------------------------------------------------------
// Aggregate export
// ---------------------------------------------------------------------------

export const STUB_COMMANDS = [
  DoctorCommand,
  FindingsCommand,
  ActionsListCommand,
  ActionsShowCommand,
  JobSubmitCommand,
  JobListCommand,
  JobShowCommand,
  JobPreviewCommand,
  JobClaimCommand,
  JobRunCommand,
  JobStatusCommand,
  JobCancelCommand,
  RecordCommand,
  AuditListCommand,
  AuditRunCommand,
  ServeCommand,
];
