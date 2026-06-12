import { useEffect, useMemo, useState } from 'react';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import { useSession } from '../store/sessionStore';
import type { MapStore } from '../store/mapStore';
import { Icon } from '../ui/Icon';
import { openSessionNote } from './controller';
import { dayKey, fmtDuration, isCounted } from './aggregate';
import {
  weekPeriod, dayPeriod, periodSessions, periodLabel, quality, weeklyTrend,
  priorityVsActual, insights, buildReportMarkdown, type Period, type ScheduledNode,
} from './report';
import { serializeNote, emptyNote } from '../io/noteFormat';
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

export function WorkHistory() {
  const close = useUi((s) => s.closeHistory);
  const noteIndex = useWorkspace((s) => s.noteIndex);
  const now = Date.now();
  const [offset, setOffset] = useState(0); // 0 = this week, -1 = last week, …
  const [day, setDay] = useState<number | null>(null); // a drilled-in day (epoch ms) or null
  const [scheduled, setScheduled] = useState<ScheduledNode[]>([]);
  useEffect(() => {
    let alive = true;
    void allScheduledNodes().then((s) => alive && setScheduled(s));
    return () => { alive = false; };
  }, []);

  const period: Period = useMemo(
    () => (day != null ? dayPeriod(day) : weekPeriod(now, offset)),
    [day, offset, now],
  );

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (day != null) setDay(null);
      else close();
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [close, day]);

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
  const byDay = useMemo(() => groupByDay([...inP].sort((a, b) => b.start - a.start)), [inP]);
  const maxTrend = Math.max(1, ...trend.map((t) => t.sec));

  const openNote = (s: FocusSession) => {
    const m = noteIndex.find((n) => n.session?.sessionId === s.sessionId);
    if (m) { void openSessionNote(m.path); close(); }
  };
  const exportReport = async () => {
    const md = buildReportMarkdown(period, now, q, byDay.map(([d, list]) => ({ day: dayLabel(d), sessions: list })));
    const root = useWorkspace.getState().root;
    const title = `작업 요약 ${periodLabel(period, now)}`;
    const path = await window.api.createFile(root, title, serializeNote({ ...emptyNote(title), body: md }), '.md');
    await useWorkspace.getState().refresh();
    try { useSession.getState().openInRight(path, await window.api.readFile(path)); } catch { /* ignore */ }
    close();
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
                  <span className="wh-section-label">작업 일지 — 무엇을 끝냈나</span>
                  <button className="wh-export" onClick={() => void exportReport()}>요약 노트로 내보내기</button>
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
                        <button key={s.sessionId} className="wh-entry" onClick={() => openNote(s)}>
                          <span className="wh-entry-time">{hm(s.start)}</span>
                          <span className="wh-entry-dur">{fmtDuration(s.durationSec)}</span>
                          <span className="wh-entry-topic">{s.link.nodeText || '노드'}</span>
                          <span className="wh-entry-outcome">
                            {s.reflect || <span className="wh-entry-noreflect">— 성과 미기록</span>}
                          </span>
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>

              <div className="wh-side">
                {/* priority vs actual */}
                {priority.length > 0 && (
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
