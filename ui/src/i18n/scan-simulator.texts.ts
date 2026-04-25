/**
 * Event-bus messages emitted by the ScanSimulatorService. These are
 * user-visible (they render in the EventLog drawer) so they belong in i18n.
 */
export const SCAN_SIMULATOR_TEXTS = {
  scanStarted: (total: number) => `Scanning ${total} nodes…`,
  scanProgress: (index: number, total: number, path: string) => `[${index}/${total}] ${path}`,
  scanCompleted: (durationSec: string, total: number) => `Scan completed in ${durationSec}s — ${total} nodes.`,
  issueDeprecated: (path: string) => `Deprecated: ${path}`,
} as const;
