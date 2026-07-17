import { describe, it, expect } from 'vitest';
import { parseScheduleText, parseHashtagColor } from './parseNodeText';

// Fixed reference "now": Wednesday 2026-07-08 12:00:00 local.
const NOW = new Date(2026, 6, 8, 12, 0, 0).getTime();

describe('parseScheduleText', () => {
  it('matches an @-marked relative day with the 09:00 default time', () => {
    expect(parseScheduleText('@내일 회의', NOW)).toEqual({
      matched: true,
      scheduleAt: '2026-07-09T09:00:00',
    });
  });

  it('matches @오늘/@모레/@글피', () => {
    expect(parseScheduleText('@오늘 정리', NOW).scheduleAt).toBe('2026-07-08T09:00:00');
    expect(parseScheduleText('@모레 발표', NOW).scheduleAt).toBe('2026-07-10T09:00:00');
    expect(parseScheduleText('@글피 여행', NOW).scheduleAt).toBe('2026-07-11T09:00:00');
  });

  it('combines an @-marked relative day with an explicit time (오후 3시)', () => {
    expect(parseScheduleText('@내일 오후 3시 미팅', NOW).scheduleAt).toBe('2026-07-09T15:00:00');
  });

  it('treats a bare 24h hour without 오전/오후 literally', () => {
    expect(parseScheduleText('@내일 3시 미팅', NOW).scheduleAt).toBe('2026-07-09T03:00:00');
  });

  it("resolves this week's weekday (2026-07-08 is a Wednesday)", () => {
    // 금요일 without "다음 주" → this week's Friday, 2 days out.
    expect(parseScheduleText('@금요일에 제출', NOW).scheduleAt).toBe('2026-07-10T09:00:00');
  });

  it('resolves "다음 주 월요일" to next week even though Monday already passed this week', () => {
    expect(parseScheduleText('@다음 주 월요일 출발', NOW).scheduleAt).toBe('2026-07-13T09:00:00');
  });

  it('does not match without a leading @, even with a clear date word', () => {
    // The original false-positive complaint: "오늘"/"내일" used as a plain
    // label or in an ordinary sentence must never auto-schedule.
    expect(parseScheduleText('내일 회의', NOW)).toEqual({ matched: false });
    expect(parseScheduleText('오늘 : 회의 메모', NOW)).toEqual({ matched: false });
    expect(parseScheduleText('화요일에 제출', NOW)).toEqual({ matched: false });
  });

  it('does not match a bare time expression with no date/weekday', () => {
    expect(parseScheduleText('3시에 밥 먹자', NOW)).toEqual({ matched: false });
  });

  it('does not match ordinary text with numbers but no date word', () => {
    expect(parseScheduleText('할 일이 3개 남았다', NOW)).toEqual({ matched: false });
  });

  it('ignores an out-of-range hour and falls back to the 09:00 default', () => {
    expect(parseScheduleText('@내일 25시 도착', NOW).scheduleAt).toBe('2026-07-09T09:00:00');
  });

  it('does not read "N시간"(소요 시간) as a time — "@내일 3시간 작업" uses the 09:00 default', () => {
    // "3시" inside "3시간" must not schedule at 03:00.
    expect(parseScheduleText('@내일 3시간 작업', NOW).scheduleAt).toBe('2026-07-09T09:00:00');
  });
});

describe('parseScheduleText — allDay (explicit midnight)', () => {
  it('pins an explicit "오전 12시" as timed (allDay:false), not all-day', () => {
    const r = parseScheduleText('@내일 오전 12시 심야회의', NOW);
    expect(r.scheduleAt).toBe('2026-07-09T00:00:00');
    expect(r.allDay).toBe(false);
  });

  it('leaves allDay undefined for a normal timed input (derives fine)', () => {
    expect(parseScheduleText('@내일 오후 3시 미팅', NOW).allDay).toBeUndefined();
  });

  it('leaves allDay undefined when no time is typed (defaults to 09:00)', () => {
    expect(parseScheduleText('@내일 회의', NOW).allDay).toBeUndefined();
  });
});

describe('parseHashtagColor', () => {
  it('matches an English tag key', () => {
    expect(parseHashtagColor('할 일 #red')).toBe('red');
  });

  it('matches a Korean alias', () => {
    expect(parseHashtagColor('아이디어 #보라')).toBe('violet');
  });

  it('is case-insensitive for English keys', () => {
    expect(parseHashtagColor('#TEAL 작업')).toBe('teal');
  });

  it('returns undefined for an unrecognized token', () => {
    expect(parseHashtagColor('#아무거나')).toBeUndefined();
  });

  it('returns undefined when there is no hashtag', () => {
    expect(parseHashtagColor('그냥 텍스트')).toBeUndefined();
  });
});
