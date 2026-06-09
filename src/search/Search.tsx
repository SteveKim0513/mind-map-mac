import { useEffect, useMemo, useRef, useState } from 'react';
import { useMap } from '../store/mapStore';
import { useUi } from '../store/uiStore';

export function Search({ onClose }: { onClose: () => void }) {
  const nodes = useMap((s) => s.doc.nodes);
  const select = useMap((s) => s.select);
  const setMatches = useUi((s) => s.setMatches);
  const focusNode = useUi((s) => s.focusNode);

  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return Object.values(nodes)
      .filter((n) =>
        `${n.text} ${n.note ?? ''} ${n.link ?? ''}`.toLowerCase().includes(q),
      )
      .map((n) => n.id);
  }, [query, nodes]);

  // Whenever the matches change, highlight them and jump to the first hit.
  useEffect(() => {
    setIndex(0);
    setMatches(matches, matches[0] ?? null);
    if (matches[0]) {
      select(matches[0]);
      focusNode(matches[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches]);

  const go = (delta: number) => {
    if (matches.length === 0) return;
    const next = (index + delta + matches.length) % matches.length;
    setIndex(next);
    setMatches(matches, matches[next]);
    select(matches[next]);
    focusNode(matches[next]);
  };

  return (
    <div className="search">
      <input
        ref={inputRef}
        placeholder="노드 검색…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            go(e.shiftKey ? -1 : 1);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <span className="count">{matches.length ? `${index + 1}/${matches.length}` : '0'}</span>
      <button title="이전 (⇧Enter)" onClick={() => go(-1)}>
        ↑
      </button>
      <button title="다음 (Enter)" onClick={() => go(1)}>
        ↓
      </button>
      <button title="닫기 (Esc)" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}
