import { useEffect, useRef, useState } from 'react';
import { MapContext, useMap, useMapStore, type MapStore } from '../store/mapStore';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import { serialize } from '../io/formats';
import { isUntitledName, fileNameFromTitle } from '../io/autoName';
import { Canvas, type CanvasHandle } from '../canvas/Canvas';
import { NodePopover } from '../inspector/NodePopover';
import { SchedulePopover } from '../inspector/SchedulePopover';
import { LinkAddPopover } from '../inspector/LinkAddPopover';
import { ContextMenu } from '../menu/ContextMenu';
import { Breadcrumb } from '../ui/Breadcrumb';
import { Icon } from '../ui/Icon';
import { useSession, type Tab } from '../store/sessionStore';
import { notifyFileSaved } from '../store/shareStore';
import { ViewerBadge } from '../ui/ViewerBadge';
import { CommentThread, anchorSelectorFor } from '../ui/CommentThread';
import { useCommentFileTarget } from '../store/commentStore';
import { finishSave } from '../store/saveGuard';

interface Props {
  tab: Tab;
  isActive: boolean;
  onActivate: () => void;
  onControls: (api: CanvasHandle | null) => void;
}

export function Pane({ tab, isActive, onActivate, onControls }: Props) {
  return (
    <MapContext.Provider value={tab.store as MapStore}>
      <div
        className={`pane${isActive ? ' active' : ''}`}
        onPointerDownCapture={onActivate}
      >
        <PaneBody isActive={isActive} onControls={onControls} />
      </div>
    </MapContext.Provider>
  );
}

function PaneBody({
  isActive,
  onControls,
}: {
  isActive: boolean;
  onControls: (api: CanvasHandle | null) => void;
}) {
  const store = useMapStore();
  const doc = useMap((s) => s.doc);
  const dirty = useMap((s) => s.dirty);
  // 공유로 받은 읽기 전용 맵(뷰어) — 편집 UI를 숨기고 절대 저장하지 않는다(스토어도 dirty를 막는다).
  const readOnly = useMap((s) => s.readOnly);
  const filePath = useMap((s) => s.filePath);
  const notePopoverId = useUi((s) => s.notePopoverId);
  const schedulePopoverId = useUi((s) => s.schedulePopoverId);
  const addLinkFor = useUi((s) => s.addLinkFor);
  const contextMenu = useUi((s) => s.contextMenu);
  // 공유 폴더 코멘트: 이 맵의 노드에 열린 스레드 팝오버(뷰어에서도 동작 — 코멘트는 문서를 바꾸지 않는다). 활성 창에만 그린다.
  const commentThread = useUi((s) => s.commentThread);
  const commentTarget = useCommentFileTarget(filePath);

  const [handle, setHandle] = useState<CanvasHandle | null>(null);

  const isEmpty = doc.rootIds.length === 0;

  // report zoom controls up when this pane is the active one
  useEffect(() => {
    onControls(isActive ? handle : null);
  }, [isActive, handle, onControls]);

  // An untitled map takes its file name from the first center topic the user
  // types (spec: docs/product/specs/2026-06-11-untitled-autoname.md). Fires at
  // most once per file — after the rename the name no longer matches the pattern.
  const editingId = useMap((s) => s.editingId);
  const autoNaming = useRef(false);
  useEffect(() => {
    if (!filePath || autoNaming.current) return;
    const base = (filePath.split('/').pop() ?? '').replace(/\.mind$/, '');
    if (!isUntitledName(base)) return;
    const rootId = doc.rootIds[0];
    if (!rootId || editingId === rootId) return; // not while the title is being typed
    const title = fileNameFromTitle(doc.nodes[rootId]?.text ?? '');
    if (!title || title === base) return;
    autoNaming.current = true;
    void (async () => {
      try {
        await useSession.getState().flushSaves(filePath);
        const newPath = await window.api.rename(filePath, `${title}.mind`);
        useSession.getState().renamePath(filePath, newPath);
        await useWorkspace.getState().refresh();
      } catch {
        /* keep the untitled name; a later edit retries */
      } finally {
        autoNaming.current = false;
      }
    })();
  }, [doc, filePath, editingId]);

  // debounced autosave to this tab's file
  useEffect(() => {
    if (!dirty || !filePath || readOnly) return;
    const t = setTimeout(() => {
      // Save to the tab's *current* path (read at fire time), not the path captured
      // when the timer was scheduled — guards against writing to a just-renamed path.
      const target = store.getState().filePath;
      if (!target) return;
      // Never recreate a file that's being trashed — see useSession.deletingPaths.
      if (useSession.getState().isDeleting(target)) return;
      if (store.getState().readOnly) return;
      const snap = store.getState().doc;
      void window.api.save(target, serialize(snap)).then((p) => {
        if (p) {
          finishSave(store, 'doc', snap, p); // 저장 중 더 고쳤다면 dirty를 남긴다(saveGuard.ts)
          notifyFileSaved(p); // 공유 폴더의 소유자라면 이 저장을 참가자에게 발행한다(그 밖에는 아무 일도 없다)
        }
      });
    }, 1000);
    return () => clearTimeout(t);
  }, [dirty, doc, filePath, store, readOnly]);

  return (
    <>
      <Canvas ref={setHandle} active={isActive} />
      <Breadcrumb />
      {readOnly && <ViewerBadge path={filePath} />}

      {isEmpty && (
        <div className="empty">
          <div className="title">빈 마인드맵</div>
          <div className="hint">
            {readOnly ? (
              '소유자가 아직 내용을 만들지 않았어요'
            ) : (
              <>
                <kbd>Enter</kbd> 를 눌러 중심 주제를 만드세요
              </>
            )}
          </div>
        </div>
      )}

      <div className="toolbar">
        {!readOnly && (
          <>
            <span className={`map-save${dirty ? ' saving' : ''}`} title={dirty ? '저장 중' : '저장됨'} />
            <span className="sep" />
          </>
        )}
        <button className="tool-btn icon" title="축소" onClick={() => handle?.zoomOut()}>
          <Icon name="minus" />
        </button>
        <button className="tool-btn zoom-label" title="화면 맞춤" onClick={() => handle?.fit()}>
          {Math.round(doc.view.zoom * 100)}%
        </button>
        <button className="tool-btn icon" title="확대" onClick={() => handle?.zoomIn()}>
          <Icon name="plus" />
        </button>
        <span className="sep" />
        <button className="tool-btn icon" title="화면 맞춤" onClick={() => handle?.fit()}>
          <Icon name="expand" />
        </button>
        <button
          className="tool-btn icon"
          title="화면 다시 맞춤"
          onClick={() => useUi.getState().relayout()}
        >
          <Icon name="refresh" />
        </button>
      </div>

      {!readOnly && notePopoverId && doc.nodes[notePopoverId] && (
        <NodePopover id={notePopoverId} onClose={() => useUi.getState().closeNote()} />
      )}
      {!readOnly && schedulePopoverId && doc.nodes[schedulePopoverId] && (
        <SchedulePopover id={schedulePopoverId} onClose={() => useUi.getState().closeSchedule()} />
      )}
      {!readOnly && addLinkFor && doc.nodes[addLinkFor] && (
        <LinkAddPopover id={addLinkFor} onClose={() => useUi.getState().closeAddLink()} />
      )}
      {isActive &&
        commentThread &&
        commentTarget &&
        commentThread.roomId === commentTarget.roomId &&
        commentThread.anchor.kind !== 'note' &&
        commentThread.anchor.fileId === commentTarget.fileId && (
          <CommentThread
            key={`${commentThread.roomId}|${commentThread.anchor.targetId ?? ''}`}
            roomId={commentThread.roomId}
            anchor={commentThread.anchor}
            anchorSelector={commentThread.anchor.targetId ? anchorSelectorFor('data-node-id', commentThread.anchor.targetId) : null}
            title={(commentThread.anchor.targetId && doc.nodes[commentThread.anchor.targetId]?.text) || commentThread.anchor.label || '코멘트'}
            onClose={() => useUi.getState().closeCommentThread()}
          />
        )}
      {contextMenu && doc.nodes[contextMenu.id] && (
        <ContextMenu
          id={contextMenu.id}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => useUi.getState().closeContextMenu()}
        />
      )}
    </>
  );
}
