import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMap } from '../store/mapStore';

interface Props {
  id: string;
  onClose: () => void;
}

/** datetime-local wants "YYYY-MM-DDTHH:mm"; our scheduleAt is local ISO with seconds. */
function toInput(iso: string | undefined): string {
  return iso ? iso.slice(0, 16) : '';
}
function fromInput(v: string): string | undefined {
  return v ? `${v}:00` : undefined;
}

/** Schedule editor floated beside its node: set a date/time and toggle Reminders sync. */
export function SchedulePopover({ id, onClose }: Props) {
  const node = useMap((s) => s.doc.nodes[id]);
  const setScheduleAt = useMap((s) => s.setScheduleAt);
  const setReminderOn = useMap((s) => s.setReminderOn);

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = document.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
    const W = 280;
    const H = 200;
    if (!el) {
      setPos({ left: window.innerWidth - W - 24, top: 80 });
      return;
    }
    const r = el.getBoundingClientRect();
    const left = Math.max(12, Math.min(r.left, window.innerWidth - W - 12));
    let top = r.bottom + 10;
    if (top + H > window.innerHeight - 12) top = Math.max(12, r.top - H - 10);
    setPos({ left, top });
  }, [id]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);

  if (!node || !pos) return null;

  return (
    <div
      ref={ref}
      className="sched-pop"
      style={{ left: pos.left, top: pos.top }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="note-pop-head">
        <span className="note-pop-title" title={node.text}>
          📅 {node.text || '제목 없음'}
        </span>
        <button className="note-pop-x" title="닫기 (Esc)" onClick={onClose}>
          ✕
        </button>
      </div>

      <label className="sched-row">
        <span className="sched-label">날짜·시간</span>
        <input
          type="datetime-local"
          className="sched-input"
          value={toInput(node.scheduleAt)}
          onChange={(e) => setScheduleAt(id, fromInput(e.target.value))}
        />
      </label>
      {node.scheduleAt && (
        <button className="sched-clear" onClick={() => setScheduleAt(id, undefined)}>
          시간 지우기
        </button>
      )}

      <label className="sched-reminder">
        <input
          type="checkbox"
          checked={!!node.reminderOn}
          onChange={(e) => setReminderOn(id, e.target.checked)}
        />
        <span>미리알림에 등록 (양방향 동기화)</span>
      </label>
      {node.reminderOn && (
        <p className="sched-hint">
          {node.reminderId ? '미리알림과 동기화됨' : '동기화 대기 중…'}
        </p>
      )}
    </div>
  );
}
