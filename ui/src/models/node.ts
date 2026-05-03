/**
 * Local TypeScript mirror of `@skill-map/spec/schemas/frontmatter/*.schema.json`.
 *
 * Temporary. The canonical source of truth is the JSON Schema. These types
 * exist only until Step 1b lands a proper DTO emission path in `@skill-map/spec`
 * (see ROADMAP §DTO gap). Drift risk is accepted for the Step 0c prototype
 * because the mock collection is the only consumer and the schemas are small.
 *
 * DO NOT extend these with ui-specific fields. Keep the shapes as pure
 * reflections of the spec; put ui state on `INodeView` below.
 */

export type TNodeKind = 'skill' | 'agent' | 'command' | 'hook' | 'note';

export type TStability = 'experimental' | 'stable' | 'deprecated';

export interface IFrontmatterBaseMetadata {
  version: string;
  specCompat?: string;
  stability?: TStability;
  supersedes?: string[];
  supersededBy?: string;
  source?: string;
  sourceVersion?: string;
  tags?: string[];
  category?: string;
  keywords?: string[];
  created?: string;
  updated?: string;
  released?: string;
  requires?: string[];
  conflictsWith?: string[];
  provides?: string[];
  related?: string[];
  icon?: string;
  color?: string;
  priority?: number;
  hidden?: boolean;
  docsUrl?: string;
  readme?: string;
  examplesUrl?: string;
  github?: string;
  homepage?: string;
  linkedin?: string;
  twitter?: string;
  [extra: string]: unknown;
}

export interface IFrontmatterBase {
  name: string;
  description: string;
  type?: string;
  author?: string;
  authors?: string[];
  license?: string;
  tools?: string[];
  allowedTools?: string[];
  metadata: IFrontmatterBaseMetadata;
  [extra: string]: unknown;
}

export interface IFrontmatterAgent extends IFrontmatterBase {
  model?: string;
}

export interface ICommandArg {
  name: string;
  type?: string;
  required?: boolean;
  description?: string;
  default?: unknown;
}

export interface IFrontmatterCommand extends IFrontmatterBase {
  args?: ICommandArg[];
  shortcut?: string;
}

export interface IFrontmatterHook extends IFrontmatterBase {
  event?: string;
  condition?: string;
  blocking?: boolean;
  idempotent?: boolean;
}

export interface ISkillParameter {
  name: string;
  type?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
}

export interface IFrontmatterSkill extends IFrontmatterBase {
  inputs?: ISkillParameter[];
  outputs?: ISkillParameter[];
}

export type TFrontmatterNote = IFrontmatterBase;

export type TFrontmatter =
  | IFrontmatterAgent
  | IFrontmatterCommand
  | IFrontmatterHook
  | IFrontmatterSkill
  | TFrontmatterNote;

/**
 * UI-facing node shape. Composes the parsed frontmatter with ui-only
 * fields (path, derived kind). This is the type stored in the in-memory
 * collection and passed to list / graph / inspector views.
 *
 * **Body is intentionally absent** — `/api/scan` (the loader's source)
 * doesn't ship body bytes by design (kernel persists `body_hash` only).
 * The Inspector view fetches the body on-demand via
 * `dataSource.getNode(path)` with `?include=body`; everywhere else
 * doesn't need it.
 */
export interface INodeView {
  path: string;
  kind: TNodeKind;
  frontmatter: TFrontmatter;
}

/**
 * Probabilistic summary report produced by an LLM-backed summarizer
 * action. Shape mirrors `spec/schemas/summaries/<kind>.schema.json` —
 * each kind extends a common `report-base` (confidence + safety) with
 * kind-specific fields. Until real summarizers land in the kernel, the
 * UI keeps these as optional inputs on `<sm-node-card>` so the LLM
 * cluster renders only when data is available.
 */
export interface IReportSafety {
  injectionDetected: boolean;
  injectionType?: 'direct-override' | 'role-swap' | 'hidden-instruction' | 'other' | null;
  injectionDetails?: string | null;
  contentQuality: 'clean' | 'suspicious' | 'malformed';
}

interface IReportBase {
  confidence: number;
  safety: IReportSafety;
}

export interface ISummaryAgent extends IReportBase {
  kind: 'agent';
  whatItDoes: string;
  whenToUse?: string;
  capabilities?: readonly string[];
  toolsObserved?: readonly string[];
  interactionStyle?: string;
  relatedNodes?: readonly string[];
  qualityNotes?: string;
}

export interface ISummarySkill extends IReportBase {
  kind: 'skill';
  whatItDoes: string;
  recipe?: readonly { step: number; description: string }[];
  preconditions?: readonly string[];
  outputs?: readonly string[];
  sideEffects?: readonly string[];
  relatedNodes?: readonly string[];
  qualityNotes?: string;
}

export interface ISummaryCommand extends IReportBase {
  kind: 'command';
  whatItDoes: string;
  invocationExample?: string;
  argsObserved?: readonly { name: string; type?: string; description?: string; required?: boolean }[];
  sideEffects?: readonly string[];
  relatedNodes?: readonly string[];
  qualityNotes?: string;
}

export interface ISummaryHook extends IReportBase {
  kind: 'hook';
  whatItDoes: string;
  triggerInferred?: string;
  sideEffects?: readonly string[];
  blockingInferred?: boolean;
  idempotentInferred?: boolean;
  relatedNodes?: readonly string[];
  qualityNotes?: string;
}

export interface ISummaryNote extends IReportBase {
  kind: 'note';
  whatItCovers: string;
  topics?: readonly string[];
  keyFacts?: readonly string[];
  relatedNodes?: readonly string[];
  qualityNotes?: string;
}

export type TSummary =
  | ISummaryAgent
  | ISummarySkill
  | ISummaryCommand
  | ISummaryHook
  | ISummaryNote;

/**
 * Deterministic finding emitted by a rule (`spec/schemas/issue.schema.json`).
 * `info` severity is filtered out before reaching the card — only
 * `error` and `warn` surface in the node UI.
 */
export interface IIssue {
  ruleId: string;
  severity: 'error' | 'warn' | 'info';
  message: string;
  detail?: string | null;
}

/**
 * Node-derived counts the kernel computes during scan. Until the
 * kernel publishes these on `INodeView`, the graph layout passes
 * a sibling `INodeStats` so `<sm-node-card>` can render the footer
 * + subtitle pills without recomputing per-frame.
 */
export interface INodeStats {
  bytesTotal?: number;
  tokensTotal?: number;
  linksIn: number;
  linksOut: number;
  externalRefsCount?: number;
  errorCount?: number;
  warnCount?: number;
}

