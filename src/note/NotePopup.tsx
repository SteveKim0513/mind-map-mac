import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useUi } from '../store/uiStore';
import { useSession } from '../store/sessionStore';
import { parseNote } from '../io/noteFormat';
import { renderMarkdown } from './markdown';
import { Icon } from '../ui/Icon';
import type { NoteDoc } from '../types';

const nameOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/, '');

/** A floating peek of a linked note, opened from a node's link chip. */
export function NotePopup() {
  const popup = useUi((s) => s.notePopup);
  const close = useUi((s) => s.closeNotePopup);
  const [idx, setIdx] = useState(0);
  const [note, setNote] = useState<NoteDoc | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [shown, setShown] = useState(false); // drives the grow/shrink morph
  const path = popup?.paths[idx];
  const anchor = popup?.anchor;

  // new open → restart the morph (grow from the chip)
  useEffect(() => {
    setIdx(0);
    setShown(false);
  }, [popup]);

  // once positioned, flip `shown` on the next frame so the transition plays
  useEffect(() => {
    if (!pos) return;
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, [pos]);

  // close with a shrink-back-into-the-chip morph (anchored only)
  const requestClose = () => {
    if (!anchor) return close();
    setShown(false);
    setTimeout(() => useUi.getState().closeNotePopup(), 190);
  };

  // Position the anchored peek using its *measured* size so it never overflows:
  // sit below the node chip when there's room, flip above when there isn't, and
  // always clamp inside the viewport (the body scrolls if it still can't fit).
  useLayoutEffect(() => {
    if (!anchor || !popupRef.current) {
      setPos(null);
      return;
    }
    const el = popupRef.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const m = 12;
    const left = Math.max(m, Math.min(anchor.x, window.innerWidth - w - m));
    const below = anchor.y + 6;
    let top: number;
    if (h <= window.innerHeight - m - below) top = below;
    else if (h <= anchor.y - 6 - m) top = anchor.y - 6 - h;
    else top = window.innerHeight - m - h;
    setPos({ left, top: Math.max(m, top) });
  }, [anchor, note, idx]);

  // A transient peek: moving the canvas (trackpad/wheel pan or pinch-zoom) would
  // strand it away from its node, so dismiss it on any scroll outside the popup.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (popupRef.current?.contains(e.target as Node)) return;
      useUi.getState().closeNotePopup();
    };
    window.addEventListener('wheel', onWheel, { passive: true, capture: true });
    return () => window.removeEventListener('wheel', onWheel, { capture: true });
  }, []);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setNote(null);
    void window.api
      .readFile(path)
      .then((c) => alive && setNote(parseNote(c, nameOf(path))))
      .catch(() => alive && setNote(null));
    return () => {
      alive = false;
    };
  }, [path]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && requestClose();
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  if (!popup || !path) return null;

  const editInSplit = async () => {
    try {
      useSession.getState().openInRight(path, await window.api.readFile(path));
    } catch {
      /* ignore */
    }
    close();
  };

  // anchored peek floats beside the node chip; the position is measured in the
  // layout effect above. Keep it hidden for the first (unmeasured) frame so it
  // never flashes at the wrong spot. No anchor → fall back to a centered modal.
  // The morph: scale grows FROM / shrinks INTO the chip — transform-origin is the
  // chip point relative to the popup's own box.
  let anchorStyle: CSSProperties | undefined;
  if (anchor) {
    if (pos) {
      anchorStyle = {
        position: 'absolute',
        left: pos.left,
        top: pos.top,
        margin: 0,
        transformOrigin: `${anchor.x - pos.left}px ${anchor.y - pos.top}px`,
        transform: shown ? 'scale(1)' : 'scale(0.16)',
        opacity: shown ? 1 : 0,
        transition: 'transform 0.22s var(--spring), opacity 0.18s ease',
      };
    } else {
      anchorStyle = { position: 'absolute', left: 0, top: 0, margin: 0, visibility: 'hidden' };
    }
  }

  return (
    <div
      className={`note-popup-backdrop${anchor ? ' anchored' : ''}`}
      onMouseDown={requestClose}
    >
      <div ref={popupRef} className="note-popup" style={anchorStyle} onMouseDown={(e) => e.stopPropagation()}>
        <div className="note-popup-head">
          <span className="note-popup-ic">
            <Icon name="note" />
          </span>
          <span className="note-popup-title">{note?.title || nameOf(path)}</span>
          <button className="note-popup-btn" title="수정 (오른쪽 분할로 열기)" onClick={() => void editInSplit()}>
            <Icon name="edit" />
          </button>
          <button className="note-popup-btn" title="닫기 (Esc)" onClick={requestClose}>
            <Icon name="close" />
          </button>
        </div>

        {popup.paths.length > 1 && (
          <div className="note-popup-switch">
            {popup.paths.map((p, i) => (
              <button
                key={p}
                className={i === idx ? 'on' : ''}
                onClick={() => setIdx(i)}
                title={nameOf(p)}
              >
                {nameOf(p)}
              </button>
            ))}
          </div>
        )}

        <div className="note-popup-body note-preview">
          {note === null ? (
            <p className="note-preview-empty">불러오는 중…</p>
          ) : note.body.trim() ? (
            renderMarkdown(note.body)
          ) : (
            <p className="note-preview-empty">내용이 없습니다.</p>
          )}
        </div>
      </div>
    </div>
  );
}
