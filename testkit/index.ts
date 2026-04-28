/**
 * `@skill-map/testkit` — kernel mocks + builders for plugin authors.
 *
 * Plugin authors install this alongside `@skill-map/cli` and use it to
 * unit-test their detectors, rules, renderers, and audits without
 * spinning up a real kernel + DB.
 *
 * The surface stays thin: builders for spec-aligned domain objects
 * (`Node` / `Link` / `Issue` / `ScanResult`), per-kind context
 * factories, in-memory storage / runner stand-ins, and high-level
 * `runDetectorOnFixture` / `runRuleOnGraph` / `runRendererOnGraph`
 * helpers that wire everything up for the most common test shape.
 *
 * **Stability**: `experimental` while Step 9 is in flight. The runner
 * stand-in (`makeFakeRunner`) is the most likely surface to change,
 * because it tracks the Step 10 job subsystem contract. Detector /
 * rule / renderer helpers and the builders are intended to stay
 * stable through v1.0.
 */

export {
  node,
  link,
  issue,
  scanResult,
} from './src/builders.js';

export {
  makeDetectContext,
  makeRuleContext,
  makeRenderContext,
  detectContextFromBody,
} from './src/context.js';
export type {
  IDetectContext,
  IRuleContext,
  IRenderContext,
} from './src/context.js';

export { makeFakeStorage } from './src/storage.js';
export type {
  IFakeStoragePort,
  IMakeFakeStorageOptions,
} from './src/storage.js';

export { makeFakeRunner } from './src/runner.js';
export type {
  IFakeRunnerCall,
  IFakeRunnerPort,
  IFakeRunnerResponse,
  IMakeFakeRunnerOptions,
} from './src/runner.js';

export {
  runDetectorOnFixture,
  runRuleOnGraph,
  runRendererOnGraph,
} from './src/run.js';
export type {
  IRunDetectorOptions,
  IRunRendererOptions,
  IRunRuleOptions,
} from './src/run.js';

// Re-export the spec-aligned domain types so a plugin author who pulls
// in this package gets the type vocabulary in one place. They can still
// import directly from `@skill-map/cli` if they prefer.
export type {
  Confidence,
  Issue,
  Link,
  LinkKind,
  Node,
  NodeKind,
  ScanResult,
  Severity,
  Stability,
  TripleSplit,
  IDetector,
  IRule,
  IRenderer,
  IAdapter,
  IAudit,
} from '@skill-map/cli';
