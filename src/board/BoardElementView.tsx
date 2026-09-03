import type { PointerEvent as ReactPointerEvent } from 'react';
import type { BoardAnchorSide, BoardElement } from '../types';
import { tagVar, contrastInk } from '../theme/palette';
import { useUi } from '../store/uiStore';
import { useBoard } from '../store/boardStore';
import { revealBoardNodeLink, revealBoardNoteLink } from './boardLinks';
import { Icon } from '../ui/Icon';

const ANCHORS: BoardAnchorSide[] = ['top', 'right', 'bottom', 'left'];
const FONT_PX: Record<string, number> = { small: 12, medium: 13.5, large: 16.5 };

interface Props {
  el: BoardElement;
  selected: boolean;
  editingField: 'text' | 'note' | null;
  editingNoteIndex: number | null; // meaningful only when editingField === 'note'
  dimmed: boolean; // hidden by the active color/shape filter
  showAnchors: boolean; // selected, hovered, or the live target of a connector drag
  snapAnchor: BoardAnchorSide | null; // which anchor an in-progress connector would land on if dropped now
  imageSrc: string | undefined; // resolved data: URI for image elements (undefined while loading)
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onAnchorPointerDown: (side: BoardAnchorSide, e: ReactPointerEvent) => void;
  onTextChange: (value: string) => void;
  onNoteChange: (index: number, value: string) => void;
  onFieldBlur: () => void;
  onRemoveNote: (index: number) => void;
}

/** Renders one board element at its world-space box. The parent world layer
 *  already carries the pan/zoom CSS transform, so x/y/width/height here are
 *  plain world-unit pixels (same convention as the mindmap canvas's nodes).
 *  Double-click-to-edit is detected upstream (BoardCanvasArea's pointerdown
 *  timing, keyed off `data-board-region`) rather than via the native
 *  `dblclick` event — see the comment on `onElementPointerDown` there for why.
 *
 *  Anchors are children of `.board-el` itself (NOT `.board-sticky`) on
 *  purpose: `.board-sticky` needs `overflow: hidden` to clip its own text to
 *  the card shape, and an anchor straddles the card's edge by design (half
 *  in, half out) — nested inside that clipped box, half of every anchor's
 *  hit-testable area would be silently cut away (found via E2E flake
 *  chasing, 2026-09-03: a click dead-center on the edge missed ~half the
 *  time). `.board-el` itself is never clipped, so anchors sit there instead,
 *  sized to just the main card (`el.height`) even though a sticky's extra
 *  `notes` stack BELOW it in normal flow, past that height. */
export function BoardElementView({
  el,
  selected,
  editingField,
  editingNoteIndex,
  dimmed,
  showAnchors,
  snapAnchor,
  imageSrc,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
  onAnchorPointerDown,
  onTextChange,
  onNoteChange,
  onFieldBlur,
  onRemoveNote,
}: Props) {
  if (el.kind === 'connector') return null; // connectors render in the shared SVG overlay
  const theme = useUi((s) => s.theme);
  const setNodeLink = useBoard((s) => s.setNodeLink);
  const setNoteLink = useBoard((s) => s.setNoteLink);

  const style: React.CSSProperties = {
    left: el.x,
    top: el.y,
    width: el.width,
    height: el.height,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
  };

  const textStyle: React.CSSProperties =
    el.kind === 'sticky'
      ? { fontSize: FONT_PX[el.fontSize ?? 'medium'], fontWeight: el.bold ? 700 : 400 }
      : {};

  return (
    <div
      className={`board-el board-el--${el.kind}${selected ? ' selected' : ''}${dimmed ? ' dimmed' : ''}`}
      style={style}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {el.kind === 'sticky' && (
        <div
          className={`board-el-body board-sticky board-sticky--${el.shape ?? 'rect'}`}
          style={{
            background: tagVar(el.color) ?? 'var(--tag-yellow)',
            color: `var(--ink-on-tag-${contrastInk(el.color ?? 'yellow', theme)})`,
            textAlign: el.align ?? 'left',
          }}
          onPointerDown={onPointerDown}
        >
          <div className={`board-el-text-main valign-${el.valign ?? 'top'}`} data-board-region="text">
            {editingField === 'text' ? (
              <textarea
                className="board-el-input"
                style={textStyle}
                autoFocus
                value={el.text}
                onChange={(e) => onTextChange(e.target.value)}
                onBlur={onFieldBlur}
                onPointerDown={(e) => e.stopPropagation()}
              />
            ) : (
              <div className="board-el-text" style={textStyle}>
                {el.text || <span className="board-el-placeholder">더블클릭해 입력</span>}
              </div>
            )}
          </div>

          {(el.nodeLink || el.noteLink) && (
            <div className="board-sticky-links" data-board-region="links">
              {el.nodeLink && (
                <button
                  className="board-sticky-link"
                  title={el.nodeLink.nodeText ? `노드로 이동: ${el.nodeLink.nodeText}` : '노드로 이동'}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => void revealBoardNodeLink(el.nodeLink!)}
                >
                  <Icon name="mindmap" />
                  <span className="board-sticky-link-text">{el.nodeLink.nodeText || '노드'}</span>
                  <span
                    className="board-sticky-link-x"
                    role="button"
                    title="연결 해제"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setNodeLink(el.id, null);
                    }}
                  >
                    <Icon name="close" />
                  </span>
                </button>
              )}
              {el.noteLink && (
                <button
                  className="board-sticky-link"
                  title={el.noteLink.title ? `노트 열기: ${el.noteLink.title}` : '노트 열기'}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => void revealBoardNoteLink(el.noteLink!.notePath)}
                >
                  <Icon name="note" />
                  <span className="board-sticky-link-text">{el.noteLink.title || '노트'}</span>
                  <span
                    className="board-sticky-link-x"
                    role="button"
                    title="연결 해제"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setNoteLink(el.id, null);
                    }}
                  >
                    <Icon name="close" />
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {el.kind === 'image' && (
        <div className="board-el-body" onPointerDown={onPointerDown}>
          {imageSrc ? (
            <img className="board-image" src={imageSrc} alt={el.alt ?? ''} draggable={false} />
          ) : (
            <div className="board-image board-image--loading">
              <Icon name="board" />
            </div>
          )}
        </div>
      )}

      {showAnchors &&
        ANCHORS.map((side) => (
          <div
            key={side}
            className={`board-anchor board-anchor--${side}${snapAnchor === side ? ' board-anchor--snap' : ''}`}
            onPointerDown={(e) => onAnchorPointerDown(side, e)}
          />
        ))}

      {el.kind === 'sticky' && el.notes && el.notes.length > 0 && (
        <div className="board-sticky-notes" style={{ width: el.width }}>
          {el.notes.map((noteText, i) => (
            <div
              key={i}
              className="board-sticky-note"
              data-board-region={`note-${i}`}
              style={{
                background: tagVar(el.color) ?? 'var(--tag-yellow)',
                color: `var(--ink-on-tag-${contrastInk(el.color ?? 'yellow', theme)})`,
                textAlign: el.align ?? 'left',
              }}
              onPointerDown={onPointerDown}
            >
              {editingField === 'note' && editingNoteIndex === i ? (
                <textarea
                  className="board-el-input"
                  style={textStyle}
                  autoFocus
                  value={noteText}
                  onChange={(e) => onNoteChange(i, e.target.value)}
                  onBlur={onFieldBlur}
                  onPointerDown={(e) => e.stopPropagation()}
                />
              ) : (
                <div className="board-el-text" style={textStyle}>
                  {noteText || <span className="board-el-placeholder">더블클릭해 입력</span>}
                </div>
              )}
              <button
                className="board-sticky-note-del"
                title="이 텍스트 박스 삭제"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onRemoveNote(i)}
              >
                <Icon name="close" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
