import { useEffect, useMemo, useRef, useState } from 'react';
import { useMap } from '../store/mapStore';
import { useUi } from '../store/uiStore';
import { Icon } from '../ui/Icon';

export function Search({
  onClose,
  initialQuery = '',
  initialActiveId = null,
}: {
  onClose: () => void;
  /** Seeded from a global-search result: start with this query… */
  initialQuery?: string;
  /** …and this node as the current match (instead of the first one). */
  initialActiveId?: string | null;
}) {
  const nodes = useMap((s) => s.doc.nodes);
  const select = useMap((s) => s.select);
  const expandTo = useMap((s) => s.expandTo);
  const setMatches = useUi((s) => s.setMatches);
  const focusNode = useUi((s) => s.focusNode);

  const [query, setQuery] = useState(initialQuery);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // the seeded active node applies to the first match list only
  const seedActive = useRef(initialActiveId);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return Object.values(nodes)
      .filter((n) =>
        `${n.text} ${n.note ?? ''} ${n.link ?? ''} ${(n.links ?? []).join(' ')}`
          .toLowerCase()
          .includes(q),
      )
      .map((n) => n.id);
  }, [query, nodes]);

  const jump = (id: string) => {
    expandTo(id); // a match under a collapsed branch must be laid out to be centered
    select(id);
    focusNode(id);
  };

  // Whenever the match list changes, highlight it and jump to the first hit
  // (or to the seeded node on the very first list).
  //
  // Only the id list matters: `nodes` changes identity on every edit (and on
  // expandTo), but if the same ids still match there is nothing to re-jump to.
  const matchKey = matches.join('\n');
  useEffect(() => {
    const seeded = seedActive.current ? matches.indexOf(seedActive.current) : -1;
    seedActive.current = null;
    const start = Math.max(0, seeded);
    setIndex(start);
    setMatches(matches, matches[start] ?? null);
    if (matches[start]) jump(matches[start]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchKey]);

  const go = (delta: number) => {
    if (matches.length === 0) return;
    const next = (index + delta + matches.length) % matches.length;
    setIndex(next);
    setMatches(matches, matches[next]);
    jump(matches[next]);
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
      <button className="search-nav" title="이전 (⇧Enter)" onClick={() => go(-1)}>
        <Icon name="chevronUp" />
      </button>
      <button className="search-nav" title="다음 (Enter)" onClick={() => go(1)}>
        <Icon name="chevronDown" />
      </button>
      <button className="search-nav" title="닫기 (Esc)" onClick={onClose}>
        <Icon name="close" />
      </button>
    </div>
  );
}
