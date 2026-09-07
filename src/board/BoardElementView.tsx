import type { PointerEvent as ReactPointerEvent } from 'react';
import type { BoardAnchorSide, BoardElement, BoardImageElement, BoardStickyElement } from '../types';
import { tagVar, contrastInk } from '../theme/palette';
import { useUi } from '../store/uiStore';
import { useBoard, type BoardElementPatch } from '../store/boardStore';
import { revealBoardNodeLink, revealBoardNoteLink } from './boardLinks';
import { Icon } from '../ui/Icon';

const ANCHORS: BoardAnchorSide[] = ['top', 'right', 'bottom', 'left'];
const FONT_PX: Record<string, number> = { small: 12, medium: 13.5, large: 16.5 };

/** Short display label for an external link chip — the hostname, or the raw
 *  string if it doesn't parse as a URL (e.g. still mid-typing). */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/** The 노드/노트/외부 링크 chip row shared by sticky and image elements — both
 *  kinds carry the same `nodeLink`/`noteLink`/`link` fields (2026-09-07: image
 *  gained them alongside sticky) and open/unlink identically. */
function LinkChips({
  el,
  setNodeLink,
  setNoteLink,
  updateElement,
}: {
  el: BoardStickyElement | BoardImageElement;
  setNodeLink: (id: string, link: null) => void;
  setNoteLink: (id: string, ref: null) => void;
  updateElement: (id: string, patch: BoardElementPatch) => void;
}) {
  return (
    <>
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
      {el.link && (
        <button
          className="board-sticky-link"
          title={`링크 열기: ${el.link}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => window.open(el.link, '_blank')}
        >
          <Icon name="external" />
          <span className="board-sticky-link-text">{hostOf(el.link)}</span>
          <span
            className="board-sticky-link-x"
            role="button"
            title="연결 해제"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              updateElement(el.id, { link: '' });
            }}
          >
            <Icon name="close" />
          </span>
        </button>
      )}
    </>
  );
}

interface Props {
  el: BoardElement;
  selected: boolean;
  editingField: 'text' | 'note' | null;
  editingNoteIndex: number | null; // meaningful only when editingField === 'note'
  showAnchors: boolean; // selected, hovered, or the live target of a connector drag — anchors are always mounted, this just toggles their "active" (big/opaque/clickable) CSS state
  snapAnchor: BoardAnchorSide | null; // which anchor an in-progress connector would land on if dropped now
  imageSrc: string | undefined; // resolved data: URI for image elements (undefined while loading)
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onAnchorPointerDown: (side: BoardAnchorSide, e: ReactPointerEvent) => void;
  onTextChange: (value: string) => void;
  onNoteChange: (index: number, value: string) => void;
  onFieldBlur: () => void;
  /** Escape while editing text/notes — reverts to the pre-edit value (via the
   *  store's transaction baseline) instead of committing. The field then
   *  blurs as usual, which still calls `onFieldBlur` (harmless no-op on the
   *  now-closed transaction) to close editing. */
  onCancelEdit: () => void;
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
  onCancelEdit,
  onRemoveNote,
}: Props) {
  if (el.kind === 'connector') return null; // connectors render in the shared SVG overlay
  const theme = useUi((s) => s.theme);
  const setNodeLink = useBoard((s) => s.setNodeLink);
  const setNoteLink = useBoard((s) => s.setNoteLink);
  const updateElement = useBoard((s) => s.updateElement);

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
      className={`board-el board-el--${el.kind}${selected ? ' selected' : ''}`}
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
              // 2026-09-07: a <textarea> scrolls internally once its content
              // overflows (native behavior, independent of CSS overflow) —
              // without stopping onWheel, scrolling long text also panned the
              // board underneath (same event-bubbling shape as the picker
              // pointerdown/keydown bugs fixed in earlier rounds, just for
              // wheel this time). Escape reverts to the pre-edit text via the
              // store's transaction baseline (onCancelEdit) instead of
              // committing — mirrors the mindmap node editor's Escape=cancel.
              <textarea
                className="board-el-input"
                style={textStyle}
                autoFocus
                value={el.text}
                onChange={(e) => onTextChange(e.target.value)}
                onBlur={onFieldBlur}
                onPointerDown={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    onCancelEdit();
                    e.currentTarget.blur();
                  }
                }}
              />
            ) : (
              <div className="board-el-text" style={textStyle}>
                {el.text || <span className="board-el-placeholder">더블클릭해 입력</span>}
              </div>
            )}
          </div>

          {(el.nodeLink || el.noteLink || el.link) && (
            <div className="board-sticky-links" data-board-region="links">
              <LinkChips el={el} setNodeLink={setNodeLink} setNoteLink={setNoteLink} updateElement={updateElement} />
            </div>
          )}
        </div>
      )}

      {el.kind === 'image' && (
        <div className="board-el-body" onPointerDown={onPointerDown}>
          {imageSrc ? (
            <img
              className="board-image"
              src={imageSrc}
              alt={el.alt ?? ''}
              draggable={false}
              style={{ borderColor: tagVar(el.color) ?? 'var(--tag-yellow)' }}
            />
          ) : (
            <div
              className="board-image board-image--loading"
              style={{ borderColor: tagVar(el.color) ?? 'var(--tag-yellow)' }}
            >
              <Icon name="board" />
            </div>
          )}
        </div>
      )}

      {el.kind === 'image' && (el.nodeLink || el.noteLink || el.link) && (
        // 스티키의 notes[]와 같은 자리(카드 아래, normal flow) — 사진 높이를 침범하지
        // 않고 그 아래로 쌓인다 (2026-09-07).
        <div className="board-image-links" style={{ width: el.width }} data-board-region="links">
          <LinkChips el={el} setNodeLink={setNodeLink} setNoteLink={setNoteLink} updateElement={updateElement} />
        </div>
      )}

      {ANCHORS.map((side) => (
        <div
          key={side}
          // Always mounted (2026-09-06) — a conditionally-mounted anchor needs
          // an entrance animation to fade in, and that class of animation was
          // already found to get stuck mid-frame in some window states
          // (2026-09-03, see .board-anchor's CSS comment). Instead the anchor
          // is always present but nearly invisible + inert (pointer-events:
          // none) until `active`, which is a plain CSS transition, not a
          // keyframe animation with its own timeline to desync.
          className={`board-anchor board-anchor--${side}${showAnchors ? ' active' : ''}${snapAnchor === side ? ' board-anchor--snap' : ''}`}
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
                // see the main-text textarea's comment above — same wheel/Escape fix
                <textarea
                  className="board-el-input"
                  style={textStyle}
                  autoFocus
                  value={noteText}
                  onChange={(e) => onNoteChange(i, e.target.value)}
                  onBlur={onFieldBlur}
                  onPointerDown={(e) => e.stopPropagation()}
                  onWheel={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      onCancelEdit();
                      e.currentTarget.blur();
                    }
                  }}
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
