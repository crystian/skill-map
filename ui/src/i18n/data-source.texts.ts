/**
 * User-visible error strings emitted by the DataSource layer (factory
 * mismatches, REST adapter failures bubbled up to the UI, etc.).
 *
 * Function-style entries take parameters so the catalog stays
 * Transloco-ready when a real i18n framework lands.
 */
export const DATA_SOURCE_TEXTS = {
  errors: {
    /** Thrown when the meta-tag value is unrecognised (defensive). */
    unknownMode: (value: string) => `SKILL_MAP_MODE: unknown value "${value}"`,
    /** Generic REST failure prefix when the BFF returned an error envelope. */
    restPrefix: (code: string) => `BFF error [${code}]: `,
    /** Used when the response shape is unexpected (no error envelope, no JSON). */
    malformedResponse: 'BFF returned a malformed response',
    /** Static-bundle fetch failed (network, 404 on the asset, etc.). */
    demoFetchFailed: (path: string, reason: string) =>
      `Demo bundle fetch failed for "${path}": ${reason}`,
    /** Static-bundle JSON parse failed. */
    demoParseFailed: (path: string, reason: string) =>
      `Demo bundle parse failed for "${path}": ${reason}`,
    /**
     * Demo build only ships the ASCII graph. Other formats reach the
     * adapter only if a caller forgets the demo-mode constraint.
     */
    graphFormatNotInDemo: (format: string) =>
      `Graph format "${format}" is not bundled in demo mode (only "ascii").`,
  },
} as const;
