import { useEffect, useRef, useState } from 'react';
import { useMap } from '../store/mapStore';
import { Icon } from '../ui/Icon';
import { useNodeAnchoredPosition } from '../ui/useNodeAnchoredPosition';
import { useOutsideDismiss } from '../ui/useOutsideDismiss';

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
  const pos = useNodeAnchoredPosition(id, 320, { gap: 8 });

  useOutsideDismiss(ref, onClose);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

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
