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
import { useUi } from '../store/uiStore';
import { BoardElementView } from './BoardElementView';
import { BoardSelectionToolbar } from './BoardSelectionToolbar';
import { BoardConnectorToolbar } from './BoardConnectorToolbar';
import { BoardContextMenu } from './BoardContextMenu';
import { BoardNodePicker } from './BoardNodePicker';
import { BoardNoteLinkPicker } from './BoardNoteLinkPicker';
import { ensureMapPersisted } from './boardLinks';
import {
  elementBBox,
  boardBounds,
  isBoxElement,
  anchorPointOfBox,
  anchorBoxFor,
  noteBBox,
  oppositeAnchor,
  type BoxElement,
  type BBox,
} from './boardGeometry';
import { routeWaypoints, roundedPath, pointsBBox, pathMidpoint } from './boardRouting';
import { layoutConnectedCluster, filterGridPositions } from './boardLayout';
import { newId } from '../io/formats';
import { tagVar } from '../theme/palette';
import type { BoardAnchorSide, BoardConnectorElement, BoardElement, BoardImageElement, BoardStickyElement } from '../types';

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

/** An existing connector already joining these two elements (either
 *  direction), if any — used to avoid drawing a second, exactly-overlapping
 *  connector between the same pair (2026-09-07 feedback: overlapping paths
 *  were impossible to tell apart). `excludeId` skips the connector being
 *  reattached itself when checking its new target. */
function findConnectorBetween(
  elements: Record<string, BoardElement>,
  a: { id: string; noteIndex?: number },
  b: { id: string; noteIndex?: number },
  excludeId?: string,
): BoardConnectorElement | undefined {
  // Note-index-aware (2026-09-09): a connector to a sticky's main card and
  // one to a specific note of that SAME sticky are different relationships,
  // not duplicates of each other — only an exact (id, noteIndex) pair match
  // on both ends counts.
  const same = (x: string, xi: number | undefined, y: string, yi: number | undefined) => x === y && (xi ?? null) === (yi ?? null);
  return Object.values(elements).find(
    (el): el is BoardConnectorElement =>
      el.kind === 'connector' &&
      el.id !== excludeId &&
      ((same(el.fromId, el.fromNoteIndex, a.id, a.noteIndex) && same(el.toId, el.toNoteIndex, b.id, b.noteIndex)) ||
        (same(el.fromId, el.fromNoteIndex, b.id, b.noteIndex) && same(el.toId, el.toNoteIndex, a.id, a.noteIndex))),
  );
}

/** The box a `targetAt` hit actually resolves to (its note box, or its own),
 *  or null if the hit wasn't a sticky/image (or there was no hit at all). */
function targetBoxOf(
  target: { id: string; noteIndex?: number } | null,
  elements: Record<string, BoardElement>,
  noteHeights: Record<string, number[]>,
): BBox | null {
  if (!target) return null;
  const el = elements[target.id];
  return el && isBoxElement(el) ? anchorBoxFor(el, target.noteIndex, noteHeights[target.id]) : null;
}

/** Nearest of a box's 4 anchor sides to a world point (used to pick where an
 *  in-progress connector should land when dropped on it) — takes a plain
 *  `BBox` so the same logic works for an element's own box or a fused note's
 *  box (see `noteBBox`). */
function nearestAnchorSide(box: BBox, point: { x: number; y: number }): BoardAnchorSide {
  const sides: BoardAnchorSide[] = ['top', 'right', 'bottom', 'left'];
  let best: BoardAnchorSide = 'top';
  let bestDist = Infinity;
  for (const side of sides) {
    const p = anchorPointOfBox(box, side);
    const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = side;
    }
  }
  return best;
}

/** Topmost box element (sticky/image) whose bounds — or, for a sticky, one of
 *  its fused note boxes (2026-09-09, see boardGeometry.ts's `noteBBox`) —
 *  contain `point`, excluding `excludeId`. A note box is checked before the
 *  sticky's own main card since it sits entirely outside it (below, in normal
 *  flow — see BoardElementView.tsx), so there's no ambiguity about which one
 *  "wins" when both would match. `noteHeights` are this render's MEASURED
 *  per-sticky note heights (BoardCanvasArea's `noteHeights` state), needed to
 *  know where each note box actually sits/ends. */
function targetAt(
  elements: Record<string, BoardElement>,
  order: string[],
  noteHeights: Record<string, number[]>,
  point: { x: number; y: number },
  excludeId: string,
): { id: string; noteIndex?: number } | null {
  const hits = (box: BBox) => point.x >= box.x0 && point.x <= box.x1 && point.y >= box.y0 && point.y <= box.y1;
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    if (id === excludeId) continue;
    const el = elements[id];
    if (!el || !isBoxElement(el)) continue;
    if (el.kind === 'sticky' && el.notes?.length) {
      const heights = noteHeights[id] ?? [];
      for (let ni = 0; ni < el.notes.length; ni++) {
        if (hits(noteBBox(el, ni, heights))) return { id, noteIndex: ni };
      }
    }
    if (hits(elementBBox(el))) return { id };
  }
  return null;
}

/** Where a new connected sticky should spawn given the anchor point it's
 *  connecting FROM (the source element's own box, or one of its note boxes —
 *  callers resolve which via `anchorBoxFor` before calling this). */
function childStickySpot(a: { x: number; y: number }, side: BoardAnchorSide): { x: number; y: number } {
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
      fromNoteIndex: number | undefined;
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
      otherNoteIndex: number | undefined;
    };

export interface BoardCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  /** Auto-arrange the connected cluster reachable from the single selected
   *  element (see board/boardLayout.ts). No-op unless exactly one sticky is
   *  selected and it has outgoing connectors. */
  tidySelected: () => void;
  /** World-space point at the center of THIS canvas's own viewport — not
   *  `window.innerWidth/Height` (2026-09-06: a split-screen pane is only half
   *  the window, so a spawn spot computed from the full window could land in
   *  the OTHER pane, off-screen from the one the user is looking at). */
  viewportCenterWorld: () => { x: number; y: number };
}

interface Props {
  boardFilePath: string | null;
  /** Is this the active pane (vs. a background split pane)? Gates focusReq
   *  centering — a search result opening a board in a background pane
   *  shouldn't yank the visible one's viewport. Defaults to true so existing
   *  single-pane callers (e2e helpers, etc.) keep working unchanged. */
  active?: boolean;
}

/** The interactive canvas: pan/zoom (mirrors canvas/Canvas.tsx's wheel gestures
 *  for muscle-memory parity), marquee select, element drag/resize, anchor-based
 *  connector drawing with smart routing, and inline text editing for sticky
 *  notes (main text + any number of fused notes stacked below). */
export const BoardCanvasArea = forwardRef<BoardCanvasHandle, Props>(function BoardCanvasArea(
  { boardFilePath, active = true },
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
  const updateElements = useBoard((s) => s.updateElements);
  const removeStickyNote = useBoard((s) => s.removeStickyNote);
  const beginTransaction = useBoard((s) => s.beginTransaction);
  const endTransaction = useBoard((s) => s.endTransaction);
  const cancelTransaction = useBoard((s) => s.cancelTransaction);
  const removeElements = useBoard((s) => s.removeElements);
  const addElements = useBoard((s) => s.addElements);
  const setView = useBoard((s) => s.setView);
  const setNodeLink = useBoard((s) => s.setNodeLink);
  const setNoteLink = useBoard((s) => s.setNoteLink);
  const copyElements = useBoard((s) => s.copyElements);
  const pasteElements = useBoard((s) => s.pasteElements);
  const hasClipboard = useBoard((s) => s.hasClipboard);
  const cutElements = useBoard((s) => s.cutElements);
  const selectAll = useBoard((s) => s.selectAll);

  // A color/shape filter is active — see the `filterPositions` block further
  // down for what this changes about rendering. Computed early because the
  // pointer handlers below (defined before that block) also need to disable
  // position-mutating interactions while it's on: dragging/resizing/marquee
  // would move REAL coordinates while the user is looking at grid-view
  // positions, which would not match what's on screen.
  const activeFilter = colorFilter !== null || shapeFilter !== null;

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [connectPreview, setConnectPreview] = useState<{
    fromId: string;
    fromAnchor: BoardAnchorSide;
    fromNoteIndex: number | undefined;
    to: { x: number; y: number };
    targetId: string | null;
    targetNoteIndex: number | undefined;
    snapAnchor: BoardAnchorSide | null;
  } | null>(null);
  // Fused note boxes auto-grow with text (pure CSS normal flow, no stored
  // height — see types.ts's BoardStickyElement.notes) so their world bbox
  // isn't knowable from the doc alone. Each sticky reports its own notes'
  // MEASURED heights here (BoardElementView's onNoteHeightsChange), indexed
  // like `el.notes`; boardGeometry.ts's `noteBBox`/`anchorBoxFor` combine
  // this with the sticky's stored x/y/width/height to place note-anchored
  // connectors and hit-test note-anchor drops (2026-09-09).
  const [noteHeights, setNoteHeights] = useState<Record<string, number[]>>({});
  const [editingTarget, setEditingTarget] = useState<EditingTarget | null>(null);
  // Wraps every text-edit entry/exit so the WHOLE typing session becomes one
  // undo step (2026-09-07 — a controlled <textarea> otherwise calls
  // updateElement per keystroke, flooding history one entry per character,
  // unlike a mindmap node's uncontrolled contentEditable which only commits
  // once on blur). Mirrors the drag begin/end wiring above, just for text
  // instead of position.
  const beginEditingTarget = (t: EditingTarget) => {
    beginTransaction();
    setEditingTarget(t);
  };
  const endEditingTarget = () => {
    endTransaction();
    setEditingTarget(null);
  };
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [linkPicker, setLinkPicker] = useState<'node' | 'note' | null>(null);
  // Right-click menu on a sticky/image (2026-09-09) — local state, not
  // uiStore's `contextMenu` (that one's shape/consumer is mindmap-specific,
  // single-id only; a board menu needs to act on a whole multi-selection).
  // Mirrors panes/TabBar.tsx's own independent right-click menu state.
  const [elementContextMenu, setElementContextMenu] = useState<{ ids: string[]; x: number; y: number } | null>(null);
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

  // Pan to center a sticky (uiStore.focusNode — generic by id, shared with the
  // mindmap canvas) — e.g. after opening this board from a global-search hit.
  // Only the active pane reacts, so a background split pane doesn't get yanked.
  const focusReq = useUi((s) => s.focusReq);
  useEffect(() => {
    if (!focusReq || !active) return;
    const el = store.getState().board.elements[focusReq.id];
    if (!el || !isBoxElement(el)) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const v = store.getState().board.view;
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    setView({ panX: rect.width / 2 - cx * v.zoom, panY: rect.height / 2 - cy * v.zoom });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusReq?.nonce, active]);

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
        // elkjs's layout runs async (dynamically imported — see boardLayout.ts's
        // doc comment on layoutConnectedCluster); the handle's own signature
        // stays synchronous (fire-and-forget, matching the button's onClick).
        void (async () => {
          const positions = await layoutConnectedCluster(selection[0], store.getState().board.elements);
          if (positions.length) store.getState().setElementPositions(positions);
        })();
      },
      viewportCenterWorld: () => {
        const rect = containerRef.current?.getBoundingClientRect();
        const v = store.getState().board.view;
        if (!rect) return { x: -v.panX / v.zoom, y: -v.panY / v.zoom };
        return { x: (rect.width / 2 - v.panX) / v.zoom, y: (rect.height / 2 - v.panY) / v.zoom };
      },
    }),
    [store, setView, selection],
  );

  // Double-clicking truly empty canvas creates a sticky right there — a
  // background double-click retargets fine natively (unlike an element's,
  // see the comment above onElementPointerDown): the pointer capture from
  // onBackgroundPointerDown lands on .board-canvas itself either way, so
  // there's no capturing-element mismatch to break the synthesized dblclick.
  const onCanvasDoubleClick = (e: React.MouseEvent) => {
    if (activeFilter) return; // world coords under the cursor don't match what's on screen in grid view
    const w = toWorld(e.clientX, e.clientY);
    const { elements, order } = store.getState().board;
    if (targetAt(elements, order, noteHeights, w, '')) return; // hit a sticky/image (or one of its notes) — its own dblclick-to-edit handles this
    const sticky = newSticky(w.x - NEW_STICKY_W / 2, w.y - NEW_STICKY_H / 2);
    addElements([sticky]);
    beginEditingTarget({ id: sticky.id, field: 'text' });
  };

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    containerRef.current?.setPointerCapture(e.pointerId);
    containerRef.current?.focus();
    if (!e.shiftKey) setSelection([]);
    endEditingTarget(); // safety-net clear — onFieldBlur normally already closed any open transaction
    if (activeFilter) return; // no marquee — hit-testing is in real coords, display is the filtered grid
    const w = toWorld(e.clientX, e.clientY);
    dragRef.current = { mode: 'marquee', startWorld: w, additive: e.shiftKey };
    setMarquee({ x0: w.x, y0: w.y, x1: w.x, y1: w.y });
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
      beginEditingTarget(region.startsWith('note-') ? { id, field: 'note', index: Number(region.slice(5)) } : { id, field: 'text' });
      return; // the click that opened editing shouldn't also start a move-drag
    }
    containerRef.current?.setPointerCapture(e.pointerId);
    containerRef.current?.focus();
    const already = selection.includes(id);
    const next = e.shiftKey ? (already ? selection.filter((x) => x !== id) : [...selection, id]) : already ? selection : [id];
    setSelection(next);
    // No move-drag in filter grid view — the on-screen position is a
    // temporary view-only layout, not the element's real coordinates, so a
    // drag delta computed from screen pixels would silently displace the
    // REAL position while the user is looking at the grid.
    if (!activeFilter) {
      beginTransaction(); // one undo step for the whole gesture, not one per pointermove
      dragRef.current = { mode: 'move', ids: next, lastClientX: e.clientX, lastClientY: e.clientY };
    }
  };

  const beginResize = (e: React.PointerEvent, id: string, handle: Handle) => {
    e.stopPropagation();
    containerRef.current?.setPointerCapture(e.pointerId);
    const el = board.elements[id];
    if (!el || !isBoxElement(el)) return;
    beginTransaction(); // one undo step for the whole gesture, not one per pointermove
    dragRef.current = {
      mode: 'resize',
      id,
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startBox: { x: el.x, y: el.y, width: el.width, height: el.height },
    };
  };

  // Right-click a sticky/image → select it (unless it's already part of a
  // larger multi-selection, in which case the WHOLE selection is the menu's
  // target — mirrors canvas/NodeView.tsx's onContextMenu) and open the menu
  // at the cursor. `duplicateElements`/`removeElements` in the menu then act
  // on exactly this id list, since it's set as the current `selection`.
  const onElementContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const alreadyInMultiSelection = selection.length > 1 && selection.includes(id);
    const ids = alreadyInMultiSelection ? selection : [id];
    if (!alreadyInMultiSelection) setSelection([id]);
    setElementContextMenu({ ids, x: e.clientX, y: e.clientY });
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

  const beginAnchorDrag = (side: BoardAnchorSide, id: string, e: React.PointerEvent, noteIndex?: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    containerRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = {
      mode: 'connect',
      fromId: id,
      fromAnchor: side,
      fromNoteIndex: noteIndex,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
    };
    const el = board.elements[id];
    if (el && isBoxElement(el)) {
      const box = anchorBoxFor(el, noteIndex, noteHeights[id]);
      if (box) {
        const p = anchorPointOfBox(box, side);
        setConnectPreview({ fromId: id, fromAnchor: side, fromNoteIndex: noteIndex, to: p, targetId: null, targetNoteIndex: undefined, snapAnchor: null });
      }
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
    otherNoteIndex: number | undefined,
    e: React.PointerEvent,
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    containerRef.current?.setPointerCapture(e.pointerId);
    setSelection([connectorId]);
    dragRef.current = { mode: 'reattach', connectorId, end, otherId, otherAnchor, otherNoteIndex };
    const otherEl = board.elements[otherId];
    if (otherEl && isBoxElement(otherEl)) {
      const box = anchorBoxFor(otherEl, otherNoteIndex, noteHeights[otherId]);
      if (box) {
        const p = anchorPointOfBox(box, otherAnchor);
        setConnectPreview({
          fromId: otherId,
          fromAnchor: otherAnchor,
          fromNoteIndex: otherNoteIndex,
          to: p,
          targetId: null,
          targetNoteIndex: undefined,
          snapAnchor: null,
        });
      }
    }
  };

  const createConnectedChild = (fromId: string, side: BoardAnchorSide, fromNoteIndex?: number) => {
    const fromEl = store.getState().board.elements[fromId];
    if (!fromEl || !isBoxElement(fromEl)) return;
    const fromBox = anchorBoxFor(fromEl, fromNoteIndex, noteHeights[fromId]);
    if (!fromBox) return;
    const spot = childStickySpot(anchorPointOfBox(fromBox, side), side);
    const sticky = newSticky(spot.x, spot.y);
    const connector: BoardConnectorElement = {
      id: newId(),
      kind: 'connector',
      fromId,
      fromAnchor: side,
      fromNoteIndex,
      toId: sticky.id,
      toAnchor: oppositeAnchor(side),
      arrow: true,
    };
    addElements([connector, sticky]);
    beginEditingTarget({ id: sticky.id, field: 'text' });
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
      const target = targetAt(elements, order, noteHeights, w, d.fromId);
      const targetBox = targetBoxOf(target, elements, noteHeights);
      const snapAnchor = targetBox ? nearestAnchorSide(targetBox, w) : null;
      setConnectPreview({
        fromId: d.fromId,
        fromAnchor: d.fromAnchor,
        fromNoteIndex: d.fromNoteIndex,
        to: w,
        targetId: target?.id ?? null,
        targetNoteIndex: target?.noteIndex,
        snapAnchor,
      });
    } else if (d.mode === 'reattach') {
      const w = toWorld(e.clientX, e.clientY);
      const { elements, order } = store.getState().board;
      const target = targetAt(elements, order, noteHeights, w, d.otherId);
      const targetBox = targetBoxOf(target, elements, noteHeights);
      const snapAnchor = targetBox ? nearestAnchorSide(targetBox, w) : null;
      setConnectPreview({
        fromId: d.otherId,
        fromAnchor: d.otherAnchor,
        fromNoteIndex: d.otherNoteIndex,
        to: w,
        targetId: target?.id ?? null,
        targetNoteIndex: target?.noteIndex,
        snapAnchor,
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    setMarquee(null);
    if (d?.mode === 'connect') {
      const { elements, order } = store.getState().board;
      const fromEl = elements[d.fromId];
      const fromBox = fromEl && isBoxElement(fromEl) ? anchorBoxFor(fromEl, d.fromNoteIndex, noteHeights[d.fromId]) : null;
      if (fromEl && isBoxElement(fromEl) && fromBox) {
        if (!d.moved) {
          // a plain click on the anchor — spawn a connected child sticky
          createConnectedChild(d.fromId, d.fromAnchor, d.fromNoteIndex);
        } else {
          const w = toWorld(e.clientX, e.clientY);
          const target = targetAt(elements, order, noteHeights, w, d.fromId);
          const targetBox = targetBoxOf(target, elements, noteHeights);
          if (target && targetBox) {
            // already connected — select the existing connector instead of
            // drawing a second, indistinguishable one on top of it
            const dup = findConnectorBetween(
              elements,
              { id: d.fromId, noteIndex: d.fromNoteIndex },
              { id: target.id, noteIndex: target.noteIndex },
            );
            if (dup) {
              setSelection([dup.id]);
            } else {
              const toAnchor = nearestAnchorSide(targetBox, w);
              const connector: BoardConnectorElement = {
                id: newId(),
                kind: 'connector',
                fromId: d.fromId,
                fromAnchor: d.fromAnchor,
                fromNoteIndex: d.fromNoteIndex,
                toId: target.id,
                toAnchor,
                toNoteIndex: target.noteIndex,
                arrow: true,
              };
              addElements([connector]);
              setSelection([connector.id]);
            }
          } else {
            // dropped on empty canvas — spawn a new sticky right there, connected
            const sticky = newSticky(w.x - NEW_STICKY_W / 2, w.y - NEW_STICKY_H / 2);
            const toAnchor = nearestAnchorSide(elementBBox(sticky), anchorPointOfBox(fromBox, d.fromAnchor));
            const connector: BoardConnectorElement = {
              id: newId(),
              kind: 'connector',
              fromId: d.fromId,
              fromAnchor: d.fromAnchor,
              fromNoteIndex: d.fromNoteIndex,
              toId: sticky.id,
              toAnchor,
              arrow: true,
            };
            addElements([connector, sticky]);
            beginEditingTarget({ id: sticky.id, field: 'text' });
          }
        }
      }
      setConnectPreview(null);
    } else if (d?.mode === 'reattach') {
      const w = toWorld(e.clientX, e.clientY);
      const { elements, order } = store.getState().board;
      const target = targetAt(elements, order, noteHeights, w, d.otherId);
      const targetBox = targetBoxOf(target, elements, noteHeights);
      if (target && targetBox) {
        // reattaching onto a pair that's already connected would create a
        // second, exactly-overlapping connector — select the existing one
        // and leave this connector's original attachment alone instead
        const dup = findConnectorBetween(
          elements,
          { id: d.otherId, noteIndex: d.otherNoteIndex },
          { id: target.id, noteIndex: target.noteIndex },
          d.connectorId,
        );
        if (dup) {
          setSelection([dup.id]);
        } else {
          const anchor = nearestAnchorSide(targetBox, w);
          updateElement(
            d.connectorId,
            d.end === 'from'
              ? { fromId: target.id, fromAnchor: anchor, fromNoteIndex: target.noteIndex }
              : { toId: target.id, toAnchor: anchor, toNoteIndex: target.noteIndex },
          );
        }
      }
      // no target → cancelled, original attachment kept
      setConnectPreview(null);
    } else if (d?.mode === 'move' || d?.mode === 'resize') {
      endTransaction(); // commits the whole drag/resize gesture as one undo step
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
    if (editingTarget || editingLabelId) return; // let the textarea/input handle its own keys, incl. native text copy/paste
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) {
      e.preventDefault();
      removeElements(selection);
      return;
    }
    if (e.key === 'Escape') {
      setSelection([]);
      return;
    }
    // ⌘/Ctrl+C / ⌘/Ctrl+V / ⌘/Ctrl+X — copy/paste/cut selected elements (+
    // connectors whose both ends are selected). Mirrors mapStore's
    // copyNode/pasteNode UX (toast feedback) but stores an in-app clipboard
    // scoped to boardStore.ts, not the OS clipboard — same as the mindmap's
    // subtree clipboard. Cut = copy + remove in one call (see boardStore's
    // cutElements doc comment for why that's already a single undo step).
    if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'v' || e.key === 'x')) {
      if (e.key === 'c' && selection.length) {
        e.preventDefault();
        copyElements();
        useUi.getState().toast('복사함');
      } else if (e.key === 'v') {
        e.preventDefault();
        if (hasClipboard()) {
          pasteElements();
          useUi.getState().toast('붙여넣음');
        }
      } else if (e.key === 'x' && selection.length) {
        e.preventDefault();
        cutElements();
        useUi.getState().toast('잘라냄');
      }
      return;
    }
    // ⌘/Ctrl+A — select every sticky/image on the board (not connectors).
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault();
      selectAll();
      return;
    }
    const sel = selection.length === 1 ? board.elements[selection[0]] : undefined;
    const side = ARROW_SIDE[e.key];
    if (side && sel?.kind === 'sticky') {
      e.preventDefault();
      // Keyboard arrow-nav always walks from the sticky's own main card, not
      // one of its notes (there's no keyboard way to select a note anchor) —
      // fromNoteIndex == null excludes a note-anchored connector sharing the
      // same fromId/side.
      const existing = Object.values(board.elements).find(
        (el): el is BoardConnectorElement =>
          el.kind === 'connector' && el.fromId === sel.id && el.fromAnchor === side && el.fromNoteIndex == null,
      );
      if (existing) setSelection([existing.toId]);
      else createConnectedChild(sel.id, side);
      return;
    }
    if (e.key === 'Enter' && sel) {
      e.preventDefault();
      if (sel.kind === 'sticky') beginEditingTarget({ id: sel.id, field: 'text' });
      else if (sel.kind === 'connector') setEditingLabelId(sel.id);
    }
  };

  const boxIds = board.order.filter((id) => board.elements[id] && isBoxElement(board.elements[id]));
  const connectorIds = board.order.filter((id) => board.elements[id]?.kind === 'connector');
  const singleSelected = selection.length === 1 ? board.elements[selection[0]] : undefined;
  const singleBoxSelected = singleSelected && isBoxElement(singleSelected) ? singleSelected : undefined;

  // Bulk editing (2026-09-03): the floating menu shows whenever every
  // selected element is a sticky (one or many) OR every selected element is
  // an image (one or many, 2026-09-07 — images gained color + 연동 too) —
  // mixed sticky+image/connector selections hide it rather than guess a
  // partial-apply behavior.
  const selectedStickies = selection
    .map((id) => board.elements[id])
    .filter((el): el is BoardStickyElement => !!el && el.kind === 'sticky');
  const selectedImages = selection
    .map((id) => board.elements[id])
    .filter((el): el is BoardImageElement => !!el && el.kind === 'image');
  const allStickiesSelected = selectedStickies.length > 0 && selectedStickies.length === selection.length;
  const allImagesSelected = selectedImages.length > 0 && selectedImages.length === selection.length;
  const toolbarElements: (BoardStickyElement | BoardImageElement)[] | null = allStickiesSelected
    ? selectedStickies
    : allImagesSelected
      ? selectedImages
      : null;
  const toolbarPos = toolbarElements
    ? {
        sx: ((Math.min(...toolbarElements.map((s) => s.x)) + Math.max(...toolbarElements.map((s) => s.x + s.width))) / 2) * zoom + panX,
        sy: Math.min(...toolbarElements.map((s) => s.y)) * zoom + panY,
      }
    : null;

  // A sticky the active color/shape filter would exclude — no longer dimmed
  // in place (2026-09-06), just left out of the filtered grid view below.
  const excludedByFilter = (el: BoxElement) =>
    (colorFilter !== null && el.kind === 'sticky' && el.color !== colorFilter) ||
    (shapeFilter !== null && el.kind === 'sticky' && (el.shape ?? 'rect') !== shapeFilter);

  // Filtered VIEW re-layout (2026-09-06 — "필터가 흐리게 dim만 하고, 마인드맵처럼
  // 재배치하지 않음"): the mindmap's color filter excludes non-matching nodes
  // from the tree layout itself, so the rest compact together — a plain dim
  // (what board did before) doesn't give that same "just show me these,
  // tidied up" read. Board has no tree to compact, so instead: while a filter
  // is active, matching stickies/images render at a fresh grid position
  // (`filterGridPositions`, view-only — `board.elements` keeps its real x/y,
  // nothing is written back) and non-matching ones don't render at all.
  // Turning the filter off just stops consulting this map. Interactions that
  // would only make sense against real coordinates (move-drag, resize,
  // marquee, anchor-drag) are suppressed while a filter is active — see the
  // `activeFilter` guards below and in the pointer handlers above.
  const filterPositions = activeFilter
    ? filterGridPositions(
        board.order.filter((id) => {
          const el = board.elements[id];
          return !!el && isBoxElement(el) && !excludedByFilter(el);
        }),
        board.elements,
        (containerRef.current?.getBoundingClientRect().width ?? 1000) / zoom,
      )
    : null;
  const displayBox = (el: BoxElement): BoxElement => {
    const p = filterPositions?.[el.id];
    return p ? ({ ...el, x: p.x, y: p.y } as BoxElement) : el;
  };
  const visibleBoxIds = activeFilter ? boxIds.filter((id) => filterPositions?.[id]) : boxIds;

  // Precomputed once, rendered in two passes: the line itself goes BEHIND every
  // sticky/image (2026-09-06 — arrows drawn on top of cards read as clutter and
  // make it hard to tell which card an arrow actually terminates at), while the
  // label chip and (when selected) reattach handles render AFTER stickies so
  // they stay clickable instead of getting covered by a card.
  const connectorRenders = connectorIds
    .map((id) => {
      const el = board.elements[id] as BoardConnectorElement;
      const fromElRaw = board.elements[el.fromId];
      const toElRaw = board.elements[el.toId];
      if (!fromElRaw || !isBoxElement(fromElRaw) || !toElRaw || !isBoxElement(toElRaw)) return null;
      if (activeFilter && (!filterPositions?.[fromElRaw.id] || !filterPositions?.[toElRaw.id])) return null;
      const fromEl = displayBox(fromElRaw);
      const toEl = displayBox(toElRaw);
      const fromBox = anchorBoxFor(fromEl, el.fromNoteIndex, noteHeights[el.fromId]) ?? elementBBox(fromEl);
      const toBox = anchorBoxFor(toEl, el.toNoteIndex, noteHeights[el.toId]) ?? elementBBox(toEl);
      const a = anchorPointOfBox(fromBox, el.fromAnchor);
      const b = anchorPointOfBox(toBox, el.toAnchor);
      const pts = routeWaypoints(a, el.fromAnchor, b, el.toAnchor);
      const box = pointsBBox(pts);
      const d = roundedPath(
        pts.map((p) => ({ x: p.x - box.x0, y: p.y - box.y0 })),
        10,
      );
      return { id, el, a, b, box, d, selected: selection.includes(id), mid: pathMidpoint(pts) };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // color toolbar for a connector-only selection (2026-09-07) — screen-space
  // position (world mid * zoom + pan), same conversion as the sticky
  // toolbar's sx/sy, since this renders outside .board-world's transform.
  const selectedConnectorIds = selection.filter((id) => board.elements[id]?.kind === 'connector');
  const allConnectorsSelected = selectedConnectorIds.length > 0 && selectedConnectorIds.length === selection.length;
  const connectorToolbarMid = allConnectorsSelected
    ? connectorRenders.find((r) => r.id === selectedConnectorIds[0])?.mid
    : undefined;
  const connectorToolbarPos = connectorToolbarMid
    ? { sx: connectorToolbarMid.x * zoom + panX, sy: connectorToolbarMid.y * zoom + panY }
    : null;

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
      onDoubleClick={onCanvasDoubleClick}
      onKeyDown={onKeyDown}
      style={{ backgroundPosition: `${panX}px ${panY}px`, backgroundSize: `${24 * zoom}px ${24 * zoom}px` }}
    >
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          {/* 2026-09-07: fill="context-stroke" (Chromium 121+ — this app bundles
              Electron 33/Chromium 130+, safe) makes the arrowhead always match
              the CURRENT stroke of the path it's attached to, instead of a
              hardcoded gray — so it follows a custom connector color, hover,
              and selection highlighting automatically with no extra markup. */}
          <marker id="board-arrow" markerWidth="8" markerHeight="8" refX="6.5" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="context-stroke" />
          </marker>
        </defs>
      </svg>

      <div className="board-world" style={worldStyle}>
        {connectorRenders.map((r) => (
          <svg
            key={r.id}
            className={`board-connector${r.selected ? ' selected' : ''}`}
            style={{ left: r.box.x0, top: r.box.y0, width: r.box.w, height: r.box.h }}
            onPointerDown={(e) => onConnectorPointerDown(e, r.id)}
          >
            <path
              d={r.d}
              fill="none"
              stroke={tagVar(r.el.color) ?? 'var(--ink-muted)'}
              strokeWidth={2.5}
              strokeLinecap="round"
              markerEnd={r.el.arrow !== false ? 'url(#board-arrow)' : undefined}
            />
          </svg>
        ))}

        {visibleBoxIds.map((id) => {
          const el = displayBox(board.elements[id] as BoxElement);
          const isConnectTarget = connectPreview?.targetId === id;
          return (
            <BoardElementView
              key={id}
              el={el}
              selected={selection.includes(id)}
              editingField={editingTarget?.id === id ? editingTarget.field : null}
              editingNoteIndex={editingTarget?.id === id && editingTarget.field === 'note' ? editingTarget.index : null}
              showAnchors={!activeFilter && (selection.includes(id) || hoveredId === id || isConnectTarget)}
              snapAnchor={
                isConnectTarget && connectPreview.snapAnchor
                  ? { side: connectPreview.snapAnchor, noteIndex: connectPreview.targetNoteIndex }
                  : null
              }
              imageSrc={el.kind === 'image' ? imageCache[el.src] : undefined}
              onPointerDown={(e) => onElementPointerDown(e, id)}
              onPointerEnter={() => setHoveredId(id)}
              onPointerLeave={() => setHoveredId((h) => (h === id ? null : h))}
              onContextMenu={(e) => onElementContextMenu(e, id)}
              onAnchorPointerDown={(side, e, noteIndex) => beginAnchorDrag(side, id, e, noteIndex)}
              onNoteHeightsChange={(heights) =>
                setNoteHeights((m) => {
                  const prev = m[id];
                  if (prev && prev.length === heights.length && prev.every((v, i) => v === heights[i])) return m;
                  return { ...m, [id]: heights };
                })
              }
              onTextChange={(text) => updateElement(id, { text })}
              onNoteChange={(index, value) => {
                if (el.kind !== 'sticky') return;
                const notes = [...(el.notes ?? [])];
                notes[index] = value;
                updateElement(id, { notes });
              }}
              onFieldBlur={endEditingTarget}
              onCancelEdit={cancelTransaction}
              onRemoveNote={(index) => removeStickyNote(id, index)}
            />
          );
        })}

        {connectorRenders.map(({ id, el, a, b, mid, selected }) => (
          <Fragment key={id}>
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
                  // defense-in-depth: this input is safe today because
                  // editingLabelId gates the canvas's own onKeyDown (below),
                  // but stop propagation directly too so it can't regress the
                  // way the link-input surfaces did (2026-09-07).
                  e.stopPropagation();
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
                  onPointerDown={(e) => beginEndpointDrag(id, 'from', el.toId, el.toAnchor, el.toNoteIndex, e)}
                />
                <div
                  className="board-connector-endpoint"
                  style={{ left: b.x, top: b.y }}
                  onPointerDown={(e) => beginEndpointDrag(id, 'to', el.fromId, el.fromAnchor, el.fromNoteIndex, e)}
                />
              </>
            )}
          </Fragment>
        ))}

        {connectPreview &&
          (() => {
            const fromEl = board.elements[connectPreview.fromId];
            if (!fromEl || !isBoxElement(fromEl)) return null;
            const fromBox = anchorBoxFor(fromEl, connectPreview.fromNoteIndex, noteHeights[connectPreview.fromId]) ?? elementBBox(fromEl);
            const a = anchorPointOfBox(fromBox, connectPreview.fromAnchor);
            // once a target is armed, preview the route into its snap anchor
            // (not just a raw line to the cursor) so the animation reads as
            // "this is where it'll attach", not just "line follows mouse"
            const targetEl = connectPreview.targetId ? board.elements[connectPreview.targetId] : null;
            const targetBox =
              targetEl && isBoxElement(targetEl)
                ? (anchorBoxFor(targetEl, connectPreview.targetNoteIndex, noteHeights[connectPreview.targetId ?? '']) ?? elementBBox(targetEl))
                : null;
            const b = targetBox && connectPreview.snapAnchor ? anchorPointOfBox(targetBox, connectPreview.snapAnchor) : connectPreview.to;
            const pts = targetBox && connectPreview.snapAnchor ? routeWaypoints(a, connectPreview.fromAnchor, b, connectPreview.snapAnchor) : [a, b];
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

        {singleBoxSelected && !editingTarget && !activeFilter && (
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

      {toolbarElements && toolbarPos && (
        <BoardSelectionToolbar
          key={toolbarElements.map((s) => s.id).join(',')}
          elements={toolbarElements}
          sx={toolbarPos.sx}
          sy={toolbarPos.sy}
          onAddNote={() => {
            const s = selectedStickies[0];
            const notes = [...(s.notes ?? []), ''];
            updateElement(s.id, { notes });
            beginEditingTarget({ id: s.id, field: 'note', index: notes.length - 1 });
          }}
          onLinkNode={() => setLinkPicker('node')}
          onLinkNote={() => setLinkPicker('note')}
        />
      )}

      {allConnectorsSelected && connectorToolbarPos && (
        <BoardConnectorToolbar
          key={selectedConnectorIds.join(',')}
          color={(board.elements[selectedConnectorIds[0]] as BoardConnectorElement).color}
          sx={connectorToolbarPos.sx}
          sy={connectorToolbarPos.sy}
          onChange={(color) => updateElements(selectedConnectorIds, { color })}
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

      {elementContextMenu && (
        <BoardContextMenu
          ids={elementContextMenu.ids}
          x={elementContextMenu.x}
          y={elementContextMenu.y}
          onClose={() => setElementContextMenu(null)}
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
