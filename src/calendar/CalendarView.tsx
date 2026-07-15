import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../ui/Icon';
import { useUi } from '../store/uiStore';
import { collectAgenda } from '../focus/collectAgenda';
import { buildAgenda, type AgendaItem, type Agenda } from '../focus/agenda';
import { dayKey } from '../focus/aggregate';
import { AgendaRow, dayHeader, rowTime, linkOf, makeAgendaActions, type AgendaActions } from '../focus/AgendaRow';
import { revealNode } from '../note/noteLinks';
import { startOfDay, addDays, weekDays, monthGridCells, groupItemsByDay } from './calendarMath';

type ViewMode = 'day' | 'week' | 'month';

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

function fmtDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY_LABELS[d.getDay()]})`;
}
function fmtMonthYear(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}
function fmtWeekRange(ms: number): string {
  const days = weekDays(ms);
  const a = new Date(days[0]);
  const b = new Date(days[6]);
  return a.getMonth() === b.getMonth()
    ? `${a.getMonth() + 1}월 ${a.getDate()}–${b.getDate()}일`
    : `${a.getMonth() + 1}월 ${a.getDate()}일 – ${b.getMonth() + 1}월 ${b.getDate()}일`;
}

/** 캘린더 탭 — "오늘" 오버레이를 일/주/월 탭으로 승격한 것(결정 0011 §4-4).
 *  기본 진입 뷰는 일간(오늘)이라 첫 화면에서 오늘 일정이 바로 보인다. */
export function CalendarView() {
  const [mode, setMode] = useState<ViewMode>('day');
  const [anchor, setAnchor] = useState(() => startOfDay(Date.now()));
  const [items, setItems] = useState<AgendaItem[] | null>(null);
  const now = Date.now();

  const reload = () => void collectAgenda().then(setItems);
  useEffect(() => {
    reload();
  }, []);

  const actions: AgendaActions = useMemo(() => makeAgendaActions(reload), [items]);
  const grouped = useMemo(() => groupItemsByDay(items ?? []), [items]);
  const agenda = useMemo(() => (items ? buildAgenda(items, now) : null), [items, now]);

  const shift = (dir: 1 | -1) => {
    setAnchor((a) => {
      if (mode === 'day') return addDays(a, dir);
      if (mode === 'week') return addDays(a, dir * 7);
      const d = new Date(a);
      return startOfDay(new Date(d.getFullYear(), d.getMonth() + dir, 1).getTime());
    });
  };
  const jumpToDay = (ms: number) => {
    setAnchor(startOfDay(ms));
    setMode('day');
  };

  return (
    <div className="cal">
      <div className="cal-head">
        <span className="cal-title">
          <Icon name="calendar" />
          캘린더
        </span>

        <div className="cal-toggle">
          {(['day', 'week', 'month'] as const).map((m) => (
            <button
              key={m}
              className={`cal-toggle-btn${mode === m ? ' on' : ''}`}
              onClick={() => setMode(m)}
            >
              {m === 'day' ? '일' : m === 'week' ? '주' : '월'}
            </button>
          ))}
        </div>

        <div className="cal-nav">
          <button className="cal-nav-btn" title="이전" onClick={() => shift(-1)}>
            <Icon name="chevronLeft" />
          </button>
          <span className="cal-nav-label">
            {mode === 'day' ? fmtDay(anchor) : mode === 'week' ? fmtWeekRange(anchor) : fmtMonthYear(anchor)}
          </span>
          <button className="cal-nav-btn" title="다음" onClick={() => shift(1)}>
            <Icon name="chevronRight" />
          </button>
        </div>

        <button className="cal-today-btn" onClick={() => jumpToDay(Date.now())}>
          오늘
        </button>

        <span className="cal-grow" />

        <button className="cal-history-btn" title="집중 기록" onClick={() => useUi.getState().openHistory()}>
          <Icon name="clock" />
        </button>
      </div>

      <div className="cal-body">
        {items == null ? (
          <div className="cal-empty">불러오는 중…</div>
        ) : mode === 'day' ? (
          <DayPane anchor={anchor} agenda={agenda} grouped={grouped} now={now} actions={actions} />
        ) : mode === 'week' ? (
          <WeekPane anchor={anchor} grouped={grouped} now={now} onPickDay={jumpToDay} />
        ) : (
          <MonthPane anchor={anchor} grouped={grouped} now={now} onPickDay={jumpToDay} />
        )}
      </div>
    </div>
  );
}

function DayPane({
  anchor,
  agenda,
  grouped,
  now,
  actions,
}: {
  anchor: number;
  agenda: Agenda | null;
  grouped: Map<string, AgendaItem[]>;
  now: number;
  actions: AgendaActions;
}) {
  const isToday = anchor === startOfDay(now);

  if (isToday && agenda) {
    const empty = !agenda.overdue.length && !agenda.today.length && !agenda.upcoming.length;
    if (empty) {
      return (
        <div className="cal-empty">
          오늘 예정된 일정이 없어요.
          <br />
          노드에 날짜·시간을 설정하면 여기 모여요.
        </div>
      );
    }
    return (
      <div className="cal-day-body">
        {agenda.overdue.length > 0 && (
          <div className="today-sec">
            <div className="today-sec-label over">지남</div>
            {agenda.overdue.map((it) => (
              <AgendaRow key={it.nodeId} it={it} overdue actions={actions} />
            ))}
          </div>
        )}
        <div className="today-sec">
          <div className="today-sec-label">오늘</div>
          {agenda.today.length === 0 ? (
            <div className="cal-day-empty">일정 없음</div>
          ) : (
            agenda.today.map((it) => <AgendaRow key={it.nodeId} it={it} actions={actions} />)
          )}
        </div>
        {agenda.upcoming.map((g) => (
          <div className="today-sec" key={g.day}>
            <div className="today-sec-label">{dayHeader(g.day, now)}</div>
            {g.items.map((it) => (
              <AgendaRow key={it.nodeId} it={it} actions={actions} />
            ))}
          </div>
        ))}
      </div>
    );
  }

  const dayAll = grouped.get(dayKey(anchor)) ?? [];
  const pending = dayAll.filter((i) => !i.done);
  const doneCount = dayAll.length - pending.length;

  return (
    <div className="cal-day-body">
      <div className="today-sec">
        <div className="today-sec-label">
          {fmtDay(anchor)}
          {doneCount > 0 && ` · 완료 ${doneCount}`}
        </div>
        {pending.length === 0 ? (
          <div className="cal-day-empty">일정 없음</div>
        ) : (
          pending.map((it) => <AgendaRow key={it.nodeId} it={it} actions={actions} />)
        )}
      </div>
    </div>
  );
}

function WeekPane({
  anchor,
  grouped,
  now,
  onPickDay,
}: {
  anchor: number;
  grouped: Map<string, AgendaItem[]>;
  now: number;
  onPickDay: (ms: number) => void;
}) {
  const days = weekDays(anchor);
  const todayMs = startOfDay(now);

  return (
    <div className="cal-week-grid">
      {days.map((ms) => {
        const key = dayKey(ms);
        const dayItems = (grouped.get(key) ?? []).filter((i) => !i.done);
        const isToday = ms === todayMs;
        return (
          <div key={key} className={`cal-week-col${isToday ? ' today' : ''}`}>
            <button className="cal-week-col-head" onClick={() => onPickDay(ms)}>
              <span className="cal-week-wd">{WEEKDAY_LABELS[new Date(ms).getDay()]}</span>
              <span className="cal-week-date">{new Date(ms).getDate()}</span>
            </button>
            <div className="cal-week-items">
              {dayItems.map((it) => (
                <button
                  key={it.nodeId}
                  className="cal-week-chip"
                  title={it.text}
                  onClick={() => void revealNode(linkOf(it))}
                >
                  <span className="cal-week-chip-time">{rowTime(it)}</span>
                  <span className="cal-week-chip-text">{it.text}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthPane({
  anchor,
  grouped,
  now,
  onPickDay,
}: {
  anchor: number;
  grouped: Map<string, AgendaItem[]>;
  now: number;
  onPickDay: (ms: number) => void;
}) {
  const d = new Date(anchor);
  const cells = monthGridCells(d.getFullYear(), d.getMonth());
  const todayMs = startOfDay(now);

  return (
    <div className="cal-month">
      <div className="cal-month-wd-row">
        {WEEKDAY_LABELS.map((w) => (
          <span key={w} className="cal-month-wd">
            {w}
          </span>
        ))}
      </div>
      <div className="cal-month-grid">
        {cells.map((c) => {
          const key = dayKey(c.ms);
          const dayItems = (grouped.get(key) ?? []).filter((i) => !i.done);
          const isToday = c.ms === todayMs;
          return (
            <button
              key={key}
              className={`cal-month-cell${c.inMonth ? '' : ' out'}${isToday ? ' today' : ''}`}
              onClick={() => onPickDay(c.ms)}
            >
              <span className="cal-month-date">{new Date(c.ms).getDate()}</span>
              {dayItems.length > 0 && (
                <span className="cal-month-badge">{dayItems.length > 3 ? '3+' : dayItems.length}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
