import { useEffect, useState } from 'react';
import { BoardContext, useBoard, useBoardStore, type BoardStore } from '../store/boardStore';
import { serializeBoard } from '../io/boardFormat';
import { useSession } from '../store/sessionStore';
import { notifyFileSaved } from '../store/shareStore';
import { ViewerBadge } from '../ui/ViewerBadge';
import { CommentThread, anchorSelectorFor } from '../ui/CommentThread';
import { useCommentFileTarget } from '../store/commentStore';
import { useUi } from '../store/uiStore';
import { useWorkspace, boardNoteLinkEntry } from '../store/workspaceStore';
import { BoardCanvasArea, type BoardCanvasHandle } from './BoardCanvasArea';
import { BoardToolbar } from './BoardToolbar';
import type { Tab } from '../store/sessionStore';
import { finishSave } from '../store/saveGuard';
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
  // 공유로 받은 읽기 전용 보드(뷰어) — 편집 UI를 숨기고 절대 저장하지 않는다(스토어도 dirty를 막는다).
  const readOnly = useBoard((s) => s.readOnly);
  const filePath = useBoard((s) => s.filePath);
  // board 참조가 바뀔 때마다 아래 자동저장 타이머가 다시 시작된다(진짜 디바운스).
  const board = useBoard((s) => s.board);
  const [handle, setHandle] = useState<BoardCanvasHandle | null>(null);
  // 공유 폴더 코멘트: 이 보드의 요소에 열린 스레드 팝오버(뷰어에서도 동작). 활성 창에만 그린다.
  const commentThread = useUi((s) => s.commentThread);
  const commentTarget = useCommentFileTarget(filePath);

  // debounced autosave to this tab's .board file — mirrors Pane.tsx/NotePane.tsx
  // 2026-10-29: 예전에는 dirty가 true인 동안 타이머가 다시 시작되지 않아 입력 도중(첫 변경 1초 뒤)에 저장이 나갔고,
  // 저장이 끝나면 markSaved가 dirty를 꺼서 그 사이에 입력한 나머지가 다음 변경 전까지 디스크에 안 써졌다.
  useEffect(() => {
    if (!dirty || !filePath || readOnly) return;
    const t = setTimeout(() => {
      const target = store.getState().filePath;
      if (!target) return;
      if (store.getState().readOnly) return;
      if (useSession.getState().isDeleting(target)) return;
      const snap = store.getState().board;
      void window.api.save(target, serializeBoard(snap)).then((p) => {
        if (p) {
          finishSave(store, 'board', snap, p); // 저장 중 더 고쳤다면 dirty를 남긴다(saveGuard.ts)
          notifyFileSaved(p); // 공유 폴더의 소유자라면 이 저장을 참가자에게 발행한다(그 밖에는 아무 일도 없다)
          // keep the "referenced from a board" reverse index fresh — read-only,
          // no rename/delete GC (see types.ts's BoardMeta doc comment)
          const nodeLinks: BoardMeta['nodeLinks'] = [];
          const noteLinks: BoardMeta['noteLinks'] = [];
          for (const el of Object.values(store.getState().board.elements)) {
            if (el.kind !== 'sticky') continue;
            if (el.nodeLink) nodeLinks.push({ stickyId: el.id, link: el.nodeLink });
            if (el.noteLink) noteLinks.push(boardNoteLinkEntry(el.id, el.noteLink));
          }
          useWorkspace.getState().reindexBoard({ path: p, nodeLinks, noteLinks });
        }
      });
    }, 1000);
    return () => clearTimeout(t);
  }, [dirty, board, filePath, store, readOnly]);

  return (
    <>
      <BoardToolbar handle={handle} boardFilePath={filePath} />
      {readOnly && <ViewerBadge path={filePath} />}
      <BoardCanvasArea ref={setHandle} boardFilePath={filePath} active={active} />
      {active &&
        commentThread &&
        commentTarget &&
        commentThread.roomId === commentTarget.roomId &&
        commentThread.anchor.kind !== 'note' &&
        commentThread.anchor.fileId === commentTarget.fileId && (
          <CommentThread
            key={`${commentThread.roomId}|${commentThread.anchor.targetId ?? ''}`}
            roomId={commentThread.roomId}
            anchor={commentThread.anchor}
            anchorSelector={commentThread.anchor.targetId ? anchorSelectorFor('data-element-id', commentThread.anchor.targetId) : null}
            title={commentThread.anchor.label || '코멘트'}
            onClose={() => useUi.getState().closeCommentThread()}
          />
        )}
    </>
  );
}
