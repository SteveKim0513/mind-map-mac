import { create } from 'zustand';

type Theme = 'light' | 'dark';

interface UiState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;

  // search highlight
  matchIds: string[];
  activeMatchId: string | null;
  setMatches: (ids: string[], active: string | null) => void;
  clearMatches: () => void;

  // a request to center a node on the canvas (nonce makes repeats fire)
  focusReq: { id: string; nonce: number } | null;
  focusNode: (id: string) => void;

  // overlays (controllable from anywhere)
  searchOpen: boolean;
  setSearchOpen: (b: boolean) => void;

  // note/link popover, anchored to a node id (the owning pane renders it)
  notePopoverId: string | null;
  openNote: (id: string) => void;
  closeNote: () => void;

  // schedule popover (date + reminder toggle), anchored to a node id
  schedulePopoverId: string | null;
  openSchedule: (id: string) => void;
  closeSchedule: () => void;

  // macOS Reminders sync health (drives a status indicator)
  syncStatus: 'idle' | 'syncing' | 'ok' | 'down' | 'denied';
  setSyncStatus: (s: 'idle' | 'syncing' | 'ok' | 'down' | 'denied') => void;

  // a tab currently being dragged (drives the pane split drop-zones)
  tabDragId: string | null;
  setTabDrag: (id: string | null) => void;

  // node right-click context menu (owning pane renders it)
  contextMenu: { id: string; x: number; y: number } | null;
  openContextMenu: (id: string, x: number, y: number) => void;
  closeContextMenu: () => void;

  // note peek popup (opened from a node's link chip) — paths + the screen point
  // it was launched from (so the peek anchors near the node, not screen-center)
  notePopup: { paths: string[]; anchor?: { x: number; y: number } } | null;
  openNotePopup: (paths: string[], anchor?: { x: number; y: number }) => void;
  closeNotePopup: () => void;

  // node→note link picker target (set from a node's "노트 연결" menu)
  linkTarget: { mapId: string; nodeId: string; nodeText: string; mapPath: string } | null;
  openLinkNote: (t: { mapId: string; nodeId: string; nodeText: string; mapPath: string }) => void;
  closeLinkNote: () => void;

  // "링크 추가" target — a node id (the owning pane renders the input)
  addLinkFor: string | null;
  openAddLink: (id: string) => void;
  closeAddLink: () => void;

  // node whose inline memo should be focused for editing (e.g. just created)
  memoEditFor: string | null;
  setMemoEditFor: (id: string | null) => void;

  // ⌘P quick-open palette
  quickOpen: boolean;
  setQuickOpen: (b: boolean) => void;

  // ⌘K command palette
  cmdkOpen: boolean;
  setCmdkOpen: (b: boolean) => void;

  // request to zoom the canvas onto a node's subtree
  zoomReq: { id: string; nonce: number } | null;
  zoomTo: (id: string) => void;

  // request to re-measure + re-fit the canvas (recover from any layout glitch)
  relayoutReq: number;
  relayout: () => void;

  // toasts
  toasts: { id: number; msg: string }[];
  toast: (msg: string) => void;
  dismissToast: (id: number) => void;

  // node text scale (persisted)
  fontScale: number;
  setFontScale: (s: number) => void;
}

function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
}

const initialTheme: Theme = (localStorage.getItem('theme') as Theme) || 'light';
applyTheme(initialTheme);

const initialScale = Number(localStorage.getItem('fontScale')) || 1;
document.documentElement.style.setProperty('--font-scale', String(initialScale));

let toastSeq = 0;

export const useUi = create<UiState>((set, get) => ({
  theme: initialTheme,
  setTheme: (t) => {
    localStorage.setItem('theme', t);
    applyTheme(t);
    set({ theme: t });
  },
  toggleTheme: () => get().setTheme(get().theme === 'light' ? 'dark' : 'light'),

  matchIds: [],
  activeMatchId: null,
  setMatches: (ids, active) => set({ matchIds: ids, activeMatchId: active }),
  clearMatches: () => set({ matchIds: [], activeMatchId: null }),

  focusReq: null,
  focusNode: (id) => set((s) => ({ focusReq: { id, nonce: (s.focusReq?.nonce ?? 0) + 1 } })),

  searchOpen: false,
  setSearchOpen: (b) => set({ searchOpen: b }),

  notePopoverId: null,
  openNote: (id) => set({ notePopoverId: id }),
  closeNote: () => set({ notePopoverId: null }),

  schedulePopoverId: null,
  openSchedule: (id) => set({ schedulePopoverId: id }),
  closeSchedule: () => set({ schedulePopoverId: null }),

  syncStatus: 'idle',
  setSyncStatus: (s) => set((cur) => (cur.syncStatus === s ? cur : { syncStatus: s })),

  tabDragId: null,
  setTabDrag: (id) => set({ tabDragId: id }),

  contextMenu: null,
  openContextMenu: (id, x, y) => set({ contextMenu: { id, x, y } }),
  closeContextMenu: () => set({ contextMenu: null }),

  notePopup: null,
  openNotePopup: (paths, anchor) => set({ notePopup: paths.length ? { paths, anchor } : null }),
  closeNotePopup: () => set({ notePopup: null }),

  linkTarget: null,
  openLinkNote: (t) => set({ linkTarget: t }),
  closeLinkNote: () => set({ linkTarget: null }),

  addLinkFor: null,
  openAddLink: (id) => set({ addLinkFor: id }),
  closeAddLink: () => set({ addLinkFor: null }),

  memoEditFor: null,
  setMemoEditFor: (id) => set({ memoEditFor: id }),

  quickOpen: false,
  setQuickOpen: (b) => set({ quickOpen: b }),

  cmdkOpen: false,
  setCmdkOpen: (b) => set({ cmdkOpen: b }),

  zoomReq: null,
  zoomTo: (id) => set((s) => ({ zoomReq: { id, nonce: (s.zoomReq?.nonce ?? 0) + 1 } })),

  relayoutReq: 0,
  relayout: () => set((s) => ({ relayoutReq: s.relayoutReq + 1 })),

  toasts: [],
  toast: (msg) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, msg }] }));
    setTimeout(() => get().dismissToast(id), 2200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  fontScale: initialScale,
  setFontScale: (sc) => {
    const clamped = Math.max(0.8, Math.min(1.5, Math.round(sc * 100) / 100));
    localStorage.setItem('fontScale', String(clamped));
    document.documentElement.style.setProperty('--font-scale', String(clamped));
    set({ fontScale: clamped });
  },
}));
