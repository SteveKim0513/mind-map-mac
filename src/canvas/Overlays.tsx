import { useEffect, useRef, useState } from 'react';
import { useMap } from '../store/mapStore';
import type { Connection, Section } from '../types';

// stable empty refs so selectors never return a fresh array (avoids render loops)
const NO_CONNS: Connection[] = [];
const NO_SECTS: Section[] = [];

export interface Center {
  cx: number;
  cy: number;
  w: number;
  h: number;
}
export type Centers = Record<string, Center>;

const SECTION_PAD = 14; // ink padding around each member (tighter → less bleed onto neighbours)
const BRIDGE_W = 22; // thickness of the bridges that connect members

const SECTION_COLORS = ['#62aef0', '#d6b6f6', '#ff64c8', '#dd5b00', '#2a9d99', '#1aae39'];

/** Closest point on the section ink (nearest member's padded rect) to a point. */
function nearestEdge(p: { x: number; y: number }, nodeIds: string[], centers: Centers) {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const id of nodeIds) {
    const c = centers[id];
    if (!c) continue;
    const x0 = c.cx - c.w / 2 - SECTION_PAD;
    const x1 = c.cx + c.w / 2 + SECTION_PAD;
    const y0 = c.cy - c.h / 2 - SECTION_PAD;
    const y1 = c.cy + c.h / 2 + SECTION_PAD;
    const px = Math.max(x0, Math.min(p.x, x1));
    const py = Math.max(y0, Math.min(p.y, y1));
    const d = (px - p.x) ** 2 + (py - p.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = { x: px, y: py };
    }
  }
  return best;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function memberRects(nodeIds: string[], centers: Centers): Rect[] {
  const rects: Rect[] = [];
  for (const id of nodeIds) {
    const c = centers[id];
    if (!c) continue;
    rects.push({
      x: c.cx - c.w / 2 - SECTION_PAD,
      y: c.cy - c.h / 2 - SECTION_PAD,
      w: c.w + SECTION_PAD * 2,
      h: c.h + SECTION_PAD * 2,
    });
  }
  return rects;
}

/** Minimum spanning tree over member centers → bridge segments that connect them. */
function bridgeLines(nodeIds: string[], centers: Centers) {
  const pts = nodeIds.map((id) => centers[id]).filter(Boolean).map((c) => ({ x: c.cx, y: c.cy }));
  if (pts.length < 2) return [] as { x1: number; y1: number; x2: number; y2: number }[];
  const inTree = [0];
  const rest = new Set(pts.map((_, i) => i).filter((i) => i !== 0));
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  while (rest.size) {
    let from = -1;
    let to = -1;
    let best = Infinity;
    for (const i of inTree) {
      for (const j of rest) {
        const d = (pts[i].x - pts[j].x) ** 2 + (pts[i].y - pts[j].y) ** 2;
        if (d < best) {
          best = d;
          from = i;
          to = j;
        }
      }
    }
    if (to < 0) break;
    lines.push({ x1: pts[from].x, y1: pts[from].y, x2: pts[to].x, y2: pts[to].y });
    inTree.push(to);
    rest.delete(to);
  }
  return lines;
}

/** Default title spot: above the top-most member. */
function defaultLabel(nodeIds: string[], centers: Centers): { x: number; y: number } | null {
  let minX = Infinity;
  let topY = Infinity;
  let any = false;
  for (const id of nodeIds) {
    const c = centers[id];
    if (!c) continue;
    any = true;
    minX = Math.min(minX, c.cx - c.w / 2);
    topY = Math.min(topY, c.cy - c.h / 2);
  }
  return any ? { x: minX + 20, y: topY - SECTION_PAD - 16 } : null;
}

/** Resolve a node id to its center, or — if it's hidden (collapsed/filtered) — to
 * the nearest visible ancestor's center, so a connection never silently vanishes. */
function resolveCenter(
  id: string,
  centers: Centers,
  nodes: Record<string, { parentId: string | null }>,
): Center | null {
  let cur: string | null = id;
  while (cur) {
    const c = centers[cur];
    if (c) return c;
    cur = nodes[cur]?.parentId ?? null;
  }
  return null;
}

interface DragState {
  id: string;
  x: number;
  y: number;
}
type DragPos = DragState | null;

/** Behind nodes: section regions (+ leader lines) + connection lines. */
export function OverlaysBack({
  centers,
  dragPos,
  sectionDrag,
}: {
  centers: Centers;
  dragPos: DragPos;
  sectionDrag: DragPos;
}) {
  const sections = useMap((s) => s.doc.sections) ?? NO_SECTS;
  const connections = useMap((s) => s.doc.connections) ?? NO_CONNS;
  const nodes = useMap((s) => s.doc.nodes);

  return (
    <>
      {sections.map((sec) => {
        const rects = memberRects(sec.nodeIds, centers);
        if (!rects.length) return null;
        const lines = bridgeLines(sec.nodeIds, centers);
        const fill = sec.color ?? '#8b8b93';
        const fid = `goo-${sec.id}`;
        const label =
          sectionDrag?.id === sec.id
            ? sectionDrag
            : sec.labelPos ?? defaultLabel(sec.nodeIds, centers);
        const anchor = label ? nearestEdge(label, sec.nodeIds, centers) : null;
        return (
          <svg key={sec.id} className="section-svg" width={1} height={1}>
            <defs>
              <filter id={fid} x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="b" />
                <feColorMatrix
                  in="b"
                  mode="matrix"
                  values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -13"
                />
              </filter>
            </defs>
            <g filter={`url(#${fid})`} fill={fill} stroke={fill} opacity={0.17}>
              {rects.map((r, i) => (
                <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={30} ry={30} />
              ))}
              {lines.map((l, i) => (
                <line
                  key={`l${i}`}
                  x1={l.x1}
                  y1={l.y1}
                  x2={l.x2}
                  y2={l.y2}
                  strokeWidth={BRIDGE_W}
                  strokeLinecap="round"
                />
              ))}
            </g>
            {label && anchor && (
              <line
                className="sec-leader"
                x1={label.x}
                y1={label.y + 9}
                x2={anchor.x}
                y2={anchor.y}
                stroke={fill}
              />
            )}
          </svg>
        );
      })}

      <svg className="edges conn-lines" width={1} height={1}>
        {connections.map((c) => {
          // route to the nearest visible ancestor when an endpoint is collapsed/filtered
          const a = resolveCenter(c.from, centers, nodes);
          const z = resolveCenter(c.to, centers, nodes);
          if (!a || !z || a === z) return null;
          const mid =
            dragPos && dragPos.id === c.id
              ? dragPos
              : c.labelPos ?? { x: (a.cx + z.cx) / 2, y: (a.cy + z.cy) / 2 };
          return (
            <path
              key={c.id}
              className="conn-line"
              d={`M ${a.cx} ${a.cy} L ${mid.x} ${mid.y} L ${z.cx} ${z.cy}`}
            />
          );
        })}
      </svg>
    </>
  );
}

/** In front of nodes: connection memos / + handles, and draggable section labels. */
export function OverlaysFront({
  centers,
  toWorld,
  dragPos,
  setDragPos,
  sectionDrag,
  setSectionDrag,
}: {
  centers: Centers;
  toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  dragPos: DragPos;
  setDragPos: (d: DragPos) => void;
  sectionDrag: DragPos;
  setSectionDrag: (d: DragPos) => void;
}) {
  const connections = useMap((s) => s.doc.connections) ?? NO_CONNS;
  const sections = useMap((s) => s.doc.sections) ?? NO_SECTS;
  const nodes = useMap((s) => s.doc.nodes);
  const setConnectionNote = useMap((s) => s.setConnectionNote);
  const setConnectionLabelPos = useMap((s) => s.setConnectionLabelPos);
  const removeConnection = useMap((s) => s.removeConnection);
  const setSectionTitle = useMap((s) => s.setSectionTitle);
  const setSectionLabelPos = useMap((s) => s.setSectionLabelPos);
  const setSectionColor = useMap((s) => s.setSectionColor);
  const removeSection = useMap((s) => s.removeSection);

  const [editing, setEditing] = useState<string | null>(null);
  const grab = useRef<{ x: number; y: number } | null>(null);

  // connection-memo drag
  useEffect(() => {
    if (!dragPos) return;
    const onMove = (e: PointerEvent) => {
      const w = toWorld(e.clientX, e.clientY);
      const g = grab.current ?? { x: 0, y: 0 };
      setDragPos({ id: dragPos.id, x: w.x - g.x, y: w.y - g.y });
    };
    const onUp = () => {
      setConnectionLabelPos(dragPos.id, { x: dragPos.x, y: dragPos.y });
      grab.current = null;
      setDragPos(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragPos, toWorld, setConnectionLabelPos, setDragPos]);

  // section-label drag
  useEffect(() => {
    if (!sectionDrag) return;
    const onMove = (e: PointerEvent) => {
      const w = toWorld(e.clientX, e.clientY);
      const g = grab.current ?? { x: 0, y: 0 };
      setSectionDrag({ id: sectionDrag.id, x: w.x - g.x, y: w.y - g.y });
    };
    const onUp = () => {
      setSectionLabelPos(sectionDrag.id, { x: sectionDrag.x, y: sectionDrag.y });
      grab.current = null;
      setSectionDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [sectionDrag, toWorld, setSectionLabelPos, setSectionDrag]);

  return (
    <>
      {sections.map((sec) => {
        const pos =
          sectionDrag?.id === sec.id
            ? sectionDrag
            : sec.labelPos ?? defaultLabel(sec.nodeIds, centers);
        if (!pos) return null;
        return (
          <SectionLabel
            key={sec.id}
            x={pos.x}
            y={pos.y}
            title={sec.title ?? ''}
            color={sec.color}
            onTitle={(t) => setSectionTitle(sec.id, t)}
            onColor={(c) => setSectionColor(sec.id, c)}
            onDelete={() => removeSection(sec.id)}
            onDragStart={(e) => {
              const w = toWorld(e.clientX, e.clientY);
              grab.current = { x: w.x - pos.x, y: w.y - pos.y };
              setSectionDrag({ id: sec.id, x: pos.x, y: pos.y });
            }}
          />
        );
      })}

      {connections.map((c) => {
        const a = resolveCenter(c.from, centers, nodes);
        const z = resolveCenter(c.to, centers, nodes);
        if (!a || !z || a === z) return null;
        const memoPos =
          dragPos && dragPos.id === c.id
            ? dragPos
            : c.labelPos ?? { x: (a.cx + z.cx) / 2, y: (a.cy + z.cy) / 2 };
        const hasMemo = c.note != null || editing === c.id;

        if (!hasMemo) {
          return (
            <div
              key={c.id}
              className="conn-handle"
              style={{ left: memoPos.x, top: memoPos.y }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button className="conn-add" title="메모 추가" onClick={() => setEditing(c.id)}>
                ＋
              </button>
              <button className="conn-del" title="연결 삭제" onClick={() => removeConnection(c.id)}>
                ✕
              </button>
            </div>
          );
        }

        return (
          <ConnMemo
            key={c.id}
            x={memoPos.x}
            y={memoPos.y}
            note={c.note ?? ''}
            startEditing={editing === c.id}
            onCommit={(text) => {
              if (text.trim() === '' && editing === c.id) setEditing(null);
              else {
                setConnectionNote(c.id, text);
                setEditing(null);
              }
            }}
            onDelete={() => removeConnection(c.id)}
            onDragStart={(e) => {
              const w = toWorld(e.clientX, e.clientY);
              grab.current = { x: w.x - memoPos.x, y: w.y - memoPos.y };
              setDragPos({ id: c.id, x: memoPos.x, y: memoPos.y });
            }}
          />
        );
      })}
    </>
  );
}

function SectionLabel({
  x,
  y,
  title,
  color,
  onTitle,
  onColor,
  onDelete,
  onDragStart,
}: {
  x: number;
  y: number;
  title: string;
  color?: string;
  onTitle: (t: string) => void;
  onColor: (c: string | undefined) => void;
  onDelete: () => void;
  onDragStart: (e: React.PointerEvent) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [showColors, setShowColors] = useState(false);
  // Buffer the title locally and commit once on blur/Enter — committing on every
  // keystroke floods undo history and deep-clones the whole document per character.
  const [draft, setDraft] = useState(title);
  const committed = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (edit) {
      committed.current = false;
      setDraft(title);
      ref.current?.focus();
      ref.current?.select();
    }
  }, [edit, title]);

  const finish = (save: boolean) => {
    if (committed.current) return;
    committed.current = true;
    if (save && draft !== title) onTitle(draft);
    setEdit(false);
  };

  return (
    <div
      className="section-label"
      style={{ left: x, top: y }}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (!edit) onDragStart(e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEdit(true);
      }}
    >
      <button
        className="section-dot"
        title="섹션 색상"
        style={{ background: color ?? 'var(--ink-faint)' }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setShowColors((v) => !v)}
      />
      {edit ? (
        <input
          ref={ref}
          className="section-title"
          value={draft}
          placeholder="섹션"
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') finish(true);
            else if (e.key === 'Escape') finish(false);
          }}
        />
      ) : (
        <span className="section-title-text">{title || '섹션'}</span>
      )}
      <button
        className="section-del"
        title="섹션 삭제"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onDelete}
      >
        ✕
      </button>

      {showColors && (
        <div className="section-swatches" onPointerDown={(e) => e.stopPropagation()}>
          {SECTION_COLORS.map((c) => (
            <button
              key={c}
              className="section-swatch"
              style={{ background: c }}
              onClick={() => {
                onColor(c);
                setShowColors(false);
              }}
            />
          ))}
          <button
            className="section-swatch none"
            title="색 제거"
            onClick={() => {
              onColor(undefined);
              setShowColors(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

function ConnMemo({
  x,
  y,
  note,
  startEditing,
  onCommit,
  onDelete,
  onDragStart,
}: {
  x: number;
  y: number;
  note: string;
  startEditing: boolean;
  onCommit: (text: string) => void;
  onDelete: () => void;
  onDragStart: (e: React.PointerEvent) => void;
}) {
  const [edit, setEdit] = useState(startEditing);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [val, setVal] = useState(note);

  useEffect(() => {
    if (edit) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [edit]);

  return (
    <div
      className="conn-memo"
      style={{ left: x, top: y }}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (!edit) onDragStart(e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEdit(true);
      }}
    >
      {edit ? (
        <textarea
          ref={ref}
          className="conn-memo-input"
          value={val}
          rows={1}
          onChange={(e) => setVal(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={() => {
            setEdit(false);
            onCommit(val);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') {
              e.preventDefault();
              setEdit(false);
              onCommit(val);
            }
          }}
        />
      ) : (
        <span className="conn-memo-text">{note || '메모'}</span>
      )}
      <button
        className="conn-del"
        title="연결 삭제"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onDelete}
      >
        ✕
      </button>
    </div>
  );
}
