import type { MindMapDoc } from '../types';

// A read-only preview of a schedule node + its descendants, shown under/next to a
// calendar entry (§3.2). Rendered as an INDENTED OUTLINE with full, wrapping text
// (no truncation) — its purpose is reading the content, not a scaled-down map.
// Lives in calendar/ (not ui/ or canvas/) so it doesn't cross a domain boundary.

interface Row {
  id: string;
  text: string;
  depth: number;
  done: boolean;
  hasNote: boolean;
}

/** Depth-first flatten of the subtree rooted at `rootId` (all descendants). */
function flatten(doc: MindMapDoc, rootId: string): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();
  const walk = (id: string, depth: number) => {
    const n = doc.nodes[id];
    if (!n || seen.has(id)) return; // guard against a cyclic graph
    seen.add(id);
    rows.push({
      id,
      text: (n.icon ? n.icon + ' ' : '') + (n.text || '무제'),
      depth,
      done: !!n.done,
      hasNote: !!n.note,
    });
    for (const c of n.children) walk(c, depth + 1);
  };
  walk(rootId, 0);
  return rows;
}

interface Props {
  doc: MindMapDoc;
  rootId: string;
  /** Fired when the root (schedule) node is clicked — container opens it in split. */
  onOpenRoot?: () => void;
  /** Max viewport height; a large subtree scrolls (each line still shows in full). */
  height?: number;
}

export function SubtreeMiniView({ doc, rootId, onOpenRoot, height = 260 }: Props) {
  if (!doc.nodes[rootId]) {
    return <div className="cal-peek-empty">노드를 찾을 수 없습니다.</div>;
  }
  const rows = flatten(doc, rootId);
  return (
    <div className="cal-peek-outline" style={{ maxHeight: height }}>
      {rows.map((r) => {
        const isRoot = r.depth === 0;
        return (
          <div
            key={r.id}
            className={`cal-peek-line${isRoot ? ' root' : ''}${r.done ? ' done' : ''}`}
            style={{ paddingLeft: 10 + r.depth * 16 }}
            onClick={isRoot ? onOpenRoot : undefined}
            role={isRoot && onOpenRoot ? 'button' : undefined}
            title={isRoot && onOpenRoot ? '오른쪽 화면에 맵 열기' : undefined}
          >
            {!isRoot && <span className="cal-peek-bullet" aria-hidden="true">·</span>}
            <span className="cal-peek-text">{r.text}</span>
            {r.hasNote && <span className="cal-peek-noteflag" title="노트 있음">노트</span>}
          </div>
        );
      })}
    </div>
  );
}
