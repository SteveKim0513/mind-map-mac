import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMap, useMapStore } from '../store/mapStore';
import { useUi } from '../store/uiStore';
import { layout, type LayoutResult } from '../layout/treeLayout';
import { measureNode } from '../layout/measure';
import { NodeView } from './NodeView';
import { Edges } from './Edges';
import { OverlaysBack, OverlaysFront } from './Overlays';
import { SelectionToolbar } from './SelectionToolbar';

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const DRAG_THRESHOLD = 5; // px before a press becomes a drag
const DROP_RADIUS = 130; // world-px radius for snapping onto a drop target

export interface CanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}

export const Canvas = forwardRef<CanvasHandle, { active?: boolean }>(function Canvas(
  { active = true },
  ref,
) {
  const doc = useMap((s) => s.doc);
  const selectedIds = useMap((s) => s.selectedIds);
  const editingId = useMap((s) => s.editingId);
  const select = useMap((s) => s.select);
  const reparent = useMap((s) => s.reparent);
  const reparentMany = useMap((s) => s.reparentMany);
  const setManualPos = useMap((s) => s.setManualPos);
  const setView = useMap((s) => s.setView);
  const addRootAt = useMap((s) => s.addRootAt);
  const focusRootId = useMap((s) => s.focusRootId);
  const colorFilter = useMap((s) => s.colorFilter);
  const filterAncestors = useMap((s) => s.filterAncestors);
  const filterDescendants = useMap((s) => s.filterDescendants);
  const mapStore = useMapStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const { zoom, panX, panY } = doc.view;

  // measured node sizes drive the layout (width → horizontal, height → vertical spacing)
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number; below: number }>>({});
  // mirror of `sizes` for callbacks (fit) that need the latest measurements
  // without re-subscribing — avoids fitting against default node sizes.
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;
  const onMeasure = useCallback((id: string, w: number, h: number, below: number) => {
    setSizes((prev) => {
      const p = prev[id];
      if (p && Math.abs(p.w - w) < 1 && Math.abs(p.h - h) < 1 && Math.abs(p.below - below) < 1)
        return prev;
      return { ...prev, [id]: { w, h, below } };
    });
  }, []);

  const result: LayoutResult = useMemo(
    () => layout(doc, sizes, focusRootId, colorFilter, filterAncestors, filterDescendants),
    [doc, sizes, focusRootId, colorFilter, filterAncestors, filterDescendants],
  );
  const selSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // live position of a connection memo / section label being dragged
  const [memoDrag, setMemoDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [sectionDrag, setSectionDrag] = useState<{ id: string; x: number; y: number } | null>(null);

  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  // sibling-reorder insertion marker (world coords) shown while dragging a node
  // into the gap above/below one of its (future) siblings
  const [insertMark, setInsertMark] = useState<{ x: number; y: number; w: number } | null>(null);
  // read synchronously in pointerup (state is async); null ⇒ no sibling insert
  const insertRef = useRef<{ parentId: string | null; index: number } | null>(null);
  // live offset while a whole root tree is being moved
  const [rootDrag, setRootDrag] = useState<{ rootId: string; dx: number; dy: number } | null>(null);
  // true after a drag ends → keep the selection toolbar hidden until the next click
  const [dragSuppress, setDragSuppress] = useState(false);
  const [panning, setPanning] = useState(false);

  // …or until the user navigates with the keyboard: arrow keys after a drag must
  // bring the toolbar back too, not just a mouse click (keyboard-first app).
  // Keyed on the keystroke, not on selection state — a selection-change effect
  // would flush after the drag's own mouseup and undo the suppression.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.startsWith('Arrow')) setDragSuppress(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Mutable interaction state kept in a ref so window listeners see fresh values.
  const interaction = useRef<
    | { mode: 'idle' }
    | { mode: 'pending-drag'; id: string; startX: number; startY: number }
    // reparent: a non-root node dragged onto another node
    | { mode: 'dragging'; kind: 'reparent'; id: string; grabX: number; grabY: number }
    // move-root: a root node dragged to freely reposition its whole tree
    | { mode: 'dragging'; kind: 'move-root'; id: string; startWX: number; startWY: number; dx: number; dy: number }
    | { mode: 'panning'; startX: number; startY: number; startPanX: number; startPanY: number }
  >({ mode: 'idle' });


  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current!.getBoundingClientRect();
      return {
        x: (clientX - rect.left - panX) / zoom,
        y: (clientY - rect.top - panY) / zoom,
      };
    },
    [panX, panY, zoom],
  );

  // ── Pan / drag pointer pipeline ───────────────────────────────────────────
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const st = interaction.current;
      if (st.mode === 'panning') {
        setView({ panX: st.startPanX + (e.clientX - st.startX), panY: st.startPanY + (e.clientY - st.startY) });
        return;
      }
      if (st.mode === 'pending-drag') {
        if (Math.hypot(e.clientX - st.startX, e.clientY - st.startY) > DRAG_THRESHOLD) {
          const isRoot = doc.nodes[st.id]?.parentId === null;
          if (isRoot) {
            // dragging a center topic moves its whole tree rigidly
            const sw = toWorld(st.startX, st.startY);
            interaction.current = {
              mode: 'dragging',
              kind: 'move-root',
              id: st.id,
              startWX: sw.x,
              startWY: sw.y,
              dx: 0,
              dy: 0,
            };
          } else {
            // remember where on the node we grabbed it, so it tracks the cursor exactly
            const startWorld = toWorld(st.startX, st.startY);
            const center = result.nodes.find((p) => p.node.id === st.id);
            const grabX = center ? startWorld.x - center.x : 0;
            const grabY = center ? startWorld.y - center.y : 0;
            interaction.current = { mode: 'dragging', kind: 'reparent', id: st.id, grabX, grabY };
          }
          setDraggingId(st.id);
        }
        return;
      }
      if (st.mode === 'dragging') {
        const w = toWorld(e.clientX, e.clientY);

        if (st.kind === 'move-root') {
          st.dx = w.x - st.startWX;
          st.dy = w.y - st.startWY;
          setRootDrag({ rootId: st.id, dx: st.dx, dy: st.dy });
          return;
        }

        // reparent: move the node so the grabbed point stays under the cursor
        setDragPos({ id: st.id, x: w.x - st.grabX, y: w.y - st.grabY });
        // find nearest eligible node center to the cursor
        let best: string | null = null;
        let bestDist = DROP_RADIUS;
        for (const p of result.nodes) {
          if (p.node.id === st.id) continue;
          // skip descendants of the dragged node (would create a cycle)
          if (isDescendant(doc.nodes, st.id, p.node.id)) continue;
          const cx = p.x + p.width / 2;
          const d = Math.hypot(cx - w.x, p.y - w.y);
          if (d < bestDist) {
            bestDist = d;
            best = p.node.id;
          }
        }

        // Decide intent against the nearest node T: hovering its top/bottom third
        // (and T is a non-root, single-target) ⇒ reorder as a SIBLING before/after
        // T; hovering its middle ⇒ reparent as T's CHILD (legacy behavior).
        const Tp = best ? result.nodes.find((p) => p.node.id === best) : null;
        const tEl = best
          ? (containerRef.current?.querySelector(`[data-node-id="${best}"]`) as HTMLElement | null)
          : null;
        const rect = tEl?.getBoundingClientRect();
        const multi = mapStore.getState().selectedIds.length > 1;
        if (Tp && rect && !multi && Tp.node.parentId) {
          const band = rect.height * 0.34;
          const before = e.clientY < rect.top + band;
          const after = e.clientY > rect.bottom - band;
          if (before || after) {
            const z = mapStore.getState().doc.view.zoom || 1;
            const halfH = rect.height / z / 2;
            const parentId = Tp.node.parentId;
            const sibs = doc.nodes[parentId].children.filter((id) => id !== st.id);
            const ti = sibs.indexOf(best!);
            insertRef.current = { parentId, index: before ? ti : ti + 1 };
            setInsertMark({ x: Tp.x, y: Tp.y + (before ? -halfH - 13 : halfH + 13), w: Tp.width });
            setDropTargetId(null);
            return;
          }
        }
        insertRef.current = null;
        setInsertMark(null);
        setDropTargetId(best);
      }
    };

    const onUp = () => {
      const st = interaction.current;
      // a real drag just ended → suppress the toolbar; a plain click (pending-drag
      // that never moved) → allow it. Selecting via click re-shows the toolbar.
      if (st.mode === 'dragging') setDragSuppress(true);
      else if (st.mode === 'pending-drag') setDragSuppress(false);
      if (st.mode === 'dragging') {
        setDraggingId(null);
        if (st.kind === 'move-root') {
          const rootPos = result.nodes.find((p) => p.node.id === st.id);
          if (rootPos && (st.dx !== 0 || st.dy !== 0)) {
            setManualPos(st.id, { x: rootPos.x + st.dx, y: rootPos.y + st.dy });
          }
          setRootDrag(null);
        } else {
          setDragPos(null);
          const draggedId = st.id;
          const ins = insertRef.current;
          if (ins) {
            // dropped in a sibling gap → reorder (reparent at a specific index)
            reparent(draggedId, ins.parentId, ins.index);
            insertRef.current = null;
            setInsertMark(null);
            setDropTargetId(null);
          } else {
            setDropTargetId((target) => {
              if (target) {
                const sel = mapStore.getState().selectedIds;
                // if the dragged node is part of a multi-selection, move them all
                if (sel.length > 1 && sel.includes(draggedId)) reparentMany(sel, target);
                else reparent(draggedId, target);
              }
              return null;
            });
          }
        }
      }
      setPanning(false);
      interaction.current = { mode: 'idle' };
    };

    // pointercancel (OS gesture / window blur / touch interruption) aborts the
    // interaction cleanly — without this the drag state would be left stuck.
    const onCancel = () => {
      setDraggingId(null);
      setDragPos(null);
      setRootDrag(null);
      setDropTargetId(null);
      setInsertMark(null);
      insertRef.current = null;
      setPanning(false);
      interaction.current = { mode: 'idle' };
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [doc.nodes, result.nodes, reparent, reparentMany, setManualPos, setView, toWorld, mapStore]);

  // The selection toolbar is suppressed after a drag and restored on the next
  // genuine click (onUp's pending-drag branch flips it back). We deliberately do
  // NOT clear it on every selectedIds change — the spurious click that can follow
  // a small drag would otherwise re-show the toolbar right after a drag.

  const handleNodePointerDown = (id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    interaction.current = { mode: 'pending-drag', id, startX: e.clientX, startY: e.clientY };
  };

  const handleBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // if a node is being edited, finish it first (commit via blur) instead of
    // clearing editingId out from under the editor → keeps the typed text
    if (mapStore.getState().editingId) {
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    select(null);
    interaction.current = {
      mode: 'panning',
      startX: e.clientX,
      startY: e.clientY,
      startPanX: panX,
      startPanY: panY,
    };
    setPanning(true);
  };

  // Block Chromium's native ctrl/⌘+wheel page zoom (React's onWheel can be passive,
  // so preventDefault must come from a non-passive native listener).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, []);

  // ── Wheel: trackpad pan, ctrl/⌘ + wheel (pinch) zoom ──────────────────────
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const rect = containerRef.current!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.01);
      const nz = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
      // keep the world point under the cursor fixed
      const wx = (cx - panX) / zoom;
      const wy = (cy - panY) / zoom;
      setView({ zoom: nz, panX: cx - wx * nz, panY: cy - wy * nz });
    } else {
      setView({ panX: panX - e.deltaX, panY: panY - e.deltaY });
    }
  };

  // ── View commands (menu + buttons) — read fresh state so the ref handle is stable
  const zoomAtCenter = useCallback(
    (factor: number) => {
      const rect = containerRef.current!.getBoundingClientRect();
      const v = mapStore.getState().doc.view;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const nz = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const wx = (cx - v.panX) / v.zoom;
      const wy = (cy - v.panY) / v.zoom;
      setView({ zoom: nz, panX: cx - wx * nz, panY: cy - wy * nz });
    },
    [mapStore, setView],
  );

  const fitBounds = useCallback(
    (b: { minX: number; minY: number; maxX: number; maxY: number }, maxZoom = 1.4) => {
      const rect = containerRef.current!.getBoundingClientRect();
      const pad = 120;
      const contentW = b.maxX - b.minX + pad * 2;
      const contentH = b.maxY - b.minY + pad * 2;
      const nz = clamp(Math.min(rect.width / contentW, rect.height / contentH), MIN_ZOOM, maxZoom);
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      setView({ zoom: nz, panX: rect.width / 2 - cx * nz, panY: rect.height / 2 - cy * nz });
    },
    [setView],
  );

  const fit = useCallback(() => {
    const s = mapStore.getState();
    fitBounds(
      layout(s.doc, sizesRef.current, s.focusRootId, s.colorFilter, s.filterAncestors, s.filterDescendants)
        .bounds,
    );
  }, [mapStore, fitBounds]);

  // Re-fit the view whenever a new document is loaded (and on first mount).
  // This keeps the first node centered instead of stranded at the origin (top-left).
  const docEpoch = useMap((s) => s.docEpoch);
  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docEpoch]);

  // Center a node when something (e.g. search) requests focus — active pane only.
  const focusReq = useUi((s) => s.focusReq);
  useEffect(() => {
    if (!focusReq || !active) return;
    const p = result.nodes.find((n) => n.node.id === focusReq.id);
    if (!p) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const z = mapStore.getState().doc.view.zoom;
    const cx = p.x + p.width / 2;
    setView({ panX: rect.width / 2 - cx * z, panY: rect.height / 2 - p.y * z });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusReq?.nonce]);

  // Zoom to a node's whole subtree (Z key / context menu) — active pane only.
  const zoomReq = useUi((s) => s.zoomReq);
  useEffect(() => {
    if (!zoomReq || !active) return;
    const ids = new Set<string>();
    const collect = (id: string) => {
      ids.add(id);
      (doc.nodes[id]?.children ?? []).forEach(collect);
    };
    collect(zoomReq.id);
    const pts = result.nodes.filter((n) => ids.has(n.node.id));
    if (!pts.length) return;
    const b = {
      minX: Math.min(...pts.map((p) => p.x)),
      minY: Math.min(...pts.map((p) => p.y)),
      maxX: Math.max(...pts.map((p) => p.x + p.width)),
      maxY: Math.max(...pts.map((p) => p.y)),
    };
    fitBounds(b, 1.6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomReq?.nonce]);

  // Manual refresh: re-read every node's real size from the DOM, then re-fit.
  const relayoutReq = useUi((s) => s.relayoutReq);
  useEffect(() => {
    if (relayoutReq === 0) return;
    if (!active) return; // only the active pane responds to the global refresh nonce
    const els = containerRef.current?.querySelectorAll<HTMLElement>('[data-node-id]');
    if (els && els.length) {
      const next: Record<string, { w: number; h: number; below: number }> = {};
      els.forEach((el) => {
        const id = el.dataset.nodeId;
        if (id) next[id] = measureNode(el);
      });
      setSizes(next);
    }
    requestAnimationFrame(() => fit());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayoutReq]);

  // Expose zoom controls to the parent pane (toolbar + menu route here).
  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomAtCenter(1.2),
      zoomOut: () => zoomAtCenter(1 / 1.2),
      fit,
    }),
    [zoomAtCenter, fit],
  );

  const rootSet = useMemo(() => new Set(doc.rootIds), [doc.rootIds]);

  // live node position with drag overrides applied — so connection lines, tree
  // edges, and sections all follow a node while it's being dragged.
  const livePos = (p: (typeof result.nodes)[number]) => {
    if (rootDrag && rootDrag.rootId === p.rootId) return { x: p.x + rootDrag.dx, y: p.y + rootDrag.dy };
    if (dragPos && dragPos.id === p.node.id) return { x: dragPos.x, y: dragPos.y };
    return { x: p.x, y: p.y };
  };
  const liveById = new Map<string, { x: number; y: number; w: number }>();
  const centers: Record<string, { cx: number; cy: number; w: number; h: number }> = {};
  for (const p of result.nodes) {
    const lp = livePos(p);
    liveById.set(p.node.id, { ...lp, w: p.width });
    centers[p.node.id] = { cx: lp.x + p.width / 2, cy: lp.y, w: p.width, h: sizes[p.node.id]?.h ?? 34 };
  }
  const liveEdges = result.edges.map((e) => {
    const cut = e.id.indexOf('->');
    const a = liveById.get(e.id.slice(0, cut));
    const b = liveById.get(e.id.slice(cut + 2));
    if (!a || !b) return e;
    return { ...e, source: { x: a.x + a.w, y: a.y }, target: { x: b.x, y: b.y } };
  });

  // floating selection toolbar position (screen space, above the node)
  const selToolbar = (() => {
    // hide while dragging a node/tree, and stay hidden after a drag until the next click
    if (draggingId || rootDrag || dragSuppress) return null;
    if (editingId || selectedIds.length !== 1) return null;
    const id = selectedIds[0];
    const c = centers[id];
    if (!c) return null;
    return { id, sx: c.cx * zoom + panX, sy: (c.cy - c.h / 2) * zoom + panY };
  })();
  const lod = zoom < 0.42; // semantic zoom: hide chips/badges only when truly zoomed out

  return (
    <div
      ref={containerRef}
      className={`canvas${panning ? ' panning' : ''}${lod ? ' lod' : ''}`}
      onPointerDown={handleBackgroundPointerDown}
      onDoubleClick={(e) => {
        // double-click empty canvas → new center topic at the cursor — but not when
        // the gesture was used to dismiss an editor (its pointerdown just committed).
        const st = mapStore.getState();
        if (st.editingId || Date.now() - st.editCommittedAt < 250) return;
        const w = toWorld(e.clientX, e.clientY);
        addRootAt(w.x, w.y);
      }}
      onWheel={onWheel}
      data-zoom-controls
    >
      <div
        className="canvas-grid"
        style={{
          backgroundPosition: `${panX}px ${panY}px`,
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
        }}
      />
      <div
        className="world"
        style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }}
      >
        <OverlaysBack centers={centers} dragPos={memoDrag} sectionDrag={sectionDrag} />
        <Edges edges={liveEdges} />
        {result.nodes.map((p) => {
          let pp = p;
          if (rootDrag && rootDrag.rootId === p.rootId) {
            // whole tree follows the dragged root
            pp = { ...p, x: p.x + rootDrag.dx, y: p.y + rootDrag.dy };
          } else if (dragPos && dragPos.id === p.node.id) {
            // single node follows the cursor (reparent)
            pp = { ...p, x: dragPos.x, y: dragPos.y };
          }
          return (
          <NodeView
            key={p.node.id}
            p={pp}
            isRoot={rootSet.has(p.node.id)}
            selected={selSet.has(p.node.id)}
            editing={p.node.id === editingId}
            isDropTarget={p.node.id === dropTargetId}
            isDragging={p.node.id === draggingId}
            onPointerDown={handleNodePointerDown}
            onMeasure={onMeasure}
          />
          );
        })}
        <OverlaysFront
          centers={centers}
          toWorld={toWorld}
          dragPos={memoDrag}
          setDragPos={setMemoDrag}
          sectionDrag={sectionDrag}
          setSectionDrag={setSectionDrag}
        />
        {insertMark && (
          <div
            className="node-insert-line"
            style={{ left: insertMark.x, top: insertMark.y, width: insertMark.w }}
          />
        )}
      </div>

      {selToolbar && (
        <SelectionToolbar
          key={selToolbar.id}
          nodeId={selToolbar.id}
          sx={selToolbar.sx}
          sy={selToolbar.sy}
        />
      )}
    </div>
  );
});

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function isDescendant(
  nodes: Record<string, { parentId: string | null }>,
  ancestor: string,
  id: string,
): boolean {
  let cur: string | null = id;
  while (cur) {
    if (cur === ancestor) return true;
    cur = nodes[cur]?.parentId ?? null;
  }
  return false;
}
