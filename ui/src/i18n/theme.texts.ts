/**
 * Shared labels for the theme toggle (used by app shell + graph toolbar).
 * The `toggleTo*` strings name the NEXT state in the cycle so screen readers
 * announce the action the button performs. The `current*` strings name the
 * CURRENT state and feed the tooltip — sighted users see what's active
 * (especially important for `auto`, whose desktop/monitor icon is not
 * self-evident).
 */
export const THEME_TEXTS = {
  toggleToAuto: 'Switch to auto theme (follow system)',
  toggleToLight: 'Switch to light theme',
  toggleToDark: 'Switch to dark theme',
  currentAuto: 'Auto theme (follows system)',
  currentLight: 'Light theme',
  currentDark: 'Dark theme',
} as const;
