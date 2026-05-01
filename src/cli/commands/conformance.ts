/**
 * `sm conformance run [--scope spec|provider:<id>|all]` — kernel-side CLI
 * verb for the conformance suite (Phase 5 / A.13).
 *
 * The verb is a thin orchestration layer over `runConformanceCase` (in
 * `src/conformance/index.ts`) and the scope registry at
 * `cli/util/conformance-scopes.ts`. It:
 *
 *   1. Resolves the requested scope set (`spec`, `provider:<id>`, or
 *      `all` — default).
 *   2. For each scope, enumerates `cases/*.json` and runs them one by
 *      one against the same `sm` binary that hosts the verb.
 *   3. Prints a pass/fail line per case + a summary per scope + a
 *      grand total.
 *
 * Why dispatch to a child `sm` instead of calling the orchestrator
 * directly: the runner already exec's `bin/sm.js` for assertion
 * symmetry — it is the contract every conforming impl must satisfy.
 * Reusing it keeps `sm conformance run` honest (the verb passes the
 * same gate any third-party reviewer would run).
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  every case in every selected scope passed
 *   1  one or more cases failed
 *   2  configuration error (unknown `--scope`, missing binary, ...)
 *
 * Stub caveats — the surface beyond the dispatch loop is intentionally
 * thin in this bump:
 *
 *   - No `--json` mode yet. The verb prints human-readable summaries
 *     to stdout; failures detail to stderr. JSON output lands when the
 *     conformance reporter shape stabilises (Step 2's full runner pass).
 *   - No parallelism. Cases run sequentially per scope; the runner
 *     already provisions an isolated tmp directory per case so this is
 *     a perf knob, not a correctness one.
 *   - The `file-matches-schema` assertion is still stubbed in the
 *     runner itself (lands with Step 2's AJV wiring). Cases relying on
 *     it report `not yet implemented` per case, not per verb.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command, Option } from 'clipanion';

import { runConformanceCase } from '../../conformance/index.js';
import { tx } from '../../kernel/util/tx.js';
import { CONFORMANCE_TEXTS } from '../i18n/conformance.texts.js';
import { ExitCode, type TExitCode } from '../util/exit-codes.js';
import { formatErrorMessage } from '../util/error-reporter.js';
import {
  listCaseFiles,
  selectConformanceScopes,
  type IConformanceScope,
} from '../util/conformance-scopes.js';

/**
 * Resolve the absolute path to `bin/sm.js` relative to this module's
 * location. Works in both the source-tree layout
 * (`src/cli/commands/conformance.ts` → `src/bin/sm.js`) and the bundled
 * dist layout (`dist/cli.js` → `dist/../bin/sm.js`). The dev flow runs
 * `tsx` directly so module identity is fine; the build flow re-exports
 * via `dist/cli.js`, also next to `bin/`.
 */
function resolveBinary(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // walk up looking for a sibling `bin/sm.js`
  let cursor = here;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = resolve(cursor, 'bin', 'sm.js');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return resolve(here, '..', '..', 'bin', 'sm.js');
}

export class ConformanceRunCommand extends Command {
  static override paths = [['conformance', 'run']];

  static override usage = Command.Usage({
    category: 'Introspection',
    description:
      'Run the conformance suite — spec-owned cases plus every built-in Provider.',
    details: `
      Drives the conformance runner shipped at
      \`@skill-map/cli/conformance\` against the cases bundled with
      this CLI install. Each case provisions an isolated tmp scope,
      seeds the appropriate fixture, runs an \`sm\` invocation, and
      asserts the requested predicates.

      Scope selection:

        --scope spec               only spec-owned, kernel-agnostic cases
                                    (default fixture: \`preamble-v1.txt\`,
                                    case: \`kernel-empty-boot\`).
        --scope provider:<id>      only the named built-in Provider's
                                    cases. Today: \`provider:claude\`
                                    (\`basic-scan\`, \`rename-high\`,
                                    \`orphan-detection\`).
        --scope all (default)      every scope, in registry order.

      Exit codes mirror the rest of the verb catalog: 0 on a clean
      sweep, 1 if any case failed, 2 on a configuration error
      (unknown scope, missing binary).
    `,
    examples: [
      ['Run every conformance suite', '$0 conformance run'],
      ['Run only the spec suite', '$0 conformance run --scope spec'],
      [
        'Run only the Claude Provider suite',
        '$0 conformance run --scope provider:claude',
      ],
    ],
  });

  scope = Option.String('--scope', {
    required: false,
    description:
      "Suite selector: 'all' (default), 'spec', or 'provider:<id>'.",
  });

  // CLI orchestrator: scope resolution + per-case run loop +
  // per-result render branches + global pass/fail decision.
  // eslint-disable-next-line complexity
  async execute(): Promise<TExitCode> {
    let scopes: IConformanceScope[];
    try {
      scopes = selectConformanceScopes(this.scope);
    } catch (err) {
      const message = formatErrorMessage(err);
      this.context.stderr.write(tx(CONFORMANCE_TEXTS.unknownScope, { message }));
      return ExitCode.Error;
    }

    const binary = resolveBinary();
    if (!existsSync(binary)) {
      this.context.stderr.write(
        tx(CONFORMANCE_TEXTS.noBinary, { binary }),
      );
      return ExitCode.Error;
    }

    let totalPass = 0;
    let totalCases = 0;
    let anyFailure = false;

    for (const scope of scopes) {
      const cases = listCaseFiles(scope);
      if (cases.length === 0) {
        this.context.stdout.write(
          tx(CONFORMANCE_TEXTS.scopeEmpty, { label: scope.label }),
        );
        continue;
      }
      this.context.stdout.write(
        tx(CONFORMANCE_TEXTS.scopeHeader, {
          label: scope.label,
          caseCount: cases.length,
        }),
      );

      let scopePass = 0;
      for (const casePath of cases) {
        const caseId = readCaseId(casePath);
        try {
          const result = runConformanceCase({
            binary,
            specRoot: scope.specRoot,
            casePath,
            fixturesRoot: scope.fixturesDir,
          });
          if (result.passed) {
            this.context.stdout.write(
              tx(CONFORMANCE_TEXTS.caseOk, { caseId: result.caseId }),
            );
            scopePass += 1;
          } else {
            anyFailure = true;
            this.context.stdout.write(
              tx(CONFORMANCE_TEXTS.caseFail, { caseId: result.caseId }),
            );
            for (const a of result.assertions) {
              if (a.ok) continue;
              this.context.stderr.write(
                tx(CONFORMANCE_TEXTS.caseFailureDetail, {
                  type: a.type,
                  reason: a.reason,
                }),
              );
            }
            writeStreamSnippet(
              this.context.stderr,
              CONFORMANCE_TEXTS.caseFailureStdoutHeader,
              result.stdout,
            );
            writeStreamSnippet(
              this.context.stderr,
              CONFORMANCE_TEXTS.caseFailureStderrHeader,
              result.stderr,
            );
          }
        } catch (err) {
          anyFailure = true;
          const message = formatErrorMessage(err);
          this.context.stderr.write(
            tx(CONFORMANCE_TEXTS.runtimeError, { message }),
          );
          this.context.stdout.write(tx(CONFORMANCE_TEXTS.caseFail, { caseId }));
        }
      }

      this.context.stdout.write(
        tx(CONFORMANCE_TEXTS.scopeSummary, {
          label: scope.label,
          passCount: scopePass,
          caseCount: cases.length,
        }),
      );
      totalPass += scopePass;
      totalCases += cases.length;
    }

    this.context.stdout.write(
      tx(CONFORMANCE_TEXTS.totalSummary, {
        passCount: totalPass,
        caseCount: totalCases,
        scopeCount: scopes.length,
      }),
    );

    if (anyFailure) return ExitCode.Issues;
    return ExitCode.Ok;
  }
}

function readCaseId(casePath: string): string {
  try {
    const raw = readFileSync(casePath, 'utf8');
    const parsed = JSON.parse(raw) as { id?: unknown };
    if (typeof parsed.id === 'string') return parsed.id;
  } catch {
    /* fall through */
  }
  return casePath;
}

function writeStreamSnippet(
  stream: { write: (s: string) => boolean | unknown },
  header: string,
  text: string,
): void {
  const trimmed = text.trim();
  if (trimmed.length === 0) return;
  stream.write(header);
  for (const line of trimmed.split(/\r?\n/)) {
    stream.write(tx(CONFORMANCE_TEXTS.caseFailureStreamLine, { line }));
  }
}

export const CONFORMANCE_COMMANDS = [ConformanceRunCommand];
