import { useEffect, useState } from 'react';
import { BoardContext, useBoard, useBoardStore, type BoardStore } from '../store/boardStore';
import { serializeBoard } from '../io/boardFormat';
import { useSession } from '../store/sessionStore';
import { useWorkspace } from '../store/workspaceStore';
import { BoardCanvasArea, type BoardCanvasHandle } from './BoardCanvasArea';
import { BoardToolbar } from './BoardToolbar';
import type { Tab } from '../store/sessionStore';
import type { BoardMeta } from '../types';

interface Props {
  tab: Tab;
  isActive: boolean;
  onActivate: () => void;
}

export function BoardPane({ tab, isActive, onActivate }: Props) {
  return (
    <BoardContext.Provider value={tab.store as BoardStore}>
      <div className={`pane board-pane${isActive ? ' active' : ''}`} onPointerDownCapture={onActivate}>
        <BoardPaneBody active={isActive} />
      </div>
    </BoardContext.Provider>
  );
}

function BoardPaneBody({ active }: { active: boolean }) {
  const store = useBoardStore();
  const dirty = useBoard((s) => s.dirty);
  const filePath = useBoard((s) => s.filePath);
  const markSaved = useBoard((s) => s.markSaved);
  const [handle, setHandle] = useState<BoardCanvasHandle | null>(null);

  // debounced autosave to this tab's .board file — mirrors Pane.tsx/NotePane.tsx
  useEffect(() => {
    if (!dirty || !filePath) return;
    const t = setTimeout(() => {
      const target = store.getState().filePath;
      if (!target) return;
      if (useSession.getState().isDeleting(target)) return;
      void window.api.save(target, serializeBoard(store.getState().board)).then((p) => {
        if (p) {
          markSaved(p);
          // keep the "referenced from a board" reverse index fresh — read-only,
          // no rename/delete GC (see types.ts's BoardMeta doc comment)
          const nodeLinks: BoardMeta['nodeLinks'] = [];
          const noteLinks: BoardMeta['noteLinks'] = [];
          for (const el of Object.values(store.getState().board.elements)) {
            if (el.kind !== 'sticky') continue;
            if (el.nodeLink) nodeLinks.push({ stickyId: el.id, link: el.nodeLink });
            if (el.noteLink) noteLinks.push({ stickyId: el.id, notePath: el.noteLink.notePath });
          }
          useWorkspace.getState().reindexBoard({ path: p, nodeLinks, noteLinks });
        }
      });
    }, 1000);
    return () => clearTimeout(t);
  }, [dirty, filePath, markSaved, store]);

  return (
    <>
      <BoardToolbar handle={handle} boardFilePath={filePath} />
      <BoardCanvasArea ref={setHandle} boardFilePath={filePath} active={active} />
    </>
  );
}
