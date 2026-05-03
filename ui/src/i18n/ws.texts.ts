/**
 * Developer-facing log strings for `WsEventStreamService`. The service
 * runs in the browser and writes these via `console.warn` / `console.info`
 * — not user-facing UI text. Centralised here so the rest of the
 * codebase has a single map of every WS-related message.
 *
 * Function-style entries take parameters so the catalog stays
 * Transloco-ready when a real i18n framework lands.
 */
export const WS_TEXTS = {
  /** Logged when the WebSocket open handshake completes. */
  connected: (url: string) => `[ws] connected to ${url}`,
  /** Logged when the WebSocket closes for any reason. */
  closed: (code: number, reason: string) => `[ws] closed (code=${code}, reason="${reason}")`,
  /** Logged when a frame fails JSON parse or fails the envelope shape check. */
  malformedFrame: (reason: string) => `[ws] malformed frame dropped: ${reason}`,
  /** Logged on `WebSocket.onerror` — the next event is usually `onclose`. */
  socketError: (message: string) => `[ws] socket error: ${message}`,
  /** Logged when the service schedules a reconnect attempt. */
  reconnectScheduled: (delayMs: number, attempt: number) =>
    `[ws] reconnect attempt ${attempt} scheduled in ${delayMs}ms`,
  /** Logged when reconnect attempts are exhausted; the consumer is on its own. */
  reconnectGiveUp: (attempts: number) =>
    `[ws] giving up after ${attempts} failed reconnect attempts`,
} as const;
