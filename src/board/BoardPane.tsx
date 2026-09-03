import { useEffect, useState } from 'react';
import { BoardContext, useBoard, useBoardStore, type BoardStore } from '../store/boardStore';
import { serializeBoard } from '../io/boardFormat';
import { useSession } from '../store/sessionStore';
import { BoardCanvasArea, type BoardCanvasHandle } from './BoardCanvasArea';
import { BoardToolbar } from './BoardToolbar';
import type { Tab } from '../store/sessionStore';

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
        if (p) markSaved(p);
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
