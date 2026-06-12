import { useEffect, useMemo, useState } from 'react';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import { useSession } from '../store/sessionStore';
import type { MapStore } from '../store/mapStore';
import { Icon } from '../ui/Icon';
import { openSessionNote } from './controller';
import { dayKey, fmtDuration, isCounted, perNode, type LiveResolver } from './aggregate';
import {
  weekPeriod, dayPeriod, periodSessions, periodLabel, quality, weeklyTrend,
  priorityVsActual, insights, type Period, type ScheduledNode,
} from './report';
import { deserialize } from '../io/formats';
import type { TreeNode } from '../../electron/preload';
import type { FocusSession } from '../types';

const DAY = 86_400_000;

function collectMindPaths(tree: TreeNode[], out: string[] = []): string[] {
  for (const n of tree) {
    if (n.type === 'dir' && n.children) collectMindPaths(n.children, out);
    else if (n.type === 'file' && n.path.endsWith('.mind')) out.push(n.path);
  }
  return out;
}

/** All scheduled nodes across the workspace (open maps + on-disk .mind files),
 *  so the deadline review isn't limited to maps that happen to be open. */
async function allScheduledNodes(): Promise<ScheduledNode[]> {
  const out: ScheduledNode[] = [];
  const seen = new Set<string>();
  const add = (mapId: string, nodeId: string, text: string, scheduleAt: string) => {
    const k = `${mapId} ${nodeId}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ mapId, nodeId, text, scheduleAt });
  };
  // open maps first (freshest)
  for (const st of openMaps()) {
    const doc = st.getState().doc;
    for (const id in doc.nodes) {
      const n = doc.nodes[id];
      if (n.scheduled && n.scheduleAt) add(doc.id ?? '', id, n.text, n.scheduleAt);
    }
  }
  // then on-disk maps
  const paths = collectMindPaths(useWorkspace.getState().tree);
  for (const p of paths) {
    try {
      const doc = deserialize(await window.api.readFile(p));
      for (const id in doc.nodes) {
        const n = doc.nodes[id];
        if (n.scheduled && n.scheduleAt) add(doc.id ?? '', id, n.text, n.scheduleAt);
      }
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

/** Open maps → live tree helpers (so moving a node re-attributes, and we can read
 *  scheduled nodes for priority-vs-actual). */
function openMaps(): MapStore[] {
  return useSession
    .getState()
    .tabs.filter((t) => t.kind === 'map')
    .map((t) => t.store as MapStore);
}
/** Is `leafId` inside `ancestorId`'s subtree in the current (open) tree? */
function inSubtree(mapId: string, ancestorId: string, leafId: string): boolean {
  const st = openMaps().find((s) => (s.getState().doc.id ?? '') === mapId);
  if (!st) return false;
  const nodes = st.getState().doc.nodes;
  let cur: string | null = leafId;
  let guard = 0;
  while (cur && guard++ < 200) {
    if (cur === ancestorId) return true;
    cur = nodes[cur]?.parentId ?? null;
  }
  return false;
}

/** Live ancestor chain from the open map (so a moved node re-attributes). */
const liveResolver: LiveResolver = (mapId, nodeId) => {
  const st = openMaps().find((s) => (s.getState().doc.id ?? '') === mapId);
  if (!st) return null;
  const nodes = st.getState().doc.nodes;
  if (!nodes[nodeId]) return null;
  const ancestors: { id: string; text: string }[] = [];
  let cur = nodes[nodeId].parentId;
  let guard = 0;
  while (cur && nodes[cur] && guard++ < 200) {
    ancestors.unshift({ id: cur, text: nodes[cur].text });
    cur = nodes[cur].parentId;
  }
  return { selfText: nodes[nodeId].text, ancestors };
};

export function WorkHistory() {
  const close = useUi((s) => s.closeHistory);
  const noteIndex = useWorkspace((s) => s.noteIndex);
  const now = Date.now();
  const [offset, setOffset] = useState(0); // 0 = this week, -1 = last week, …
  const [day, setDay] = useState<number | null>(null); // a drilled-in day (epoch ms) or null
  const [filter, setFilter] = useState<{ mapId: string; nodeId: string; label: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null); // expanded session id
  const [scheduled, setScheduled] = useState<ScheduledNode[]>([]);
  const [schedLoading, setSchedLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    void allScheduledNodes().then((s) => {
      if (!alive) return;
      setScheduled(s);
      setSchedLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const period: Period = useMemo(
    () => (day != null ? dayPeriod(day) : weekPeriod(now, offset)),
    [day, offset, now],
  );

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (expanded) setExpanded(null);
      else if (filter) setFilter(null);
      else if (day != null) setDay(null);
      else close();
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [close, day, filter, expanded]);

  const sessions = useMemo(
    () => noteIndex.map((m) => m.session).filter((s): s is FocusSession => !!s),
    [noteIndex],
  );
  const counted = useMemo(() => sessions.filter(isCounted), [sessions]);
  const inP = useMemo(() => periodSessions(sessions, period), [sessions, period]);
  const q = useMemo(() => quality(inP), [inP]);
  const prevQ = useMemo(
    () => quality(periodSessions(sessions, day != null ? dayPeriod(day - DAY) : weekPeriod(now, offset - 1))),
    [sessions, day, offset, now],
  );
  const priority = useMemo(
    () => priorityVsActual(scheduled, sessions, period, now, inSubtree),
    [scheduled, sessions, period, now],
  );
  const tips = useMemo(() => insights(period, q, prevQ, priority, now), [period, q, prevQ, priority, now]);
  const trend = useMemo(() => weeklyTrend(sessions, now, 8), [sessions, now]);
  // per-topic rollup for THIS period (live tree) — the drill-down dimension
  const topics = useMemo(
    () => [...perNode(inP, liveResolver).values()].filter((t) => t.selfSec > 0 || t.rolledSec > 0)
      .sort((a, b) => b.rolledSec - a.rolledSec),
    [inP],
  );
  // diary, optionally filtered to the selected topic's subtree
  const diary = useMemo(() => {
    const list = filter
      ? inP.filter(
          (s) =>
            s.link.mapId === filter.mapId &&
            (s.link.nodeId === filter.nodeId || inSubtree(filter.mapId, filter.nodeId, s.link.nodeId)),
        )
      : inP;
    return [...list].sort((a, b) => b.start - a.start);
  }, [inP, filter]);
  const byDay = useMemo(() => groupByDay(diary), [diary]);
  const maxTrend = Math.max(1, ...trend.map((t) => t.sec));

  const openNote = (s: FocusSession) => {
    const m = noteIndex.find((n) => n.session?.sessionId === s.sessionId);
    if (m) { void openSessionNote(m.path); close(); }
  };
  return (
    <div className="wh-backdrop" onMouseDown={close}>
      <div className="wh" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wh-head">
          <Icon name="clock" />
          <span className="wh-title">작업 기록</span>
          {/* period navigation */}
          <div className="wh-nav">
            <button className="wh-nav-btn" title="이전" onClick={() => (day != null ? setDay(day - DAY) : setOffset(offset - 1))}>
              <Icon name="chevronLeft" />
            </button>
            <span className="wh-period">{periodLabel(period, now)}</span>
            <button
              className="wh-nav-btn"
              title="다음"
              disabled={day != null ? day + DAY > now : offset >= 0}
              onClick={() => (day != null ? setDay(day + DAY) : setOffset(Math.min(0, offset + 1)))}
            >
              <Icon name="chevronRight" />
            </button>
            {day != null && (
              <button className="wh-nav-week" onClick={() => setDay(null)}>주 단위</button>
            )}
          </div>
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
            {/* insight strip — the "so what" */}
            <div className="wh-insights">
              {tips.map((t, i) => (
                <div key={i} className={`wh-insight ${t.tone}`}>{t.text}</div>
              ))}
            </div>

            <div className="wh-cols">
              {/* outcome-first work digest */}
              <div className="wh-log">
                <div className="wh-log-head">
                  <span className="wh-section-label">
                    {filter ? `「${filter.label}」 기록` : '작업 일지 — 무엇을 끝냈나'}
                  </span>
                  {filter && (
                    <button className="wh-export" onClick={() => setFilter(null)}>← 전체</button>
                  )}
                </div>
                {byDay.length === 0 ? (
                  <div className="wh-noday">이 기간에 집중 기록이 없어요.</div>
                ) : (
                  byDay.map(([d, list]) => (
                    <div className="wh-day" key={d}>
                      <button
                        className="wh-day-head"
                        title="이 날만 보기"
                        onClick={() => setDay(new Date(d + 'T00:00:00').getTime())}
                      >
                        <span className="wh-day-label">{dayLabel(d)}</span>
                        <span className="wh-day-total">
                          {fmtDuration(list.reduce((a, s) => a + s.durationSec, 0))} · {list.length}세션
                        </span>
                      </button>
                      {list.map((s) => (
                        <div key={s.sessionId} className={`wh-entry-wrap${expanded === s.sessionId ? ' open' : ''}`}>
                          <button
                            className="wh-entry"
                            onClick={() => setExpanded(expanded === s.sessionId ? null : s.sessionId)}
                          >
                            <span className="wh-entry-time">{hm(s.start)}</span>
                            <span className="wh-entry-dur">{fmtDuration(s.durationSec)}</span>
                            <span className="wh-entry-topic">{s.link.nodeText || '노드'}</span>
                            <span className="wh-entry-outcome">
                              {s.reflect || <span className="wh-entry-noreflect">— 성과 미기록</span>}
                            </span>
                            <Icon name={expanded === s.sessionId ? 'chevronDown' : 'chevronRight'} />
                          </button>
                          {expanded === s.sessionId && (
                            <div className="wh-entry-detail">
                              <div className="wh-detail-row">
                                <span className="wh-detail-k">🎯 목표</span>
                                <span className="wh-detail-v">{s.goal || <i>(미기록)</i>}</span>
                              </div>
                              <div className="wh-detail-row">
                                <span className="wh-detail-k">✅ 성과</span>
                                <span className="wh-detail-v">{s.reflect || <i>(미기록)</i>}</span>
                              </div>
                              <div className="wh-detail-actions">
                                <button onClick={() => openNote(s)}>노트 열기</button>
                                {s.estimated && <span className="wh-detail-est">· 종료 시각 추정</span>}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>

              <div className="wh-side">
                {/* per-topic — click to drill the diary into that topic */}
                {topics.length > 0 && (
                  <div className="wh-panel">
                    <div className="wh-section-label">주제별 집중 (하위 포함)</div>
                    {topics.slice(0, 8).map((t) => (
                      <button
                        key={`${t.mapId} ${t.nodeId}`}
                        className={`wh-topic${filter?.nodeId === t.nodeId ? ' on' : ''}`}
                        title="이 주제의 기록만 보기"
                        onClick={() =>
                          setFilter(
                            filter?.nodeId === t.nodeId
                              ? null
                              : { mapId: t.mapId, nodeId: t.nodeId, label: t.label || '(이름 없음)' },
                          )
                        }
                      >
                        <span className="wh-topic-label">{t.label || '(이름 없음)'}</span>
                        <span className="wh-topic-bar">
                          <span
                            className="wh-topic-fill"
                            style={{ width: `${Math.round((t.rolledSec / (topics[0]?.rolledSec || 1)) * 100)}%` }}
                          />
                        </span>
                        <span className="wh-topic-val">{fmtDuration(t.rolledSec)}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* priority vs actual */}
                {schedLoading ? (
                  <div className="wh-panel">
                    <div className="wh-section-label">마감 vs 실제 집중</div>
                    <div className="wh-prio-none">마감 불러오는 중…</div>
                  </div>
                ) : priority.length > 0 && (
                  <div className="wh-panel">
                    <div className="wh-section-label">마감 vs 실제 집중</div>
                    {priority.slice(0, 6).map((p) => (
                      <div key={`${p.mapId} ${p.nodeId}`} className={`wh-prio${p.flagged ? ' risk' : ''}`}>
                        <span className="wh-prio-label">{p.label}</span>
                        <span className="wh-prio-due">
                          {p.dueInDays < 0 ? `${-p.dueInDays}일 지남` : p.dueInDays === 0 ? '오늘' : `D-${p.dueInDays}`}
                        </span>
                        <span className="wh-prio-focus">{p.focusSec > 0 ? fmtDuration(p.focusSec) : '0분'}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* quality */}
                <div className="wh-panel">
                  <div className="wh-section-label">집중의 질</div>
                  <div className="wh-qrow"><span>평균 세션</span><b>{fmtDuration(q.avgSec)}</b></div>
                  <div className="wh-qrow"><span>최장 몰입</span><b>{fmtDuration(q.longestSec)}</b></div>
                  <div className="wh-qrow"><span>딥워크(50분+)</span><b>{q.deepWorkCount}회</b></div>
                  <div className="wh-hours" title="시간대별 집중(0–23시)">
                    {q.byHour.map((sec, h) => (
                      <span
                        key={h}
                        className="wh-hour"
                        style={{ height: `${Math.max(2, Math.round((sec / Math.max(1, ...q.byHour)) * 22))}px` }}
                        title={`${h}시 · ${fmtDuration(sec)}`}
                      />
                    ))}
                  </div>
                  <div className="wh-hours-axis" aria-hidden="true">
                    <span>0</span><span>6</span><span>12</span><span>18</span><span>23</span>
                  </div>
                </div>

                {/* trend */}
                <div className="wh-panel">
                  <div className="wh-section-label">주별 추세 (8주)</div>
                  <div className="wh-trend">
                    {trend.map((t, i) => (
                      <span
                        key={i}
                        className={`wh-trend-bar${i === trend.length - 1 + (offset) ? ' on' : ''}`}
                        style={{ height: `${Math.max(3, Math.round((t.sec / maxTrend) * 40))}px` }}
                        title={`${fmtDuration(t.sec)}`}
                        onClick={() => { setDay(null); setOffset(i - (trend.length - 1)); }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
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
  const wd = ['일', '월', '화', '수', '목', '금', '토'][new Date(key + 'T00:00:00').getDay()];
  return `${Number(m)}/${Number(d)} (${wd})`;
}
