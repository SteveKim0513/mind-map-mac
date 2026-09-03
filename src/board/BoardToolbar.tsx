import { useMemo, useRef, useState } from 'react';
import { useBoard, useBoardStore } from '../store/boardStore';
import { newId } from '../io/formats';
import { fileToImageData } from '../io/imageAssets';
import type { BoardElement, BoardStickyElement, StickyShape } from '../types';
import { Icon, type IconName } from '../ui/Icon';
import type { BoardCanvasHandle } from './BoardCanvasArea';

const SHAPE_ICON: Record<StickyShape, IconName> = {
  rect: 'rectShape',
  ellipse: 'ellipseShape',
};
const SHAPE_LABEL: Record<StickyShape, string> = {
  rect: '사각형',
  ellipse: '타원',
};

function isSticky(e: BoardElement): e is BoardStickyElement {
  return e.kind === 'sticky';
}

interface Props {
  handle: BoardCanvasHandle | null;
  boardFilePath: string | null;
}

export function BoardToolbar({ handle, boardFilePath }: Props) {
  const store = useBoardStore();
  const board = useBoard((s) => s.board);
  const dirty = useBoard((s) => s.dirty);
  const selection = useBoard((s) => s.selection);
  const shapeFilter = useBoard((s) => s.shapeFilter);
  const addElement = useBoard((s) => s.addElement);
  const removeElements = useBoard((s) => s.removeElements);
  const bringToFront = useBoard((s) => s.bringToFront);
  const sendToBack = useBoard((s) => s.sendToBack);
  const setShapeFilter = useBoard((s) => s.setShapeFilter);

  const dropCount = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const stickies = useMemo(() => Object.values(board.elements).filter(isSticky), [board.elements]);
  const usedShapes = useMemo(() => {
    const set = new Set<StickyShape>();
    for (const s of stickies) set.add(s.shape ?? 'rect');
    return [...set];
  }, [stickies]);

  // Cascade each new sticky slightly so repeated adds don't stack exactly on
  // top of each other; anchored near the current viewport center.
  const nextSpot = () => {
    const v = store.getState().board.view;
    const cx = (window.innerWidth / 2 - v.panX) / v.zoom;
    const cy = (window.innerHeight / 2 - v.panY) / v.zoom;
    const n = dropCount.current++;
    const jitter = (n % 8) * 24;
    return { x: cx - 90 + jitter, y: cy - 70 + jitter };
  };

  const addSticky = () => {
    const { x, y } = nextSpot();
    addElement({ id: newId(), kind: 'sticky', x, y, width: 180, height: 140, text: '', color: 'yellow' });
  };

  const addImages = async (files: File[]) => {
    if (!files.length || !boardFilePath) return;
    setUploading(true);
    try {
      for (const file of files) {
        try {
          const { buffer, filename } = await fileToImageData(file);
          const src = await window.api.imagesWrite({ notePath: boardFilePath, filename, buffer });
          const { x, y } = nextSpot();
          addElement({ id: newId(), kind: 'image', x, y, width: 240, height: 180, src });
        } catch {
          /* skip unreadable/unwritable image */
        }
      }
    } finally {
      setUploading(false);
    }
  };

  const hasSelection = selection.length > 0;
  const zoomPct = Math.round(board.view.zoom * 100);
  const singleSelectedSticky = selection.length === 1 ? board.elements[selection[0]] : undefined;
  const canTidy = singleSelectedSticky?.kind === 'sticky';

  return (
    <div className="toolbar board-toolbar">
      <span className={`map-save${dirty ? ' saving' : ''}`} title={dirty ? '저장 중' : '저장됨'} />
      <span className="sep" />
      <button className="tool-btn icon" title="스티키노트 추가" onClick={addSticky}>
        <Icon name="sticky" />
      </button>
      <button
        className="tool-btn icon"
        title="이미지 추가"
        disabled={!boardFilePath || uploading}
        onClick={() => fileInputRef.current?.click()}
      >
        <Icon name="image" />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'));
          void addImages(files);
          e.target.value = '';
        }}
      />

      <span className="sep" />
      <button className="tool-btn icon" title="맨 앞으로" disabled={selection.length !== 1} onClick={() => bringToFront(selection[0])}>
        <Icon name="chevronUp" />
      </button>
      <button className="tool-btn icon" title="맨 뒤로" disabled={selection.length !== 1} onClick={() => sendToBack(selection[0])}>
        <Icon name="chevronDown" />
      </button>
      <button className="tool-btn icon" title="삭제" disabled={!hasSelection} onClick={() => removeElements(selection)}>
        <Icon name="close" />
      </button>
      <button className="tool-btn icon" title="정리 — 연결된 스티키를 자동 배치" disabled={!canTidy} onClick={() => handle?.tidySelected()}>
        <Icon name="layout" />
      </button>

      {usedShapes.length > 1 && (
        <>
        <span className="sep" />
        <span className="board-shape-picker" title="모양으로 필터">
          {usedShapes.map((sh) => (
            <button
              key={sh}
              className={`tool-btn icon small${shapeFilter === sh ? ' on' : ''}`}
              title={shapeFilter === sh ? '필터 해제' : `${SHAPE_LABEL[sh]}만 보기`}
              onClick={() => setShapeFilter(shapeFilter === sh ? null : sh)}
            >
              <Icon name={SHAPE_ICON[sh]} />
            </button>
          ))}
        </span>
        </>
      )}

      <span className="sep" />
      <button className="tool-btn icon" title="축소" onClick={() => handle?.zoomOut()}>
        <Icon name="minus" />
      </button>
      <button className="tool-btn zoom-label" title="화면 맞춤" onClick={() => handle?.fit()}>
        {zoomPct}%
      </button>
      <button className="tool-btn icon" title="확대" onClick={() => handle?.zoomIn()}>
        <Icon name="plus" />
      </button>
      <button className="tool-btn icon" title="화면 맞춤" onClick={() => handle?.fit()}>
        <Icon name="expand" />
      </button>
    </div>
  );
}
