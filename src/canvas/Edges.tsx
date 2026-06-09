import type { PositionedEdge } from '../types';

interface Props {
  edges: PositionedEdge[];
  /** Live offset applied to edges of a root being dragged. */
  rootDrag?: { rootId: string; dx: number; dy: number } | null;
}

/** Smooth left-to-right bezier connectors drawn between node centers. */
export function Edges({ edges, rootDrag }: Props) {
  return (
    <svg className="edges" width={1} height={1}>
      {edges.map((e) => {
        const off = rootDrag && rootDrag.rootId === e.rootId ? rootDrag : null;
        const sx = e.source.x + (off ? off.dx : 0);
        const sy = e.source.y + (off ? off.dy : 0);
        const tx = e.target.x + (off ? off.dx : 0);
        const ty = e.target.y + (off ? off.dy : 0);
        const midX = (sx + tx) / 2;
        const d = `M ${sx} ${sy} C ${midX} ${sy} ${midX} ${ty} ${tx} ${ty}`;
        // thicker near the root, tapering with depth, for a clear hierarchy
        const width = Math.max(1, 2.2 - e.depth * 0.35);
        return <path key={e.id} className="edge" d={d} strokeWidth={width} />;
      })}
    </svg>
  );
}
