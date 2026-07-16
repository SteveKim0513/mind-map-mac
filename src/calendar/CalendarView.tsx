import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Icon } from '../ui/Icon';
import { useUi } from '../store/uiStore';
import { useSession } from '../store/sessionStore';
import type { MapStore } from '../store/mapStore';
import { useWorkspace } from '../store/workspaceStore';
import { collectAgenda } from '../focus/collectAgenda';
import { buildAgenda, type AgendaItem, type Agenda } from '../focus/agenda';
import { dayKey, dailyTotals, fmtDuration } from '../focus/aggregate';
import { mapStoreById } from '../focus/controller';
import type { FocusSession } from '../types';
import { AgendaRow, dayHeader, rowTime, linkOf, makeAgendaActions, type AgendaActions } from '../focus/AgendaRow';
import { revealNode } from '../note/noteLinks';
import {
  startOfDay,
  addDays,
  weekDays,
  monthGridCells,
  groupItemsByDay,
  rescheduleToDay,
  rescheduleToMinute,
  isoDate,
  gridHourLabels,
  gridTopMinutes,
  blockSpanMinutes,
  layoutDayBlocks,
  WEEK_GRID_START_HOUR,
  WEEK_GRID_MINUTES,
} from './calendarMath';

type ViewMode = 'day' | 'week' | 'month';

/** Cross-cell drag-reschedule wiring, shared by the week/month panes. The dragged
 *  item is held in a ref (survives React's async state) while `dragOverKey` drives
 *  the drop-target highlight. Every drop goes through mapStore.setScheduleAt so the
 *  Reminders invariant (reminderOn/reminderId) is preserved by the store, never
 *  bypassed. Three drop semantics: keep-time (month), set-time (week grid),
 *  make-all-day (week strip). */
export interface DragReschedule {
  onStart: (it: AgendaItem) => void;
  onEnd: () => void;
  onOverDay: (key: string) => void;
  dropDay: (targetDayMs: number) => void; // month cell: change date, keep time-of-day
  dropTimed: (targetDayMs: number, minuteOfDay: number) => void; // week grid: date + time
  dropAllDay: (targetDayMs: number) => void; // week strip: date, forced all-day
  dragOverKey: string | null;
}

/** Empty-slot quick-capture on the week grid (Phase 1c). Creates a scheduled node
 *  in the *active map tab* — nodes live in maps, so the calendar never makes an
 *  orphan; with no map open it shows a hint instead. */
export interface CaptureCtl {
  active: { key: string; minute: number } | null; // open input's column + minute-of-day
  text: string;
  hint: boolean; // true when a click had no active map to capture into
  openAt: (key: string, dayMs: number, minute: number) => void;
  setText: (t: string) => void;
  submit: () => void;
  cancel: () => void;
}

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

  // ── plan ↔ actual: real focus seconds per day, overlaid on the calendar ──────
  const noteIndex = useWorkspace((s) => s.noteIndex);
  const focusByDay = useMemo(
    () => dailyTotals(noteIndex.map((m) => m.session).filter((s): s is FocusSession => !!s)),
    [noteIndex],
  );

  // ── drag to reschedule ──────────────────────────────────────────────────────
  const dragRef = useRef<AgendaItem | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  /** Persist a new schedule for a dragged item through the store (keeps the
   *  Reminders invariant). Closed maps degrade to "open it in the canvas" (v1). */
  const applyReschedule = (it: AgendaItem, iso: string) => {
    const store = mapStoreById(it.mapId);
    if (!store) {
      void revealNode(linkOf(it)); // closed map → open it (same fallback as AgendaRow)
      return;
    }
    store.getState().setScheduleAt(it.nodeId, iso);
    setTimeout(reload, 80);
  };

  const takeDragged = (): AgendaItem | null => {
    const it = dragRef.current;
    dragRef.current = null;
    setDragOverKey(null);
    return it;
  };

  /** Resize a time block → set its durationMin (local-only, decision 0012). */
  const setDurationFor = (it: AgendaItem, minutes: number) => {
    const store = mapStoreById(it.mapId);
    if (!store) return;
    store.getState().setDuration(it.nodeId, minutes);
    setTimeout(reload, 80);
  };

  const drag: DragReschedule = {
    onStart: (it) => {
      dragRef.current = it;
    },
    onEnd: () => {
      dragRef.current = null;
      setDragOverKey(null);
    },
    onOverDay: (key) => setDragOverKey((k) => (k === key ? k : key)),
    dropDay: (targetDayMs) => {
      const it = takeDragged();
      if (!it || isoDate(it.at) === isoDate(targetDayMs)) return;
      applyReschedule(it, rescheduleToDay(it.scheduleAt, targetDayMs));
    },
    dropTimed: (targetDayMs, minuteOfDay) => {
      const it = takeDragged();
      if (!it) return;
      applyReschedule(it, rescheduleToMinute(rescheduleToDay(it.scheduleAt, targetDayMs), minuteOfDay));
    },
    dropAllDay: (targetDayMs) => {
      const it = takeDragged();
      if (!it) return;
      applyReschedule(it, rescheduleToMinute(rescheduleToDay(it.scheduleAt, targetDayMs), 0));
    },
    dragOverKey,
  };

  // ── empty-slot quick-capture (week grid) ─────────────────────────────────────
  const [capture, setCapture] = useState<{ key: string; dayMs: number; minute: number } | null>(null);
  const [captureText, setCaptureText] = useState('');
  const [noMapHint, setNoMapHint] = useState(false);

  // The calendar tab is itself active while capturing, so activeStore() is null —
  // fall back to the first open map tab. Nodes live in maps; with none open we hint.
  const targetMapStore = (): MapStore | null => {
    const s = useSession.getState();
    return s.activeStore() ?? ((s.tabs.find((t) => t.kind === 'map')?.store as MapStore | undefined) ?? null);
  };

  const captureCtl: CaptureCtl = {
    active: capture,
    text: captureText,
    hint: noMapHint,
    openAt: (key, dayMs, minute) => {
      if (!targetMapStore()) {
        setNoMapHint(true);
        return;
      }
      setNoMapHint(false);
      setCaptureText('');
      setCapture({ key, dayMs, minute });
    },
    setText: setCaptureText,
    submit: () => {
      const store = targetMapStore();
      const text = captureText.trim();
      if (capture && text && store) {
        const iso = rescheduleToMinute(`${isoDate(capture.dayMs)}T00:00:00`, capture.minute);
        store.getState().captureScheduled(text, iso);
        setTimeout(reload, 80);
      }
      setCapture(null);
      setCaptureText('');
    },
    cancel: () => {
      setCapture(null);
      setCaptureText('');
      setNoMapHint(false);
    },
  };

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
          <DayPane anchor={anchor} agenda={agenda} grouped={grouped} now={now} actions={actions} focusByDay={focusByDay} />
        ) : mode === 'week' ? (
          <WeekPane
            anchor={anchor}
            grouped={grouped}
            now={now}
            onPickDay={jumpToDay}
            drag={drag}
            actions={actions}
            capture={captureCtl}
            focusByDay={focusByDay}
            onResize={setDurationFor}
          />
        ) : (
          <MonthPane
            anchor={anchor}
            grouped={grouped}
            now={now}
            onPickDay={jumpToDay}
            drag={drag}
            actions={actions}
            focusByDay={focusByDay}
          />
        )}
      </div>
    </div>
  );
}

/** "계획 3 · 집중 1h 20m · 완료 2" — the plan↔actual one-liner for a day (원칙 2). */
function DaySummary({
  planned,
  focusSec,
  done,
}: {
  planned: number;
  focusSec: number;
  done: number;
}) {
  if (planned === 0 && focusSec === 0) return null;
  return (
    <div className="cal-day-summary">
      <span className="cal-day-summary-seg">계획 {planned}</span>
      {focusSec > 0 && <span className="cal-day-summary-seg focus">집중 {fmtDuration(focusSec)}</span>}
      {done > 0 && <span className="cal-day-summary-seg done">완료 {done}</span>}
    </div>
  );
}

function DayPane({
  anchor,
  agenda,
  grouped,
  now,
  actions,
  focusByDay,
}: {
  anchor: number;
  agenda: Agenda | null;
  grouped: Map<string, AgendaItem[]>;
  now: number;
  actions: AgendaActions;
  focusByDay: Map<string, number>;
}) {
  const isToday = anchor === startOfDay(now);
  const dayAllForSummary = grouped.get(dayKey(anchor)) ?? [];
  const summary = (
    <DaySummary
      planned={dayAllForSummary.length}
      focusSec={focusByDay.get(dayKey(anchor)) ?? 0}
      done={dayAllForSummary.filter((i) => i.done).length}
    />
  );

  if (isToday && agenda) {
    const empty = !agenda.overdue.length && !agenda.today.length && !agenda.upcoming.length;
    if (empty) {
      const focusSec = focusByDay.get(dayKey(anchor)) ?? 0;
      return (
        <div className="cal-day-body">
          {summary}
          <div className="cal-empty">
            오늘 예정된 일정이 없어요.
            {focusSec === 0 && (
              <>
                <br />
                노드에 날짜·시간을 설정하면 여기 모여요.
              </>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="cal-day-body">
        {summary}
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
      {summary}
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

/** Inline focus/done actions, shared by week blocks and month chips (Phase 1c).
 *  Clicks stopPropagation so they never bubble to a parent cell's day-jump. */
function ItemActions({ it, actions }: { it: AgendaItem; actions: AgendaActions }) {
  const stop = (fn: () => void) => (e: ReactMouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <span className="cal-item-acts">
      <button className="cal-item-act" title="집중 시작" onClick={stop(() => actions.startFocus(it))}>
        <Icon name="clock" />
      </button>
      <button className="cal-item-act" title="완료 표시" onClick={stop(() => actions.toggleDone(it))}>
        <Icon name="check" />
      </button>
    </span>
  );
}

/** A draggable schedule chip (week all-day strip + month cells). A div, not a
 *  button, so it can hold both a clickable main area and nested action buttons. */
function CalChip({
  it,
  drag,
  actions,
  showTime,
}: {
  it: AgendaItem;
  drag: DragReschedule;
  actions: AgendaActions;
  showTime: boolean;
}) {
  return (
    <div
      className="cal-chip"
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        drag.onStart(it);
      }}
      onDragEnd={drag.onEnd}
      title={it.text}
    >
      <button
        className="cal-chip-main"
        onClick={(e) => {
          e.stopPropagation();
          actions.reveal(it);
        }}
      >
        {showTime && <span className="cal-chip-time">{rowTime(it)}</span>}
        <span className="cal-chip-text">{it.text}</span>
      </button>
      <ItemActions it={it} actions={actions} />
    </div>
  );
}

/** A timed block on the week grid: positioned by start minute, sized by
 *  durationMin (Phase 3), packed into a column when it overlaps neighbours, and
 *  resizable by dragging its bottom edge → setDuration. */
function WeekBlock({
  it,
  topMin,
  spanMin,
  col,
  cols,
  drag,
  actions,
  onResize,
}: {
  it: AgendaItem;
  topMin: number;
  spanMin: number;
  col: number;
  cols: number;
  drag: DragReschedule;
  actions: AgendaActions;
  onResize: (it: AgendaItem, minutes: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState(false);
  const [previewMin, setPreviewMin] = useState<number | null>(null);
  const span = previewMin ?? spanMin;

  const startResize = (e: ReactPointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const column = ref.current?.parentElement;
    if (!column) return;
    const rect = column.getBoundingClientRect();
    const topPx = (topMin / WEEK_GRID_MINUTES) * rect.height;
    const minuteAt = (clientY: number) => {
      const spanPx = clientY - rect.top - topPx;
      const raw = (spanPx / rect.height) * WEEK_GRID_MINUTES;
      return Math.max(15, Math.round(raw / 15) * 15); // snap 15 min, min 15
    };
    setResizing(true);
    const move = (ev: PointerEvent) => setPreviewMin(minuteAt(ev.clientY));
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setResizing(false);
      setPreviewMin(null);
      onResize(it, minuteAt(ev.clientY));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      ref={ref}
      className="cal-wk-block"
      style={{
        top: `${(topMin / WEEK_GRID_MINUTES) * 100}%`,
        height: `${(Math.min(span, WEEK_GRID_MINUTES - topMin) / WEEK_GRID_MINUTES) * 100}%`,
        left: `${(col / cols) * 100}%`,
        width: `${100 / cols}%`,
      }}
      draggable={!resizing}
      onDragStart={(e) => {
        e.stopPropagation();
        drag.onStart(it);
      }}
      onDragEnd={drag.onEnd}
      title={it.text}
    >
      <button
        className="cal-wk-block-main"
        onClick={(e) => {
          e.stopPropagation();
          actions.reveal(it);
        }}
      >
        <span className="cal-wk-block-time">{rowTime(it)}</span>
        <span className="cal-wk-block-text">{it.text}</span>
      </button>
      <ItemActions it={it} actions={actions} />
      <div className="cal-wk-block-resize" onPointerDown={startResize} title="드래그로 소요 시간 조절" />
    </div>
  );
}

function WeekPane({
  anchor,
  grouped,
  now,
  onPickDay,
  drag,
  actions,
  capture,
  focusByDay,
  onResize,
}: {
  anchor: number;
  grouped: Map<string, AgendaItem[]>;
  now: number;
  onPickDay: (ms: number) => void;
  drag: DragReschedule;
  actions: AgendaActions;
  capture: CaptureCtl;
  focusByDay: Map<string, number>;
  onResize: (it: AgendaItem, minutes: number) => void;
}) {
  const days = weekDays(anchor);
  const todayMs = startOfDay(now);
  const hours = gridHourLabels();

  /** Clicked-Y within a day column → minute-of-day, snapped to 15 min. */
  const minuteFromClick = (e: ReactMouseEvent<HTMLDivElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return WEEK_GRID_START_HOUR * 60 + Math.round((frac * WEEK_GRID_MINUTES) / 15) * 15;
  };

  return (
    <div className="cal-wk">
      {capture.hint && (
        <div className="cal-wk-hint">
          새 일정을 담을 맵을 먼저 열어주세요.
          <button className="cal-wk-hint-x" onClick={() => capture.cancel()} title="닫기">
            <Icon name="close" />
          </button>
        </div>
      )}
      <div className="cal-wk-head">
        <span className="cal-wk-rail-sp" />
        {days.map((ms) => {
          const isToday = ms === todayMs;
          const focusSec = focusByDay.get(dayKey(ms)) ?? 0;
          return (
            <button
              key={dayKey(ms)}
              className={`cal-wk-daybtn${isToday ? ' today' : ''}`}
              onClick={() => onPickDay(ms)}
            >
              <span className="cal-wk-wd">{WEEKDAY_LABELS[new Date(ms).getDay()]}</span>
              <span className="cal-wk-dt">{new Date(ms).getDate()}</span>
              {focusSec > 0 && <span className="cal-wk-focus">{fmtDuration(focusSec)}</span>}
            </button>
          );
        })}
      </div>

      {/* all-day / out-of-window strip — nothing is silently hidden */}
      <div className="cal-wk-allday">
        <span className="cal-wk-rail-lbl">종일</span>
        {days.map((ms) => {
          const key = dayKey(ms);
          const strip = (grouped.get(key) ?? []).filter((i) => !i.done && gridTopMinutes(i.at, i.hasTime) === null);
          return (
            <div
              key={key}
              className={`cal-wk-allday-col${drag.dragOverKey === key ? ' drop' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                drag.onOverDay(key);
              }}
              onDrop={() => drag.dropAllDay(ms)}
            >
              {strip.map((it) => (
                <CalChip key={it.nodeId} it={it} drag={drag} actions={actions} showTime={it.hasTime} />
              ))}
            </div>
          );
        })}
      </div>

      {/* timed grid — hour rail + 7 day columns, blocks positioned by start time */}
      <div className="cal-wk-grid">
        <div className="cal-wk-rail">
          {hours.map((h) => (
            <div key={h} className="cal-wk-hour">
              <span>{h}시</span>
            </div>
          ))}
        </div>
        {days.map((ms) => {
          const key = dayKey(ms);
          const timed = (grouped.get(key) ?? []).filter((i) => !i.done && gridTopMinutes(i.at, i.hasTime) !== null);
          const byId = new Map(timed.map((it) => [it.nodeId, it]));
          const layout = layoutDayBlocks(
            timed.map((it) => {
              const start = gridTopMinutes(it.at, it.hasTime)!;
              return { nodeId: it.nodeId, startMin: start, endMin: start + blockSpanMinutes(it.durationMin) };
            }),
          );
          const isToday = ms === todayMs;
          return (
            <div
              key={key}
              data-day={key}
              className={`cal-wk-col${isToday ? ' today' : ''}${drag.dragOverKey === key ? ' drop' : ''}`}
              onClick={(e) => capture.openAt(key, ms, minuteFromClick(e))}
              onDragOver={(e) => {
                e.preventDefault();
                drag.onOverDay(key);
              }}
              onDrop={(e) => drag.dropTimed(ms, minuteFromClick(e))}
            >
              {hours.map((h) => (
                <div key={h} className="cal-wk-slot" />
              ))}
              {layout.map((b) => (
                <WeekBlock
                  key={b.nodeId}
                  it={byId.get(b.nodeId)!}
                  topMin={b.startMin}
                  spanMin={b.endMin - b.startMin}
                  col={b.col}
                  cols={b.cols}
                  drag={drag}
                  actions={actions}
                  onResize={onResize}
                />
              ))}
              {capture.active?.key === key && (
                <div
                  className="cal-wk-capture"
                  style={{ top: `${((capture.active.minute - WEEK_GRID_START_HOUR * 60) / WEEK_GRID_MINUTES) * 100}%` }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    autoFocus
                    className="cal-wk-capture-input"
                    value={capture.text}
                    placeholder="새 일정…"
                    onChange={(e) => capture.setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') capture.submit();
                      else if (e.key === 'Escape') capture.cancel();
                    }}
                    onBlur={() => capture.cancel()}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthPane({
  anchor,
  grouped,
  now,
  onPickDay,
  drag,
  actions,
  focusByDay,
}: {
  anchor: number;
  grouped: Map<string, AgendaItem[]>;
  now: number;
  onPickDay: (ms: number) => void;
  drag: DragReschedule;
  actions: AgendaActions;
  focusByDay: Map<string, number>;
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
            <div
              key={key}
              data-day={key}
              className={`cal-month-cell${c.inMonth ? '' : ' out'}${isToday ? ' today' : ''}${
                drag.dragOverKey === key ? ' drop' : ''
              }`}
              onClick={() => onPickDay(c.ms)}
              onDragOver={(e) => {
                e.preventDefault();
                drag.onOverDay(key);
              }}
              onDrop={() => drag.dropDay(c.ms)}
            >
              <button className="cal-month-datebtn" onClick={() => onPickDay(c.ms)}>
                {new Date(c.ms).getDate()}
              </button>
              {(focusByDay.get(key) ?? 0) > 0 && (
                <span className="cal-focus-tag" title="이 날 집중한 시간">
                  {fmtDuration(focusByDay.get(key)!)}
                </span>
              )}
              <div className="cal-month-chips">
                {dayItems.slice(0, 3).map((it) => (
                  <CalChip key={it.nodeId} it={it} drag={drag} actions={actions} showTime={it.hasTime} />
                ))}
                {dayItems.length > 3 && (
                  <button className="cal-month-more" onClick={() => onPickDay(c.ms)}>
                    +{dayItems.length - 3}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
