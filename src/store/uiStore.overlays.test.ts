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

  it('공유 패널·다이얼로그도 같은 스택 규칙을 따른다 (Esc는 위에서부터 한 단계씩)', () => {
    const st = useUi.getState();
    st.openShare('room-AAAAAAAA', { code: 'ABCD2345', expiresAt: 5 });
    st.openShareJoin();
    let s = useUi.getState();
    expect(s.overlayStack).toEqual(['share', 'shareDialog']);
    expect(s.shareRoomId).toBe('room-AAAAAAAA');
    expect(s.shareInvite).toEqual({ code: 'ABCD2345', expiresAt: 5 });
    expect(s.shareDialog).toEqual({ kind: 'join' });
    s.closeShareDialog();
    s = useUi.getState();
    expect(s.shareDialog).toBeNull();
    expect(s.overlayStack).toEqual(['share']);
    s.closeShare();
    s = useUi.getState();
    expect(s.shareOpen).toBe(false);
    expect(s.shareRoomId).toBeNull();
    expect(s.shareInvite).toBeNull(); // 초대 코드는 패널을 닫으면 메모리에서도 사라진다
    expect(s.overlayStack).toEqual([]);
  });

  it('openShareCreate는 폴더를 미리 정했는지 여부를 담는다', () => {
    useUi.getState().openShareCreate('/ws/team');
    expect(useUi.getState().shareDialog).toEqual({ kind: 'create', folderPath: '/ws/team' });
    useUi.getState().openShareCreate(null);
    expect(useUi.getState().shareDialog).toEqual({ kind: 'create', folderPath: null });
    expect(useUi.getState().overlayStack).toEqual(['shareDialog']); // 다시 열어도 중복되지 않는다
  });

  it('closeAllOverlays는 공유 패널·다이얼로그·초대 코드도 정리한다', () => {
    const st = useUi.getState();
    st.openShare('room-AAAAAAAA', { code: 'ABCD2345', expiresAt: 5 });
    st.openShareCreate('/ws/team');
    useUi.getState().closeAllOverlays();
    const s = useUi.getState();
    expect(s.shareOpen).toBe(false);
    expect(s.shareRoomId).toBeNull();
    expect(s.shareInvite).toBeNull();
    expect(s.shareDialog).toBeNull();
    expect(s.overlayStack).toEqual([]);
  });

  it('closeAllOverlays leaves whatsNew alone (out of the stack)', () => {
    useUi.getState().setWhatsNew('9.9.9');
    useUi.getState().openSettings();
    useUi.getState().closeAllOverlays();
    expect(useUi.getState().whatsNew).toBe('9.9.9');
    useUi.getState().setWhatsNew(null);
  });
  it('알림 센터도 같은 스택 규칙을 따르고, 목적 달성(closeAllOverlays)으로 함께 닫힌다', () => {
    const st = useUi.getState();
    st.openSettings();
    st.openNotifications();
    let s = useUi.getState();
    expect(s.notificationsOpen).toBe(true);
    expect(s.overlayStack).toEqual(['settings', 'notifications']);
    s.closeNotifications(); // Esc는 맨 위(알림 센터)만 닫고 설정으로 돌아온다
    s = useUi.getState();
    expect(s.notificationsOpen).toBe(false);
    expect(s.overlayStack).toEqual(['settings']);
    s.openNotifications();
    useUi.getState().closeAllOverlays(); // 알림을 눌러 해당 위치로 떠날 때
    s = useUi.getState();
    expect(s.notificationsOpen).toBe(false);
    expect(s.overlayStack).toEqual([]);
  });

  it('코멘트 스레드는 관리형 오버레이가 아니라 스택에 들어가지 않는다', () => {
    const st = useUi.getState();
    st.openCommentThread('room-abcdef12', { kind: 'note', noteId: 'note-1' });
    expect(useUi.getState().commentThread).toEqual({ roomId: 'room-abcdef12', anchor: { kind: 'note', noteId: 'note-1' } });
    expect(useUi.getState().overlayStack).toEqual([]);
    useUi.getState().closeCommentThread();
    expect(useUi.getState().commentThread).toBeNull();
  });
});
