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
        // Control points extend HORIZONTALLY from each end by a distance-aware,
        // clamped offset: short links curve gently, long ones flow — the curve
        // eases out of the parent and into the child instead of kinking at the
        // midpoint. Reads far more refined than a midX S-curve.
        const dx = Math.abs(tx - sx);
        const cp = Math.max(18, Math.min(dx * 0.5, 90));
        const d = `M ${sx} ${sy} C ${sx + cp} ${sy} ${tx - cp} ${ty} ${tx} ${ty}`;
        // thicker near the root, tapering with depth, for a clear hierarchy
        const width = Math.max(1, 2.2 - e.depth * 0.35);
        return <path key={e.id} className="edge" d={d} strokeWidth={width} />;
      })}
    </svg>
  );
}
