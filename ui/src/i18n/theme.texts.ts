/**
 * Shared labels for the theme toggle (used by app shell + graph toolbar).
 * The `toggleTo*` strings name the NEXT state in the cycle so screen readers
 * announce the action the button performs. The `current*` strings name the
 * CURRENT state and feed the tooltip, sighted users see what's active
 * (especially important for `auto`, whose desktop/monitor icon is not
 * self-evident).
 */
export const THEME_TEXTS = {
  /** Topbar trigger: accessible name + tooltip carry the CURRENT theme. */
  trigger: (current: string): string => `Theme: ${current}`,
  menuAria: 'Choose a theme',
  currentAuto: 'Auto theme (follows system)',
  currentLight: 'Light theme',
  currentDark: 'Dark theme',
  /** Menu rows for the tri-state base (name only, user call 2026-08-29), then the registry's extras. */
  optionAuto: 'Auto',
  optionLight: 'Light',
  optionDark: 'Dark',
  extrasGroup: 'Specialty',
} as const;
