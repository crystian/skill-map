/**
 * Built-in extension registry. Returns the eight extensions bundled with
 * the reference implementation, ready to be registered on a Kernel. The
 * set matches ROADMAP §Step 2 verbatim.
 *
 * Keeping runtime references separate from the manifest-only entries the
 * Registry indexes: a consumer that only needs to list what's bundled
 * iterates `listBuiltIns()` for cheap manifest facts, while the
 * orchestrator needs the concrete `IAdapter` / `IDetector` / ... values
 * to actually call walk / detect / evaluate / render / run. Two exports
 * keep both access patterns first-class.
 */

import type {
  IAdapter,
  IAudit,
  IDetector,
  IRenderer,
  IRule,
} from '../kernel/extensions/index.js';
import type { Extension } from '../kernel/registry.js';
import { claudeAdapter } from './adapters/claude/index.js';
import { frontmatterDetector } from './detectors/frontmatter/index.js';
import { slashDetector } from './detectors/slash/index.js';
import { atDirectiveDetector } from './detectors/at-directive/index.js';
import { externalUrlCounterDetector } from './detectors/external-url-counter/index.js';
import { triggerCollisionRule } from './rules/trigger-collision/index.js';
import { brokenRefRule } from './rules/broken-ref/index.js';
import { supersededRule } from './rules/superseded/index.js';
import { asciiRenderer } from './renderers/ascii/index.js';
import { validateAllAudit } from './audits/validate-all/index.js';

export interface IBuiltIns {
  adapters: IAdapter[];
  detectors: IDetector[];
  rules: IRule[];
  renderers: IRenderer[];
  audits: IAudit[];
}

export function builtIns(): IBuiltIns {
  return {
    adapters: [claudeAdapter],
    detectors: [frontmatterDetector, slashDetector, atDirectiveDetector, externalUrlCounterDetector],
    rules: [triggerCollisionRule, brokenRefRule, supersededRule],
    renderers: [asciiRenderer],
    audits: [validateAllAudit],
  };
}

/** Flat view as Registry-ready Extension rows. */
export function listBuiltIns(): Extension[] {
  const set = builtIns();
  return [
    ...set.adapters,
    ...set.detectors,
    ...set.rules,
    ...set.renderers,
    ...set.audits,
  ].map((x): Extension => {
    const row: Extension = { id: x.id, kind: x.kind, version: x.version };
    if (x.description !== undefined) row.description = x.description;
    if (x.stability !== undefined) row.stability = x.stability;
    if (x.preconditions !== undefined) row.preconditions = x.preconditions;
    if (x.entry !== undefined) row.entry = x.entry;
    return row;
  });
}
