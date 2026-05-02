/**
 * UI strings for the demo-mode banner. Visible only when the SPA boots
 * with `<meta name="skill-map-mode" content="demo">` (i.e. on the
 * static demo bundle deployed at skill-map.dev/demo/).
 *
 * Single-string surface today; structured as an object so future
 * additions (link copy, dismiss aria-label variants) drop in without a
 * call-site refactor. Function entries take parameters so the catalog
 * stays Transloco-ready.
 */
export const DEMO_BANNER_TEXTS = {
  body:
    "You are viewing a static demo of skill-map's UI. Run `npx @skill-map/cli serve` for the full experience.",
  dismissAria: 'Dismiss demo banner',
} as const;
