import { useEffect } from 'react';
import { useStore } from 'zustand';
import { useSession } from '../store/sessionStore';
import { useWorkspace } from '../store/workspaceStore';
import { useUi } from '../store/uiStore';
import type { MapStore } from '../store/mapStore';

// One-time nudges toward Tier-2 features the moment their trigger condition is
// first met (IA-STRATEGY-2026-07.md §3/§5-6) — each fires at most once ever,
// mirroring the existing `focusCoachShown` localStorage-flag convention
// (src/focus/controller.ts) rather than inventing a new one.
const shown = (key: string): boolean => localStorage.getItem(`nudge:${key}:shown`) === '1';
const markShown = (key: string): void => localStorage.setItem(`nudge:${key}:shown`, '1');

/** Renders nothing. Mounted once at the app root; watches cross-cutting
 *  session/workspace signals and offers a single toast nudge each. */
export function GrowthNudges() {
  const tabs = useSession((s) => s.tabs);
  const leftActive = useSession((s) => s.leftActive);
  const rightActive = useSession((s) => s.rightActive);
  const activeGroup = useSession((s) => s.activeGroup);
  const split = useSession((s) => s.split);
  const effectiveGroup = split ? activeGroup : 0;
  const leftTab = tabs.find((t) => t.id === leftActive) ?? null;
  const rightTab = tabs.find((t) => t.id === rightActive) ?? null;
  const activeTab = effectiveGroup === 1 ? rightTab : leftTab;

  // ── 5개 이상 탭이 열리면 → 화면 분할 제안 ──
  useEffect(() => {
    if (tabs.length >= 5 && !shown('split')) {
      markShown('split');
      useUi.getState().toastAction('탭이 많아졌어요 — 화면을 나눠서 볼까요?', '분할하기', () => {
        useSession.getState().toggleSplit();
      });
    }
  }, [tabs.length]);

  // ── 제목이 비슷한 노트가 3개 이상 생기면(예: "회의록 …") → 노트 템플릿 제안 ──
  // "제목 없음"(기본값) 계열은 실제 반복 패턴이 아니라 그냥 안 지은 제목이므로 제외.
  const noteIndex = useWorkspace((s) => s.noteIndex);
  useEffect(() => {
    if (shown('note-template')) return;
    const counts = new Map<string, number>();
    for (const n of noteIndex) {
      const title = n.title.trim();
      if (/^제목 없음(\s+\d+)?$/.test(title)) continue;
      const prefix = title.split(/\s+/)[0];
      if (!prefix) continue;
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
    if ([...counts.values()].some((c) => c >= 3)) {
      markShown('note-template');
      useUi.getState().toastAction(
        '비슷한 노트를 여러 번 쓰고 계시네요 — 템플릿으로 저장해둘까요?',
        '템플릿 보기',
        () => useUi.getState().openTemplates(),
      );
    }
  }, [noteIndex]);

  return activeTab?.kind === 'map' ? <ScheduleNudge store={activeTab.store as MapStore} /> : null;
}

/** 열려 있는 맵 하나에 일정이 걸린 노드가 3개 이상 쌓이면 → 리마인더 동기화 제안. */
function ScheduleNudge({ store }: { store: MapStore }) {
  const scheduledCount = useStore(store, (s) =>
    Object.values(s.doc.nodes).filter((n) => n.scheduled).length,
  );
  useEffect(() => {
    if (scheduledCount >= 3 && !shown('reminders')) {
      markShown('reminders');
      useUi.getState().toastAction(
        '일정이 걸린 노드가 늘고 있어요 — 리마인더 앱과 동기화해서 놓치지 않게 할까요?',
        '설정 열기',
        () => useUi.getState().openSettings(),
      );
    }
  }, [scheduledCount]);
  return null;
}
