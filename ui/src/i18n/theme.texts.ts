/**
 * Shared labels for the theme toggle (used by app shell + graph toolbar).
 * The `toggleTo*` strings name the NEXT state in the cycle so screen readers
 * announce the action the button performs.
 */
export const THEME_TEXTS = {
  toggleToAuto: 'Switch to auto theme (follow system)',
  toggleToLight: 'Switch to light theme',
  toggleToDark: 'Switch to dark theme',
} as const;
