/**
 * User-visible error strings emitted by the DataSource layer (factory
 * mismatches, REST adapter failures bubbled up to the UI, etc.).
 *
 * Function-style entries take parameters so the catalog stays
 * Transloco-ready when a real i18n framework lands.
 */
export const DATA_SOURCE_TEXTS = {
  errors: {
    /**
     * Thrown when the meta-tag mode is `demo` but the StaticDataSource
     * isn't bundled (Step 14.3.a still ships only the live path).
     */
    demoModeNotImplemented:
      'SKILL_MAP_MODE=demo: StaticDataSource lands in Step 14.3.b — meta-tag mismatch?',
    /** Thrown when the meta-tag value is unrecognised (defensive). */
    unknownMode: (value: string) => `SKILL_MAP_MODE: unknown value "${value}"`,
    /** Generic REST failure prefix when the BFF returned an error envelope. */
    restPrefix: (code: string) => `BFF error [${code}]: `,
    /** Used when the response shape is unexpected (no error envelope, no JSON). */
    malformedResponse: 'BFF returned a malformed response',
  },
} as const;
