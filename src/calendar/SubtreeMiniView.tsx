import { useMemo } from 'react';
import type { MindMapDoc } from '../types';
import { layout, type NodeSize } from '../layout/treeLayout';

// A read-only static preview of a schedule node + its descendants, rendered from
// the pure layout() (no editing, no store binding). Lives in calendar/ — not ui/
// or canvas/ — so it doesn't cross a domain boundary (calendar can't import a
// sibling domain like canvas/; it reuses the lower-level layout/ lib). The bezier
// connector matches canvas/Edges.tsx but is inlined here to avoid that import.
// See specs/2026-07-16-calendar-ux-overhaul.md §3.2.

const NODE_H = 30;
const PAD = 16;

/** Rough box width — we don't measure text in a read-only preview. */
function estimateWidth(text: string, hasIcon: boolean): number {
  const chars = [...text].length; // CJK counts as 1 code point but renders ~wide
  const w = chars * 9 + (hasIcon ? 22 : 0) + 22;
  return Math.max(56, Math.min(w, 220));
}

interface Props {
  doc: MindMapDoc;
  rootId: string;
  /** Fired when the root (schedule) node is clicked — container opens it in split. */
  onOpenRoot?: () => void;
  /** Pixel height of the preview viewport; larger trees scale to fit (meet). */
  height?: number;
}

export function SubtreeMiniView({ doc, rootId, onOpenRoot, height = 200 }: Props) {
  const result = useMemo(() => {
    const sizes: Record<string, NodeSize> = {};
    for (const id of Object.keys(doc.nodes)) {
      const n = doc.nodes[id];
      sizes[id] = { w: estimateWidth(n.text || '무제', !!n.icon), h: NODE_H };
    }
    return layout(doc, sizes, rootId);
  }, [doc, rootId]);

  if (!doc.nodes[rootId]) {
    return <div className="cal-peek-empty">노드를 찾을 수 없습니다.</div>;
  }

  const { nodes, edges, bounds } = result;
  const vw = Math.max(1, bounds.maxX - bounds.minX) + PAD * 2;
  const vh = Math.max(1, bounds.maxY - bounds.minY) + PAD * 2;

  return (
    <div className="cal-peek-mini" style={{ height }}>
      <svg
        viewBox={`${bounds.minX - PAD} ${bounds.minY - PAD} ${vw} ${vh}`}
        preserveAspectRatio="xMidYMid meet"
        width="100%"
        height="100%"
        role="img"
        aria-label="일정 노드 미리보기"
      >
        {edges.map((e) => {
          const dx = Math.abs(e.target.x - e.source.x);
          const cp = Math.max(18, Math.min(dx * 0.5, 90));
          const d = `M ${e.source.x} ${e.source.y} C ${e.source.x + cp} ${e.source.y} ${e.target.x - cp} ${e.target.y} ${e.target.x} ${e.target.y}`;
          return <path key={e.id} className="cal-peek-edge" d={d} />;
        })}
        {nodes.map((p) => {
          const isRoot = p.node.id === rootId;
          const top = p.y - NODE_H / 2;
          const maxChars = Math.max(3, Math.floor((p.width - 16) / 8));
          const raw = (p.node.icon ? p.node.icon + ' ' : '') + (p.node.text || '무제');
          const label = [...raw].length > maxChars ? [...raw].slice(0, maxChars).join('') + '…' : raw;
          return (
            <g
              key={p.node.id}
              className={`cal-peek-node${isRoot ? ' root' : ''}${p.node.done ? ' done' : ''}`}
              onClick={isRoot ? onOpenRoot : undefined}
              style={isRoot && onOpenRoot ? { cursor: 'pointer' } : undefined}
            >
              <rect x={p.x} y={top} width={p.width} height={NODE_H} rx={7} />
              <text x={p.x + 9} y={p.y} dominantBaseline="central">
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
