import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import { isoDate, rescheduleToMinute } from './calendarMath';
import { collectNodesCached, type NodeRef } from './collectNodesCached';

// Create-a-schedule flow (§3.3–3.6): search an EXISTING workspace node and pin
// it to a date/time, or make a NEW node that lands in "오늘의 생각". Opened from
// the week grid (time locked to the clicked slot), or day/month (no time → a
// 종일 default + opt-in HH:mm field). Replaces the old "type text → new node in
// the active map" capture.

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const MAX_RESULTS = 40;

function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map((n) => parseInt(n, 10));
  return (Number.isFinite(h) ? h : 9) * 60 + (Number.isFinite(m) ? m : 0);
}

interface Props {
  dayMs: number;
  /** Locked minute-of-day from a week-grid slot; null → show the 종일/시간 toggle. */
  fixed: number | null;
  onAssign: (node: NodeRef, iso: string) => void;
  onCreate: (text: string, iso: string) => void;
  onClose: () => void;
}

export function SchedulePicker({ dayMs, fixed, onAssign, onCreate, onClose }: Props) {
  const [nodes, setNodes] = useState<NodeRef[] | null>(null);
  const [query, setQuery] = useState('');
  const [allDay, setAllDay] = useState(true);
  const [timeStr, setTimeStr] = useState('09:00');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void collectNodesCached().then(setNodes);
    inputRef.current?.focus();
  }, []);

  const iso = useMemo(() => {
    const midnight = `${isoDate(dayMs)}T00:00:00`;
    if (fixed != null) return rescheduleToMinute(midnight, fixed);
    return allDay ? midnight : rescheduleToMinute(midnight, parseHHMM(timeStr));
  }, [dayMs, fixed, allDay, timeStr]);

  const results = useMemo(() => {
    if (!nodes) return [];
    const q = query.trim().toLowerCase();
    const base = q ? nodes.filter((n) => n.text.toLowerCase().includes(q)) : nodes;
    return base.slice(0, MAX_RESULTS);
  }, [nodes, query]);

  const d = new Date(dayMs);
  const dateLabel = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
  const timeLabel =
    fixed != null
      ? `${String(Math.floor(fixed / 60)).padStart(2, '0')}:${String(fixed % 60).padStart(2, '0')}`
      : allDay
        ? '종일'
        : timeStr;

  const canCreate = query.trim().length > 0;
  const createNew = () => {
    if (canCreate) onCreate(query.trim(), iso);
  };

  return (
    <div className="cal-picker-scrim" onClick={onClose}>
      <div className="cal-picker" onClick={(e) => e.stopPropagation()}>
        <div className="cal-picker-head">
          <span className="cal-picker-title">일정 추가</span>
          <span className="cal-picker-when">
            {dateLabel} · {timeLabel}
          </span>
          <span className="cal-grow" />
          <button className="cal-picker-x" onClick={onClose} title="닫기">
            <Icon name="close" />
          </button>
        </div>

        <input
          ref={inputRef}
          className="cal-picker-search"
          placeholder="노드 검색… (없으면 새로 만들기)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'Enter' && canCreate) createNew();
          }}
        />

        {fixed == null && (
          <div className="cal-picker-time">
            <div className="cal-picker-seg">
              <button className={`cal-picker-seg-btn${allDay ? ' on' : ''}`} onClick={() => setAllDay(true)}>
                종일
              </button>
              <button className={`cal-picker-seg-btn${allDay ? '' : ' on'}`} onClick={() => setAllDay(false)}>
                시간 지정
              </button>
            </div>
            {!allDay && (
              <input
                type="time"
                className="cal-picker-timefield"
                value={timeStr}
                onChange={(e) => setTimeStr(e.target.value)}
              />
            )}
          </div>
        )}

        <div className="cal-picker-list">
          {canCreate && (
            <button className="cal-picker-new" onClick={createNew}>
              <Icon name="plus" />
              <span className="cal-picker-new-text">
                “{query.trim()}” 새로 만들기 <span className="cal-picker-new-dest">→ 오늘의 생각</span>
              </span>
            </button>
          )}
          {nodes == null ? (
            <div className="cal-picker-empty">불러오는 중…</div>
          ) : results.length === 0 ? (
            <div className="cal-picker-empty">
              {query.trim() ? '검색 결과가 없어요. 위에서 새로 만들 수 있어요.' : '노드가 없어요.'}
            </div>
          ) : (
            results.map((n) => (
              <button
                key={`${n.mapId} ${n.nodeId}`}
                className={`cal-picker-row${n.scheduled ? ' scheduled' : ''}`}
                onClick={() => onAssign(n, iso)}
                title={n.scheduled ? '이미 일정이 있어요 — 이 시각으로 옮깁니다' : '이 노드에 일정을 잡습니다'}
              >
                <span className="cal-picker-row-text">{n.text}</span>
                {n.mapName && <span className="cal-picker-row-map">{n.mapName}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
