import { useEffect, useState } from 'react';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import { Icon } from '../ui/Icon';
import { fmtDuration } from './aggregate';
import { endFocusSession, openSessionNote, attachReflection, confirmFocusStart, cancelFocusStart } from './controller';

const NUDGE_SEC = 4 * 3600; // gently remind to end after this long (still running)

function elapsedClock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

/**
 * The running-session pill. Two presentations of the SAME thing:
 *  - `docked`  — lives inside the sidebar foot (part of the sidebar) when it's open
 *  - floating  — a fixed bottom-left pill when the sidebar is collapsed
 * Returns null when no session is running.
 */
export function FocusPill({ docked }: { docked?: boolean }) {
  const active = useUi((s) => s.activeFocus);
  const [now, setNow] = useState(Date.now());
  // Docked (sidebar foot) starts collapsed to an ambient timer — the sidebar
  // is a busy strip and the running session recedes into the background once
  // acknowledged, like a macOS Focus mode (REDESIGN-VISION §3-8). Floating
  // (sidebar hidden) is the session's only visible control, so it stays full.
  const [expanded, setExpanded] = useState(!docked);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  if (!active) return null;

  const elapsedSec = Math.max(0, Math.round((now - active.start) / 1000));
  const long = elapsedSec >= NUDGE_SEC; // running unusually long — gentle reminder (B9)
  const nudge = '장시간 집중 중이에요 — 종료를 잊지 않으셨나요?';

  if (docked && !expanded) {
    return (
      <button
        className={`focus-pill docked collapsed${long ? ' long' : ''}`}
        title={`집중 중 · ${active.nodeText} · ${elapsedClock(elapsedSec)}`}
        onClick={() => setExpanded(true)}
      >
        <span className="focus-dot" />
        <span className="focus-elapsed">{elapsedClock(elapsedSec)}</span>
      </button>
    );
  }

  return (
    <div className={`focus-pill${docked ? ' docked' : ' floating'}${long ? ' long' : ''}`}>
      <span className="focus-dot" title={long ? nudge : undefined} />
      <span className="focus-elapsed">{elapsedClock(elapsedSec)}</span>
      <button className="focus-node" title="세션 노트 열기" onClick={() => void openSessionNote(active.notePath)}>
        {active.nodeText}
      </button>
      {long && <span className="focus-nudge" title={nudge}>아직 집중 중?</span>}
      <button className="focus-end" onClick={() => void endFocusSession()}>
        종료
      </button>
      {docked && (
        <button className="focus-collapse" title="접기" onClick={() => setExpanded(false)}>
          <Icon name="chevronDown" />
        </button>
      )}
    </div>
  );
}

/** Mounted globally: the goal prompt + floating pill (sidebar hidden) + completion card. */
export function FocusOverlay({ sidebarVisible }: { sidebarVisible: boolean }) {
  const done = useUi((s) => s.focusDone);
  const prompt = useUi((s) => s.focusPrompt);
  return (
    <>
      {prompt && <FocusStartCard nodeText={prompt.nodeText} />}
      {!sidebarVisible && <FocusPill />}
      {done && <FocusCompletionCard />}
    </>
  );
}

/** Opening ritual: capture the session's ONE goal up front (structured, skippable)
 *  so goal → process → result is measurable without relying on a note template. */
function FocusStartCard({ nodeText }: { nodeText: string }) {
  const [goal, setGoal] = useState('');
  const start = () => void confirmFocusStart(goal); // blank → starts without a goal
  return (
    <div className="focus-done-backdrop" onMouseDown={cancelFocusStart}>
      <div className="focus-start" onMouseDown={(e) => e.stopPropagation()}>
        <div className="focus-start-head">
          <span className="focus-start-title">집중 세션</span>
          <span className="focus-start-sub">「{nodeText}」</span>
        </div>
        <input
          className="focus-done-reflect"
          autoFocus
          placeholder="이번 세션에 집중할 한 가지 (선택)"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') start();
            if (e.key === 'Escape') cancelFocusStart();
          }}
        />
        <div className="focus-start-actions">
          <span className="focus-start-hint">Enter 시작 · 비워도 시작</span>
          <button className="focus-done-ok focus-start-go" onClick={start}>시작</button>
        </div>
      </div>
    </div>
  );
}

/** Closure ritual: shows the "쌓임" right after ending + captures a one-line
 *  outcome by default (skippable) — the reward that closes the habit loop (§14-C/D). */
function FocusCompletionCard() {
  const done = useUi((s) => s.focusDone)!;
  const close = () => useUi.getState().setFocusDone(null);
  const [reflect, setReflect] = useState('');

  const finish = () => {
    if (reflect.trim()) {
      void attachReflection(done.notePath, reflect).then(() => useWorkspace.getState().refresh());
    }
    close();
  };

  return (
    <div className="focus-done-backdrop" onMouseDown={finish}>
      <div className="focus-done" onMouseDown={(e) => e.stopPropagation()}>
        <div className="focus-done-head">
          <span className="focus-done-big">{fmtDuration(done.durationSec)}</span>
          <span className="focus-done-sub">집중 완료 · 「{done.nodeText}」</span>
        </div>
        <div className="focus-done-stats">
          <Stat label="오늘 누적" value={fmtDuration(done.todaySec)} />
          <Stat label="최근 7일" value={`${done.focusDays7}일 집중`} />
          <Stat label="이 주제 누적" value={fmtDuration(done.nodeRolledSec)} />
        </div>
        {done.goal && (
          <div className="focus-done-goal">
            <span className="focus-done-goal-k">🎯 목표였던 것</span>
            <span className="focus-done-goal-v">{done.goal}</span>
          </div>
        )}
        <input
          className="focus-done-reflect"
          autoFocus
          placeholder={done.goal ? '그래서, 됐나요? 성과 한 줄 (선택)' : '이번 세션 성과 한 줄 — 무엇을 끝냈나? (선택)'}
          value={reflect}
          onChange={(e) => setReflect(e.target.value)}
          onKeyDown={(e) => {
            // both Enter and Escape commit — never silently discard a typed outcome (B3)
            if (e.key === 'Enter' || e.key === 'Escape') finish();
          }}
        />
        <div className="focus-done-actions">
          <button className="focus-done-ok" onClick={finish}>
            완료
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="focus-done-stat">
      <span className="focus-done-stat-v">{value}</span>
      <span className="focus-done-stat-l">{label}</span>
    </div>
  );
}
