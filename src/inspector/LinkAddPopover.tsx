import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMap } from '../store/mapStore';
import { Icon } from '../ui/Icon';

interface Props {
  id: string;
  onClose: () => void;
}

/** A tiny one-field popover to attach a URL to a node (→ link satellite). */
export function LinkAddPopover({ id, onClose }: Props) {
  const addNodeLink = useMap((s) => s.addNodeLink);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('https://');
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = document.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
    const W = 320;
    if (!el) {
      setPos({ left: window.innerWidth - W - 24, top: 90 });
      return;
    }
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(12, Math.min(r.left, window.innerWidth - W - 12)), top: r.bottom + 8 });
  }, [id]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
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

  const submit = () => {
    const u = url.trim();
    if (u && u !== 'https://') addNodeLink(id, u);
    onClose();
  };

  if (!pos) return null;

  return (
    <div
      ref={ref}
      className="linkadd-pop"
      style={{ left: pos.left, top: pos.top }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="linkadd-ic">
        <Icon name="link" />
      </span>
      <input
        ref={inputRef}
        className="linkadd-input"
        placeholder="https://…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      <button className="linkadd-go" title="추가 (↵)" onClick={submit}>
        <Icon name="check" />
      </button>
    </div>
  );
}
