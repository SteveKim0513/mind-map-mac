import { TAG_KEYS, type TagKey } from '../theme/palette';

export interface ScheduleParseResult {
  matched: boolean;
  scheduleAt?: string; // local-time ISO "YYYY-MM-DDTHH:mm:00"
  // false only when the user typed an explicit midnight time (e.g. "@오전 12시"):
  // "...T00:00:00" would otherwise be read as all-day. undefined otherwise so the
  // agenda layer derives all-day/timed from the time component as before.
  allDay?: boolean;
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
 * Detects an explicit relative date or weekday — marked with a leading "@"
 * (e.g. "@내일", "@화요일"), mirroring the "#색상" convention — optionally
 * followed by a time of day. A bare "오늘"/"내일" with no "@" never matches:
 * those words show up constantly as ordinary labels ("오늘: 회의 메모") or in
 * plain sentences, and scheduling on every occurrence was too many false
 * positives in practice. Never matches on a bare time expression either — a
 * lone "3시" is far too ambiguous with ordinary sentence text (REDESIGN-VISION
 * §3-2/§5: "과탐지보다 무반응이 안전"). Default time when a date matches
 * without a time is 09:00, mirroring SchedulePopover's "아침 09:00" quick chip.
 */
export function parseScheduleText(text: string, now: number = Date.now()): ScheduleParseResult {
  const base = new Date(now);
  let target: Date | null = null;

  const relMatch = text.match(/@(오늘|내일|모레|글피)/);
  if (relMatch) {
    target = new Date(base);
    target.setDate(target.getDate() + RELATIVE_DAYS[relMatch[1]]);
  } else {
    const wdMatch = text.match(/@(다음\s?주\s?)?([월화수목금토일])요일/);
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
  let hadTime = false; // did the user type an explicit time token?
  // (?!간) — "3시간"(소요 시간)의 "3시"를 시각으로 오인하지 않도록. "@내일 3시간 작업"은
  // 시각 없음으로 보고 09:00 기본값을 쓴다. "@내일 3시"(다음 문자가 '간'이 아님)는 그대로 매칭.
  const timeMatch = text.match(/(오전|오후)?\s?(\d{1,2})시(?!간)(\s?(\d{1,2})분)?/);
  if (timeMatch) {
    const h = parseInt(timeMatch[2], 10);
    if (h <= 23) {
      let resolved = h;
      if (timeMatch[1] === '오후' && h < 12) resolved += 12;
      if (timeMatch[1] === '오전' && h === 12) resolved = 0;
      hour = resolved;
      minute = timeMatch[4] ? parseInt(timeMatch[4], 10) : 0;
      hadTime = true;
    }
  }

  // An explicit "오전 12시" resolves to 00:00, which would otherwise read as all-day
  // — pin it as timed. Non-midnight times derive correctly, so leave allDay unset.
  const allDay = hadTime && hour === 0 && minute === 0 ? false : undefined;
  return { matched: true, scheduleAt: `${dateStr(target)}T${pad(hour)}:${pad(minute)}:00`, allDay };
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
