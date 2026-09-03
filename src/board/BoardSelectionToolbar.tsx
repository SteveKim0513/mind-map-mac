import { useState } from 'react';
import { useBoard } from '../store/boardStore';
import { ColorSwatchGrid } from '../ui/ColorSwatchGrid';
import { tagVar } from '../theme/palette';
import { Icon, type IconName } from '../ui/Icon';
import type { BoardStickyElement, StickyAlign, StickyFontSize, StickyShape, StickyValign } from '../types';

const ALIGNS: StickyAlign[] = ['left', 'center', 'right'];
const ALIGN_ICON: Record<StickyAlign, IconName> = { left: 'alignLeft', center: 'alignCenter', right: 'alignRight' };
const ALIGN_LABEL: Record<StickyAlign, string> = { left: '왼쪽 정렬', center: '가운데 정렬', right: '오른쪽 정렬' };

const VALIGNS: StickyValign[] = ['top', 'middle', 'bottom'];
const VALIGN_ICON: Record<StickyValign, IconName> = { top: 'valignTop', middle: 'valignMiddle', bottom: 'valignBottom' };
const VALIGN_LABEL: Record<StickyValign, string> = { top: '위쪽 정렬', middle: '중간 정렬', bottom: '아래쪽 정렬' };

const SHAPES: StickyShape[] = ['rect', 'ellipse'];
const SHAPE_ICON: Record<StickyShape, IconName> = { rect: 'rectShape', ellipse: 'ellipseShape' };
const SHAPE_LABEL: Record<StickyShape, string> = { rect: '사각형', ellipse: '타원' };

const SIZES: StickyFontSize[] = ['small', 'medium', 'large'];
const SIZE_LABEL: Record<StickyFontSize, string> = { small: '작게', medium: '중간', large: '크게' };
const SIZE_PX: Record<StickyFontSize, number> = { small: 11, medium: 14, large: 18 };

type Flyout = 'color' | 'shape' | 'align' | 'format' | 'link' | null;

interface Props {
  stickies: BoardStickyElement[]; // 1+ selected stickies — edits apply to all at once
  sx: number;
  sy: number;
  onAddNote: () => void; // single-selection only: appends a fused note block + enters edit mode
  onLinkNode: () => void; // single-selection only: opens the node picker
  onLinkNote: () => void; // single-selection only: opens the note picker
}

/** Floating action bar shown above the selected sticky note(s) — mirrors
 *  canvas/SelectionToolbar.tsx's pattern (screen-space position passed in,
 *  rendered outside the pan/zoom transform, .sel-toolbar/.st-* shared CSS).
 *  With multiple stickies selected, every action applies to all of them at
 *  once (`updateElements`); preview glyphs (current color/shape/etc.) show
 *  the first selected sticky's value as a representative default. */
export function BoardSelectionToolbar({ stickies, sx, sy, onAddNote, onLinkNode, onLinkNote }: Props) {
  const updateElements = useBoard((s) => s.updateElements);
  const setNodeLink = useBoard((s) => s.setNodeLink);
  const setNoteLink = useBoard((s) => s.setNoteLink);
  const [flyout, setFlyout] = useState<Flyout>(null);
  const toggle = (f: Flyout) => setFlyout((v) => (v === f ? null : f));

  const primary = stickies[0];
  const ids = stickies.map((s) => s.id);
  const single = stickies.length === 1;
  const apply = (patch: Parameters<typeof updateElements>[1]) => updateElements(ids, patch);

  return (
    <div
      className="sel-toolbar"
      style={{ left: sx, top: sy }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button className="st-btn" title="색 변경" onClick={() => toggle('color')}>
        <span className="st-dot" style={{ background: tagVar(primary.color) ?? 'var(--tag-yellow)' }} />
      </button>
      <span className="st-sep" />
      <button className="st-btn" title="모양 변경" onClick={() => toggle('shape')}>
        <Icon name={SHAPE_ICON[primary.shape ?? 'rect']} />
      </button>
      <span className="st-sep" />
      <button className="st-btn" title="정렬" onClick={() => toggle('align')}>
        <Icon name={ALIGN_ICON[primary.align ?? 'left']} />
      </button>
      <span className="st-sep" />
      <button className={`st-btn${primary.bold ? ' on' : ''}`} title="글자 서식" onClick={() => toggle('format')}>
        <span className="st-format-glyph" style={{ fontWeight: primary.bold ? 700 : 400 }}>
          가
        </span>
      </button>
      {single && (
        <>
          <span className="st-sep" />
          <button className="st-btn" title="텍스트 박스 추가" onClick={onAddNote}>
            <Icon name="plus" />
          </button>
          <span className="st-sep" />
          <button className={`st-btn${primary.nodeLink || primary.noteLink ? ' on' : ''}`} title="연동" onClick={() => toggle('link')}>
            <Icon name="link" />
          </button>
        </>
      )}

      {flyout === 'color' && (
        <div className="st-swatches">
          <ColorSwatchGrid value={primary.color} onChange={(c) => { apply({ color: c ?? 'yellow' }); setFlyout(null); }} />
        </div>
      )}
      {flyout === 'shape' && (
        <div className="st-swatches">
          {SHAPES.map((sh) => (
            <button
              key={sh}
              className={`st-btn${(primary.shape ?? 'rect') === sh ? ' on' : ''}`}
              title={SHAPE_LABEL[sh]}
              onClick={() => { apply({ shape: sh }); setFlyout(null); }}
            >
              <Icon name={SHAPE_ICON[sh]} />
            </button>
          ))}
        </div>
      )}
      {flyout === 'align' && (
        <div className="st-swatches st-flyout-col">
          <div className="st-flyout-row">
            {ALIGNS.map((a) => (
              <button
                key={a}
                className={`st-btn${(primary.align ?? 'left') === a ? ' on' : ''}`}
                title={ALIGN_LABEL[a]}
                onClick={() => apply({ align: a })}
              >
                <Icon name={ALIGN_ICON[a]} />
              </button>
            ))}
          </div>
          <div className="st-flyout-row">
            {VALIGNS.map((v) => (
              <button
                key={v}
                className={`st-btn${(primary.valign ?? 'top') === v ? ' on' : ''}`}
                title={VALIGN_LABEL[v]}
                onClick={() => apply({ valign: v })}
              >
                <Icon name={VALIGN_ICON[v]} />
              </button>
            ))}
          </div>
        </div>
      )}
      {flyout === 'format' && (
        <div className="st-swatches st-flyout-col">
          <div className="st-flyout-row">
            {SIZES.map((sz) => (
              <button
                key={sz}
                className={`st-btn${(primary.fontSize ?? 'medium') === sz ? ' on' : ''}`}
                title={SIZE_LABEL[sz]}
                onClick={() => apply({ fontSize: sz })}
              >
                <span style={{ fontSize: SIZE_PX[sz] }}>가</span>
              </button>
            ))}
          </div>
          <div className="st-flyout-row">
            <button className={`st-btn${primary.bold ? ' on' : ''}`} title="굵게" onClick={() => apply({ bold: !primary.bold })}>
              <span className="st-format-glyph" style={{ fontWeight: 700 }}>가</span>
              <span className="st-format-text">굵게</span>
            </button>
          </div>
        </div>
      )}
      {flyout === 'link' && single && (
        <div className="st-swatches st-flyout-col">
          <div className="st-flyout-row">
            {primary.nodeLink ? (
              <button className="st-btn st-link-row" title="노드 연결 해제" onClick={() => setNodeLink(primary.id, null)}>
                <Icon name="mindmap" />
                <span className="st-format-text">{primary.nodeLink.nodeText || '노드'}</span>
                <Icon name="close" />
              </button>
            ) : (
              <button className="st-btn st-link-row" title="마인드맵 노드 연결" onClick={() => { setFlyout(null); onLinkNode(); }}>
                <Icon name="mindmap" />
                <span className="st-format-text">노드 연결</span>
              </button>
            )}
          </div>
          <div className="st-flyout-row">
            {primary.noteLink ? (
              <button className="st-btn st-link-row" title="노트 연결 해제" onClick={() => setNoteLink(primary.id, null)}>
                <Icon name="note" />
                <span className="st-format-text">{primary.noteLink.title || '노트'}</span>
                <Icon name="close" />
              </button>
            ) : (
              <button className="st-btn st-link-row" title="노트 연결" onClick={() => { setFlyout(null); onLinkNote(); }}>
                <Icon name="note" />
                <span className="st-format-text">노트 연결</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
