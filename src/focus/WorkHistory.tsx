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
import { collectAgenda } from './collectAgenda';
import type { FocusSession } from '../types';

const DAY = 86_400_000;

/** All scheduled nodes across the workspace (open maps + on-disk .mind files) —
 *  shares the "오늘" view's collector so the two never diverge. */
async function allScheduledNodes(): Promise<ScheduledNode[]> {
  return (await collectAgenda()).map((a) => ({ mapId: a.mapId, nodeId: a.nodeId, text: a.text, scheduleAt: a.scheduleAt }));
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
  const [showAnalysis, setShowAnalysis] = useState(false);
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

  // at-a-glance derivations
  const deltaPct = prevQ.totalSec > 0 ? Math.round(((q.totalSec - prevQ.totalSec) / prevQ.totalSec) * 100) : null;
  const focusDays = useMemo(() => new Set(inP.map((s) => dayKey(s.start))).size, [inP]);
  const warns = useMemo(() => tips.filter((t) => t.tone === 'warn'), [tips]);
  const weekLabel = periodLabel(weekPeriod(now, offset), now);
  const weekDays = useMemo(() => {
    const start = weekPeriod(now, offset).from;
    return ['월', '화', '수', '목', '금', '토', '일'].map((dow, i) => {
      const from = start + i * DAY;
      const key = dayKey(from);
      const sec = counted.reduce((a, s) => a + (dayKey(s.start) === key ? s.durationSec : 0), 0);
      return { from, key, sec, dow, future: from > now };
    });
  }, [offset, counted, now]);
  const weekMax = Math.max(1, ...weekDays.map((d) => d.sec));
  const gotoWeek = (delta: number) => { setDay(null); setExpanded(null); setOffset((o) => Math.min(0, o + delta)); };

  const openNote = (s: FocusSession) => {
    const m = noteIndex.find((n) => n.session?.sessionId === s.sessionId);
    if (m) { void openSessionNote(m.path); close(); }
  };
  return (
    <div className="wh-backdrop" onMouseDown={close}>
      <div className="wh" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wh-head">
          <span className="wh-title">돌아보기</span>
          <div className="wh-nav">
            <button className="wh-nav-btn" title="이전 주" onClick={() => gotoWeek(-1)}><Icon name="chevronLeft" /></button>
            <span className="wh-period">{weekLabel}</span>
            <button className="wh-nav-btn" title="다음 주" disabled={offset >= 0} onClick={() => gotoWeek(1)}><Icon name="chevronRight" /></button>
          </div>
          <button className="wh-close" title="닫기 (Esc)" onClick={close}><Icon name="close" /></button>
        </div>

        {counted.length === 0 ? (
          <div className="wh-empty">
            아직 집중 기록이 없어요.<br />
            노드에서 <b>“집중 세션 시작”</b>으로 첫 기록을 남겨보세요.
          </div>
        ) : (
          <div className="wh-body">
            {/* HERO — the 3-second read */}
            <div className="wh-hero">
              <div className="wh-hero-top">
                <span className="wh-hero-label">
                  {periodLabel(period, now)} 집중
                  {day != null && <button className="wh-hero-back" onClick={() => setDay(null)}>주 전체 보기</button>}
                </span>
                {deltaPct != null && Math.abs(deltaPct) >= 5 && (
                  <span className={`wh-hero-delta ${deltaPct >= 0 ? 'up' : 'down'}`}>
                    {deltaPct >= 0 ? '↑' : '↓'} 지난 {period.kind === 'week' ? '주' : '날'}보다 {deltaPct > 0 ? '+' : ''}{deltaPct}%
                  </span>
                )}
              </div>
              <div className="wh-hero-num">{fmtDuration(q.totalSec)}</div>
              <div className="wh-hero-stats">
                <span>딥워크 <b>{q.deepWorkCount}</b>회</span>
                <span className="wh-dot" />
                {period.kind === 'week'
                  ? <span>집중 <b>{focusDays}</b>일</span>
                  : <span><b>{q.count}</b>세션</span>}
                <span className="wh-dot" />
                <span>최장 <b>{fmtDuration(q.longestSec)}</b></span>
              </div>
            </div>

            {/* WEEK STRIP — the week at a glance, click a day to drill in */}
            <div className="wh-week">
              {weekDays.map((d) => {
                const sel = day != null && d.key === dayKey(day);
                const today = d.key === dayKey(now);
                return (
                  <button
                    key={d.key}
                    className={`wh-wday${sel ? ' sel' : ''}${today ? ' today' : ''}`}
                    disabled={d.future}
                    title={d.sec ? fmtDuration(d.sec) : '집중 없음'}
                    onClick={() => setDay(sel ? null : d.from)}
                  >
                    <span className="wh-wbar-wrap">
                      <span className="wh-wbar" style={{ height: d.sec ? `${Math.max(10, Math.round((d.sec / weekMax) * 100))}%` : '0' }} />
                    </span>
                    <span className="wh-wdow">{d.dow}</span>
                  </button>
                );
              })}
            </div>

            {/* FLAGS — only what needs attention */}
            {warns.length > 0 && (
              <div className="wh-flags">
                {warns.slice(0, 2).map((t, i) => <div key={i} className="wh-flag">{t.text}</div>)}
              </div>
            )}

            {/* NARRATIVE — what you actually did */}
            <div className="wh-narrative">
              <div className="wh-narr-head">
                <span className="wh-narr-title">무엇을 했나{filter && ` · 「${filter.label}」`}</span>
                {filter && <button className="wh-link" onClick={() => setFilter(null)}>← 전체</button>}
              </div>
              {byDay.length === 0 ? (
                <div className="wh-noday">이 기간에 집중 기록이 없어요.</div>
              ) : (
                byDay.map(([d, list]) => (
                  <div className="wh-day" key={d}>
                    <div className="wh-day-head">
                      <span className="wh-day-label">{dayLabel(d)}</span>
                      <span className="wh-day-total">{fmtDuration(list.reduce((a, s) => a + s.durationSec, 0))}</span>
                    </div>
                    {list.map((s) => (
                      <div key={s.sessionId} className={`wh-entry-wrap${expanded === s.sessionId ? ' open' : ''}`}>
                        <button className="wh-entry" onClick={() => setExpanded(expanded === s.sessionId ? null : s.sessionId)}>
                          <span className="wh-entry-time">{hm(s.start)}</span>
                          <span className="wh-entry-topic">{s.link.nodeText || '노드'}</span>
                          <span className="wh-entry-outcome">
                            {s.reflect || <span className="wh-entry-noreflect">— 성과 미기록</span>}
                          </span>
                          <span className="wh-entry-dur">{fmtDuration(s.durationSec)}</span>
                        </button>
                        {expanded === s.sessionId && (
                          <div className="wh-entry-detail">
                            <div className="wh-detail-row"><span className="wh-detail-k">🎯 목표</span><span className="wh-detail-v">{s.goal || <i>(미기록)</i>}</span></div>
                            <div className="wh-detail-row"><span className="wh-detail-k">✅ 성과</span><span className="wh-detail-v">{s.reflect || <i>(미기록)</i>}</span></div>
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

            {/* ANALYSIS — drill deeper, collapsed by default */}
            <div className="wh-analysis">
              <button className="wh-analysis-toggle" onClick={() => setShowAnalysis((v) => !v)}>
                <Icon name={showAnalysis ? 'chevronDown' : 'chevronRight'} />
                분석 — 주제별 · 마감 대조 · 시간대 · 추세
              </button>
              {showAnalysis && (
                <div className="wh-analysis-body">
                  {topics.length > 0 && (
                    <div className="wh-panel">
                      <div className="wh-section-label">주제별 집중 (하위 포함)</div>
                      {topics.slice(0, 8).map((t) => (
                        <button
                          key={`${t.mapId} ${t.nodeId}`}
                          className={`wh-topic${filter?.nodeId === t.nodeId ? ' on' : ''}`}
                          title="이 주제의 기록만 보기"
                          onClick={() => setFilter(filter?.nodeId === t.nodeId ? null : { mapId: t.mapId, nodeId: t.nodeId, label: t.label || '(이름 없음)' })}
                        >
                          <span className="wh-topic-label">{t.label || '(이름 없음)'}</span>
                          <span className="wh-topic-bar"><span className="wh-topic-fill" style={{ width: `${Math.round((t.rolledSec / (topics[0]?.rolledSec || 1)) * 100)}%` }} /></span>
                          <span className="wh-topic-val">{fmtDuration(t.rolledSec)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {schedLoading ? (
                    <div className="wh-panel"><div className="wh-section-label">마감 vs 실제 집중</div><div className="wh-prio-none">마감 불러오는 중…</div></div>
                  ) : priority.length > 0 && (
                    <div className="wh-panel">
                      <div className="wh-section-label">마감 vs 실제 집중</div>
                      {priority.slice(0, 6).map((p) => (
                        <div key={`${p.mapId} ${p.nodeId}`} className={`wh-prio${p.flagged ? ' risk' : ''}`}>
                          <span className="wh-prio-label">{p.label}</span>
                          <span className="wh-prio-due">{p.dueInDays < 0 ? `${-p.dueInDays}일 지남` : p.dueInDays === 0 ? '오늘' : `D-${p.dueInDays}`}</span>
                          <span className="wh-prio-focus">{p.focusSec > 0 ? fmtDuration(p.focusSec) : '0분'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="wh-panel">
                    <div className="wh-section-label">집중의 질</div>
                    <div className="wh-qrow"><span>평균 세션</span><b>{fmtDuration(q.avgSec)}</b></div>
                    <div className="wh-qrow"><span>딥워크(50분+)</span><b>{q.deepWorkCount}회</b></div>
                    <div className="wh-hours" title="시간대별 집중(0–23시)">
                      {q.byHour.map((sec, h) => (
                        <span key={h} className="wh-hour" style={{ height: `${Math.max(2, Math.round((sec / Math.max(1, ...q.byHour)) * 22))}px` }} title={`${h}시 · ${fmtDuration(sec)}`} />
                      ))}
                    </div>
                    <div className="wh-hours-axis" aria-hidden="true"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>
                  </div>
                  <div className="wh-panel">
                    <div className="wh-section-label">주별 추세 (8주)</div>
                    <div className="wh-trend">
                      {trend.map((t, i) => (
                        <span key={i} className={`wh-trend-bar${i === trend.length - 1 + offset ? ' on' : ''}`}
                          style={{ height: `${Math.max(3, Math.round((t.sec / maxTrend) * 40))}px` }}
                          title={fmtDuration(t.sec)}
                          onClick={() => gotoWeek(i - (trend.length - 1) - offset)} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
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
