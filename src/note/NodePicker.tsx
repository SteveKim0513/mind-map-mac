import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../store/sessionStore';
import { Icon } from '../ui/Icon';
import type { MapStore } from '../store/mapStore';
import type { NoteLink } from '../types';

interface Props {
  onPick: (link: NoteLink) => void;
  onClose: () => void;
}

interface Item {
  mapId: string;
  mapPath: string;
  mapTitle: string;
  nodeId: string;
  text: string;
}

/** Refined overlay to pick a node from any open mind map, to link a note to it. */
export function NodePicker({ onPick, onClose }: Props) {
  const tabs = useSession((s) => s.tabs);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const t of tabs) {
      if (t.kind !== 'map') continue;
      const doc = (t.store as MapStore).getState().doc;
      const mapId = doc.id ?? '';
      for (const id in doc.nodes) {
        const text = doc.nodes[id].text.trim();
        if (!text) continue; // skip empty nodes — nothing to recognise them by
        out.push({ mapId, mapPath: t.path, mapTitle: t.title, nodeId: id, text });
      }
    }
    return out;
  }, [tabs]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? items.filter((i) => i.text.toLowerCase().includes(s)) : items;
    return list.slice(0, 80);
  }, [items, q]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  // keep the active row in view
  useEffect(() => {
    listRef.current?.querySelector('.picker-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (it: Item) =>
    onPick({ mapId: it.mapId, nodeId: it.nodeId, nodeText: it.text, mapPath: it.mapPath });

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return onClose();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = filtered[active];
      if (it) pick(it);
    }
  };

  return (
    <div className="picker-backdrop" onMouseDown={onClose}>
      <div className="picker" onMouseDown={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <Icon name="link" />
          <span>노드 연결</span>
        </div>
        <input
          ref={inputRef}
          className="picker-input"
          placeholder="연결할 노드 검색…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="picker-list" ref={listRef}>
          {items.length === 0 ? (
            <div className="picker-empty">
              <Icon name="mindmap" />
              <span>먼저 마인드맵을 여세요</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="picker-empty">
              <Icon name="search" />
              <span>일치하는 노드가 없습니다</span>
            </div>
          ) : (
            filtered.map((it, i) => (
              <button
                key={`${it.mapId}:${it.nodeId}`}
                className={`picker-item${i === active ? ' active' : ''}`}
                onMouseMove={() => setActive(i)}
                onClick={() => pick(it)}
              >
                <span className="picker-node">
                  <Icon name="mindmap" />
                  <span className="picker-node-text">{it.text}</span>
                </span>
                <span className="picker-tag">{it.mapTitle}</span>
              </button>
            ))
          )}
        </div>
        <div className="picker-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> 이동</span>
          <span><kbd>↵</kbd> 연결</span>
          <span><kbd>esc</kbd> 닫기</span>
        </div>
      </div>
    </div>
  );
}
