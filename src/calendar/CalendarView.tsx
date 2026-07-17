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
import { collectAgendaCached } from './collectAgendaCached';
import { buildAgenda, type AgendaItem, type Agenda } from '../focus/agenda';
import { dayKey, dailyTotals, fmtDuration } from '../focus/aggregate';
import { mapStoreById } from '../focus/controller';
import type { FocusSession, MindMapDoc } from '../types';
import { deserialize, emptyDoc, serialize, newId } from '../io/formats';
import { rowTime, linkOf, mapName, makeAgendaActions, type AgendaActions } from '../focus/AgendaRow';
import { revealNode } from '../note/noteLinks';
import { SubtreeMiniView } from './SubtreeMiniView';
import { SchedulePicker } from './SchedulePicker';
import type { NodeRef } from './collectNodesCached';
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
  WEEK_GRID_END_HOUR,
  WEEK_GRID_MINUTES,
  minutesToPx,
  pxToMinutes,
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


/** Schedule-node peek (§3.2): first click opens a read-only subtree preview
 *  (day = drawer under the card, month = panel below the grid, week = floating
 *  popup); clicking the schedule node inside it opens the map in the right split.
 *  The doc is the open map's live doc, or a closed map read from disk. */
export interface PeekCtl {
  active: { item: AgendaItem; doc: MindMapDoc } | null;
  open: (it: AgendaItem) => void; // toggle the preview for this item
  openSplit: (it: AgendaItem) => void; // open the map beside (right split) + focus node
  close: () => void;
}

/** Create-a-schedule popup control (§3.3–3.6). `fixed` is a locked minute-of-day
 *  from a week slot; null means day/month → the popup shows a 종일/시간 toggle. */
export interface PickerCtl {
  active: { dayMs: number; fixed: number | null } | null;
  openAt: (dayMs: number, fixed: number | null) => void;
  close: () => void;
}

/** Is `it` the item currently being previewed? (nodeId is stable per map.) */
function isPeeked(peek: PeekCtl, it: AgendaItem): boolean {
  return peek.active != null && peek.active.item.nodeId === it.nodeId && peek.active.item.mapId === it.mapId;
}

/** Shared preview body: a header (title · map · "오른쪽에 열기" · 닫기) over the
 *  read-only subtree mini-view. Wrapped by each view's own container. */
function PeekBody({ peek }: { peek: PeekCtl }) {
  if (!peek.active) return null;
  const { item, doc } = peek.active;
  return (
    <div className="cal-peek">
      <div className="cal-peek-head">
        <span className="cal-peek-title">{item.text || '무제'}</span>
        {mapName(item) && <span className="cal-peek-map">{mapName(item)}</span>}
        <span className="cal-grow" />
        <button className="cal-peek-open" onClick={() => peek.openSplit(item)} title="오른쪽 화면에 맵 열기">
          오른쪽에 열기
          <Icon name="chevronRight" />
        </button>
        <button className="cal-peek-x" onClick={peek.close} title="닫기">
          <Icon name="close" />
        </button>
      </div>
      <SubtreeMiniView doc={doc} rootId={item.nodeId} onOpenRoot={() => peek.openSplit(item)} />
    </div>
  );
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

  const reload = () => void collectAgendaCached().then(setItems);
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

  // ── create a schedule: search an existing node, or make a new one (§3.3–3.6) ──
  const [picker, setPicker] = useState<{ dayMs: number; fixed: number | null } | null>(null);
  const pickerCtl: PickerCtl = {
    active: picker,
    openAt: (dayMs, fixed) => setPicker({ dayMs, fixed }),
    close: () => setPicker(null),
  };

  /** Pin an EXISTING node to `iso`. Open map → its store; closed map → open it in
   *  the background, apply, then return focus to the calendar (§8). Always through
   *  mapStore.setScheduleAt so the Reminders invariant holds. */
  const assignExisting = (node: NodeRef, iso: string) => {
    void (async () => {
      const store = mapStoreById(node.mapId);
      if (store) {
        store.getState().setScheduleAt(node.nodeId, iso);
      } else if (node.mapPath) {
        try {
          const content = await window.api.readFile(node.mapPath);
          const sess = useSession.getState();
          sess.openPath(node.mapPath, content); // opens the closed map (creates its store)
          mapStoreById(node.mapId)?.getState().setScheduleAt(node.nodeId, iso);
          sess.openCalendar(); // keep the user on the calendar tab
          useUi.getState().toast(`'${node.mapName}'에 일정을 잡았어요`);
        } catch {
          useUi.getState().toast('맵을 열 수 없어 일정을 잡지 못했어요');
        }
      }
      setPicker(null);
      setTimeout(reload, 80);
    })();
  };

  /** Make a NEW scheduled node in "오늘의 생각" (the same inbox as ⌥Space capture),
   *  never in the active map. Uses the open tab's store if it's open (avoids a
   *  file/store write race), else appends to the file directly. */
  const createInInbox = (text: string, iso: string) => {
    void (async () => {
      const targetPath = await window.api.capture.targetPath();
      const sess = useSession.getState();
      const openTab = sess.tabs.find((t) => t.kind === 'map' && t.path === targetPath);
      if (openTab) {
        (openTab.store as MapStore).getState().captureScheduled(text, iso);
      } else {
        let doc: MindMapDoc;
        try {
          doc = deserialize(await window.api.readFile(targetPath));
        } catch {
          doc = emptyDoc();
        }
        const id = newId();
        doc.nodes[id] = {
          id,
          text,
          parentId: null,
          children: [],
          collapsed: false,
          todo: true,
          scheduled: true,
          scheduleAt: iso,
        };
        doc.rootIds.push(id);
        await window.api.save(targetPath, serialize(doc));
        await window.api.capture.notifyAppended(targetPath);
        // a brand-new 오늘의 생각.mind isn't in the sidebar tree yet → refresh so
        // the calendar's disk scan can find it on reload.
        await useWorkspace.getState().refresh();
      }
      useUi.getState().toast('오늘의 생각에 새 일정을 담았어요');
      setPicker(null);
      setTimeout(reload, 120);
    })();
  };

  // ── schedule peek → split (§3.2) ─────────────────────────────────────────────
  const [peek, setPeek] = useState<{ item: AgendaItem; doc: MindMapDoc } | null>(null);

  const peekCtl: PeekCtl = {
    active: peek,
    open: (it) => {
      // toggle off if this item is already open
      if (peek && peek.item.nodeId === it.nodeId && peek.item.mapId === it.mapId) {
        setPeek(null);
        return;
      }
      void (async () => {
        // open map → live doc; closed map → read from disk (no tab opened yet)
        const openDoc = mapStoreById(it.mapId)?.getState().doc ?? null;
        let doc: MindMapDoc | null = openDoc;
        if (!doc && it.mapPath) {
          try {
            doc = deserialize(await window.api.readFile(it.mapPath));
          } catch {
            doc = null;
          }
        }
        if (doc && doc.nodes[it.nodeId]) setPeek({ item: it, doc });
        else void revealNode(linkOf(it)); // can't resolve → fall back to opening the map
      })();
    },
    openSplit: (it) => {
      setPeek(null);
      void (async () => {
        if (!it.mapPath) {
          void revealNode(linkOf(it)); // no path hint → best-effort open
          return;
        }
        let content: string;
        try {
          content = await window.api.readFile(it.mapPath);
        } catch {
          void revealNode(linkOf(it));
          return;
        }
        useSession.getState().openInRight(it.mapPath, content);
        // openInRight added the tab synchronously → its store is now resolvable
        const store = mapStoreById(it.mapId);
        if (store) {
          store.getState().select(it.nodeId);
          setTimeout(() => useUi.getState().focusNode(it.nodeId), 0);
        }
      })();
    },
    close: () => setPeek(null),
  };

  const shift = (dir: 1 | -1) => {
    setPeek(null);
    setAnchor((a) => {
      if (mode === 'day') return addDays(a, dir);
      if (mode === 'week') return addDays(a, dir * 7);
      const d = new Date(a);
      return startOfDay(new Date(d.getFullYear(), d.getMonth() + dir, 1).getTime());
    });
  };
  const jumpToDay = (ms: number) => {
    setPeek(null);
    setAnchor(startOfDay(ms));
    setMode('day');
  };

  /** Reference date for the header "일정 추가" button — the viewed day (day), or
   *  today when it's inside the shown week/month, else the period's start. */
  const headerAddDate = (): number => {
    const today = startOfDay(now);
    if (mode === 'day') return anchor;
    if (mode === 'week') {
      const days = weekDays(anchor);
      return days.includes(today) ? today : days[0];
    }
    const d = new Date(anchor);
    const sameMonth = new Date(today).getFullYear() === d.getFullYear() && new Date(today).getMonth() === d.getMonth();
    return sameMonth ? today : startOfDay(new Date(d.getFullYear(), d.getMonth(), 1).getTime());
  };

  return (
    <div className="cal">
      <div className="cal-head">
        <span className="cal-title">
          <Icon name="calendar" />
          <span className="cal-title-text">캘린더</span>
        </span>

        <div className="cal-toggle">
          {(['day', 'week', 'month'] as const).map((m) => (
            <button
              key={m}
              className={`cal-toggle-btn${mode === m ? ' on' : ''}`}
              onClick={() => {
                setPeek(null);
                setMode(m);
              }}
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

        {/* one visible entry point in every view (same place, same label) — §3.1 */}
        <button className="cal-add-btn" onClick={() => pickerCtl.openAt(headerAddDate(), null)} title="일정 추가">
          <Icon name="plus" />
          <span className="cal-add-btn-text">일정 추가</span>
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
          <DayPane anchor={anchor} agenda={agenda} grouped={grouped} now={now} actions={actions} peek={peekCtl} focusByDay={focusByDay} />
        ) : mode === 'week' ? (
          <WeekPane
            anchor={anchor}
            grouped={grouped}
            now={now}
            onPickDay={jumpToDay}
            drag={drag}
            peek={peekCtl}
            picker={pickerCtl}
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
            peek={peekCtl}
            picker={pickerCtl}
            focusByDay={focusByDay}
          />
        )}
      </div>

      {pickerCtl.active && (
        <SchedulePicker
          dayMs={pickerCtl.active.dayMs}
          fixed={pickerCtl.active.fixed}
          onAssign={assignExisting}
          onCreate={createInInbox}
          onClose={pickerCtl.close}
        />
      )}
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

const durLabel = (m: number): string =>
  m < 60 ? `${m}분` : m % 60 === 0 ? `${m / 60}시간` : `${Math.floor(m / 60)}시간 ${m % 60}분`;

/** A rich day-view card: big time badge + full (wrapping) title + meta + an
 *  always-visible "집중" action. The day view is the app's home for "what do I do
 *  now" (결정 0011 실행), so the focus action is primary and titles never truncate. */
function DayCard({
  it,
  actions,
  peek,
  overdue,
  isNext,
}: {
  it: AgendaItem;
  actions: AgendaActions;
  peek: PeekCtl;
  overdue?: boolean;
  isNext?: boolean;
}) {
  const timeLabel = overdue ? `${new Date(it.at).getMonth() + 1}/${new Date(it.at).getDate()}` : rowTime(it);
  const map = mapName(it);
  const peeked = isPeeked(peek, it);
  return (
    <div className="cal-daycard-wrap">
      <div className={`cal-daycard${it.done ? ' done' : ''}${overdue ? ' over' : ''}${isNext ? ' next' : ''}${peeked ? ' peeked' : ''}`}>
      <button className="cal-daycard-hit" onClick={() => peek.open(it)} title="일정 미리보기">
        <span className="cal-daycard-time">{timeLabel}</span>
        <span className="cal-daycard-main">
          <span className="cal-daycard-title">{it.text}</span>
          {(isNext || map || it.durationMin) && (
            <span className="cal-daycard-meta">
              {isNext && <span className="cal-daycard-next">다음</span>}
              {map && <span className="cal-daycard-map">{map}</span>}
              {it.durationMin ? <span className="cal-daycard-dur">{durLabel(it.durationMin)}</span> : null}
            </span>
          )}
        </span>
      </button>
      <span className="cal-daycard-acts">
        <button className="cal-daycard-act cal-daycard-act--focus" onClick={() => actions.startFocus(it)} title="집중 세션 시작">
          <Icon name="clock" />
          집중
        </button>
        <button
          className={`cal-daycard-act cal-daycard-act--done${it.done ? ' is-done' : ''}`}
          title={it.done ? '완료 취소' : '완료 표시'}
          onClick={() => actions.toggleDone(it)}
        >
          <Icon name="check" />
          {it.done ? '완료됨' : '완료'}
        </button>
      </span>
      </div>
      {peeked && (
        <div className="cal-peek-drawer">
          <PeekBody peek={peek} />
        </div>
      )}
    </div>
  );
}

/** Overdue = carried-over work (still actionable today). Collapsed by default so
 *  the day view leads with *today only*; one click reveals it. */
function OverdueSection({ items, actions, peek }: { items: AgendaItem[]; actions: AgendaActions; peek: PeekCtl }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`cal-overdue${open ? ' open' : ''}`}>
      <button className="cal-overdue-toggle" onClick={() => setOpen((o) => !o)}>
        <Icon name="chevronRight" />
        지남 {items.length}개
      </button>
      {open && (
        <div className="cal-day-list">
          {items.map((it) => (
            <DayCard key={it.nodeId} it={it} actions={actions} peek={peek} overdue />
          ))}
        </div>
      )}
    </div>
  );
}

function DayPane({
  anchor,
  agenda,
  grouped,
  now,
  actions,
  peek,
  focusByDay,
}: {
  anchor: number;
  agenda: Agenda | null;
  grouped: Map<string, AgendaItem[]>;
  now: number;
  actions: AgendaActions;
  peek: PeekCtl;
  focusByDay: Map<string, number>;
}) {
  const isToday = anchor === startOfDay(now);
  const dayAll = grouped.get(dayKey(anchor)) ?? [];
  // add entry point lives in the calendar header (§3.1), same in every view.
  const summary = (
    <DaySummary
      planned={dayAll.length}
      focusSec={focusByDay.get(dayKey(anchor)) ?? 0}
      done={dayAll.filter((i) => i.done).length}
    />
  );

  // Today: lead with *today only* (no upcoming days). Overdue sits collapsed above.
  if (isToday && agenda) {
    const nextId = agenda.today.find((it) => it.hasTime && it.at > now)?.nodeId;
    const nothing = agenda.today.length === 0 && agenda.overdue.length === 0;
    return (
      <div className="cal-day-body">
        {summary}
        {agenda.overdue.length > 0 && <OverdueSection items={agenda.overdue} actions={actions} peek={peek} />}
        {agenda.today.length > 0 ? (
          <div className="cal-day-list">
            {agenda.today.map((it) => (
              <DayCard key={it.nodeId} it={it} actions={actions} peek={peek} isNext={it.nodeId === nextId} />
            ))}
          </div>
        ) : nothing ? (
          <div className="cal-empty">
            오늘 예정된 일정이 없어요.
            <br />
            노드에 날짜·시간을 설정하면 여기 모여요.
          </div>
        ) : (
          <div className="cal-day-empty">오늘 예정된 일정은 없어요.</div>
        )}
      </div>
    );
  }

  // Other day: only that day's pending items (never future info).
  const pending = dayAll.filter((i) => !i.done);
  return (
    <div className="cal-day-body">
      {summary}
      {pending.length === 0 ? (
        <div className="cal-empty">이 날은 예정된 일정이 없어요.</div>
      ) : (
        <div className="cal-day-list">
          {pending.map((it) => (
            <DayCard key={it.nodeId} it={it} actions={actions} peek={peek} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A draggable schedule chip (week all-day strip + month cells). Overview/plan
 *  surfaces — no inline 집중·완료 (execution lives only in the day view, §3.1/§6).
 *  Click = peek the node; drag = reschedule. */
function CalChip({
  it,
  drag,
  peek,
  showTime,
}: {
  it: AgendaItem;
  drag: DragReschedule;
  peek: PeekCtl;
  showTime: boolean;
}) {
  return (
    <div
      className={`cal-chip${isPeeked(peek, it) ? ' peeked' : ''}`}
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
          peek.open(it);
        }}
      >
        {showTime && <span className="cal-chip-time">{rowTime(it)}</span>}
        <span className="cal-chip-text">{it.text}</span>
      </button>
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
  peek,
  onResize,
}: {
  it: AgendaItem;
  topMin: number;
  spanMin: number;
  col: number;
  cols: number;
  drag: DragReschedule;
  peek: PeekCtl;
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
    const topPx = minutesToPx(topMin);
    const minuteAt = (clientY: number) => {
      const spanPx = clientY - rect.top - topPx;
      const raw = pxToMinutes(spanPx);
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
      className={`cal-wk-block${isPeeked(peek, it) ? ' peeked' : ''}${cols > 1 ? ' overlap' : ''}`}
      style={{
        top: `${minutesToPx(topMin)}px`,
        height: `${minutesToPx(Math.min(span, WEEK_GRID_MINUTES - topMin))}px`,
        // side-by-side columns for overlaps, with a small gap so they read as
        // distinct blocks (hover expands one to full width — see CSS).
        left: `calc(${(col / cols) * 100}% + 1px)`,
        width: `calc(${100 / cols}% - 3px)`,
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
          peek.open(it);
        }}
      >
        {/* overlapping blocks hide the redundant time (CSS) to give the title room;
            it returns on hover when the block expands to full width. */}
        <span className="cal-wk-block-time">{rowTime(it)}</span>
        <span className="cal-wk-block-text">{it.text}</span>
      </button>
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
  peek,
  picker,
  focusByDay,
  onResize,
}: {
  anchor: number;
  grouped: Map<string, AgendaItem[]>;
  now: number;
  onPickDay: (ms: number) => void;
  drag: DragReschedule;
  peek: PeekCtl;
  picker: PickerCtl;
  focusByDay: Map<string, number>;
  onResize: (it: AgendaItem, minutes: number) => void;
}) {
  const days = weekDays(anchor);
  const todayMs = startOfDay(now);
  const hours = gridHourLabels();

  /** Clicked-Y within a day column → minute-of-day, snapped to 15 min. Uses the
   *  fixed px scale (not column height) so the captured time matches the visual
   *  gridline even when the pane is taller than the grid content (§3.8). */
  const minuteFromClick = (e: ReactMouseEvent<HTMLDivElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = WEEK_GRID_START_HOUR * 60 + pxToMinutes(e.clientY - rect.top);
    const snapped = Math.round(raw / 15) * 15;
    return Math.max(WEEK_GRID_START_HOUR * 60, Math.min(WEEK_GRID_END_HOUR * 60 - 15, snapped));
  };

  return (
    <div className="cal-wk">
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
              onClick={() => picker.openAt(ms, null)}
              onDragOver={(e) => {
                e.preventDefault();
                drag.onOverDay(key);
              }}
              onDrop={() => drag.dropAllDay(ms)}
              title="클릭해서 종일 일정 추가"
            >
              {strip.map((it) => (
                <CalChip key={it.nodeId} it={it} drag={drag} peek={peek} showTime={it.hasTime} />
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
              onClick={(e) => picker.openAt(ms, minuteFromClick(e))}
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
                  peek={peek}
                  onResize={onResize}
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* week has no room for an inline drawer → float the preview as a popup (§3.2) */}
      {peek.active && (
        <div className="cal-peek-popup-scrim" onClick={peek.close}>
          <div className="cal-peek-popup" onClick={(e) => e.stopPropagation()}>
            <PeekBody peek={peek} />
          </div>
        </div>
      )}
    </div>
  );
}

function MonthPane({
  anchor,
  grouped,
  now,
  onPickDay,
  drag,
  peek,
  picker,
  focusByDay,
}: {
  anchor: number;
  grouped: Map<string, AgendaItem[]>;
  now: number;
  onPickDay: (ms: number) => void;
  drag: DragReschedule;
  peek: PeekCtl;
  picker: PickerCtl;
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
              <button
                className="cal-month-add"
                title="이 날에 일정 추가"
                onClick={(e) => {
                  e.stopPropagation();
                  picker.openAt(c.ms, null);
                }}
              >
                <Icon name="plus" />
              </button>
              {(focusByDay.get(key) ?? 0) > 0 && (
                <span className="cal-focus-tag" title="이 날 집중한 시간">
                  {fmtDuration(focusByDay.get(key)!)}
                </span>
              )}
              {/* All items scroll within the cell (no "+N" truncation) — §3.7 */}
              <div className="cal-month-chips">
                {dayItems.map((it) => (
                  <CalChip key={it.nodeId} it={it} drag={drag} peek={peek} showTime={it.hasTime} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* month cells are too small for an inline preview → panel below the grid (§3.2) */}
      {peek.active && (
        <div className="cal-peek-panel">
          <PeekBody peek={peek} />
        </div>
      )}
    </div>
  );
}
