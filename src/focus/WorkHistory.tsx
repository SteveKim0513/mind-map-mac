import { useEffect, useMemo } from 'react';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import { Icon } from '../ui/Icon';
import { revealNode } from '../note/noteLinks';
import { openSessionNote } from './controller';
import { summary, perNode, dailyTotals, dayKey, fmtDuration, isCounted } from './aggregate';
import type { FocusSession } from '../types';

const DAY = 86_400_000;

/** Work-history dashboard: an overlay (not a tab) — opened from the sidebar foot,
 *  the canvas focus chip, or ⌘K. Reads sessions from the workspace note index. */
export function WorkHistory() {
  const close = useUi((s) => s.closeHistory);
  const noteIndex = useWorkspace((s) => s.noteIndex);
  const now = Date.now();
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [close]);

  const sessions = useMemo(
    () => noteIndex.map((m) => m.session).filter((s): s is FocusSession => !!s),
    [noteIndex],
  );
  const counted = useMemo(() => sessions.filter(isCounted), [sessions]);
  const broken = noteIndex.filter((m) => !m.session && /집중/.test(m.title)).length; // best-effort hint

  const sum = useMemo(() => summary(sessions, now), [sessions, now]);
  const daily = useMemo(() => dailyTotals(sessions), [sessions]);
  const nodes = useMemo(
    () => [...perNode(sessions).values()].sort((a, b) => b.rolledSec - a.rolledSec).slice(0, 8),
    [sessions],
  );
  const recent = useMemo(
    () => [...counted].sort((a, b) => b.start - a.start).slice(0, 20),
    [counted],
  );

  // last 17 weeks of day cells (GitHub-grass style), columns = weeks
  const weeks = 17;
  const heat = useMemo(() => buildHeat(daily, now, weeks), [daily, now]);
  const maxDay = Math.max(1, ...[...daily.values()]);

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
            {/* summary strip */}
            <div className="wh-strip">
              <Card big={fmtDuration(sum.todaySec)} label="오늘" />
              <Card big={fmtDuration(sum.weekSec)} label="이번 주" />
              <Card big={`${sum.countToday}회`} label="오늘 세션" />
              <Card big={`🔥 ${sum.streak}일`} label="연속" />
            </div>

            {/* heatmap */}
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
              {/* recent timeline */}
              <div className="wh-timeline">
                <div className="wh-section-label">최근 세션</div>
                {recent.map((s) => (
                  <button
                    key={s.sessionId}
                    className="wh-session"
                    onClick={() => {
                      const m = noteIndex.find((n) => n.session?.sessionId === s.sessionId);
                      if (m) void openSessionNote(m.path);
                    }}
                  >
                    <span className="wh-session-when">{whenLabel(s.start)}</span>
                    <span className="wh-session-dur">{fmtDuration(s.durationSec)}</span>
                    <span
                      className="wh-session-node"
                      onClick={(e) => {
                        e.stopPropagation();
                        void revealNode(s.link);
                      }}
                      title="노드로 이동"
                    >
                      {s.link.nodeText || '노드'}
                    </span>
                    {s.reflect && <span className="wh-session-reflect">{s.reflect}</span>}
                  </button>
                ))}
              </div>

              {/* per-node cumulative */}
              <div className="wh-nodes">
                <div className="wh-section-label">주제별 누적 (하위 포함)</div>
                {nodes.map((n) => (
                  <button
                    key={`${n.mapId} ${n.nodeId}`}
                    className="wh-node"
                    onClick={() => void revealNode({ mapId: n.mapId, nodeId: n.nodeId, nodeText: n.label })}
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

            {broken > 0 && (
              <div className="wh-broken">읽을 수 없는 세션 {broken}건 (파일이 손상됐을 수 있어요)</div>
            )}
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

function level(sec: number, max: number): number {
  if (sec <= 0) return 0;
  const r = sec / max;
  return r > 0.66 ? 4 : r > 0.33 ? 3 : r > 0.1 ? 2 : 1;
}

function buildHeat(daily: Map<string, number>, now: number, weeks: number) {
  // align so the last column ends on today; each column is a week (7 rows)
  const cols: ({ key: string; sec: number } | null)[][] = [];
  const today = new Date(now);
  const dow = today.getDay(); // 0..6
  const totalDays = weeks * 7;
  const startMs = now - (totalDays - 1 - (6 - dow)) * DAY;
  for (let c = 0; c < weeks; c++) {
    const col: ({ key: string; sec: number } | null)[] = [];
    for (let r = 0; r < 7; r++) {
      const ms = startMs + (c * 7 + r) * DAY;
      if (ms > now + DAY) {
        col.push(null);
        continue;
      }
      const key = dayKey(ms);
      col.push({ key, sec: daily.get(key) ?? 0 });
    }
    cols.push(col);
  }
  return cols;
}

function whenLabel(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  const today = dayKey(Date.now());
  const that = dayKey(ms);
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (that === today) return `오늘 ${hm}`;
  if (that === dayKey(Date.now() - DAY)) return `어제 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
