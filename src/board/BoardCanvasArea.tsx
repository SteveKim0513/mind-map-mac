import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useBoard, useBoardStore } from '../store/boardStore';
import { BoardElementView } from './BoardElementView';
import { BoardSelectionToolbar } from './BoardSelectionToolbar';
import { BoardNodePicker } from './BoardNodePicker';
import { BoardNoteLinkPicker } from './BoardNoteLinkPicker';
import { ensureMapPersisted } from './boardLinks';
import { elementBBox, boardBounds, isBoxElement, anchorPoint, oppositeAnchor, type BoxElement } from './boardGeometry';
import { routeWaypoints, roundedPath, pointsBBox, pathMidpoint } from './boardRouting';
import { autoLayoutPositions } from './boardLayout';
import { newId } from '../io/formats';
import { tagVar } from '../theme/palette';
import type { BoardAnchorSide, BoardConnectorElement, BoardElement, BoardStickyElement } from '../types';

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const MIN_SIZE = 24;
const DRAG_THRESHOLD = 5; // px before an anchor press counts as a drag, not a click
const CHILD_GAP = 56; // px between a source edge and an auto-created child sticky
const NEW_STICKY_W = 180;
const NEW_STICKY_H = 140;

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function newSticky(x: number, y: number): BoardStickyElement {
  return { id: newId(), kind: 'sticky', x, y, width: NEW_STICKY_W, height: NEW_STICKY_H, text: '', color: 'yellow' };
}

/** Nearest of an element's 4 anchor sides to a world point (used to pick
 *  where an in-progress connector should land when dropped on it). */
function nearestAnchorSide(el: BoxElement, point: { x: number; y: number }): BoardAnchorSide {
  const sides: BoardAnchorSide[] = ['top', 'right', 'bottom', 'left'];
  let best: BoardAnchorSide = 'top';
  let bestDist = Infinity;
  for (const side of sides) {
    const p = anchorPoint(el, side);
    const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = side;
    }
  }
  return best;
}

/** Topmost box element (sticky/image) whose bounds contain `point`, excluding `excludeId`. */
function elementAt(
  elements: Record<string, BoardElement>,
  order: string[],
  point: { x: number; y: number },
  excludeId: string,
): string | null {
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    if (id === excludeId) continue;
    const el = elements[id];
    if (!el || !isBoxElement(el)) continue;
    const box = elementBBox(el);
    if (point.x >= box.x0 && point.x <= box.x1 && point.y >= box.y0 && point.y <= box.y1) return id;
  }
  return null;
}

function childStickySpot(source: BoxElement, side: BoardAnchorSide): { x: number; y: number } {
  const a = anchorPoint(source, side);
  switch (side) {
    case 'right':
      return { x: a.x + CHILD_GAP, y: a.y - NEW_STICKY_H / 2 };
    case 'left':
      return { x: a.x - CHILD_GAP - NEW_STICKY_W, y: a.y - NEW_STICKY_H / 2 };
    case 'bottom':
      return { x: a.x - NEW_STICKY_W / 2, y: a.y + CHILD_GAP };
    case 'top':
      return { x: a.x - NEW_STICKY_W / 2, y: a.y - CHILD_GAP - NEW_STICKY_H };
  }
}

type Handle = 'nw' | 'ne' | 'sw' | 'se';

type EditingTarget = { id: string; field: 'text' } | { id: string; field: 'note'; index: number };

type Drag =
  | { mode: 'marquee'; startWorld: { x: number; y: number }; additive: boolean }
  | { mode: 'move'; ids: string[]; lastClientX: number; lastClientY: number }
  | {
      mode: 'resize';
      id: string;
      handle: Handle;
      startClientX: number;
      startClientY: number;
      startBox: { x: number; y: number; width: number; height: number };
    }
  | {
      mode: 'connect';
      fromId: string;
      fromAnchor: BoardAnchorSide;
      startClientX: number;
      startClientY: number;
      moved: boolean;
    }
  | {
      mode: 'reattach';
      connectorId: string;
      end: 'from' | 'to';
      otherId: string;
      otherAnchor: BoardAnchorSide;
    };

export interface BoardCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  /** Auto-arrange the connected cluster reachable from the single selected
   *  element (see board/boardLayout.ts). No-op unless exactly one sticky is
   *  selected and it has outgoing connectors. */
  tidySelected: () => void;
}

interface Props {
  boardFilePath: string | null;
}

/** The interactive canvas: pan/zoom (mirrors canvas/Canvas.tsx's wheel gestures
 *  for muscle-memory parity), marquee select, element drag/resize, anchor-based
 *  connector drawing with smart routing, and inline text editing for sticky
 *  notes (main text + any number of fused notes stacked below). */
export const BoardCanvasArea = forwardRef<BoardCanvasHandle, Props>(function BoardCanvasArea(
  { boardFilePath },
  ref,
) {
  const store = useBoardStore();
  const board = useBoard((s) => s.board);
  const selection = useBoard((s) => s.selection);
  const colorFilter = useBoard((s) => s.colorFilter);
  const shapeFilter = useBoard((s) => s.shapeFilter);
  const setSelection = useBoard((s) => s.setSelection);
  const moveElements = useBoard((s) => s.moveElements);
  const updateElement = useBoard((s) => s.updateElement);
  const removeElements = useBoard((s) => s.removeElements);
  const addElements = useBoard((s) => s.addElements);
  const setView = useBoard((s) => s.setView);
  const setNodeLink = useBoard((s) => s.setNodeLink);
  const setNoteLink = useBoard((s) => s.setNoteLink);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [connectPreview, setConnectPreview] = useState<{
    fromId: string;
    fromAnchor: BoardAnchorSide;
    to: { x: number; y: number };
    targetId: string | null;
    snapAnchor: BoardAnchorSide | null;
  } | null>(null);
  const [editingTarget, setEditingTarget] = useState<EditingTarget | null>(null);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [linkPicker, setLinkPicker] = useState<'node' | 'note' | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [imageCache, setImageCache] = useState<Record<string, string>>({});
  const fetchingRef = useRef<Set<string>>(new Set());

  const { zoom, panX, panY } = board.view;

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current!.getBoundingClientRect();
      return { x: (clientX - rect.left - panX) / zoom, y: (clientY - rect.top - panY) / zoom };
    },
    [panX, panY, zoom],
  );

  // Resolve image elements' relative `src` (asset-folder path) to a data: URI —
  // same images:read IPC + hidden-folder convention as note images (decision 0010).
  useEffect(() => {
    if (!boardFilePath) return;
    for (const el of Object.values(board.elements)) {
      if (el.kind !== 'image') continue;
      if (imageCache[el.src] || fetchingRef.current.has(el.src)) continue;
      fetchingRef.current.add(el.src);
      void window.api
        .imagesRead({ notePath: boardFilePath, filepath: el.src })
        .then((uri) => setImageCache((m) => ({ ...m, [el.src]: uri })))
        .catch(() => {})
        .finally(() => fetchingRef.current.delete(el.src));
    }
  }, [board.elements, boardFilePath, imageCache]);

  // Block Chromium's native ctrl/⌘+wheel page zoom (mirrors canvas/Canvas.tsx).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, []);

  const onWheel = (e: React.WheelEvent) => {
    const v = store.getState().board.view;
    if (e.ctrlKey || e.metaKey) {
      const rect = containerRef.current!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.01);
      const nz = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const wx = (cx - v.panX) / v.zoom;
      const wy = (cy - v.panY) / v.zoom;
      setView({ zoom: nz, panX: cx - wx * nz, panY: cy - wy * nz });
    } else {
      setView({ panX: v.panX - e.deltaX, panY: v.panY - e.deltaY });
    }
  };

  const zoomAtCenter = useCallback(
    (factor: number) => {
      const rect = containerRef.current!.getBoundingClientRect();
      const v = store.getState().board.view;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const nz = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const wx = (cx - v.panX) / v.zoom;
      const wy = (cy - v.panY) / v.zoom;
      setView({ zoom: nz, panX: cx - wx * nz, panY: cy - wy * nz });
    },
    [store, setView],
  );

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomAtCenter(1.2),
      zoomOut: () => zoomAtCenter(1 / 1.2),
      fit: () => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const b = boardBounds(store.getState().board.elements);
        if (!b) {
          setView({ zoom: 1, panX: 0, panY: 0 });
          return;
        }
        const pad = 80;
        const contentW = b.x1 - b.x0 + pad * 2;
        const contentH = b.y1 - b.y0 + pad * 2;
        const nz = clamp(Math.min(rect.width / contentW, rect.height / contentH), MIN_ZOOM, 1.4);
        const cx = (b.x0 + b.x1) / 2;
        const cy = (b.y0 + b.y1) / 2;
        setView({ zoom: nz, panX: rect.width / 2 - cx * nz, panY: rect.height / 2 - cy * nz });
      },
      tidySelected: () => {
        if (selection.length !== 1) return;
        const positions = autoLayoutPositions(selection[0], store.getState().board.elements);
        if (positions.length) store.getState().setElementPositions(positions);
      },
    }),
    [store, setView, selection],
  );

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    containerRef.current?.setPointerCapture(e.pointerId);
    containerRef.current?.focus();
    const w = toWorld(e.clientX, e.clientY);
    if (!e.shiftKey) setSelection([]);
    dragRef.current = { mode: 'marquee', startWorld: w, additive: e.shiftKey };
    setMarquee({ x0: w.x, y0: w.y, x1: w.x, y1: w.y });
    setEditingTarget(null);
  };

  // Manual double-click detection (pointerdown-based) instead of the native
  // `dblclick` DOM event: once a drag-capable element calls setPointerCapture
  // on the container mid-gesture, the browser retargets the compat mouse
  // events (click/dblclick) it synthesizes from that pointer to the CAPTURING
  // element instead of the original target — so a real `dblclick` on the
  // element never fires. Tracking clicks ourselves sidesteps that entirely.
  const lastClickRef = useRef<{ id: string; region: string; time: number } | null>(null);
  const DOUBLE_CLICK_MS = 400;

  const onElementPointerDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // Suppress the browser's default mousedown focus handling — without this,
    // when the 2nd click of a double-click swaps a div for an autoFocus'd
    // textarea mid-event, Chromium's default action (running AFTER our sync
    // re-render, evaluated against the now-removed, non-focusable original
    // target) blurs the textarea straight back out again.
    e.preventDefault();
    const now = Date.now();
    // Which text region (main vs. a specific fused note block) was actually
    // hit — BoardElementView tags each with data-board-region so a double-
    // click on any of them edits THAT field, not always the main text.
    const region = (e.target as HTMLElement).closest('[data-board-region]')?.getAttribute('data-board-region') ?? 'text';
    const isDoubleClick =
      lastClickRef.current?.id === id && lastClickRef.current.region === region && now - lastClickRef.current.time < DOUBLE_CLICK_MS;
    lastClickRef.current = { id, region, time: now };
    const el = board.elements[id];
    if (isDoubleClick && el && el.kind === 'sticky') {
      setSelection([id]);
      setEditingTarget(region.startsWith('note-') ? { id, field: 'note', index: Number(region.slice(5)) } : { id, field: 'text' });
      return; // the click that opened editing shouldn't also start a move-drag
    }
    containerRef.current?.setPointerCapture(e.pointerId);
    containerRef.current?.focus();
    const already = selection.includes(id);
    const next = e.shiftKey ? (already ? selection.filter((x) => x !== id) : [...selection, id]) : already ? selection : [id];
    setSelection(next);
    dragRef.current = { mode: 'move', ids: next, lastClientX: e.clientX, lastClientY: e.clientY };
  };

  const beginResize = (e: React.PointerEvent, id: string, handle: Handle) => {
    e.stopPropagation();
    containerRef.current?.setPointerCapture(e.pointerId);
    const el = board.elements[id];
    if (!el || !isBoxElement(el)) return;
    dragRef.current = {
      mode: 'resize',
      id,
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startBox: { x: el.x, y: el.y, width: el.width, height: el.height },
    };
  };

  const onConnectorPointerDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    containerRef.current?.setPointerCapture(e.pointerId);
    containerRef.current?.focus();
    const already = selection.includes(id);
    const next = e.shiftKey ? (already ? selection.filter((x) => x !== id) : [...selection, id]) : already ? selection : [id];
    setSelection(next);
  };

  const beginAnchorDrag = (side: BoardAnchorSide, id: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    containerRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = { mode: 'connect', fromId: id, fromAnchor: side, startClientX: e.clientX, startClientY: e.clientY, moved: false };
    const el = board.elements[id];
    if (el && isBoxElement(el)) {
      const p = anchorPoint(el, side);
      setConnectPreview({ fromId: id, fromAnchor: side, to: p, targetId: null, snapAnchor: null });
    }
  };

  /** Click+drag the on the end of an already-drawn connector to reattach it to
   *  a different element/anchor (2026-09-03) — same route/snap preview as
   *  drawing a brand-new connector, just re-pointing an existing one instead
   *  of creating one. Dropped on empty canvas or the connector's own other
   *  end → cancelled, original attachment kept (no implicit sticky spawn here,
   *  unlike a fresh anchor drag — an accidental drop shouldn't rewrite an
   *  existing structure). */
  const beginEndpointDrag = (
    connectorId: string,
    end: 'from' | 'to',
    otherId: string,
    otherAnchor: BoardAnchorSide,
    e: React.PointerEvent,
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    containerRef.current?.setPointerCapture(e.pointerId);
    setSelection([connectorId]);
    dragRef.current = { mode: 'reattach', connectorId, end, otherId, otherAnchor };
    const otherEl = board.elements[otherId];
    if (otherEl && isBoxElement(otherEl)) {
      const p = anchorPoint(otherEl, otherAnchor);
      setConnectPreview({ fromId: otherId, fromAnchor: otherAnchor, to: p, targetId: null, snapAnchor: null });
    }
  };

  const createConnectedChild = (fromId: string, side: BoardAnchorSide) => {
    const fromEl = store.getState().board.elements[fromId];
    if (!fromEl || !isBoxElement(fromEl)) return;
    const spot = childStickySpot(fromEl, side);
    const sticky = newSticky(spot.x, spot.y);
    const connector: BoardConnectorElement = {
      id: newId(),
      kind: 'connector',
      fromId,
      fromAnchor: side,
      toId: sticky.id,
      toAnchor: oppositeAnchor(side),
      arrow: true,
    };
    addElements([connector, sticky]);
    setEditingTarget({ id: sticky.id, field: 'text' });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.mode === 'marquee') {
      const w = toWorld(e.clientX, e.clientY);
      const rect = { x0: d.startWorld.x, y0: d.startWorld.y, x1: w.x, y1: w.y };
      setMarquee(rect);
      const lo = { x: Math.min(rect.x0, rect.x1), y: Math.min(rect.y0, rect.y1) };
      const hi = { x: Math.max(rect.x0, rect.x1), y: Math.max(rect.y0, rect.y1) };
      const hits: string[] = [];
      for (const el of Object.values(store.getState().board.elements)) {
        if (!isBoxElement(el)) continue;
        const box = elementBBox(el);
        if (box.x1 >= lo.x && box.x0 <= hi.x && box.y1 >= lo.y && box.y0 <= hi.y) hits.push(el.id);
      }
      setSelection(d.additive ? Array.from(new Set([...selection, ...hits])) : hits);
    } else if (d.mode === 'move') {
      const dx = (e.clientX - d.lastClientX) / zoom;
      const dy = (e.clientY - d.lastClientY) / zoom;
      if (dx || dy) moveElements(d.ids, dx, dy);
      d.lastClientX = e.clientX;
      d.lastClientY = e.clientY;
    } else if (d.mode === 'resize') {
      const dx = (e.clientX - d.startClientX) / zoom;
      const dy = (e.clientY - d.startClientY) / zoom;
      const b = d.startBox;
      let x = b.x;
      let y = b.y;
      let width = b.width;
      let height = b.height;
      if (d.handle.includes('e')) width = Math.max(MIN_SIZE, b.width + dx);
      if (d.handle.includes('s')) height = Math.max(MIN_SIZE, b.height + dy);
      if (d.handle.includes('w')) {
        width = Math.max(MIN_SIZE, b.width - dx);
        x = b.x + (b.width - width);
      }
      if (d.handle.includes('n')) {
        height = Math.max(MIN_SIZE, b.height - dy);
        y = b.y + (b.height - height);
      }
      updateElement(d.id, { x, y, width, height });
    } else if (d.mode === 'connect') {
      if (!d.moved && Math.hypot(e.clientX - d.startClientX, e.clientY - d.startClientY) >= DRAG_THRESHOLD) {
        d.moved = true;
      }
      const w = toWorld(e.clientX, e.clientY);
      const { elements, order } = store.getState().board;
      const targetId = elementAt(elements, order, w, d.fromId);
      const targetEl = targetId ? elements[targetId] : null;
      const snapAnchor = targetEl && isBoxElement(targetEl) ? nearestAnchorSide(targetEl, w) : null;
      setConnectPreview({ fromId: d.fromId, fromAnchor: d.fromAnchor, to: w, targetId, snapAnchor });
    } else if (d.mode === 'reattach') {
      const w = toWorld(e.clientX, e.clientY);
      const { elements, order } = store.getState().board;
      const targetId = elementAt(elements, order, w, d.otherId);
      const targetEl = targetId ? elements[targetId] : null;
      const snapAnchor = targetEl && isBoxElement(targetEl) ? nearestAnchorSide(targetEl, w) : null;
      setConnectPreview({ fromId: d.otherId, fromAnchor: d.otherAnchor, to: w, targetId, snapAnchor });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    setMarquee(null);
    if (d?.mode === 'connect') {
      const { elements, order } = store.getState().board;
      const fromEl = elements[d.fromId];
      if (fromEl && isBoxElement(fromEl)) {
        if (!d.moved) {
          // a plain click on the anchor — spawn a connected child sticky
          createConnectedChild(d.fromId, d.fromAnchor);
        } else {
          const w = toWorld(e.clientX, e.clientY);
          const targetId = elementAt(elements, order, w, d.fromId);
          if (targetId) {
            const targetEl = elements[targetId];
            if (targetEl && isBoxElement(targetEl)) {
              const toAnchor = nearestAnchorSide(targetEl, w);
              const connector: BoardConnectorElement = {
                id: newId(),
                kind: 'connector',
                fromId: d.fromId,
                fromAnchor: d.fromAnchor,
                toId: targetId,
                toAnchor,
                arrow: true,
              };
              addElements([connector]);
              setSelection([connector.id]);
            }
          } else {
            // dropped on empty canvas — spawn a new sticky right there, connected
            const sticky = newSticky(w.x - NEW_STICKY_W / 2, w.y - NEW_STICKY_H / 2);
            const toAnchor = nearestAnchorSide(sticky, anchorPoint(fromEl, d.fromAnchor));
            const connector: BoardConnectorElement = {
              id: newId(),
              kind: 'connector',
              fromId: d.fromId,
              fromAnchor: d.fromAnchor,
              toId: sticky.id,
              toAnchor,
              arrow: true,
            };
            addElements([connector, sticky]);
            setEditingTarget({ id: sticky.id, field: 'text' });
          }
        }
      }
      setConnectPreview(null);
    } else if (d?.mode === 'reattach') {
      const w = toWorld(e.clientX, e.clientY);
      const { elements, order } = store.getState().board;
      const targetId = elementAt(elements, order, w, d.otherId);
      const targetEl = targetId ? elements[targetId] : null;
      if (targetId && targetEl && isBoxElement(targetEl)) {
        const anchor = nearestAnchorSide(targetEl, w);
        updateElement(d.connectorId, d.end === 'from' ? { fromId: targetId, fromAnchor: anchor } : { toId: targetId, toAnchor: anchor });
      }
      // no target → cancelled, original attachment kept
      setConnectPreview(null);
    }
    try {
      containerRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
  };

  const ARROW_SIDE: Partial<Record<string, BoardAnchorSide>> = {
    ArrowRight: 'right',
    ArrowLeft: 'left',
    ArrowUp: 'top',
    ArrowDown: 'bottom',
  };

  // Keyboard-driven graph expansion (2026-09-03) — mirrors the mindmap's
  // Tab/Enter-to-expand muscle memory, adapted to a board's 4-directional
  // anchors: an arrow key from a selected sticky either walks to the
  // already-connected neighbor in that direction, or — if there isn't one —
  // creates and connects a new one (same as clicking that anchor).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editingTarget || editingLabelId) return; // let the textarea/input handle its own keys
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) {
      e.preventDefault();
      removeElements(selection);
      return;
    }
    if (e.key === 'Escape') {
      setSelection([]);
      return;
    }
    const sel = selection.length === 1 ? board.elements[selection[0]] : undefined;
    const side = ARROW_SIDE[e.key];
    if (side && sel?.kind === 'sticky') {
      e.preventDefault();
      const existing = Object.values(board.elements).find(
        (el): el is BoardConnectorElement => el.kind === 'connector' && el.fromId === sel.id && el.fromAnchor === side,
      );
      if (existing) setSelection([existing.toId]);
      else createConnectedChild(sel.id, side);
      return;
    }
    if (e.key === 'Enter' && sel) {
      e.preventDefault();
      if (sel.kind === 'sticky') setEditingTarget({ id: sel.id, field: 'text' });
      else if (sel.kind === 'connector') setEditingLabelId(sel.id);
    }
  };

  const boxIds = board.order.filter((id) => board.elements[id] && isBoxElement(board.elements[id]));
  const connectorIds = board.order.filter((id) => board.elements[id]?.kind === 'connector');
  const singleSelected = selection.length === 1 ? board.elements[selection[0]] : undefined;
  const singleBoxSelected = singleSelected && isBoxElement(singleSelected) ? singleSelected : undefined;

  // Bulk editing (2026-09-03): the floating menu shows whenever every
  // selected element is a sticky (one or many) — mixed sticky+image/connector
  // selections hide it rather than guess a partial-apply behavior.
  const selectedStickies = selection
    .map((id) => board.elements[id])
    .filter((el): el is BoardStickyElement => !!el && el.kind === 'sticky');
  const allStickiesSelected = selectedStickies.length > 0 && selectedStickies.length === selection.length;
  const toolbarPos = allStickiesSelected
    ? {
        sx: ((Math.min(...selectedStickies.map((s) => s.x)) + Math.max(...selectedStickies.map((s) => s.x + s.width))) / 2) * zoom + panX,
        sy: Math.min(...selectedStickies.map((s) => s.y)) * zoom + panY,
      }
    : null;

  const dimmed = (el: BoxElement) =>
    (colorFilter !== null && el.kind === 'sticky' && el.color !== colorFilter) ||
    (shapeFilter !== null && el.kind === 'sticky' && (el.shape ?? 'rect') !== shapeFilter);

  const worldStyle: CSSProperties = { transform: `translate(${panX}px, ${panY}px) scale(${zoom})` };
  const isEmpty = board.order.length === 0;

  return (
    <div
      ref={containerRef}
      className="board-canvas"
      tabIndex={0}
      onWheel={onWheel}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      style={{ backgroundPosition: `${panX}px ${panY}px`, backgroundSize: `${24 * zoom}px ${24 * zoom}px` }}
    >
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <marker id="board-arrow" markerWidth="8" markerHeight="8" refX="6.5" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--ink-muted)" />
          </marker>
        </defs>
      </svg>

      <div className="board-world" style={worldStyle}>
        {boxIds.map((id) => {
          const el = board.elements[id] as BoxElement;
          const isConnectTarget = connectPreview?.targetId === id;
          return (
            <BoardElementView
              key={id}
              el={el}
              selected={selection.includes(id)}
              editingField={editingTarget?.id === id ? editingTarget.field : null}
              editingNoteIndex={editingTarget?.id === id && editingTarget.field === 'note' ? editingTarget.index : null}
              dimmed={dimmed(el)}
              showAnchors={selection.includes(id) || hoveredId === id || isConnectTarget}
              snapAnchor={isConnectTarget ? connectPreview.snapAnchor : null}
              imageSrc={el.kind === 'image' ? imageCache[el.src] : undefined}
              onPointerDown={(e) => onElementPointerDown(e, id)}
              onPointerEnter={() => setHoveredId(id)}
              onPointerLeave={() => setHoveredId((h) => (h === id ? null : h))}
              onAnchorPointerDown={(side, e) => beginAnchorDrag(side, id, e)}
              onTextChange={(text) => updateElement(id, { text })}
              onNoteChange={(index, value) => {
                if (el.kind !== 'sticky') return;
                const notes = [...(el.notes ?? [])];
                notes[index] = value;
                updateElement(id, { notes });
              }}
              onFieldBlur={() => setEditingTarget(null)}
              onRemoveNote={(index) => {
                if (el.kind !== 'sticky') return;
                const notes = (el.notes ?? []).filter((_, i) => i !== index);
                updateElement(id, { notes });
              }}
            />
          );
        })}

        {connectorIds.map((id) => {
          const el = board.elements[id] as BoardConnectorElement;
          const fromEl = board.elements[el.fromId];
          const toEl = board.elements[el.toId];
          if (!fromEl || !isBoxElement(fromEl) || !toEl || !isBoxElement(toEl)) return null;
          const a = anchorPoint(fromEl, el.fromAnchor);
          const b = anchorPoint(toEl, el.toAnchor);
          const pts = routeWaypoints(a, el.fromAnchor, b, el.toAnchor);
          const box = pointsBBox(pts);
          const d = roundedPath(
            pts.map((p) => ({ x: p.x - box.x0, y: p.y - box.y0 })),
            10,
          );
          const selected = selection.includes(id);
          const mid = pathMidpoint(pts);
          return (
            <Fragment key={id}>
              <svg
                className={`board-connector${selected ? ' selected' : ''}`}
                style={{ left: box.x0, top: box.y0, width: box.w, height: box.h }}
                onPointerDown={(e) => onConnectorPointerDown(e, id)}
              >
                <path
                  d={d}
                  fill="none"
                  stroke={tagVar(el.color) ?? 'var(--ink-muted)'}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  markerEnd={el.arrow !== false ? 'url(#board-arrow)' : undefined}
                />
              </svg>

              {editingLabelId === id ? (
                <input
                  className="board-label-input"
                  style={{ left: mid.x, top: mid.y }}
                  autoFocus
                  defaultValue={el.label ?? ''}
                  onPointerDown={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    updateElement(id, { label: e.target.value.trim() });
                    setEditingLabelId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
                  }}
                />
              ) : el.label ? (
                <button
                  className="board-label-chip"
                  style={{ left: mid.x, top: mid.y }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setSelection([id]);
                    setEditingLabelId(id);
                  }}
                >
                  {el.label}
                </button>
              ) : selected ? (
                <button
                  className="board-label-chip ghost selected"
                  style={{ left: mid.x, top: mid.y }}
                  title="라벨 추가"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setEditingLabelId(id)}
                >
                  +
                </button>
              ) : null}

              {selected && (
                <>
                  <div
                    className="board-connector-endpoint"
                    style={{ left: a.x, top: a.y }}
                    onPointerDown={(e) => beginEndpointDrag(id, 'from', el.toId, el.toAnchor, e)}
                  />
                  <div
                    className="board-connector-endpoint"
                    style={{ left: b.x, top: b.y }}
                    onPointerDown={(e) => beginEndpointDrag(id, 'to', el.fromId, el.fromAnchor, e)}
                  />
                </>
              )}
            </Fragment>
          );
        })}

        {connectPreview &&
          (() => {
            const fromEl = board.elements[connectPreview.fromId];
            if (!fromEl || !isBoxElement(fromEl)) return null;
            const a = anchorPoint(fromEl, connectPreview.fromAnchor);
            // once a target is armed, preview the route into its snap anchor
            // (not just a raw line to the cursor) so the animation reads as
            // "this is where it'll attach", not just "line follows mouse"
            const targetEl = connectPreview.targetId ? board.elements[connectPreview.targetId] : null;
            const b =
              targetEl && isBoxElement(targetEl) && connectPreview.snapAnchor
                ? anchorPoint(targetEl, connectPreview.snapAnchor)
                : connectPreview.to;
            const pts =
              targetEl && isBoxElement(targetEl) && connectPreview.snapAnchor
                ? routeWaypoints(a, connectPreview.fromAnchor, b, connectPreview.snapAnchor)
                : [a, b];
            const box = pointsBBox(pts);
            const d = roundedPath(
              pts.map((p) => ({ x: p.x - box.x0, y: p.y - box.y0 })),
              10,
            );
            return (
              <svg className="board-connect-preview" style={{ left: box.x0, top: box.y0, width: box.w, height: box.h }}>
                <path d={d} fill="none" stroke="var(--primary)" strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round" />
              </svg>
            );
          })()}

        {singleBoxSelected && !editingTarget && (
          <div
            className="board-resize-handles"
            style={{ left: singleBoxSelected.x, top: singleBoxSelected.y, width: singleBoxSelected.width, height: singleBoxSelected.height }}
          >
            {(['nw', 'ne', 'sw', 'se'] as Handle[]).map((h) => (
              <div key={h} className={`board-handle board-handle--${h}`} onPointerDown={(e) => beginResize(e, singleBoxSelected.id, h)} />
            ))}
          </div>
        )}

        {marquee && (
          <div
            className="board-marquee"
            style={{
              left: Math.min(marquee.x0, marquee.x1),
              top: Math.min(marquee.y0, marquee.y1),
              width: Math.abs(marquee.x1 - marquee.x0),
              height: Math.abs(marquee.y1 - marquee.y0),
            }}
          />
        )}
      </div>

      {allStickiesSelected && toolbarPos && (
        <BoardSelectionToolbar
          key={selectedStickies.map((s) => s.id).join(',')}
          stickies={selectedStickies}
          sx={toolbarPos.sx}
          sy={toolbarPos.sy}
          onAddNote={() => {
            const s = selectedStickies[0];
            const notes = [...(s.notes ?? []), ''];
            updateElement(s.id, { notes });
            setEditingTarget({ id: s.id, field: 'note', index: notes.length - 1 });
          }}
          onLinkNode={() => setLinkPicker('node')}
          onLinkNote={() => setLinkPicker('note')}
        />
      )}

      {linkPicker === 'node' && selection.length === 1 && (
        <BoardNodePicker
          onPick={(link) => {
            setNodeLink(selection[0], link);
            void ensureMapPersisted(link.mapId);
            setLinkPicker(null);
          }}
          onClose={() => setLinkPicker(null)}
        />
      )}
      {linkPicker === 'note' && selection.length === 1 && (
        <BoardNoteLinkPicker
          boardFilePath={boardFilePath}
          onPick={(ref) => {
            setNoteLink(selection[0], ref);
            setLinkPicker(null);
          }}
          onClose={() => setLinkPicker(null)}
        />
      )}

      {isEmpty && (
        <div className="empty">
          <div className="title">빈 보드</div>
          <div className="hint">위 툴바에서 스티키노트를 추가해 시작하세요</div>
        </div>
      )}
    </div>
  );
});
