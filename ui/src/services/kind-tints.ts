/**
 * `deriveTints(baseHex, theme)` — derive `bg` and `fg` tints from a
 * Provider-declared kind color (Step 14.5.d).
 *
 * The Provider declares a single base color per theme (`color` for
 * light, optional `colorDark` for dark, falling back to `color`). The
 * UI derives `bg` and `fg` here so providers don't have to ship four
 * hex values per kind and so the contrast story stays in one place.
 *
 * Algorithm — deliberately simple, no perceptual color space gymnastics
 * because the design only needs three readable variants per kind:
 *
 *   - **light theme**: `bg` = base mixed 90% toward white (very pale tint
 *     suitable for chip backgrounds); `fg` = base mixed 50% toward black
 *     (deep saturated text that reads against the pale bg).
 *   - **dark theme**: `bg` = base mixed 70% toward black (deep tint
 *     suitable for chip backgrounds in dark mode); `fg` = base mixed
 *     60% toward white (bright text that reads against the deep bg).
 *
 * Pure function — no DOM touch, no globals — so the UI's CSS-variable
 * service (`KindRegistryService.applyCssVars`) can call it deterministically
 * at boot and tests can assert exact values.
 */

export type TKindTintTheme = 'light' | 'dark';

export interface IKindTints {
  bg: string;
  fg: string;
}

/**
 * Mix two colors by `ratio`. `ratio` of 0 returns `from`; `ratio` of 1
 * returns `to`. Linear in sRGB — accurate enough for the UI's contrast
 * needs without dragging in a perceptual color library.
 */
function mix(from: [number, number, number], to: [number, number, number], ratio: number): [number, number, number] {
  return [
    Math.round(from[0] + (to[0] - from[0]) * ratio),
    Math.round(from[1] + (to[1] - from[1]) * ratio),
    Math.round(from[2] + (to[2] - from[2]) * ratio),
  ];
}

function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) {
    throw new Error(`deriveTints: invalid hex color "${hex}" (expected #RRGGBB)`);
  }
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function toHex([r, g, b]: [number, number, number]): string {
  const toByte = (n: number): string => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

export function deriveTints(baseHex: string, theme: TKindTintTheme): IKindTints {
  const base = parseHex(baseHex);
  if (theme === 'light') {
    return {
      bg: toHex(mix(base, WHITE, 0.85)),
      fg: toHex(mix(base, BLACK, 0.5)),
    };
  }
  return {
    bg: toHex(mix(base, BLACK, 0.7)),
    fg: toHex(mix(base, WHITE, 0.6)),
  };
}
