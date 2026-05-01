/**
 * ESLint v10 flat config for the `src/` workspace.
 *
 * Three layers:
 *   1. Project rules — translated from the legacy `.eslintrc.json`
 *      (preserved verbatim where possible).
 *   2. Architectural invariants — enforce the cross-layer contracts
 *      surfaced in the v0.6 audit:
 *        - kernel must not write stdout/stderr (`no-console`);
 *        - kernel must not read `process.cwd` / `process.env` (port them);
 *        - kernel must not import from `cli/`;
 *        - relative ESM imports terminate in `.js`.
 *   3. Stylistic — formatting rules ESLint moved out of core in v9 live
 *      in `@stylistic/eslint-plugin`.
 *
 * Tests are excluded (separate rigor) and so is the build output.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import importX from 'eslint-plugin-import-x';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '**/dist/**',
      'node_modules/**',
      'coverage/**',
      'migrations/**',
      'test/**',
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/*.mjs',
      '**/*.js',
      '!eslint.config.js',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    plugins: {
      '@stylistic': stylistic,
      'import-x': importX,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // `node` env equivalent — Node 24 globals are first-class.
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
      },
    },
    rules: {
      // --- Project rules (from legacy .eslintrc.json) ----------------------
      // Promoted to 'error' after the complexity sweep; functions that
      // are inherently complex (CLI orchestrators, parsers,
      // multi-accumulator folds) carry an `eslint-disable-next-line
      // complexity` with rationale.
      complexity: ['error', { max: 8 }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'no-eval': 'error',
      'no-throw-literal': 'error',
      'block-scoped-var': 'error',
      'no-fallthrough': 'error',
      'no-useless-return': 'error',
      'no-else-return': ['error', { allowElseIf: true }],
      'no-extra-boolean-cast': ['error', { enforceForLogicalOperands: true }],
      curly: ['error', 'multi-line', 'consistent'],
      'no-console': ['error', { allow: ['warn', 'error', 'log'] }],

      // --- TS rules (from legacy .eslintrc.json) --------------------------
      '@typescript-eslint/explicit-module-boundary-types': [
        'error',
        { allowArgumentsExplicitlyTypedAsAny: true },
      ],
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-function': 'error',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',

      // --- Quality rules surfaced by the audit -----------------------------
      'preserve-caught-error': 'error',
      // Allow ZWSP / BOM / NBSP inside string literals, regex, and
      // JSDoc — these come up legitimately in YAML BOM detection,
      // block-comment escaping, etc. Identifier whitespace stays an error.
      'no-irregular-whitespace': [
        'error',
        { skipStrings: true, skipComments: true, skipRegExps: true, skipTemplates: true },
      ],
      'no-useless-assignment': 'error',
      'no-unused-private-class-members': 'warn',

      // --- Stylistic (moved out of ESLint core in v9) ---------------------
      '@stylistic/quotes': [
        'error',
        'single',
        { avoidEscape: true, allowTemplateLiterals: 'always' },
      ],
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/linebreak-style': ['error', 'unix'],
      '@stylistic/no-multi-spaces': 'error',
      '@stylistic/newline-per-chained-call': ['error', { ignoreChainWithDepth: 4 }],

      // --- Repo invariants (apply everywhere) ------------------------------
      // Relative ESM imports MUST terminate in `.js` (TS source uses `.js`
      // because the emitted file is what the runtime resolves).
      'import-x/extensions': [
        'error',
        'always',
        { ts: 'never', tsx: 'never', json: 'always' },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // Kernel-only invariants (V1, V5 of the audit)
  // -------------------------------------------------------------------------
  {
    files: ['kernel/**/*.ts'],
    rules: {
      // V1 — kernel never writes to stdout/stderr directly. Use the
      // singleton `log` from `kernel/util/logger.js` instead.
      'no-console': 'error',

      // V5 — kernel never reads `process.cwd()` / `process.env` directly.
      // Adapters (CLI, test harness) must inject those values via options.
      // We use targeted AST selectors so other `process.*` access (like
      // `process.exit` in tests, which is excluded anyway) keeps working.
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='cwd']",
          message:
            'Kernel must not call process.cwd(). Inject `cwd` via the caller (CLI / adapter).',
        },
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'Kernel must not read process.env. Inject env values via the caller (CLI / adapter).',
        },
      ],

      // Kernel must not import from cli/. Resolves the V1 invariant
      // structurally (was hand-audited in the v0.6 review).
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '../cli/*',
                '../cli/**',
                '../../cli/*',
                '../../cli/**',
                '../../../cli/*',
                '../../../cli/**',
                '../../../../cli/*',
                '../../../../cli/**',
              ],
              message: 'Kernel must not import from cli/.',
            },
          ],
        },
      ],
    },
  },
);
