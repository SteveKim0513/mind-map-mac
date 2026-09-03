import { createContext, useContext } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import type {
  BoardAnchorSide,
  BoardDoc,
  BoardElement,
  BoardNoteRef,
  NoteLink,
  StickyAlign,
  StickyFontSize,
  StickyShape,
  StickyValign,
} from '../types';
import type { TagKey } from '../theme/palette';
import { emptyBoard } from '../io/boardFormat';

/** Patchable fields across every element kind (union of all kind-specific
 *  fields, minus `id`/`kind`) — avoids the keyof-intersection trap of
 *  `Partial<BoardElement>` on a discriminated union while staying `any`-free. */
export type BoardElementPatch = Partial<{
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  text: string;
  color: string;
  shape: StickyShape;
  align: StickyAlign;
  valign: StickyValign;
  fontSize: StickyFontSize;
  bold: boolean;
  notes: string[];
  src: string;
  alt: string;
  fromId: string;
  fromAnchor: BoardAnchorSide;
  toId: string;
  toAnchor: BoardAnchorSide;
  arrow: boolean;
  label: string;
}>;

interface BoardState {
  board: BoardDoc;
  filePath: string | null;
  dirty: boolean;
  selection: string[]; // selected element ids — ephemeral, not persisted
  colorFilter: string | null; // ephemeral — dim every sticky not tagged this color
  shapeFilter: StickyShape | null; // ephemeral — dim every sticky not this outline shape

  loadBoard: (board: BoardDoc, filePath: string | null) => void;
  markSaved: (filePath: string) => void;
  setFilePath: (filePath: string) => void;

  addElement: (el: BoardElement) => void;
  /** Atomic multi-add (e.g. a new sticky + the connector that spawned it).
   *  Selects the LAST element in `els` — order the array with the "main" new
   *  element (the sticky, not its connector) last. */
  addElements: (els: BoardElement[]) => void;
  updateElement: (id: string, patch: BoardElementPatch) => void;
  /** Same patch applied to several elements at once (bulk sticky editing) —
   *  one history-worthy write instead of N, and each element only takes the
   *  fields that apply to it (a patch with `shape` is silently ignored on an
   *  image, same as `updateElement` already does via the discriminated union). */
  updateElements: (ids: string[], patch: BoardElementPatch) => void;
  moveElements: (ids: string[], dx: number, dy: number) => void;
  /** Batch absolute reposition (auto-layout) — every id gets its own x/y in
   *  one write, so the canvas doesn't re-render mid-layout. */
  setElementPositions: (positions: { id: string; x: number; y: number }[]) => void;
  /** Removes the given elements AND any connector attached to one of them
   *  (a connector can't dangle on a deleted endpoint). */
  removeElements: (ids: string[]) => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  setSelection: (ids: string[]) => void;
  setColorFilter: (color: string | null) => void;
  setShapeFilter: (shape: StickyShape | null) => void;
  setTagLabel: (key: TagKey, label: string) => void;
  setView: (view: Partial<BoardDoc['view']>) => void;
  /** null clears the link. Distinct from `updateElement` so callers never have
   *  to reason about whether an optional-object patch field "clears" or "is
   *  omitted" — see BoardStickyElement.nodeLink/noteLink. */
  setNodeLink: (id: string, link: NoteLink | null) => void;
  setNoteLink: (id: string, ref: BoardNoteRef | null) => void;
}

export type BoardStore = StoreApi<BoardState>;

export function createBoardStore(): BoardStore {
  return createStore<BoardState>((set, get) => ({
    board: emptyBoard(),
    filePath: null,
    dirty: false,
    selection: [],
    colorFilter: null,
    shapeFilter: null,

    loadBoard: (board, filePath) =>
      set({ board, filePath, dirty: false, selection: [], colorFilter: null, shapeFilter: null }),
    markSaved: (filePath) => set({ filePath, dirty: false }),
    setFilePath: (filePath) => set({ filePath }),

    addElement: (el) => get().addElements([el]),

    addElements: (els) => {
      if (!els.length) return;
      const { board } = get();
      const elements = { ...board.elements };
      for (const el of els) elements[el.id] = el;
      set({
        board: { ...board, elements, order: [...board.order, ...els.map((e) => e.id)] },
        dirty: true,
        selection: [els[els.length - 1].id],
      });
    },

    updateElement: (id, patch) => {
      const { board } = get();
      const el = board.elements[id];
      if (!el) return;
      set({
        board: { ...board, elements: { ...board.elements, [id]: { ...el, ...patch } as BoardElement } },
        dirty: true,
      });
    },

    updateElements: (ids, patch) => {
      const { board } = get();
      const elements = { ...board.elements };
      let changed = false;
      for (const id of ids) {
        const el = elements[id];
        if (!el) continue;
        elements[id] = { ...el, ...patch } as BoardElement;
        changed = true;
      }
      if (!changed) return;
      set({ board: { ...board, elements }, dirty: true });
    },

    setElementPositions: (positions) => {
      const { board } = get();
      const elements = { ...board.elements };
      let changed = false;
      for (const { id, x, y } of positions) {
        const el = elements[id];
        if (!el || el.kind === 'connector') continue;
        elements[id] = { ...el, x, y };
        changed = true;
      }
      if (!changed) return;
      set({ board: { ...board, elements }, dirty: true });
    },

    moveElements: (ids, dx, dy) => {
      const { board } = get();
      const elements = { ...board.elements };
      for (const id of ids) {
        const el = elements[id];
        if (!el || el.kind === 'connector') continue; // connectors have no position of their own
        elements[id] = { ...el, x: el.x + dx, y: el.y + dy };
      }
      set({ board: { ...board, elements }, dirty: true });
    },

    removeElements: (ids) => {
      const { board, selection } = get();
      const idSet = new Set(ids);
      for (const el of Object.values(board.elements)) {
        if (el.kind === 'connector' && (idSet.has(el.fromId) || idSet.has(el.toId))) idSet.add(el.id);
      }
      const elements = { ...board.elements };
      for (const id of idSet) delete elements[id];
      set({
        board: { ...board, elements, order: board.order.filter((id) => !idSet.has(id)) },
        dirty: true,
        selection: selection.filter((id) => !idSet.has(id)),
      });
    },

    bringToFront: (id) => {
      const { board } = get();
      if (!board.order.includes(id)) return;
      set({ board: { ...board, order: [...board.order.filter((x) => x !== id), id] }, dirty: true });
    },

    sendToBack: (id) => {
      const { board } = get();
      if (!board.order.includes(id)) return;
      set({ board: { ...board, order: [id, ...board.order.filter((x) => x !== id)] }, dirty: true });
    },

    setSelection: (ids) => set({ selection: ids }),
    setColorFilter: (color) => set({ colorFilter: color }),
    setShapeFilter: (shape) => set({ shapeFilter: shape }),

    setTagLabel: (key, label) => {
      const { board } = get();
      const tagLabels = { ...board.tagLabels };
      if (!label) {
        delete tagLabels[key];
      } else {
        tagLabels[key] = label;
      }
      set({
        board: { ...board, tagLabels: Object.keys(tagLabels).length > 0 ? tagLabels : undefined },
        dirty: true,
      });
    },

    setView: (view) =>
      set((s) => ({ board: { ...s.board, view: { ...s.board.view, ...view } }, dirty: true })),

    setNodeLink: (id, link) => {
      const { board } = get();
      const el = board.elements[id];
      if (!el || el.kind !== 'sticky') return;
      const next = { ...el, nodeLink: link ?? undefined };
      set({ board: { ...board, elements: { ...board.elements, [id]: next } }, dirty: true });
    },

    setNoteLink: (id, ref) => {
      const { board } = get();
      const el = board.elements[id];
      if (!el || el.kind !== 'sticky') return;
      const next = { ...el, noteLink: ref ?? undefined };
      set({ board: { ...board, elements: { ...board.elements, [id]: next } }, dirty: true });
    },
  }));
}

// ── React context: components read the board store of the pane they render in ──
export const BoardContext = createContext<BoardStore | null>(null);

export function useBoardStore(): BoardStore {
  const store = useContext(BoardContext);
  if (!store) throw new Error('useBoardStore must be used within a BoardContext.Provider');
  return store;
}

export function useBoard<T>(selector: (s: ReturnType<BoardStore['getState']>) => T): T {
  return useStore(useBoardStore(), selector);
}
