import { describe, it, expect, beforeEach } from 'vitest';
import { pushOverlay, removeOverlay, useUi, type OverlayId } from './uiStore';

// 관리형 오버레이 스택(ADR 0018) — 순수 헬퍼 + store 뮤테이션이 boolean과 스택을
// 한 set 안에서 동기 갱신하는지. Esc 한 단계 복귀와 z-order가 이 스택에 달려 있다.

describe('pushOverlay / removeOverlay (pure helpers)', () => {
  it('appends to the top', () => {
    expect(pushOverlay([], 'settings')).toEqual(['settings']);
    expect(pushOverlay(['settings'], 'recent')).toEqual(['settings', 'recent']);
  });

  it('re-pushing an existing id moves it to the top (no duplicates)', () => {
    expect(pushOverlay(['settings', 'recent'], 'settings')).toEqual(['recent', 'settings']);
  });

  it('removes only the given id, keeping the rest in order', () => {
    expect(removeOverlay(['settings', 'recent', 'manual'], 'recent')).toEqual(['settings', 'manual']);
    expect(removeOverlay(['settings'], 'recent')).toEqual(['settings']);
    expect(removeOverlay([], 'settings')).toEqual([]);
  });

  it('does not mutate the input stack', () => {
    const stack: OverlayId[] = ['settings'];
    pushOverlay(stack, 'recent');
    removeOverlay(stack, 'settings');
    expect(stack).toEqual(['settings']);
  });
});

describe('uiStore overlay mutations', () => {
  beforeEach(() => {
    useUi.getState().closeAllOverlays();
  });

  it('open* sets the boolean and pushes onto the stack in one action', () => {
    useUi.getState().openSettings();
    useUi.getState().openRecent();
    const s = useUi.getState();
    expect(s.settingsOpen).toBe(true);
    expect(s.recentOpen).toBe(true);
    expect(s.overlayStack).toEqual(['settings', 'recent']);
  });

  it('close* clears the boolean and removes from the stack, leaving the rest', () => {
    useUi.getState().openSettings();
    useUi.getState().openManual();
    useUi.getState().closeManual();
    const s = useUi.getState();
    expect(s.manualOpen).toBe(false);
    expect(s.settingsOpen).toBe(true);
    expect(s.overlayStack).toEqual(['settings']);
  });

  it('re-opening an open overlay raises it to the top', () => {
    useUi.getState().openSettings();
    useUi.getState().openTrash();
    useUi.getState().openSettings();
    expect(useUi.getState().overlayStack).toEqual(['trash', 'settings']);
  });

  it('openVersions/closeVersions keep versionsPath in sync with the stack', () => {
    useUi.getState().openVersions('/tmp/a.mind');
    expect(useUi.getState().versionsPath).toBe('/tmp/a.mind');
    expect(useUi.getState().overlayStack).toEqual(['versions']);
    useUi.getState().closeVersions();
    expect(useUi.getState().versionsPath).toBeNull();
    expect(useUi.getState().overlayStack).toEqual([]);
  });

  it('closeAllOverlays clears every boolean, the stack, and versionsPath', () => {
    const st = useUi.getState();
    st.openHistory();
    st.openTrash();
    st.openVersions('/tmp/a.mind');
    st.openTemplates();
    st.openRecent();
    st.openFavorites();
    st.openUpdates();
    st.openSettings();
    st.openManual();
    expect(useUi.getState().overlayStack).toHaveLength(9);
    useUi.getState().closeAllOverlays();
    const s = useUi.getState();
    expect(s.overlayStack).toEqual([]);
    expect(s.historyOpen).toBe(false);
    expect(s.trashOpen).toBe(false);
    expect(s.versionsOpen).toBe(false);
    expect(s.versionsPath).toBeNull();
    expect(s.templatesOpen).toBe(false);
    expect(s.recentOpen).toBe(false);
    expect(s.favoritesOpen).toBe(false);
    expect(s.updatesOpen).toBe(false);
    expect(s.settingsOpen).toBe(false);
    expect(s.manualOpen).toBe(false);
  });

  it('closeAllOverlays leaves whatsNew alone (out of the stack)', () => {
    useUi.getState().setWhatsNew('9.9.9');
    useUi.getState().openSettings();
    useUi.getState().closeAllOverlays();
    expect(useUi.getState().whatsNew).toBe('9.9.9');
    useUi.getState().setWhatsNew(null);
  });
});
