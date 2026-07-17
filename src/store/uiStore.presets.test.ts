import { describe, it, expect } from 'vitest';
import { cleanPresets, DEFAULT_TIME_PRESETS } from './uiStore';

// 시간 프리셋 검증/정규화(순수 함수). 저장·로드 경계에서 잘못된 값이 칩을 깨지 않도록.
describe('cleanPresets', () => {
  it('keeps valid rows and trims/caps labels', () => {
    expect(cleanPresets([{ label: '  아침  ', time: '09:00' }])).toEqual([{ label: '아침', time: '09:00' }]);
    expect(cleanPresets([{ label: '엄청나게긴라벨이야', time: '09:00' }])[0].label).toHaveLength(8);
  });

  it('drops rows with an empty label or an invalid time', () => {
    expect(
      cleanPresets([
        { label: '', time: '09:00' }, // empty label → drop
        { label: '   ', time: '10:00' }, // whitespace label → drop
        { label: '점심', time: '25:00' }, // invalid hour → drop
        { label: '저녁', time: '9:00' }, // not HH:MM → drop
        { label: '밤', time: '21:00' }, // valid → keep
      ]),
    ).toEqual([{ label: '밤', time: '21:00' }]);
  });

  it('caps the list at 6', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ label: `t${i}`, time: '08:00' }));
    expect(cleanPresets(many)).toHaveLength(6);
  });

  it('returns an empty list for non-arrays or all-invalid input (caller decides fallback)', () => {
    expect(cleanPresets(null)).toEqual([]);
    expect(cleanPresets('nope')).toEqual([]);
    expect(cleanPresets([{ foo: 'bar' }])).toEqual([]);
  });

  it('accepts the shipped defaults unchanged', () => {
    expect(cleanPresets(DEFAULT_TIME_PRESETS)).toEqual(DEFAULT_TIME_PRESETS);
  });
});
