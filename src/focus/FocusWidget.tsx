import { useEffect, useState } from 'react';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import { fmtDuration } from './aggregate';
import { endFocusSession, openSessionNote, attachReflection } from './controller';

function elapsedClock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

/**
 * The running-session pill. Anchored bottom-left: docked at the sidebar foot
 * when the sidebar shows, floating in the same spot when it's hidden — so the
 * timer is always visible (you hide the sidebar *to* focus) and never jumps (§7).
 */
export function FocusWidget({ sidebarVisible }: { sidebarVisible: boolean }) {
  const active = useUi((s) => s.activeFocus);
  const done = useUi((s) => s.focusDone);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  return (
    <>
      {active && (
        <div className={`focus-pill${sidebarVisible ? ' docked' : ' floating'}`}>
          <span className="focus-dot" />
          <span className="focus-elapsed">{elapsedClock(Math.max(0, Math.round((now - active.start) / 1000)))}</span>
          <button
            className="focus-node"
            title="세션 노트 열기"
            onClick={() => void openSessionNote(active.notePath)}
          >
            {active.nodeText}
          </button>
          <button className="focus-end" onClick={() => void endFocusSession()}>
            종료
          </button>
        </div>
      )}
      {done && <FocusCompletionCard />}
    </>
  );
}

/** Closure ritual: shows the "쌓임" right after ending + captures a one-line
 *  reflection by default (skippable) — the reward that closes the habit loop (§14-C/D). */
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
          <Stat label="연속" value={`🔥 ${done.streak}일`} />
          <Stat label="이 주제 누적" value={fmtDuration(done.nodeRolledSec)} />
        </div>
        <input
          className="focus-done-reflect"
          autoFocus
          placeholder="방금 뭐가 풀렸나? 다음 시작점은? (선택)"
          value={reflect}
          onChange={(e) => setReflect(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finish();
            if (e.key === 'Escape') close();
          }}
        />
        <div className="focus-done-actions">
          <button className="focus-done-open" onClick={() => { void openSessionNote(done.notePath); finish(); }}>
            세션 노트 열기
          </button>
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
