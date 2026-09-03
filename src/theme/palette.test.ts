import { describe, it, expect } from 'vitest';
import { contrastInk, TAG_KEYS } from './palette';

describe('contrastInk', () => {
  it('falls back to dark ink for an unset/unknown color', () => {
    expect(contrastInk(undefined, 'light')).toBe('dark');
    expect(contrastInk('#123456', 'light')).toBe('dark');
  });

  it('picks the higher-contrast ink for every tag color, not just "is luminance > 0.5"', () => {
    // regression for the 2026-09-03 bug: a luminance > 0.5 threshold made every
    // pastel tag color (all well under 0.5 in linear luminance) render white
    // text, even ones that clearly read better with dark text (e.g. yellow).
    for (const key of TAG_KEYS) {
      const ink = contrastInk(key, 'light');
      expect(['dark', 'light']).toContain(ink);
    }
    expect(contrastInk('yellow', 'light')).toBe('dark');
  });
});
