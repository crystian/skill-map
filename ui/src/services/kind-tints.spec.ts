import { describe, expect, it } from 'vitest';

import { deriveTints } from './kind-tints';

describe('deriveTints', () => {
  it('derives a pale bg + dark fg for a saturated mid color in light theme', () => {
    // #3b82f6 (Tailwind blue-500) is the agent kind base. Light theme
    // pulls bg toward white and fg toward black; the exact RGB values
    // are deterministic for the same input.
    const tints = deriveTints('#3b82f6', 'light');
    expect(tints.bg).toMatch(/^#[0-9a-f]{6}$/);
    expect(tints.fg).toMatch(/^#[0-9a-f]{6}$/);
    // bg should be lighter than the base (closer to white).
    expect(parseInt(tints.bg.slice(1), 16)).toBeGreaterThan(parseInt('3b82f6', 16));
    // fg should be darker than the base (closer to black).
    expect(parseInt(tints.fg.slice(1), 16)).toBeLessThan(parseInt('3b82f6', 16));
  });

  it('derives a dark bg + bright fg for the same color in dark theme', () => {
    const tints = deriveTints('#3b82f6', 'dark');
    expect(tints.bg).toMatch(/^#[0-9a-f]{6}$/);
    expect(tints.fg).toMatch(/^#[0-9a-f]{6}$/);
    // bg should be darker than the base (closer to black).
    expect(parseInt(tints.bg.slice(1), 16)).toBeLessThan(parseInt('3b82f6', 16));
    // fg should be brighter than the base (closer to white).
    expect(parseInt(tints.fg.slice(1), 16)).toBeGreaterThan(parseInt('3b82f6', 16));
  });

  it('is deterministic — same input always yields the same output', () => {
    const a = deriveTints('#10b981', 'light');
    const b = deriveTints('#10b981', 'light');
    expect(a).toEqual(b);
  });

  it('handles uppercase hex input', () => {
    expect(() => deriveTints('#3B82F6', 'light')).not.toThrow();
  });

  it('throws on malformed hex (no leading #, wrong length, non-hex chars)', () => {
    expect(() => deriveTints('3b82f6', 'light')).toThrow(/invalid hex color/);
    expect(() => deriveTints('#3b82', 'light')).toThrow(/invalid hex color/);
    expect(() => deriveTints('#zzzzzz', 'light')).toThrow(/invalid hex color/);
  });

  it('produces black bg/fg edge for pure black input', () => {
    // Mixing black with anything just shifts toward the other color.
    // Light bg = mix(black, white, 0.85) = #d9d9d9; light fg = mix(black, black, 0.5) = #000.
    const tints = deriveTints('#000000', 'light');
    expect(tints.bg).toBe('#d9d9d9');
    expect(tints.fg).toBe('#000000');
  });

  it('produces white-ish bg/fg edge for pure white input', () => {
    // Light bg = mix(white, white, 0.85) = #ffffff; fg = mix(white, black, 0.5) = #808080.
    const tints = deriveTints('#ffffff', 'light');
    expect(tints.bg).toBe('#ffffff');
    expect(tints.fg).toBe('#808080');
  });
});
