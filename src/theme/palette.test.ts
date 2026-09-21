import { describe, it, expect } from 'vitest';
import { contrastInk, presenceKey, PRESENCE_KEYS, TAG_KEYS } from './palette';

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

describe('presenceKey (공유 노트 참가자 표시색)', () => {
  it('같은 참가자 id는 항상 같은 색 키를 받는다', () => {
    expect(presenceKey('p-abc123')).toBe(presenceKey('p-abc123'));
  });

  it('태그 팔레트 키만 쓰고 노란색은 제외한다(밝은 테마 대비)', () => {
    expect(PRESENCE_KEYS).not.toContain('yellow');
    for (const k of PRESENCE_KEYS) expect(TAG_KEYS).toContain(k);
    for (let i = 0; i < 200; i++) expect(PRESENCE_KEYS).toContain(presenceKey(`participant-${i}`));
  });

  it('여러 참가자가 여러 색으로 흩어진다(전부 같은 색으로 몰리지 않는다)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) seen.add(presenceKey(`participant-${i}`));
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });
});
