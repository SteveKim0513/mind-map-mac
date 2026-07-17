import { useCallback, useEffect, useRef, useState } from 'react';
import { Sidebar } from './sidebar/Sidebar';
import { TabBar } from './panes/TabBar';
import { Pane } from './panes/Pane';
import { NotePane } from './note/NotePane';
import { NotePopup } from './note/NotePopup';
import { FocusOverlay } from './focus/FocusWidget';
import { WorkHistory } from './focus/WorkHistory';
import { CalendarView } from './calendar/CalendarView';
import { TrashPanel } from './ui/TrashPanel';
import { VersionHistoryPanel } from './ui/VersionHistoryPanel';
import { TemplatePanel } from './ui/TemplatePanel';
import { RecentView } from './ui/RecentView';
import { FavoritesView } from './ui/FavoritesView';
import { UpdatesOverlay, WhatsNewCard } from './ui/Updates';
import { CURRENT_VERSION, isNewer } from './ui/changelog';
import { NoteLinkPicker } from './note/NoteLinkPicker';
import { Home } from './panes/Home';
import { Search } from './search/Search';
import { GlobalSearch } from './search/GlobalSearch';
import { Settings } from './ui/Settings';
import { Manual } from './ui/Manual';
import { UpdateStatus } from './ui/UpdateStatus';
import { Toasts } from './ui/Toasts';
import { GrowthNudges } from './ui/GrowthNudges';
import { QuickOpen } from './ui/QuickOpen';
import { CommandPalette, type Command } from './ui/CommandPalette';
import type { TreeNode } from '../electron/preload';
import { useKeyboard } from './interactions/useKeyboard';
import { startReminderSync } from './sync/reminderSync';
import { startNoteLinkSync } from './note/noteLinks';
import { MapContext, useMap, type MapStore } from './store/mapStore';
import { useSession, loadSessionSnapshot } from './store/sessionStore';
import { useWorkspace } from './store/workspaceStore';
import { useUi, type UpdateStatus as UpdateStatusType } from './store/uiStore';
import type { CanvasHandle } from './canvas/Canvas';
import type { Tab, GroupIndex } from './store/sessionStore';
import {
  serialize,
  emptyDoc,
  toMarkdown,
  fromMarkdown,
  toOpml,
  fromOpml,
} from './io/formats';
import { emptyNote, serializeNote } from './io/noteFormat';
import { requestFocusStart } from './focus/controller';
import { TAG_KEYS, type TagKey } from './theme/palette';

const TAG_LABEL: Record<TagKey, string> = {
  red: '빨강', orange: '주황', yellow: '노랑', green: '초록',
  teal: '청록', violet: '보라', pink: '분홍', brown: '갈색',
};

// Standard Markdown/OPML carry structure + text only — color, schedule, todo
// state and note links have no representation there. Warn once per export so the
// loss is never silent (decision: keep the standard format, inform the user).
const EXPORT_LOSSY_WARNING = '색·일정·완료·노트 링크는 표준 포맷에 포함되지 않습니다.';

export default function App() {
  useKeyboard();

  const tabs = useSession((s) => s.tabs);
  const leftTabs = useSession((s) => s.leftTabs);
  const leftActive = useSession((s) => s.leftActive);
  const rightTabs = useSession((s) => s.rightTabs);
  const rightActive = useSession((s) => s.rightActive);
  const split = useSession((s) => s.split);
  const activeGroup = useSession((s) => s.activeGroup);
  const recent = useSession((s) => s.recent);

  const [sidebarVisible, setSidebarVisible] = useState(true);
  // ⌘K "전체에서 찾기" → ⌘⇧F로 넘어갈 때 이미 입력한 쿼리를 이어받기 위한 중계 상태.
  const [gsInitialQuery, setGsInitialQuery] = useState('');
  const searchOpen = useUi((s) => s.searchOpen);
  const globalSearchOpen = useUi((s) => s.globalSearchOpen);
  const settingsOpen = useUi((s) => s.settingsOpen);
  const manualOpen = useUi((s) => s.manualOpen);
  const quickOpen = useUi((s) => s.quickOpen);
  const cmdkOpen = useUi((s) => s.cmdkOpen);
  const historyOpen = useUi((s) => s.historyOpen);
  const trashOpen = useUi((s) => s.trashOpen);
  const versionsOpen = useUi((s) => s.versionsOpen);
  const templatesOpen = useUi((s) => s.templatesOpen);
  const recentOpen = useUi((s) => s.recentOpen);
  const favoritesOpen = useUi((s) => s.favoritesOpen);
  const updatesOpen = useUi((s) => s.updatesOpen);
  const whatsNew = useUi((s) => s.whatsNew);

  // post-update "what's new": show this version's changes once after an update
  // (not on a fresh install). Top CHANGELOG entry = the running build's version.
  useEffect(() => {
    if (!CURRENT_VERSION) return;
    const seen = localStorage.getItem('lastSeenVersion');
    if (seen && isNewer(CURRENT_VERSION, seen)) useUi.getState().setWhatsNew(CURRENT_VERSION);
    localStorage.setItem('lastSeenVersion', CURRENT_VERSION);
  }, []);
  const wsTree = useWorkspace((s) => s.tree);
  const tabDrag = useUi((s) => s.tabDrag);

  const activeControls = useRef<CanvasHandle | null>(null);

  const effectiveGroup: 0 | 1 = split ? activeGroup : 0;
  const leftTab = tabs.find((t) => t.id === leftActive) ?? null;
  const rightTab = tabs.find((t) => t.id === rightActive) ?? null;
  const activeTab = effectiveGroup === 1 ? rightTab : leftTab;
  const activeStore: MapStore | null =
    activeTab?.kind === 'map' ? (activeTab.store as MapStore) : null;

  // ── File helpers ────────────────────────────────────────────────────────────
  const openByPath = useCallback(async (path: string) => {
    try {
      const content = await window.api.readFile(path);
      useSession.getState().openPath(path, content);
    } catch (err) {
      console.error('open failed', err);
      // If the file is gone, close any stale tab and remove from sidebar
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ENOENT') || msg.includes('no such file')) {
        useSession.getState().closeByPath(path);
        await useWorkspace.getState().refresh();
      } else {
        useUi.getState().toast('파일을 열 수 없습니다 — 권한을 확인하거나 다시 시도해 보세요');
      }
    }
  }, []);

  // Refresh the workspace tree when the window regains focus so external
  // changes made in Finder are reflected without any manual action.
  // IF-04 · also warn if an open map changed on disk under us (iCloud/Dropbox
  // sync, another app or device) — offer a one-tap reload, warning once per
  // distinct external change so it never nags.
  const externalWarnedRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    return window.api.onWorkspaceFocus(() => {
      void useWorkspace.getState().refresh();
      for (const t of useSession.getState().tabs) {
        // Maps AND notes (both back real files) get external-change detection —
        // an open note edited by another app/device used to be silently
        // overwritten by this tab's autosave (calendar has no backing file).
        if ((t.kind !== 'map' && t.kind !== 'note') || !t.path) continue;
        const p = t.path;
        const title = t.title;
        void window.api.externalChange(p).then(({ changed, mtime }) => {
          if (!changed || mtime == null) return;
          if (externalWarnedRef.current.get(p) === mtime) return; // already warned for this change
          externalWarnedRef.current.set(p, mtime);
          useUi.getState().toastAction(
            `"${title}"이(가) 다른 곳에서 바뀌었어요 — 디스크 버전을 불러올까요?`,
            '불러오기',
            () => void useSession.getState().reloadIfOpen(p),
          );
        });
      }
    });
  }, []);

  // A global capture (§3-1) writes straight to disk — if that file is open in
  // a tab here, reload it so this tab's own autosave can't overwrite the
  // capture with its stale in-memory copy.
  useEffect(() => {
    return window.api.capture.onAppended((path) => {
      void useSession.getState().reloadIfOpen(path);
    });
  }, []);

  // ⌘P quick-open · ⌘K command palette · ⌘W close tab (key code → layout-independent)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (useUi.getState().linkTarget) return; // note-link picker is modal
      if (e.code === 'KeyP') {
        e.preventDefault();
        useUi.getState().setQuickOpen(true);
      } else if (e.code === 'KeyK') {
        e.preventDefault();
        useUi.getState().setCmdkOpen(true);
      } else if (e.code === 'KeyF' && e.shiftKey) {
        e.preventDefault();
        useUi.getState().setGlobalSearch(true); // ⌘⇧F — workspace-wide search
      } else if (e.code === 'Comma') {
        e.preventDefault();
        useUi.getState().openSettings(); // ⌘, — settings
      } else if (e.code === 'KeyW') {
        e.preventDefault();
        const active = useSession.getState().activeTab();
        if (active) useSession.getState().closeTab(active.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const newMindmap = useCallback(async () => {
    const root = useWorkspace.getState().root;
    const path = await window.api.createFile(root, '제목 없음', serialize(emptyDoc()));
    await useWorkspace.getState().refresh();
    await openByPath(path);
  }, [openByPath]);

  const newNote = useCallback(async () => {
    const root = useWorkspace.getState().root;
    const path = await window.api.createFile(root, '제목 없음', serializeNote(emptyNote('제목 없음')), '.md');
    await useWorkspace.getState().refresh();
    await openByPath(path);
  }, [openByPath]);

  const createFromDoc = useCallback(
    async (name: string, doc: ReturnType<typeof emptyDoc>) => {
      const root = useWorkspace.getState().root;
      const path = await window.api.createFile(root, name, serialize(doc));
      await useWorkspace.getState().refresh();
      await openByPath(path);
    },
    [openByPath],
  );

  // ── Update-check status → in-app popup (instant feedback) ───────────────────
  useEffect(() => {
    return window.api.onUpdateStatus((s) => useUi.getState().setUpdateStatus(s as UpdateStatusType));
  }, []);

  // ── Native menu commands (operate on the active pane) ───────────────────────
  useEffect(() => {
    return window.api.onMenu(async (action) => {
      const sess = useSession.getState();
      const st = sess.activeStore()?.getState();
      const title = sess.activeTab()?.title ?? 'mindmap';
      switch (action) {
        case 'new':
          await newMindmap();
          break;
        case 'new-note':
          await newNote();
          break;
        case 'open': {
          const res = await window.api.open();
          if (res) sess.openPath(res.path, res.content);
          break;
        }
        case 'save':
          if (st) {
            const p = await window.api.save(st.filePath, serialize(st.doc));
            if (p) sess.activeStore()!.getState().markSaved(p);
          }
          break;
        case 'saveAs':
          if (st) {
            const p = await window.api.save(null, serialize(st.doc));
            if (p) {
              await useWorkspace.getState().refresh();
              await openByPath(p);
            }
          }
          break;
        case 'undo':
          st?.undo();
          break;
        case 'redo':
          st?.redo();
          break;
        case 'find':
          // ⌘F: in a map → in-canvas node find; in a note / home → workspace search
          if (sess.activeStore()) useUi.getState().setSearchOpen(true);
          else useUi.getState().setGlobalSearch(true);
          break;
        case 'toggle-sidebar':
          setSidebarVisible((v) => !v);
          break;
        case 'toggle-split':
          useSession.getState().toggleSplit();
          break;
        case 'toggle-theme':
          useUi.getState().toggleTheme();
          break;
        case 'zoom-in':
          activeControls.current?.zoomIn();
          break;
        case 'zoom-out':
          activeControls.current?.zoomOut();
          break;
        case 'zoom-fit':
          activeControls.current?.fit();
          break;
        case 'export-markdown':
          if (st) {
            const saved = await window.api.saveAs(`${title}.md`, toMarkdown(st.doc), 'md');
            if (saved) useUi.getState().toast(EXPORT_LOSSY_WARNING);
          }
          break;
        case 'export-opml':
          if (st) {
            const saved = await window.api.saveAs(`${title}.opml`, toOpml(st.doc), 'opml');
            if (saved) useUi.getState().toast(EXPORT_LOSSY_WARNING);
          }
          break;
        case 'import-markdown': {
          const res = await window.api.openAs('md');
          if (res) {
            const doc = fromMarkdown(res.content);
            // A file with no bullet list yields zero nodes — creating an empty
            // "가져온 마인드맵" would look like a silent failure, so warn instead.
            if (Object.keys(doc.nodes).length === 0) {
              useUi.getState().toast('불릿(- * +)이 없어 가져올 구조가 없습니다');
            } else {
              await createFromDoc('가져온 마인드맵', doc);
            }
          }
          break;
        }
        case 'import-opml': {
          const res = await window.api.openAs('opml');
          if (res) {
            try {
              await createFromDoc('가져온 마인드맵', fromOpml(res.content));
            } catch (err) {
              console.error('OPML import failed', err);
              useUi.getState().toast('OPML을 가져올 수 없습니다 — 파일 형식을 확인해 보세요');
            }
          }
          break;
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Startup: load workspace + restore last session ──────────────────────────
  useEffect(() => {
    (async () => {
      await useWorkspace.getState().refresh();
      const raw = loadSessionSnapshot();
      const snap = raw && {
        leftPaths: raw.leftPaths ?? [],
        leftActivePath: raw.leftActivePath ?? null,
        rightPaths: raw.rightPaths ?? [],
        rightActivePath: raw.rightActivePath ?? null,
        split: raw.split ?? false,
        activeGroup: (raw.activeGroup ?? 0) as 0 | 1,
      };
      const allPaths = snap ? [...snap.leftPaths, ...snap.rightPaths] : [];
      if (snap && allPaths.length) {
        const files: { path: string; content: string }[] = [];
        for (const p of allPaths) {
          try {
            files.push({ path: p, content: await window.api.readFile(p) });
          } catch {
            /* file gone — skip */
          }
        }
        if (files.length) useSession.getState().hydrate(files, snap);
      }
    })();
  }, []);

  const handleControls = useCallback((api: CanvasHandle | null) => {
    if (api) activeControls.current = api;
  }, []);

  // Start macOS Reminders two-way sync (no-op off macOS / when unavailable).
  useEffect(() => {
    startReminderSync();
    startNoteLinkSync(); // IF-05 · node delete → drop dead note links; node rename → refresh label
  }, []);

  // Safety net: always clear the tab-drag overlay when a drag ends (or on mount),
  // so the split drop-zones can never get stuck blocking the canvas.
  useEffect(() => {
    useUi.getState().setTabDrag(null);
    const clear = () => useUi.getState().setTabDrag(null);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    window.addEventListener('mouseup', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
      window.removeEventListener('mouseup', clear);
    };
  }, []);

  const closeSearch = () => {
    useUi.getState().setSearchOpen(false);
    useUi.getState().clearMatches();
  };

  const renderPane = (tab: Tab | null, group: 0 | 1) =>
    tab ? (
      tab.kind === 'calendar' ? (
        <div
          key={tab.id}
          className={`pane cal-pane${effectiveGroup === group ? ' active' : ''}`}
          onPointerDownCapture={() => useSession.getState().setActiveGroup(group)}
        >
          <CalendarView />
        </div>
      ) : tab.kind === 'note' ? (
        <NotePane
          key={tab.id}
          tab={tab}
          isActive={effectiveGroup === group}
          onActivate={() => useSession.getState().setActiveGroup(group)}
        />
      ) : (
        <Pane
          key={tab.id}
          tab={tab}
          isActive={effectiveGroup === group}
          onActivate={() => useSession.getState().setActiveGroup(group)}
          onControls={handleControls}
        />
      )
    ) : (
      <div className="pane" onPointerDownCapture={() => useSession.getState().setActiveGroup(group)}>
        <Home recent={recent} onNew={() => void newMindmap()} onNewNote={() => void newNote()} onOpenRecent={(p) => void openByPath(p)} />
      </div>
    );

  return (
    <div className="app">
      {sidebarVisible && (
        <Sidebar
          openPaths={tabs.map((t) => t.path)}
          activePath={activeTab?.path ?? null}
          onOpenFile={(p) => void openByPath(p)}
          onRenamed={(o, n) => useSession.getState().renamePath(o, n)}
          onDeleted={(p) => {
            useSession.getState().closeByPath(p);
            // Also dismiss any peek popup that was showing the deleted file
            const popup = useUi.getState().notePopup;
            if (popup?.paths.some((pp) => pp === p || pp.startsWith(p + '/'))) {
              useUi.getState().closeNotePopup();
            }
          }}
          onToggle={() => setSidebarVisible(false)}
        />
      )}

      <div className="main">
        <TabBar
          tabs={tabs}
          leftTabs={leftTabs}
          leftActive={leftActive}
          rightTabs={rightTabs}
          rightActive={rightActive}
          split={split}
          activeGroup={activeGroup}
          sidebarVisible={sidebarVisible}
          onSelectTab={(id, group) => useSession.getState().selectTab(id, group)}
          onCloseTab={(id) => useSession.getState().closeTab(id)}
          onMoveTab={(id, group) => useSession.getState().moveTab(id, group)}
          onReorderTab={(id, group, before) => useSession.getState().reorderTab(id, group, before)}
          onCloseOthers={(id) => useSession.getState().closeOtherTabs(id)}
          onCloseAll={() => useSession.getState().closeAllTabs()}
          onShowSidebar={() => setSidebarVisible(true)}
        />

        <div className={`panes${split ? ' split' : ''}`}>
          {renderPane(leftTab, 0)}
          {split && <div className="pane-divider" />}
          {split && renderPane(rightTab, 1)}

          {/* Drag a tab DOWN onto the panes to split / move it there. Only shown
              once the cursor leaves the tab strip, so reordering stays clean. */}
          {tabDrag?.overPane &&
            (split ? (
              <div className="split-zones">
                <DropZone variant="left" label="◧ 왼쪽" group={0} over={tabDrag.zone === 0} />
                <DropZone variant="right" label="오른쪽 ▶" group={1} over={tabDrag.zone === 1} />
              </div>
            ) : (
              <div className="split-zones">
                <DropZone variant="wide" label="화면 분할" group={1} over={tabDrag.zone === 1} />
              </div>
            ))}
        </div>

        {/* Search overlay bound to the active pane's store */}
        {activeStore && (
          <MapContext.Provider value={activeStore}>
            <DocTitle title={activeTab?.title ?? 'MindMap'} />
            {searchOpen && <Search onClose={closeSearch} />}
          </MapContext.Provider>
        )}
      </div>

      {quickOpen && (
        <QuickOpen
          onOpen={(p) => void openByPath(p)}
          onClose={() => useUi.getState().setQuickOpen(false)}
          onSearchEverywhere={(query) => {
            setGsInitialQuery(query);
            useUi.getState().setGlobalSearch(true);
          }}
        />
      )}
      {globalSearchOpen && (
        <GlobalSearch
          onOpen={(p) => void openByPath(p)}
          onClose={() => useUi.getState().setGlobalSearch(false)}
          initialQuery={gsInitialQuery}
        />
      )}
      {cmdkOpen && (
        <CommandPalette
          commands={buildCommands({
            split,
            hasActive: !!activeStore,
            newMindmap: () => void newMindmap(),
            fit: () => activeControls.current?.fit(),
            tidy: () => activeControls.current?.tidy(),
            toggleSidebar: () => setSidebarVisible((v) => !v),
            activeMapPath: activeTab?.kind === 'map' ? (activeTab.path ?? null) : null,
            selectedNode: activeStore && activeTab
              ? (() => {
                  const st = activeStore.getState();
                  const n = st.selectedId ? st.doc.nodes[st.selectedId] : undefined;
                  return n ? { id: n.id, text: n.text, todo: !!n.todo, mapId: st.doc.id ?? '', mapPath: activeTab.path, store: activeStore } : null;
                })()
              : null,
          })}
          files={flattenFiles(wsTree, (p) => void openByPath(p))}
          nodes={
            activeStore
              ? Object.values(activeStore.getState().doc.nodes).map((n) => ({
                  id: n.id,
                  text: n.text,
                  run: () => {
                    activeStore.getState().select(n.id);
                    useUi.getState().focusNode(n.id);
                  },
                }))
              : undefined
          }
          onSearchEverywhere={(query) => {
            setGsInitialQuery(query);
            useUi.getState().setGlobalSearch(true);
          }}
          onClose={() => useUi.getState().setCmdkOpen(false)}
        />
      )}
      <Toasts />
      <GrowthNudges />
      <NotePopup />
      <NoteLinkPicker />
      <FocusOverlay sidebarVisible={sidebarVisible} />
      {historyOpen && <WorkHistory />}
      {trashOpen && <TrashPanel />}
      {versionsOpen && <VersionHistoryPanel />}
      {templatesOpen && <TemplatePanel onOpen={(p) => void openByPath(p)} />}
      {recentOpen && <RecentView onOpen={(p) => void openByPath(p)} />}
      {favoritesOpen && <FavoritesView onOpen={(p) => void openByPath(p)} />}
      {updatesOpen && <UpdatesOverlay />}
      {whatsNew && <WhatsNewCard />}
      {settingsOpen && <Settings />}
      {manualOpen && <Manual />}
      <UpdateStatus />
    </div>
  );
}

function buildCommands(o: {
  split: boolean;
  hasActive: boolean;
  newMindmap: () => void;
  fit: () => void;
  tidy: () => void;
  toggleSidebar: () => void;
  activeMapPath: string | null;
  selectedNode: { id: string; text: string; todo: boolean; mapId: string; mapPath: string; store: MapStore } | null;
}): Command[] {
  const cmds: Command[] = [
    { id: 'new', icon: 'plus', label: '새 마인드맵', run: o.newMindmap },
    { id: 'capture', icon: 'bulb', label: '빠른 메모 열기', hint: '⌥Space', run: () => void window.api.capture.show() },
    { id: 'calendar', icon: 'calendar', label: '캘린더 열기', run: () => useSession.getState().openCalendar() },
    { id: 'history', icon: 'clock', label: '집중 기록 열기', run: () => useUi.getState().openHistory() },
    { id: 'recent', icon: 'clock', label: '최근 수정 보기', run: () => useUi.getState().openRecent() },
    { id: 'favorites', icon: 'star', label: '즐겨찾기 보기', run: () => useUi.getState().openFavorites() },
    { id: 'trash', icon: 'trash', label: '휴지통 열기', run: () => useUi.getState().openTrash() },
    {
      id: 'versions',
      icon: 'clock',
      label: '이전 버전 보기 (되돌리기)',
      run: () => {
        if (o.activeMapPath) useUi.getState().openVersions(o.activeMapPath);
        else useUi.getState().toast('맵을 연 상태에서 이용할 수 있어요');
      },
    },
    { id: 'reminders', icon: 'calendar', label: '미리알림 동기화 설정', run: () => useUi.getState().openSettings() },
    { id: 'globalsearch', icon: 'search', label: '전체 검색 (노드·노트)', hint: '⌘⇧F', run: () => useUi.getState().setGlobalSearch(true) },
    { id: 'quickopen', icon: 'file', label: '파일 빠른 열기', hint: '⌘P', run: () => useUi.getState().setQuickOpen(true) },
    { id: 'theme', icon: 'moon', label: '다크 모드 전환', hint: '⌘⇧L', run: () => useUi.getState().toggleTheme() },
    { id: 'sidebar', icon: 'menu', label: '사이드바 토글', run: o.toggleSidebar },
    { id: 'split', icon: 'expand', label: o.split ? '화면 분할 해제' : '화면 분할', run: () => useSession.getState().toggleSplit() },
    { id: 'relayout', icon: 'refresh', label: '화면 다시 맞춤', run: () => useUi.getState().relayout() },
    { id: 'tidy', icon: 'target', label: '겹침 정돈 (겹친 가지 떨어뜨리기)', run: o.tidy },
  ];
  // 선택된 노드에 대한 동작 — 아이콘을 몰라도, 마우스로 우연히 찾지 못해도
  // "이걸 하고 싶다"고 타이핑해서 도달할 수 있는 통로 (UX-CLARITY-VISION 전략 D).
  const sel = o.selectedNode;
  if (sel) {
    // 실행(일정·집중)은 할 일(todo) 노드에서만 — 툴바·우클릭 메뉴와 동일 게이트(결정 0014).
    // 일반 노드(순수 생각)엔 "할 일로 전환"만 노출한다.
    if (sel.todo) {
      cmds.push(
        { id: 'node-schedule', icon: 'calendar', label: '선택 노드: 일정 설정', run: () => useUi.getState().openSchedule(sel.id) },
        { id: 'node-focus', icon: 'clock', label: '선택 노드: 집중 시작', run: () => requestFocusStart(sel.store, sel.id) },
      );
    } else {
      cmds.push({ id: 'node-make-todo', icon: 'checklist', label: '선택 노드: 할 일로 전환', run: () => sel.store.getState().setTodo(sel.id, true) });
    }
    cmds.push(
      { id: 'node-link', icon: 'link', label: '선택 노드: 링크 추가', run: () => useUi.getState().openAddLink(sel.id) },
      {
        id: 'node-link-note',
        icon: 'note',
        label: '선택 노드: 노트 연결',
        run: () => useUi.getState().openLinkNote({ mapId: sel.mapId, nodeId: sel.id, nodeText: sel.text, mapPath: sel.mapPath }),
      },
      ...TAG_KEYS.map((c) => ({
        id: `node-color-${c}`,
        icon: 'paint' as const,
        label: `선택 노드: 색상 — ${TAG_LABEL[c]}`,
        run: () => sel.store.getState().setColor(sel.id, c),
      })),
    );
  }
  if (o.hasActive) {
    cmds.splice(1, 0, {
      id: 'search',
      icon: 'search',
      label: '노드 검색',
      hint: '⌘F',
      run: () => useUi.getState().setSearchOpen(true),
    });
    cmds.push(
      { id: 'fit', icon: 'expand', label: '화면 맞춤', hint: '⌘0', run: o.fit },
      {
        id: 'export-md',
        icon: 'download',
        label: 'Markdown 내보내기',
        run: async () => {
          const sess = useSession.getState();
          const st = sess.activeStore()?.getState();
          if (st) {
            const saved = await window.api.saveAs(`${sess.activeTab()?.title ?? 'map'}.md`, toMarkdown(st.doc), 'md');
            if (saved) useUi.getState().toast(EXPORT_LOSSY_WARNING);
          }
        },
      },
      {
        id: 'export-opml',
        icon: 'download',
        label: 'OPML 내보내기',
        run: async () => {
          const sess = useSession.getState();
          const st = sess.activeStore()?.getState();
          if (st) {
            const saved = await window.api.saveAs(`${sess.activeTab()?.title ?? 'map'}.opml`, toOpml(st.doc), 'opml');
            if (saved) useUi.getState().toast(EXPORT_LOSSY_WARNING);
          }
        },
      },
    );
  }
  return cmds;
}

function flattenFiles(
  tree: TreeNode[],
  open: (path: string) => void,
): { path: string; name: string; folder: string; run: () => void }[] {
  const out: { path: string; name: string; folder: string; run: () => void }[] = [];
  const walk = (nodes: TreeNode[], folder: string) => {
    for (const n of nodes) {
      if (n.type === 'file') {
        out.push({
          path: n.path,
          name: n.name.replace(/\.mind$/, ''),
          folder,
          run: () => open(n.path),
        });
      } else if (n.children) {
        walk(n.children, folder ? `${folder} / ${n.name}` : n.name);
      }
    }
  };
  walk(tree, '');
  return out;
}

/** A split drop target shown over the pane area while a tab is being dragged. */
function DropZone({
  variant,
  label,
  group,
  over,
}: {
  variant: 'left' | 'right' | 'wide';
  label: string;
  group: GroupIndex;
  over: boolean;
}) {
  // The drop itself is committed by TabBar's pointer logic (it hit-tests this
  // zone via `data-movegroup`); this element is purely the visible target.
  return (
    <div className={`split-zone ${variant}${over ? ' over' : ''}`} data-movegroup={group}>
      <span>{label}</span>
    </div>
  );
}

/** Keeps the OS window title in sync with the active document. */
function DocTitle({ title }: { title: string }) {
  const dirty = useMap((s) => s.dirty);
  useEffect(() => {
    document.title = `${title}${dirty ? ' •' : ''} — MindMap`;
  }, [title, dirty]);
  return null;
}
