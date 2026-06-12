import { useEffect, useMemo, useState } from 'react';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import { useSession } from '../store/sessionStore';
import type { MapStore } from '../store/mapStore';
import { Icon } from '../ui/Icon';
import { openSessionNote } from './controller';
import { dayKey, fmtDuration, isCounted, perNode, type LiveResolver } from './aggregate';
import {
  weekPeriod, dayPeriod, periodSessions, periodLabel, quality, weeklyTrend, insights, type Period,
} from './report';
import type { FocusSession } from '../types';

const DAY = 86_400_000;
type Scope = 'day' | 'week';

function openMaps(): MapStore[] {
  return useSession.getState().tabs.filter((t) => t.kind === 'map').map((t) => t.store as MapStore);
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
  const today = dayPeriod(now).from;
  const [scope, setScope] = useState<Scope>('day'); // default: today
  const [dayMs, setDayMs] = useState(today);
  const [weekOffset, setWeekOffset] = useState(0);
  const [filter, setFilter] = useState<{ mapId: string; nodeId: string; label: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);

  const period: Period = useMemo(
    () => (scope === 'day' ? dayPeriod(dayMs) : weekPeriod(now, weekOffset)),
    [scope, dayMs, weekOffset, now],
  );
  const prevPeriod: Period = useMemo(
    () => (scope === 'day' ? dayPeriod(dayMs - DAY) : weekPeriod(now, weekOffset - 1)),
    [scope, dayMs, weekOffset, now],
  );

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (expanded) setExpanded(null);
      else if (filter) setFilter(null);
      else close();
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [close, filter, expanded]);

  const sessions = useMemo(
    () => noteIndex.map((m) => m.session).filter((s): s is FocusSession => !!s),
    [noteIndex],
  );
  const counted = useMemo(() => sessions.filter(isCounted), [sessions]);
  const inP = useMemo(() => periodSessions(sessions, period), [sessions, period]);
  const q = useMemo(() => quality(inP), [inP]);
  const prevQ = useMemo(() => quality(periodSessions(sessions, prevPeriod)), [sessions, prevPeriod]);
  // no priority/deadline here — that's planning, it lives in the "오늘" view
  const tips = useMemo(() => insights(period, q, prevQ, [], now), [period, q, prevQ, now]);
  const trend = useMemo(() => weeklyTrend(sessions, now, 8), [sessions, now]);
  const topics = useMemo(
    () => [...perNode(inP, liveResolver).values()].filter((t) => t.selfSec > 0 || t.rolledSec > 0).sort((a, b) => b.rolledSec - a.rolledSec),
    [inP],
  );
  const diary = useMemo(() => {
    const list = filter
      ? inP.filter((s) => s.link.mapId === filter.mapId && (s.link.nodeId === filter.nodeId || inSubtree(filter.mapId, filter.nodeId, s.link.nodeId)))
      : inP;
    return [...list].sort((a, b) => b.start - a.start);
  }, [inP, filter]);
  const byDay = useMemo(() => groupByDay(diary), [diary]);
  const maxTrend = Math.max(1, ...trend.map((t) => t.sec));

  const deltaPct = prevQ.totalSec > 0 ? Math.round(((q.totalSec - prevQ.totalSec) / prevQ.totalSec) * 100) : null;
  const focusDays = useMemo(() => new Set(inP.map((s) => dayKey(s.start))).size, [inP]);
  const calmInsights = tips.slice(1); // tips[0] is the total — the hero already shows it
  const weekDays = useMemo(() => {
    const start = weekPeriod(now, weekOffset).from;
    return ['월', '화', '수', '목', '금', '토', '일'].map((dow, i) => {
      const from = start + i * DAY;
      const key = dayKey(from);
      const sec = counted.reduce((a, s) => a + (dayKey(s.start) === key ? s.durationSec : 0), 0);
      return { from, key, sec, dow, future: from > now };
    });
  }, [weekOffset, counted, now]);
  const weekMax = Math.max(1, ...weekDays.map((d) => d.sec));

  // navigation
  const toDay = () => { setScope('day'); setDayMs(today); setFilter(null); setExpanded(null); };
  const toWeek = () => { setScope('week'); setWeekOffset(0); setFilter(null); setExpanded(null); };
  const goPrev = () => { setExpanded(null); scope === 'day' ? setDayMs((d) => d - DAY) : setWeekOffset((o) => o - 1); };
  const goNext = () => { setExpanded(null); scope === 'day' ? setDayMs((d) => Math.min(today, d + DAY)) : setWeekOffset((o) => Math.min(0, o + 1)); };
  const nextDisabled = scope === 'day' ? dayMs >= today : weekOffset >= 0;
  const drillDay = (from: number) => { setScope('day'); setDayMs(from); setFilter(null); setExpanded(null); };

  const openNote = (s: FocusSession) => {
    const m = noteIndex.find((n) => n.session?.sessionId === s.sessionId);
    if (m) { void openSessionNote(m.path); close(); }
  };

  const renderEntry = (s: FocusSession) => (
    <div key={s.sessionId} className={`wh-entry-wrap${expanded === s.sessionId ? ' open' : ''}`}>
      <button className="wh-entry" onClick={() => setExpanded(expanded === s.sessionId ? null : s.sessionId)}>
        <span className="wh-entry-time">{hm(s.start)}</span>
        <span className="wh-entry-topic">{s.link.nodeText || '노드'}</span>
        <span className="wh-entry-outcome">{s.reflect || <span className="wh-entry-noreflect">— 성과 미기록</span>}</span>
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
  );

  return (
    <div className="wh-backdrop" onMouseDown={close}>
      <div className="wh" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wh-head">
          <span className="wh-title">돌아보기</span>
          <div className="seg wh-seg">
            <button className={`seg-btn${scope === 'day' ? ' on' : ''}`} onClick={toDay}>오늘</button>
            <button className={`seg-btn${scope === 'week' ? ' on' : ''}`} onClick={toWeek}>이번 주</button>
          </div>
          <div className="wh-nav">
            <button className="wh-nav-btn" title="이전" onClick={goPrev}><Icon name="chevronLeft" /></button>
            <span className="wh-period">{periodLabel(period, now)}</span>
            <button className="wh-nav-btn" title="다음" disabled={nextDisabled} onClick={goNext}><Icon name="chevronRight" /></button>
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
            {/* HERO — the 3-second read, scoped to the chosen level only */}
            <div className="wh-hero">
              <div className="wh-hero-top">
                <span className="wh-hero-label">{periodLabel(period, now)} 집중</span>
                {deltaPct != null && Math.abs(deltaPct) >= 5 && (
                  <span className={`wh-hero-delta ${deltaPct >= 0 ? 'up' : 'down'}`}>
                    {deltaPct >= 0 ? '↑' : '↓'} 지난 {scope === 'week' ? '주' : '날'}보다 {deltaPct > 0 ? '+' : ''}{deltaPct}%
                  </span>
                )}
              </div>
              <div className="wh-hero-num">{fmtDuration(q.totalSec)}</div>
              <div className="wh-hero-stats">
                <span><b>{q.count}</b>세션</span>
                {scope === 'week' && <><span className="wh-dot" /><span>집중 <b>{focusDays}</b>일</span></>}
                {q.longestSec > 0 && <><span className="wh-dot" /><span>최장 <b>{fmtDuration(q.longestSec)}</b></span></>}
              </div>
            </div>

            {/* WEEK STRIP (week scope only) — click a day to zoom into it */}
            {scope === 'week' && (
              <div className="wh-week">
                {weekDays.map((d) => {
                  const isToday = d.key === dayKey(now);
                  return (
                    <button key={d.key} className={`wh-wday${isToday ? ' today' : ''}`} disabled={d.future}
                      title={d.sec ? fmtDuration(d.sec) : '집중 없음'} onClick={() => drillDay(d.from)}>
                      <span className="wh-wbar-wrap"><span className="wh-wbar" style={{ height: d.sec ? `${Math.max(10, Math.round((d.sec / weekMax) * 100))}%` : '0' }} /></span>
                      <span className="wh-wdow">{d.dow}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* TOPIC FILTER (week scope) — right above the list it filters */}
            {scope === 'week' && topics.length >= 2 && (
              <div className="wh-topics">
                <button className={`wh-chip${!filter ? ' on' : ''}`} onClick={() => setFilter(null)}>전체</button>
                {topics.slice(0, 6).map((t) => (
                  <button key={`${t.mapId} ${t.nodeId}`} className={`wh-chip${filter?.nodeId === t.nodeId ? ' on' : ''}`}
                    onClick={() => setFilter(filter?.nodeId === t.nodeId ? null : { mapId: t.mapId, nodeId: t.nodeId, label: t.label || '(이름 없음)' })}>
                    {t.label || '(이름 없음)'} <span className="wh-chip-val">{fmtDuration(t.rolledSec)}</span>
                  </button>
                ))}
              </div>
            )}

            {/* NARRATIVE — what you actually did (day: flat list / week: by day) */}
            <div className="wh-narrative">
              <div className="wh-narr-head">
                <span className="wh-narr-title">무엇을 했나{filter && ` · 「${filter.label}」`}</span>
              </div>
              {diary.length === 0 ? (
                <div className="wh-noday">{scope === 'day' ? '이 날은 집중 기록이 없어요.' : '이 기간에 집중 기록이 없어요.'}</div>
              ) : scope === 'day' ? (
                diary.map(renderEntry)
              ) : (
                byDay.map(([d, list]) => (
                  <div className="wh-day" key={d}>
                    <div className="wh-day-head">
                      <button className="wh-day-label as-link" onClick={() => drillDay(new Date(d + 'T00:00:00').getTime())} title="이 날만 보기">{dayLabel(d)}</button>
                      <span className="wh-day-total">{fmtDuration(list.reduce((a, s) => a + s.durationSec, 0))}</span>
                    </div>
                    {list.map(renderEntry)}
                  </div>
                ))
              )}
            </div>

            {/* WEEK reflection: calm insights + collapsed analysis */}
            {scope === 'week' && (
              <>
                {calmInsights.length > 0 && (
                  <div className="wh-notes">
                    <div className="wh-section-label">이렇게 일했어요</div>
                    {calmInsights.map((t, i) => <div key={i} className="wh-note">· {t.text}</div>)}
                  </div>
                )}
                <div className="wh-analysis">
                  <button className="wh-analysis-toggle" onClick={() => setShowAnalysis((v) => !v)}>
                    <Icon name={showAnalysis ? 'chevronDown' : 'chevronRight'} />
                    더보기 — 시간대 · 8주 추세
                  </button>
                  {showAnalysis && (
                    <div className="wh-analysis-body">
                      <div className="wh-panel">
                        <div className="wh-section-label">시간대별 집중</div>
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
                            <span key={i} className={`wh-trend-bar read${i === trend.length - 1 + weekOffset ? ' on' : ''}`}
                              style={{ height: `${Math.max(3, Math.round((t.sec / maxTrend) * 40))}px` }} title={fmtDuration(t.sec)} />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
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
