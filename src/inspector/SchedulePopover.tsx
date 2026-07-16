import { useRef } from 'react';
import { useMap, useMapStore } from '../store/mapStore';
import { useUi } from '../store/uiStore';
import { requestFocusStart } from '../focus/controller';
import { Icon } from '../ui/Icon';
import { useNodeAnchoredPosition } from '../ui/useNodeAnchoredPosition';
import { useOutsideDismiss } from '../ui/useOutsideDismiss';

interface Props {
  id: string;
  onClose: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** our scheduleAt is local ISO "YYYY-MM-DDTHH:mm:ss" — split into the two fields. */
function splitISO(iso: string | undefined): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}
function combine(date: string, time: string): string | undefined {
  if (!date) return undefined;
  return `${date}T${time || '00:00'}:00`;
}

/** Human label for a chosen schedule, shown as a live preview. */
function preview(date: string, time: string): string {
  if (!date) return '날짜를 선택하세요';
  const d = new Date(`${date}T${time || '00:00'}:00`);
  if (Number.isNaN(d.getTime())) return '—';
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((d0.getTime() - t0.getTime()) / 86400000);
  const rel =
    days === 0 ? '오늘' : days === 1 ? '내일' : days === -1 ? '어제' : days > 0 ? `${days}일 후` : `${-days}일 전`;
  const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일 (${wd})`;
  const hasTime = time && time !== '00:00';
  return hasTime ? `${rel} · ${md} · ${time}` : `${rel} · ${md}`;
}

/** Schedule editor floated beside its node: set a date/time and toggle Reminders sync. */
export function SchedulePopover({ id, onClose }: Props) {
  const node = useMap((s) => s.doc.nodes[id]);
  const setScheduleAt = useMap((s) => s.setScheduleAt);
  const setDuration = useMap((s) => s.setDuration);
  const setReminderOn = useMap((s) => s.setReminderOn);
  const syncStatus = useUi((s) => s.syncStatus);
  const mapStore = useMapStore();

  const ref = useRef<HTMLDivElement>(null);

  const { date, time } = splitISO(node?.scheduleAt);

  const apply = (nextDate: string, nextTime: string) => setScheduleAt(id, combine(nextDate, nextTime));

  // ── natural-language quick sets ───────────────────────────────────────────
  const relDate = (addDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + addDays);
    return dateStr(d);
  };
  const nextWeekend = () => {
    const d = new Date();
    const delta = (6 - d.getDay() + 7) % 7 || 7; // upcoming Saturday
    d.setDate(d.getDate() + delta);
    return dateStr(d);
  };
  const dateChips = [
    { label: '오늘', get: () => relDate(0) },
    { label: '내일', get: () => relDate(1) },
    { label: '주말', get: () => nextWeekend() },
    { label: '다음 주', get: () => relDate(7) },
  ];
  const timeChips = [
    { label: '아침', sub: '9:00', val: '09:00' },
    { label: '점심', sub: '13:00', val: '13:00' },
    { label: '저녁', sub: '18:00', val: '18:00' },
    { label: '밤', sub: '21:00', val: '21:00' },
  ];
  const durationChips = [
    { label: '없음', min: 0 },
    { label: '15분', min: 15 },
    { label: '30분', min: 30 },
    { label: '1시간', min: 60 },
    { label: '2시간', min: 120 },
  ];
  const hasTime = !!time && time !== '00:00';

  const pos = useNodeAnchoredPosition(id, 300, { height: 360 });

  useOutsideDismiss(ref, onClose, {
    // a native date/time picker overlay renders OUTSIDE our DOM; while one of
    // our inputs holds focus, an outside mousedown is likely a click in that
    // picker (selecting a day/time) — don't close the popover then.
    skip: () => !!ref.current?.contains(document.activeElement),
  });

  if (!node || !pos) return null;

  return (
    <div
      ref={ref}
      className="sched-pop"
      style={{ left: pos.left, top: pos.top }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="sched-head">
        <span className="sched-head-ic">
          <Icon name={node.reminderOn ? 'alarm' : 'calendar'} />
        </span>
        <span className="sched-head-title" title={node.text}>
          {node.text || '제목 없음'}
        </span>
        <button className="sched-x" title="닫기 (Esc)" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      {/* live preview of the chosen moment */}
      <div className={`sched-preview${date ? ' set' : ''}`}>{preview(date, time)}</div>

      {/* one-tap natural-language dates */}
      <div className="sched-chips">
        {dateChips.map((c) => {
          const v = c.get();
          return (
            <button
              key={c.label}
              className={`sched-chip${date === v ? ' on' : ''}`}
              onClick={() => apply(v, time)}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* precise date + time fields */}
      <div className="sched-fields">
        <label className="sched-field">
          <span className="sched-field-lbl">날짜</span>
          <input
            type="date"
            className="sched-native"
            value={date}
            onChange={(e) => apply(e.target.value, time)}
          />
        </label>
        <label className="sched-field">
          <span className="sched-field-lbl">시간</span>
          <input
            type="time"
            className="sched-native sched-native-time"
            value={time}
            disabled={!date}
            onChange={(e) => apply(date, e.target.value)}
          />
        </label>
      </div>

      {/* one-tap times */}
      <div className="sched-chips times">
        {timeChips.map((c) => (
          <button
            key={c.val}
            className={`sched-time-chip${time === c.val ? ' on' : ''}`}
            disabled={!date}
            onClick={() => apply(date, c.val)}
          >
            <span className="sched-time-lbl">{c.label}</span>
            <span className="sched-time-sub">{c.sub}</span>
          </button>
        ))}
      </div>

      {/* 소요 시간 — only for timed events (time-block on the calendar grid) */}
      {hasTime && (
        <div className="sched-dur">
          <span className="sched-dur-lbl">소요 시간</span>
          <div className="sched-chips">
            {durationChips.map((c) => (
              <button
                key={c.label}
                className={`sched-chip${(node.durationMin ?? 0) === c.min ? ' on' : ''}`}
                onClick={() => setDuration(id, c.min || undefined)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* reminder sync — iOS-style switch */}
      <div className="sched-toggle-row">
        <button
          type="button"
          role="switch"
          aria-checked={!!node.reminderOn}
          className={`sched-switch${node.reminderOn ? ' on' : ''}`}
          onClick={() => setReminderOn(id, !node.reminderOn)}
        >
          <span className="sched-knob" />
        </button>
        <div className="sched-toggle-text">
          <span className="sched-toggle-title">미리알림에 등록</span>
          <span className="sched-toggle-sub">
            {node.reminderOn
              ? syncStatus === 'denied'
                ? '권한 필요 — 설정 › 개인정보 보호 및 보안 › 자동화'
                : syncStatus === 'down'
                  ? '동기화 일시 중지 — 자동 재시도 중'
                  : node.reminderId
                    ? '미리알림과 동기화됨'
                    : '동기화 대기 중…'
              : 'macOS 미리알림과 양방향 동기화'}
          </span>
        </div>
      </div>

      {/* 실행 — 스케줄 노드를 실행하는 다음 단계는 집중 세션(결정 0011 §3) */}
      {node.scheduleAt && (
        <button className="sched-focus" onClick={() => requestFocusStart(mapStore, id)}>
          <Icon name="clock" />
          지금 집중 시작
        </button>
      )}

      {node.scheduleAt && (
        <button className="sched-clear" onClick={() => setScheduleAt(id, undefined)}>
          <Icon name="trash" />
          스케줄 지우기
        </button>
      )}
    </div>
  );
}
