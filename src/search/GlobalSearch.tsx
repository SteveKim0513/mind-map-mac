import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '../store/workspaceStore';
import { deserialize } from '../io/formats';
import { parseNote } from '../io/noteFormat';
import { revealNode } from '../note/noteLinks';
import { Icon } from '../ui/Icon';
import type { TreeNode } from '../../electron/preload';

const nameOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.(mind|md)$/, '');

type Hit =
  | { kind: 'node'; label: string; sub: string; mapPath: string; mapId: string; nodeId: string }
  | { kind: 'note'; label: string; path: string; body: string; metaText?: string; snippet?: string };

function collectPaths(tree: TreeNode[], mind: string[], md: string[]) {
  for (const n of tree) {
    if (n.type === 'dir' && n.children) collectPaths(n.children, mind, md);
    else if (n.type === 'file') {
      if (n.path.endsWith('.mind')) mind.push(n.path);
      else if (n.path.endsWith('.md')) md.push(n.path);
    }
  }
}

/** A ~text window around the first match, so the result shows *where* it hit. */
function snippetAround(body: string, at: number, len: number): string {
  const start = Math.max(0, at - 30);
  const end = Math.min(body.length, at + len + 40);
  return (start > 0 ? '…' : '') + body.slice(start, end).replace(/\s+/g, ' ').trim() + (end < body.length ? '…' : '');
}

/**
 * Workspace-wide search: every map's node text + every note's title and body.
 * Reads the files once on open (a personal workspace is small); filtering is
 * in-memory. Picking a result opens the note, or opens the map and centers the node.
 */
export function GlobalSearch({
  onOpen,
  onClose,
  initialQuery,
}: {
  onOpen: (path: string) => void;
  onClose: () => void;
  /** ⌘K에서 "전체에서 찾기"로 넘어올 때, 이미 입력한 쿼리를 이어받는다 (IA-STRATEGY §5-1). */
  initialQuery?: string;
}) {
  const tree = useWorkspace((s) => s.tree);
  const [entries, setEntries] = useState<Hit[] | null>(null);
  const [q, setQ] = useState(initialQuery ?? '');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => setIdx(0), [q]);

  // one-time scan of the whole workspace
  useEffect(() => {
    let alive = true;
    void (async () => {
      const mind: string[] = [];
      const md: string[] = [];
      collectPaths(tree, mind, md);
      const out: Hit[] = [];
      await Promise.all([
        ...mind.map(async (path) => {
          try {
            const doc = deserialize(await window.api.readFile(path));
            const map = nameOf(path);
            for (const n of Object.values(doc.nodes)) {
              if (!n.text?.trim()) continue;
              out.push({ kind: 'node', label: n.text, sub: map, mapPath: path, mapId: doc.id ?? '', nodeId: n.id });
            }
          } catch {
            /* unreadable / corrupt → skip */
          }
        }),
        ...md.map(async (path) => {
          try {
            const note = parseNote(await window.api.readFile(path), nameOf(path));
            if (note.session) return; // focus work-logs are noise here
            const metaText = note.metaBlocks?.flatMap((b) => Object.values(b.values ?? {})).join(' ') ?? '';
            out.push({ kind: 'note', label: note.title, path, body: note.body, metaText });
          } catch {
            /* skip */
          }
        }),
      ]);
      if (alive) setEntries(out);
    })();
    return () => {
      alive = false;
    };
  }, [tree]);

  const results = useMemo(() => {
    if (!entries) return [];
    const s = q.trim().toLowerCase();
    if (!s) {
      // Show up to 20 files when query is empty (notes first, then maps)
      const notes = entries.filter((e) => e.kind === 'note').slice(0, 20);
      const nodes = entries.filter((e) => e.kind === 'node').slice(0, Math.max(0, 20 - notes.length));
      return [...notes, ...nodes];
    }
    const out: Hit[] = [];
    for (const e of entries) {
      if (e.kind === 'node') {
        if (e.label.toLowerCase().includes(s)) out.push(e);
      } else {
        const inTitle = e.label.toLowerCase().includes(s);
        const b = e.body.toLowerCase().indexOf(s);
        const inMeta = !!e.metaText && e.metaText.toLowerCase().includes(s);
        if (inTitle || b >= 0 || inMeta) {
          const snippet = b >= 0 ? snippetAround(e.body, b, s.length) : inMeta ? `양식: ${e.metaText}` : '';
          out.push({ ...e, snippet });
        }
      }
      if (out.length >= 80) break;
    }
    // notes first (usually what people mean by "search"), then nodes
    return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'note' ? -1 : 1));
  }, [q, entries]);

  useEffect(() => {
    listRef.current?.querySelector('.qo-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  const choose = (i: number) => {
    const h = results[i];
    if (!h) return;
    onClose();
    if (h.kind === 'node') void revealNode({ mapId: h.mapId, nodeId: h.nodeId, mapPath: h.mapPath });
    else onOpen(h.path);
  };

  return (
    <div className="qo-backdrop" onMouseDown={onClose}>
      <div className="qo gs" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="qo-input"
          placeholder="검색 — 노드, 노트"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIdx((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIdx((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(idx);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="qo-list" ref={listRef}>
          {q.trim() === '' && !entries ? (
            <div className="qo-empty">불러오는 중…</div>
          ) : results.length === 0 ? (
            <div className="qo-empty">일치하는 결과가 없습니다</div>
          ) : (
            results.map((h, i) => (
              <button
                key={h.kind === 'node' ? `${h.mapPath}:${h.nodeId}` : h.path}
                className={`qo-item${i === idx ? ' active' : ''}`}
                onMouseEnter={() => setIdx(i)}
                onClick={() => choose(i)}
              >
                <span className="qo-name">
                  <span className={`gs-ic gs-ic--${h.kind}`}>
                    <Icon name={h.kind === 'note' ? 'note' : 'mindmap'} />
                  </span>
                  <span className="qo-name-txt">{h.label || '제목 없음'}</span>
                </span>
                <span className="qo-folder">
                  {h.kind === 'node' ? h.sub : h.snippet || '노트'}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
