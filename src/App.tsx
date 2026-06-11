import { useCallback, useEffect, useRef, useState } from 'react';
import { Sidebar } from './sidebar/Sidebar';
import { TabBar } from './panes/TabBar';
import { Pane } from './panes/Pane';
import { NotePane } from './note/NotePane';
import { NotePopup } from './note/NotePopup';
import { NoteLinkPicker } from './note/NoteLinkPicker';
import { Home } from './panes/Home';
import { Search } from './search/Search';
import { Toasts } from './ui/Toasts';
import { QuickOpen } from './ui/QuickOpen';
import { CommandPalette, type Command } from './ui/CommandPalette';
import type { TreeNode } from '../electron/preload';
import { useKeyboard } from './interactions/useKeyboard';
import { startReminderSync } from './sync/reminderSync';
import { MapContext, useMap, type MapStore } from './store/mapStore';
import { useSession, loadSessionSnapshot } from './store/sessionStore';
import { useWorkspace } from './store/workspaceStore';
import { useUi } from './store/uiStore';
import type { CanvasHandle } from './canvas/Canvas';
import type { Tab } from './store/sessionStore';
import {
  serialize,
  emptyDoc,
  toMarkdown,
  fromMarkdown,
  toOpml,
  fromOpml,
} from './io/formats';

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
  const quickOpen = useUi((s) => s.quickOpen);
  const cmdkOpen = useUi((s) => s.cmdkOpen);
  const wsTree = useWorkspace((s) => s.tree);
  const tabDragId = useUi((s) => s.tabDragId);

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
      useUi.getState().toast('파일을 열 수 없습니다');
    }
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

  const createFromDoc = useCallback(
    async (name: string, doc: ReturnType<typeof emptyDoc>) => {
      const root = useWorkspace.getState().root;
      const path = await window.api.createFile(root, name, serialize(doc));
      await useWorkspace.getState().refresh();
      await openByPath(path);
    },
    [openByPath],
  );

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
          if (sess.activeStore()) useUi.getState().setSearchOpen(true);
          break;
        case 'toggle-sidebar':
          setSidebarVisible((v) => !v);
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
        <Home recent={recent} onNew={() => void newMindmap()} onOpenRecent={(p) => void openByPath(p)} />
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
          onDeleted={(p) => useSession.getState().closeByPath(p)}
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

          {/* Drag a tab onto a side to split / move it there (Cursor-style) */}
          {tabDragId &&
            (split ? (
              <div className="split-zones">
                <DropZone variant="left" label="◧ 왼쪽" onDrop={() => useSession.getState().moveTab(tabDragId, 0)} />
                <DropZone variant="right" label="오른쪽 ▶" onDrop={() => useSession.getState().moveTab(tabDragId, 1)} />
              </div>
            ) : (
              <div className="split-zones">
                <DropZone variant="wide" label="여기에 놓아 화면 분할" onDrop={() => useSession.getState().moveTab(tabDragId, 1)} />
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
  onDrop,
}: {
  variant: 'left' | 'right' | 'wide';
  label: string;
  onDrop: () => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`split-zone ${variant}${over ? ' over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        // Clear the drag guide here too: moveTab() unmounts the dragged tab,
        // so onDragEnd may never fire and the split-zones overlay would linger.
        useUi.getState().setTabDrag(null);
        onDrop();
      }}
    >
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
