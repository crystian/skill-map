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
  nav: {
    graph: 'Graph',
    list: 'List',
  },
  actions: {},
  badge: {
    nodes: 'nodes',
  },
  a11y: {
    viewSwitcher: 'View switcher',
  },
  viewportWarning: {
    title: "Looks like you're on a small screen",
    subtitle: 'skill-map is built for desktop',
    body: 'The graph and inspector need room to breathe. Pop this open on a screen at least 768px wide — see you there.',
  },
} as const;
