// Shared agenda-row rendering — used by CalendarView's day pane (일간 뷰).
// Keeps the reveal/집중/완료 interaction logic in one place.

import { Icon } from '../ui/Icon';
import { revealNode } from '../note/noteLinks';
import { requestFocusStart, mapStoreById } from './controller';
import { dayKey } from './aggregate';
import type { AgendaItem } from './agenda';
import type { NoteLink } from '../types';

const pad = (n: number) => String(n).padStart(2, '0');

export const linkOf = (it: AgendaItem): NoteLink => ({
  mapId: it.mapId,
  nodeId: it.nodeId,
  nodeText: it.text,
  mapPath: it.mapPath,
});

export function rowTime(it: AgendaItem): string {
  const d = new Date(it.at);
  return it.hasTime ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '종일';
}

export function mapName(it: AgendaItem): string {
  if (!it.mapPath) return '';
  return (it.mapPath.split('/').pop() ?? '').replace(/\.mind$/, '');
}

/** Human label for an upcoming-day group header ("오늘"/"내일"/"7/3 (금)"). */
export function dayHeader(key: string, now: number): string {
  if (key === dayKey(now)) return '오늘';
  if (key === dayKey(now + 86_400_000)) return '내일';
  const [, m, d] = key.split('-');
  const wd = ['일', '월', '화', '수', '목', '금', '토'][new Date(key + 'T00:00:00').getDay()];
  return `${Number(m)}/${Number(d)} (${wd})`;
}

export interface AgendaActions {
  reveal: (it: AgendaItem) => void;
  startFocus: (it: AgendaItem) => void;
  toggleDone: (it: AgendaItem) => void;
}

/** Reveal/집중시작/완료 handlers bound to a `reload` callback (re-fetch the
 *  agenda after a mutation) and an optional `afterNavigate` (e.g. close an
 *  overlay before jumping to the node's map). */
export function makeAgendaActions(reload: () => void, afterNavigate?: () => void): AgendaActions {
  const reveal = (it: AgendaItem) => {
    void revealNode(linkOf(it));
    afterNavigate?.();
  };
  const startFocus = (it: AgendaItem) => {
    void (async () => {
      let store = mapStoreById(it.mapId);
      if (!store) {
        await revealNode(linkOf(it));
        store = mapStoreById(it.mapId);
      }
      if (store) {
        afterNavigate?.();
        requestFocusStart(store, it.nodeId);
      } else {
        reveal(it);
      }
    })();
  };
  const toggleDone = (it: AgendaItem) => {
    const store = mapStoreById(it.mapId);
    if (store) {
      store.getState().toggleDone(it.nodeId);
      setTimeout(reload, 60);
    } else {
      reveal(it); // closed map → open it to toggle in the canvas (v1)
    }
  };
  return { reveal, startFocus, toggleDone };
}

interface AgendaRowProps {
  it: AgendaItem;
  overdue?: boolean;
  actions: AgendaActions;
}

export function AgendaRow({ it, overdue, actions }: AgendaRowProps) {
  return (
    <div className={`today-row${overdue ? ' over' : ''}`}>
      <button className="today-main" onClick={() => actions.reveal(it)} title="노드로 이동">
        <span className="today-time">
          {overdue ? `${pad(new Date(it.at).getMonth() + 1)}/${pad(new Date(it.at).getDate())}` : rowTime(it)}
        </span>
        <span className="today-text">{it.text}</span>
        {mapName(it) && <span className="today-map">{mapName(it)}</span>}
      </button>
      <span className="today-acts">
        <button className="today-act focus" onClick={() => actions.startFocus(it)} title="집중 시작">
          <Icon name="clock" />
        </button>
        <button className="today-act" onClick={() => actions.toggleDone(it)} title="완료 표시">
          <Icon name="check" />
        </button>
      </span>
    </div>
  );
}
