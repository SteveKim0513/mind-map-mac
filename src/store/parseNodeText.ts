import { TAG_KEYS, type TagKey } from '../theme/palette';

export interface ScheduleParseResult {
  matched: boolean;
  scheduleAt?: string; // local-time ISO "YYYY-MM-DDTHH:mm:00"
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']; // index = Date#getDay()
const RELATIVE_DAYS: Record<string, number> = { 오늘: 0, 내일: 1, 모레: 2, 글피: 3 };

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function dateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Detects an explicit relative date or weekday, optionally followed by a time
 * of day. Never matches on a bare time expression — a lone "3시" is far too
 * ambiguous with ordinary sentence text (REDESIGN-VISION §3-2/§5: "과탐지보다
 * 무반응이 안전"). Default time when a date matches without a time is 09:00,
 * mirroring SchedulePopover's "아침 09:00" quick chip.
 */
export function parseScheduleText(text: string, now: number = Date.now()): ScheduleParseResult {
  const base = new Date(now);
  let target: Date | null = null;

  const relMatch = text.match(/(오늘|내일|모레|글피)/);
  if (relMatch) {
    target = new Date(base);
    target.setDate(target.getDate() + RELATIVE_DAYS[relMatch[1]]);
  } else {
    const wdMatch = text.match(/(다음\s?주\s?)?([월화수목금토일])요일/);
    if (wdMatch) {
      const targetDow = WEEKDAYS.indexOf(wdMatch[2]);
      const isNextWeek = !!wdMatch[1];
      // Anchor to this calendar week's Sunday, then step to the target weekday —
      // avoids double-counting when "이번 주"'s occurrence already passed (e.g.
      // "다음 주 월요일" asked on a Wednesday must land 5 days out, not 12).
      const thisWeekSunday = new Date(base);
      thisWeekSunday.setDate(thisWeekSunday.getDate() - thisWeekSunday.getDay());
      const candidate = new Date(thisWeekSunday);
      candidate.setDate(candidate.getDate() + targetDow + (isNextWeek ? 7 : 0));
      if (!isNextWeek && candidate < base) candidate.setDate(candidate.getDate() + 7);
      target = candidate;
    }
  }

  if (!target) return { matched: false };

  let hour = 9;
  let minute = 0;
  const timeMatch = text.match(/(오전|오후)?\s?(\d{1,2})시(\s?(\d{1,2})분)?/);
  if (timeMatch) {
    const h = parseInt(timeMatch[2], 10);
    if (h <= 23) {
      let resolved = h;
      if (timeMatch[1] === '오후' && h < 12) resolved += 12;
      if (timeMatch[1] === '오전' && h === 12) resolved = 0;
      hour = resolved;
      minute = timeMatch[4] ? parseInt(timeMatch[4], 10) : 0;
    }
  }

  return { matched: true, scheduleAt: `${dateStr(target)}T${pad(hour)}:${pad(minute)}:00` };
}

const KOREAN_TO_TAG_KEY: Record<string, TagKey> = {
  빨강: 'red',
  주황: 'orange',
  노랑: 'yellow',
  초록: 'green',
  청록: 'teal',
  보라: 'violet',
  분홍: 'pink',
  갈색: 'brown',
};

/** Detects a `#색상명` token matching a tag-palette key (English or Korean alias). */
export function parseHashtagColor(text: string): TagKey | undefined {
  const m = text.match(/#([\p{L}\d]+)/u);
  if (!m) return undefined;
  const token = m[1].toLowerCase();
  if ((TAG_KEYS as readonly string[]).includes(token)) return token as TagKey;
  return KOREAN_TO_TAG_KEY[m[1]];
}
