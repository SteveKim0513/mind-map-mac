import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMap } from '../store/mapStore';

const ICONS = ['⭐', '✅', '❗', '💡', '📌', '🎯'];

interface Props {
  id: string;
  onClose: () => void;
}

/** Note / link / icon editor floated beside its node. Autosaves as you type. */
export function NodePopover({ id, onClose }: Props) {
  const node = useMap((s) => s.doc.nodes[id]);
  const setIcon = useMap((s) => s.setIcon);
  const setLink = useMap((s) => s.setLink);
  const setNote = useMap((s) => s.setNote);

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = document.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
    const W = 300;
    const H = 280;
    if (!el) {
      setPos({ left: window.innerWidth - W - 24, top: 80 });
      return;
    }
    const r = el.getBoundingClientRect();
    let left = Math.max(12, Math.min(r.left, window.innerWidth - W - 12));
    let top = r.bottom + 10;
    if (top + H > window.innerHeight - 12) top = Math.max(12, r.top - H - 10);
    setPos({ left, top });
  }, [id]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);

  if (!node || !pos) return null;

  return (
    <div
      ref={ref}
      className="note-pop"
      style={{ left: pos.left, top: pos.top }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="note-pop-head">
        <span className="note-pop-title" title={node.text}>
          {node.text || '제목 없음'}
        </span>
        <button className="note-pop-x" title="닫기 (Esc)" onClick={onClose}>
          ✕
        </button>
      </div>

      <Fields
        id={id}
        initialLink={node.link}
        initialNote={node.note}
        setLink={setLink}
        setNote={setNote}
      />

      <div className="note-pop-icons">
        {ICONS.map((ic) => (
          <button
            key={ic}
            className={`icon-opt${node.icon === ic ? ' on' : ''}`}
            onClick={() => setIcon(id, node.icon === ic ? undefined : ic)}
          >
            {ic}
          </button>
        ))}
        {node.icon && (
          <button className="icon-opt clear" title="아이콘 제거" onClick={() => setIcon(id, undefined)}>
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function Fields({
  id,
  initialLink,
  initialNote,
  setLink,
  setNote,
}: {
  id: string;
  initialLink?: string;
  initialNote?: string;
  setLink: (id: string, v: string | undefined) => void;
  setNote: (id: string, v: string) => void;
}) {
  const [link, setLinkLocal] = useState(initialLink ?? '');
  const [note, setNoteLocal] = useState(initialNote ?? '');
  const linkTimer = useRef<ReturnType<typeof setTimeout>>();
  const noteTimer = useRef<ReturnType<typeof setTimeout>>();
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    noteRef.current?.focus();
    return () => {
      clearTimeout(linkTimer.current);
      clearTimeout(noteTimer.current);
    };
  }, []);

  const onLink = (v: string) => {
    setLinkLocal(v);
    clearTimeout(linkTimer.current);
    linkTimer.current = setTimeout(() => setLink(id, v.trim() || undefined), 400);
  };
  const onNote = (v: string) => {
    setNoteLocal(v);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(id, v), 400);
  };

  const openable = /^https?:\/\/|^www\./i.test(link.trim());

  return (
    <>
      <textarea
        ref={noteRef}
        className="note-pop-area"
        placeholder="노트를 입력하세요…"
        value={note}
        onChange={(e) => onNote(e.target.value)}
        onBlur={() => setNote(id, note)}
      />
      <div className="note-pop-linkrow">
        <span className="note-pop-link-ic">🔗</span>
        <input
          className="note-pop-link"
          placeholder="링크 추가 (https://…)"
          value={link}
          onChange={(e) => onLink(e.target.value)}
          onBlur={() => setLink(id, link.trim() || undefined)}
        />
        {openable && (
          <button
            className="note-pop-open"
            title="링크 열기"
            onClick={() => {
              const url = link.trim();
              window.open(/^https?:\/\//i.test(url) ? url : `https://${url}`, '_blank');
            }}
          >
            ↗
          </button>
        )}
      </div>
    </>
  );
}
