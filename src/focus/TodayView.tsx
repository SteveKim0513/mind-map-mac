import { useEffect, useMemo, useState } from 'react';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import { Icon } from '../ui/Icon';
import { revealNode } from '../note/noteLinks';
import { requestFocusStart, mapStoreById } from './controller';
import { collectAgenda } from './collectAgenda';
import { buildAgenda, type AgendaItem } from './agenda';
import { summary, fmtDuration, dayKey } from './aggregate';
import type { FocusSession, NoteLink } from '../types';

const pad = (n: number) => String(n).padStart(2, '0');
const linkOf = (it: AgendaItem): NoteLink => ({ mapId: it.mapId, nodeId: it.nodeId, nodeText: it.text, mapPath: it.mapPath });
function rowTime(it: AgendaItem): string {
  const d = new Date(it.at);
  return it.hasTime ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '종일';
}
function mapName(it: AgendaItem): string {
  if (!it.mapPath) return '';
  return (it.mapPath.split('/').pop() ?? '').replace(/\.mind$/, '');
}
function dayHeader(key: string, now: number): string {
  if (key === dayKey(now)) return '오늘';
  if (key === dayKey(now + 86_400_000)) return '내일';
  const [, m, d] = key.split('-');
  const wd = ['일', '월', '화', '수', '목', '금', '토'][new Date(key + 'T00:00:00').getDay()];
  return `${Number(m)}/${Number(d)} (${wd})`;
}

export function TodayView() {
  const close = useUi((s) => s.closeToday);
  const noteIndex = useWorkspace((s) => s.noteIndex);
  const now = Date.now();
  const [items, setItems] = useState<AgendaItem[] | null>(null);

  const reload = () => void collectAgenda().then(setItems);
  useEffect(() => { reload(); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [close]);

  const agenda = useMemo(() => (items ? buildAgenda(items, now) : null), [items, now]);
  const todaySec = useMemo(() => {
    const sessions = noteIndex.map((m) => m.session).filter((s): s is FocusSession => !!s);
    return summary(sessions, now).todaySec;
  }, [noteIndex, now]);

  const reveal = (it: AgendaItem) => { void revealNode(linkOf(it)); close(); };
  const startFocus = async (it: AgendaItem) => {
    let store = mapStoreById(it.mapId);
    if (!store) { await revealNode(linkOf(it)); store = mapStoreById(it.mapId); }
    if (store) { close(); requestFocusStart(store, it.nodeId); }
    else reveal(it);
  };
  const toggleDone = (it: AgendaItem) => {
    const store = mapStoreById(it.mapId);
    if (store) { store.getState().toggleDone(it.nodeId); setTimeout(reload, 60); }
    else reveal(it); // closed map → open it to toggle in the canvas (v1)
  };

  const Row = ({ it, overdue }: { it: AgendaItem; overdue?: boolean }) => (
    <div className={`today-row${overdue ? ' over' : ''}`}>
      <button className="today-main" onClick={() => reveal(it)} title="노드로 이동">
        <span className="today-time">{overdue ? `${pad(new Date(it.at).getMonth() + 1)}/${pad(new Date(it.at).getDate())}` : rowTime(it)}</span>
        <span className="today-text">{it.text}</span>
        {mapName(it) && <span className="today-map">{mapName(it)}</span>}
      </button>
      <span className="today-acts">
        <button className="today-act focus" onClick={() => void startFocus(it)} title="집중 세션 시작"><Icon name="clock" /></button>
        <button className="today-act" onClick={() => toggleDone(it)} title="완료 표시"><Icon name="check" /></button>
      </span>
    </div>
  );

  const empty = agenda && !agenda.overdue.length && !agenda.today.length && !agenda.upcoming.length;

  return (
    <div className="wh-backdrop" onMouseDown={close}>
      <div className="today" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wh-head">
          <Icon name="calendar" />
          <span className="wh-title">오늘</span>
          {agenda && (
            <span className="today-summary">
              오늘 {agenda.today.length}건{agenda.overdue.length ? ` · 지남 ${agenda.overdue.length}` : ''}
              {agenda.doneToday ? ` · 완료 ${agenda.doneToday}` : ''}
              {todaySec ? ` · 집중 ${fmtDuration(todaySec)}` : ''}
            </span>
          )}
          <button className="wh-close" title="닫기 (Esc)" onClick={close}><Icon name="close" /></button>
        </div>

        {items == null ? (
          <div className="today-empty">불러오는 중…</div>
        ) : empty ? (
          <div className="today-empty">오늘 예정된 일정이 없어요.<br />노드에 날짜·시간을 설정하면 여기 모여요.</div>
        ) : (
          <div className="today-body">
            {agenda!.overdue.length > 0 && (
              <div className="today-sec">
                <div className="today-sec-label over">지남</div>
                {agenda!.overdue.map((it) => <Row key={it.nodeId} it={it} overdue />)}
              </div>
            )}
            {agenda!.today.length > 0 && (
              <div className="today-sec">
                <div className="today-sec-label">오늘</div>
                {agenda!.today.map((it) => <Row key={it.nodeId} it={it} />)}
              </div>
            )}
            {agenda!.upcoming.map((g) => (
              <div className="today-sec" key={g.day}>
                <div className="today-sec-label">{dayHeader(g.day, now)}</div>
                {g.items.map((it) => <Row key={it.nodeId} it={it} />)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
