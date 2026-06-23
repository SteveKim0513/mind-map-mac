import { useCallback, useEffect, useRef, useState } from 'react';
import { Sidebar } from './sidebar/Sidebar';
import { TabBar } from './panes/TabBar';
import { Pane } from './panes/Pane';
import { NotePane } from './note/NotePane';
import { NotePopup } from './note/NotePopup';
import { FocusOverlay } from './focus/FocusWidget';
import { WorkHistory } from './focus/WorkHistory';
import { TodayView } from './focus/TodayView';
import { TrashPanel } from './ui/TrashPanel';
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
import { QuickOpen } from './ui/QuickOpen';
import { CommandPalette, type Command } from './ui/CommandPalette';
import type { TreeNode } from '../electron/preload';
import { useKeyboard } from './interactions/useKeyboard';
import { startReminderSync } from './sync/reminderSync';
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
  const searchOpen = useUi((s) => s.searchOpen);
  const globalSearchOpen = useUi((s) => s.globalSearchOpen);
  const settingsOpen = useUi((s) => s.settingsOpen);
  const manualOpen = useUi((s) => s.manualOpen);
  const quickOpen = useUi((s) => s.quickOpen);
  const cmdkOpen = useUi((s) => s.cmdkOpen);
  const historyOpen = useUi((s) => s.historyOpen);
  const todayOpen = useUi((s) => s.todayOpen);
  const trashOpen = useUi((s) => s.trashOpen);
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
        useUi.getState().toast('파일을 열 수 없습니다');
      }
    }
  }, []);

  // Refresh the workspace tree when the window regains focus so external
  // changes made in Finder are reflected without any manual action.
  useEffect(() => {
    return window.api.onWorkspaceFocus(() => {
      void useWorkspace.getState().refresh();
    });
  }, []);

  // ⌘P quick-open · ⌘K command palette (key code → layout-independent)
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
          if (st) await window.api.saveAs(`${title}.md`, toMarkdown(st.doc), 'md');
          break;
        case 'export-opml':
          if (st) await window.api.saveAs(`${title}.opml`, toOpml(st.doc), 'opml');
          break;
        case 'import-markdown': {
          const res = await window.api.openAs('md');
          if (res) await createFromDoc('가져온 마인드맵', fromMarkdown(res.content));
          break;
        }
        case 'import-opml': {
          const res = await window.api.openAs('opml');
          if (res) {
            try {
              await createFromDoc('가져온 마인드맵', fromOpml(res.content));
            } catch (err) {
              console.error('OPML import failed', err);
              useUi.getState().toast('OPML을 가져올 수 없습니다');
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
      tab.kind === 'note' ? (
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
        />
      )}
      {globalSearchOpen && (
        <GlobalSearch
          onOpen={(p) => void openByPath(p)}
          onClose={() => useUi.getState().setGlobalSearch(false)}
        />
      )}
      {cmdkOpen && (
        <CommandPalette
          commands={buildCommands({
            split,
            hasActive: !!activeStore,
            newMindmap: () => void newMindmap(),
            fit: () => activeControls.current?.fit(),
            toggleSidebar: () => setSidebarVisible((v) => !v),
          })}
          files={flattenFiles(wsTree, (p) => void openByPath(p))}
          onClose={() => useUi.getState().setCmdkOpen(false)}
        />
      )}
      <Toasts />
      <NotePopup />
      <NoteLinkPicker />
      <FocusOverlay sidebarVisible={sidebarVisible} />
      {historyOpen && <WorkHistory />}
      {todayOpen && <TodayView />}
      {trashOpen && <TrashPanel />}
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
  toggleSidebar: () => void;
}): Command[] {
  const cmds: Command[] = [
    { id: 'new', icon: 'plus', label: '새 마인드맵', run: o.newMindmap },
    { id: 'today', icon: 'calendar', label: '오늘 열기', run: () => useUi.getState().openToday() },
    { id: 'history', icon: 'clock', label: '돌아보기 열기', run: () => useUi.getState().openHistory() },
    { id: 'trash', icon: 'trash', label: '휴지통 열기', run: () => useUi.getState().openTrash() },
    { id: 'globalsearch', icon: 'search', label: '전체 검색 (노드·노트)', hint: '⌘⇧F', run: () => useUi.getState().setGlobalSearch(true) },
    { id: 'quickopen', icon: 'file', label: '파일 빠른 열기', hint: '⌘P', run: () => useUi.getState().setQuickOpen(true) },
    { id: 'theme', icon: 'moon', label: '다크 모드 전환', hint: '⌘⇧L', run: () => useUi.getState().toggleTheme() },
    { id: 'sidebar', icon: 'menu', label: '사이드바 토글', run: o.toggleSidebar },
    { id: 'split', icon: 'expand', label: o.split ? '화면 분할 해제' : '화면 분할', run: () => useSession.getState().toggleSplit() },
    { id: 'relayout', icon: 'refresh', label: '새로고침 (재배치)', run: () => useUi.getState().relayout() },
  ];
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
          if (st) await window.api.saveAs(`${sess.activeTab()?.title ?? 'map'}.md`, toMarkdown(st.doc), 'md');
        },
      },
      {
        id: 'export-opml',
        icon: 'download',
        label: 'OPML 내보내기',
        run: async () => {
          const sess = useSession.getState();
          const st = sess.activeStore()?.getState();
          if (st) await window.api.saveAs(`${sess.activeTab()?.title ?? 'map'}.opml`, toOpml(st.doc), 'opml');
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
