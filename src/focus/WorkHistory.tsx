import { useEffect, useMemo, useState } from 'react';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import { useSession } from '../store/sessionStore';
import type { MapStore } from '../store/mapStore';
import { Icon } from '../ui/Icon';
import { openSessionNote } from './controller';
import {
  summary, perNode, dailyTotals, dayKey, fmtDuration, isCounted, type LiveResolver,
} from './aggregate';
import type { FocusSession } from '../types';

const DAY = 86_400_000;

/** Resolve a node's CURRENT position from the open map (so a moved node's time
 *  re-attributes); null when the map isn't open or the node is gone. */
const liveResolver: LiveResolver = (mapId, nodeId) => {
  const tab = useSession
    .getState()
    .tabs.find((t) => t.kind === 'map' && (t.store as MapStore).getState().doc.id === mapId);
  if (!tab) return null;
  const nodes = (tab.store as MapStore).getState().doc.nodes;
  const n = nodes[nodeId];
  if (!n) return null;
  const ancestors: { id: string; text: string }[] = [];
  let cur = n.parentId;
  let guard = 0;
  while (cur && nodes[cur] && guard++ < 200) {
    ancestors.unshift({ id: cur, text: nodes[cur].text });
    cur = nodes[cur].parentId;
  }
  return { selfText: n.text, ancestors };
};

/**
 * Work-history dashboard — a work review, not a personal tracker: a manager (or
 * you) should be able to read *how the work went*. Day-grouped log of what was
 * done (topic · duration · outcome), an activity heatmap, and where time went by
 * topic. Clicking a topic filters the log; clicking a session opens its note
 * (and closes this overlay, since it would otherwise cover the result).
 */
export function WorkHistory() {
  const close = useUi((s) => s.closeHistory);
  const noteIndex = useWorkspace((s) => s.noteIndex);
  const now = Date.now();
  const [filter, setFilter] = useState<{ mapId: string; nodeId: string; label: string } | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && (filter ? setFilter(null) : close());
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [close, filter]);

  const sessions = useMemo(
    () => noteIndex.map((m) => m.session).filter((s): s is FocusSession => !!s),
    [noteIndex],
  );
  const counted = useMemo(() => sessions.filter(isCounted), [sessions]);
  const sum = useMemo(() => summary(sessions, now), [sessions, now]);
  const daily = useMemo(() => dailyTotals(sessions), [sessions]);
  const nodeAgg = useMemo(() => perNode(sessions, liveResolver), [sessions]);
  const nodes = useMemo(
    () => [...nodeAgg.values()].sort((a, b) => b.rolledSec - a.rolledSec).slice(0, 8),
    [nodeAgg],
  );

  // subtree membership for the active topic filter (direct node + its descendants)
  const inFilter = (s: FocusSession): boolean => {
    if (!filter) return true;
    if (s.link.mapId !== filter.mapId) return false;
    if (s.link.nodeId === filter.nodeId) return true;
    const live = liveResolver(s.link.mapId, s.link.nodeId);
    const chain = live ? live.ancestors.map((a) => a.id) : s.ancestorIds;
    return chain.includes(filter.nodeId);
  };
  const shown = useMemo(
    () => counted.filter(inFilter).sort((a, b) => b.start - a.start),
    [counted, filter],
  );
  const byDay = useMemo(() => groupByDay(shown), [shown]);

  const weeks = 17;
  const heat = useMemo(() => buildHeat(daily, now, weeks), [daily, now]);
  const maxDay = Math.max(1, ...[...daily.values()]);

  const openNote = (s: FocusSession) => {
    const m = noteIndex.find((n) => n.session?.sessionId === s.sessionId);
    if (m) {
      void openSessionNote(m.path);
      close(); // the note opens in the split underneath — get out of the way
    }
  };

  return (
    <div className="wh-backdrop" onMouseDown={close}>
      <div className="wh" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wh-head">
          <Icon name="clock" />
          <span className="wh-title">작업 기록</span>
          <button className="wh-close" title="닫기 (Esc)" onClick={close}>
            <Icon name="close" />
          </button>
        </div>

        {counted.length === 0 ? (
          <div className="wh-empty">
            아직 집중 기록이 없어요.<br />
            노드에서 <b>“집중 세션 시작”</b>으로 첫 기록을 남겨보세요.
          </div>
        ) : (
          <div className="wh-body">
            <div className="wh-strip">
              <Card big={fmtDuration(sum.todaySec)} label="오늘" />
              <Card big={fmtDuration(sum.weekSec)} label="이번 주" />
              <Card big={`${sum.countToday}회`} label="오늘 세션" />
              <Card big={`🔥 ${sum.streak}일`} label="연속" />
            </div>

            <div className="wh-section-label">최근 {weeks}주</div>
            <div className="wh-heat">
              {heat.map((col, ci) => (
                <div className="wh-heat-col" key={ci}>
                  {col.map((cell, ri) => (
                    <div
                      key={ri}
                      className={`wh-cell${cell ? ` lvl-${level(cell.sec, maxDay)}` : ' empty'}`}
                      title={cell ? `${cell.key} · ${fmtDuration(cell.sec)}` : ''}
                    />
                  ))}
                </div>
              ))}
            </div>

            <div className="wh-cols">
              {/* day-grouped work log */}
              <div className="wh-log">
                <div className="wh-log-head">
                  <span className="wh-section-label">
                    {filter ? `「${filter.label}」 기록` : '작업 일지'}
                  </span>
                  {filter && (
                    <button className="wh-filter-clear" onClick={() => setFilter(null)}>
                      전체 보기 ✕
                    </button>
                  )}
                </div>
                {byDay.map(([day, list]) => (
                  <div className="wh-day" key={day}>
                    <div className="wh-day-head">
                      <span className="wh-day-label">{dayLabel(day)}</span>
                      <span className="wh-day-total">
                        {fmtDuration(list.reduce((a, s) => a + s.durationSec, 0))} · {list.length}세션
                      </span>
                    </div>
                    {list.map((s) => (
                      <button key={s.sessionId} className="wh-entry" onClick={() => openNote(s)}>
                        <span className="wh-entry-time">{hm(s.start)}</span>
                        <span className="wh-entry-dur">{fmtDuration(s.durationSec)}</span>
                        <span className="wh-entry-topic">{s.link.nodeText || '노드'}</span>
                        <span className="wh-entry-outcome">
                          {s.reflect || <span className="wh-entry-noreflect">— (성과 미기록)</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>

              {/* where time went, by topic — click to filter the log */}
              <div className="wh-nodes">
                <div className="wh-section-label">주제별 누적 (하위 포함)</div>
                {nodes.map((n) => (
                  <button
                    key={`${n.mapId} ${n.nodeId}`}
                    className={`wh-node${filter?.nodeId === n.nodeId ? ' on' : ''}`}
                    onClick={() =>
                      setFilter(
                        filter?.nodeId === n.nodeId
                          ? null
                          : { mapId: n.mapId, nodeId: n.nodeId, label: n.label || '(이름 없음)' },
                      )
                    }
                    title="이 주제의 기록만 보기"
                  >
                    <span className="wh-node-label">{n.label || '(이름 없음)'}</span>
                    <span className="wh-node-bar">
                      <span
                        className="wh-node-fill"
                        style={{ width: `${Math.round((n.rolledSec / (nodes[0]?.rolledSec || 1)) * 100)}%` }}
                      />
                    </span>
                    <span className="wh-node-val">{fmtDuration(n.rolledSec)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ big, label }: { big: string; label: string }) {
  return (
    <div className="wh-card">
      <span className="wh-card-big">{big}</span>
      <span className="wh-card-label">{label}</span>
    </div>
  );
}

function groupByDay(sorted: FocusSession[]): [string, FocusSession[]][] {
  const map = new Map<string, FocusSession[]>();
  for (const s of sorted) {
    const k = dayKey(s.start);
    (map.get(k) ?? map.set(k, []).get(k)!).push(s);
  }
  return [...map.entries()];
}

function level(sec: number, max: number): number {
  if (sec <= 0) return 0;
  const r = sec / max;
  return r > 0.66 ? 4 : r > 0.33 ? 3 : r > 0.1 ? 2 : 1;
}

function buildHeat(daily: Map<string, number>, now: number, weeks: number) {
  const cols: ({ key: string; sec: number } | null)[][] = [];
  const today = new Date(now);
  const dow = today.getDay();
  const totalDays = weeks * 7;
  const startMs = now - (totalDays - 1 - (6 - dow)) * DAY;
  for (let c = 0; c < weeks; c++) {
    const col: ({ key: string; sec: number } | null)[] = [];
    for (let r = 0; r < 7; r++) {
      const ms = startMs + (c * 7 + r) * DAY;
      if (ms > now + DAY) { col.push(null); continue; }
      const key = dayKey(ms);
      col.push({ key, sec: daily.get(key) ?? 0 });
    }
    cols.push(col);
  }
  return cols;
}

function hm(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
function dayLabel(key: string): string {
  const today = dayKey(Date.now());
  if (key === today) return '오늘';
  if (key === dayKey(Date.now() - DAY)) return '어제';
  const [, m, d] = key.split('-');
  return `${Number(m)}월 ${Number(d)}일`;
}
