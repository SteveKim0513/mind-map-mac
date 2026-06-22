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
  // workspace-wide search (all maps' nodes + all notes' title/body)
  globalSearchOpen: boolean;
  setGlobalSearch: (b: boolean) => void;

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

  // a tab currently being dragged. `overPane` = the cursor left the tab strip and
  // is over the panes (→ show split zones); `zone` = which split zone is hovered
  // (→ highlight it). Null while reordering within the strip.
  tabDrag: { id: string; overPane: boolean; zone: 0 | 1 | null } | null;
  setTabDrag: (v: { id: string; overPane: boolean; zone: 0 | 1 | null } | null) => void;

  // node right-click context menu (owning pane renders it)
  contextMenu: { id: string; x: number; y: number } | null;
  openContextMenu: (id: string, x: number, y: number) => void;
  closeContextMenu: () => void;

  // note peek popup (opened from a node's link chip) — paths + the screen point
  // it was launched from (so the peek anchors near the node, not screen-center)
  notePopup: {
    paths: string[];
    anchor?: { x: number; y: number };
    /** the node the popup was opened from — enables unlinking from the node side */
    link?: { mapId: string; nodeId: string };
    /** for a note→note peek: the pane the source note is in, so "열기" opens the
     *  target in the OPPOSITE pane (keeps the source visible) */
    sourceGroup?: 0 | 1;
  } | null;
  openNotePopup: (
    paths: string[],
    anchor?: { x: number; y: number },
    link?: { mapId: string; nodeId: string },
    sourceGroup?: 0 | 1,
  ) => void;
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
  toasts: { id: number; msg: string; action?: { label: string; onClick: () => void } }[];
  toast: (msg: string) => void;
  toastError: (msg: string) => void;
  toastAction: (msg: string, actionLabel: string, onAction: () => void) => void;
  dismissToast: (id: number) => void;

  // node text scale (persisted)
  fontScale: number;
  setFontScale: (s: number) => void;

  // ── focus session (only one active at a time) ──
  // goal prompt shown before a session starts (captures the goal as structured
  // data via the process, not a note template)
  focusPrompt: { nodeText: string } | null;
  openFocusPrompt: (p: { nodeText: string }) => void;
  closeFocusPrompt: () => void;
  activeFocus: ActiveFocus | null;
  setActiveFocus: (f: ActiveFocus | null) => void;
  // completion card shown on end (null = hidden)
  focusDone: FocusDoneCard | null;
  setFocusDone: (c: FocusDoneCard | null) => void;
  // work-history dashboard (overlay)
  historyOpen: boolean;
  openHistory: () => void;
  closeHistory: () => void;
  // "오늘" agenda (overlay)
  todayOpen: boolean;
  openToday: () => void;
  closeToday: () => void;
  // release history (overlay) + post-update "what's new" card (a version string)
  updatesOpen: boolean;
  openUpdates: () => void;
  closeUpdates: () => void;
  whatsNew: string | null;
  setWhatsNew: (v: string | null) => void;
  // settings (overlay) + the in-app manual (shortcuts + usage)
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  manualOpen: boolean;
  openManual: () => void;
  closeManual: () => void;
  // in-app update-check popup (immediate feedback on "업데이트 확인")
  updateStatus: UpdateStatus | null;
  setUpdateStatus: (s: UpdateStatus | null) => void;
}

export type UpdateStatus =
  | { phase: 'checking' }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'downloaded'; version: string }
  | { phase: 'up-to-date'; version: string }
  | { phase: 'error'; message?: string }
  | { phase: 'dev-disabled' };

/** The running session, mirrored to localStorage for crash recovery. */
export interface ActiveFocus {
  sessionId: string;
  notePath: string;
  start: number; // epoch ms
  mapId: string;
  nodeId: string;
  nodeText: string;
}
export interface FocusDoneCard {
  durationSec: number;
  nodeText: string;
  goal?: string; // the session's "🎯 한 가지" (so the outcome can be judged against it)
  todaySec: number;
  focusDays7: number; // focus days in the last 7 (neutral framing, ADR 0007)
  nodeRolledSec: number;
  notePath: string;
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
  globalSearchOpen: false,
  setGlobalSearch: (b) => set({ globalSearchOpen: b }),

  notePopoverId: null,
  openNote: (id) => set({ notePopoverId: id }),
  closeNote: () => set({ notePopoverId: null }),

  schedulePopoverId: null,
  openSchedule: (id) => set({ schedulePopoverId: id }),
  closeSchedule: () => set({ schedulePopoverId: null }),

  syncStatus: 'idle',
  setSyncStatus: (s) => set((cur) => (cur.syncStatus === s ? cur : { syncStatus: s })),

  tabDrag: null,
  setTabDrag: (v) => set({ tabDrag: v }),

  contextMenu: null,
  openContextMenu: (id, x, y) => set({ contextMenu: { id, x, y } }),
  closeContextMenu: () => set({ contextMenu: null }),

  notePopup: null,
  openNotePopup: (paths, anchor, link, sourceGroup) =>
    set({ notePopup: paths.length ? { paths, anchor, link, sourceGroup } : null }),
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
    setTimeout(() => get().dismissToast(id), 2500);
  },
  toastError: (msg) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, msg }] }));
    setTimeout(() => get().dismissToast(id), 5000);
  },
  toastAction: (msg, actionLabel, onAction) => {
    const id = ++toastSeq;
    const onClick = () => { onAction(); get().dismissToast(id); };
    set((s) => ({ toasts: [...s.toasts, { id, msg, action: { label: actionLabel, onClick } }] }));
    setTimeout(() => get().dismissToast(id), 5000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  fontScale: initialScale,
  setFontScale: (sc) => {
    const clamped = Math.max(0.8, Math.min(1.5, Math.round(sc * 100) / 100));
    localStorage.setItem('fontScale', String(clamped));
    document.documentElement.style.setProperty('--font-scale', String(clamped));
    set({ fontScale: clamped });
  },

  focusPrompt: null,
  openFocusPrompt: (p) => set({ focusPrompt: p }),
  closeFocusPrompt: () => set({ focusPrompt: null }),
  activeFocus: (() => {
    try {
      const raw = localStorage.getItem('activeFocus');
      return raw ? (JSON.parse(raw) as ActiveFocus) : null;
    } catch {
      return null;
    }
  })(),
  setActiveFocus: (f) => {
    if (f) localStorage.setItem('activeFocus', JSON.stringify(f));
    else localStorage.removeItem('activeFocus');
    set({ activeFocus: f });
  },
  focusDone: null,
  setFocusDone: (c) => set({ focusDone: c }),
  historyOpen: false,
  openHistory: () => set({ historyOpen: true }),
  closeHistory: () => set({ historyOpen: false }),
  todayOpen: false,
  openToday: () => set({ todayOpen: true }),
  closeToday: () => set({ todayOpen: false }),
  updatesOpen: false,
  openUpdates: () => set({ updatesOpen: true }),
  closeUpdates: () => set({ updatesOpen: false }),
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  manualOpen: false,
  openManual: () => set({ manualOpen: true }),
  closeManual: () => set({ manualOpen: false }),
  updateStatus: null,
  setUpdateStatus: (s) => set({ updateStatus: s }),
  whatsNew: null,
  setWhatsNew: (v) => set({ whatsNew: v }),
}));
