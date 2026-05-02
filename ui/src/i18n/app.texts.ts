/**
 * UI strings for the App shell (top-level chrome: brand, nav, theme toggle,
 * scan trigger, node count badge).
 *
 * Convention: each component / service owns a `*.texts.ts` file under
 * `src/i18n/`. Keys group by surface (nav, actions, a11y, …). Functions
 * are used for parameterised strings — Transloco-ready when we eventually
 * migrate to a real i18n library.
 */
export const APP_TEXTS = {
  brand: 'skill-map',
  tag: 'ui prototype · Step 3',
  nav: {
    list: 'List',
    graph: 'Graph',
    inspector: 'Inspector',
  },
  actions: {},
  badge: {
    nodes: 'nodes',
  },
  a11y: {
    viewSwitcher: 'View switcher',
  },
} as const;
