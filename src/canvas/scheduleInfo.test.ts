import { describe, it, expect } from 'vitest';
import { scheduleInfo } from './scheduleInfo';

const NOON = new Date('2026-06-11T12:00:00'); // a fixed "now"

describe('scheduleInfo urgency', () => {
  it('a date-only schedule is "today" for its whole day, not overdue', () => {
    expect(scheduleInfo('2026-06-11T00:00:00', NOON)).toEqual({ label: '오늘', urg: 'today' });
  });

  it('a date-only schedule turns overdue only after its day has passed', () => {
    expect(scheduleInfo('2026-06-10T00:00:00', NOON).urg).toBe('over');
    expect(scheduleInfo('2026-06-10T00:00:00', NOON).label).toBe('어제');
  });

  it('a timed schedule is overdue once its time passes', () => {
    expect(scheduleInfo('2026-06-11T09:00:00', NOON)).toEqual({ label: '오늘 09:00', urg: 'over' });
    expect(scheduleInfo('2026-06-11T15:00:00', NOON)).toEqual({ label: '오늘 15:00', urg: 'today' });
  });

  it('tomorrow and later keep their labels', () => {
    expect(scheduleInfo('2026-06-12T00:00:00', NOON)).toEqual({ label: '내일', urg: 'soon' });
    expect(scheduleInfo('2026-06-15T00:00:00', NOON)).toEqual({ label: '4일 후', urg: 'later' });
    expect(scheduleInfo('2026-06-25T00:00:00', NOON)).toEqual({ label: '6/25', urg: 'later' });
  });
});
