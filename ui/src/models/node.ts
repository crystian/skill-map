/**
 * Local TypeScript mirror of `@skill-map/spec/schemas/frontmatter/*.schema.json`.
 *
 * Temporary. The canonical source of truth is the JSON Schema. These types
 * exist only until Step 1b lands a proper DTO emission path in `@skill-map/spec`
 * (see ROADMAP §DTO gap). Drift risk is accepted for the Step 0c prototype
 * because the mock collection is the only consumer and the schemas are small.
 *
 * DO NOT extend these with ui-specific fields. Keep the shapes as pure
 * reflections of the spec; put ui state on `TNodeView` below.
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
 * UI-facing node shape. Composes the parsed frontmatter with ui-only fields
 * (path, body, derived kind). This is the type stored in the in-memory
 * collection and passed to views.
 */
export interface TNodeView {
  path: string;
  kind: TNodeKind;
  frontmatter: TFrontmatter;
  body: string;
  raw: string;
}

/**
 * Mock-collection manifest shape, produced by ui/scripts/build-mock-index.mjs.
 */
export interface IMockIndex {
  generatedAt: string;
  root: string;
  count: number;
  paths: string[];
}
