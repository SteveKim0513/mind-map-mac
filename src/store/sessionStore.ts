import { create } from 'zustand';
import { createMapStore, type MapStore } from './mapStore';
import { createNoteStore, type NoteStore } from './noteStore';
import { deserialize, serialize, newId } from './../io/formats';
import { parseNote, serializeNote } from './../io/noteFormat';
import { useUi } from './uiStore';

export type TabKind = 'map' | 'note';

export interface Tab {
  id: string;
  path: string;
  title: string;
  kind: TabKind;
  isTemplate: boolean;
  store: MapStore | NoteStore;
}

/** true when this path should open as a Markdown note (vs a .mind map). */
export function isNotePath(path: string): boolean {
  return path.endsWith('.md');
}

/** true when this path lives in the hidden Note Template folder (.templates/). */
export function isTemplatePath(path: string): boolean {
  return path.includes('/.templates/');
}

export interface RecentFile {
  path: string;
  name: string;
  ts: number;
}

export type GroupIndex = 0 | 1;

interface SessionState {
  tabs: Tab[]; // pool of all open documents (one per file)
  // Two editor groups (panes). A tab id lives in exactly one group.
  leftTabs: string[];
  leftActive: string | null;
  rightTabs: string[];
  rightActive: string | null;
  split: boolean; // is the right group shown?
  activeGroup: GroupIndex;
  recent: RecentFile[];
  // Paths mid-trash. Autosave must NOT write these — otherwise a debounced save
  // can recreate the file just after shell.trashItem (delete-race guard).
  deletingPaths: Set<string>;

  // queries
  activeTab: () => Tab | null;
  activeStore: () => MapStore | null; // map-only (null when a note tab is active)
  activeNoteStore: () => NoteStore | null;
  tabById: (id: string | null) => Tab | undefined;

  // actions
  openPath: (path: string, content: string) => void;
  openInRight: (path: string, content: string) => void; // open/activate beside (right split)
  // open in the pane OPPOSITE the source group (keeps the source note visible);
  // used by note-link "열기" so the original never gets covered
  openBeside: (path: string, content: string, sourceGroup: GroupIndex) => void;
  selectTab: (tabId: string, group: GroupIndex) => void;
  closeTab: (tabId: string) => void;
  closeAllTabs: () => void;
  closeOtherTabs: (keepId: string) => void;
  moveTab: (tabId: string, toGroup: GroupIndex) => void;
  reorderTab: (tabId: string, group: GroupIndex, beforeTabId: string | null) => void;
  toggleSplit: () => void;
  setActiveGroup: (group: GroupIndex) => void;
  renamePath: (oldPath: string, newPath: string) => void;
  flushSaves: (target: string) => Promise<void>;
  beginDelete: (path: string) => void; // suppress autosave for path while trashing
  endDelete: (path: string) => void; // resume autosave (on failure or after settle)
  isDeleting: (path: string) => boolean; // true for the path or anything under it
  closeByPath: (path: string) => void;
  hydrate: (files: { path: string; content: string }[], snap: SessionSnapshot) => void;
}

function base(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.(mind|md)$/, '');
}

function makeTab(path: string, content: string): Tab {
  const isTemplate = isTemplatePath(path);
  if (isNotePath(path)) {
    const store = createNoteStore();
    store.getState().loadNote(parseNote(content, base(path)), path);
    return { id: newId(), path, title: base(path), kind: 'note', isTemplate, store };
  }
  const store = createMapStore();
  store.getState().loadDoc(deserialize(content), path);
  return { id: newId(), path, title: base(path), kind: 'map', isTemplate, store };
}

/** makeTab that returns null (instead of throwing) when the file is corrupt. */
function tryMakeTab(path: string, content: string): Tab | null {
  try {
    return makeTab(path, content);
  } catch {
    return null;
  }
}

// ── localStorage persistence ────────────────────────────────────────────────
function loadRecent(): RecentFile[] {
  try {
    return JSON.parse(localStorage.getItem('recent') ?? '[]');
  } catch {
    return [];
  }
}

export interface SessionSnapshot {
  leftPaths: string[];
  leftActivePath: string | null;
  rightPaths: string[];
  rightActivePath: string | null;
  split: boolean;
  activeGroup: GroupIndex;
}

export function loadSessionSnapshot(): SessionSnapshot | null {
  try {
    const s = localStorage.getItem('session');
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export const useSession = create<SessionState>((set, get) => {
  const persist = () => {
    const { tabs, leftTabs, leftActive, rightTabs, rightActive, split, activeGroup } = get();
    const pathOf = (id: string | null) => tabs.find((t) => t.id === id)?.path ?? null;
    const paths = (ids: string[]) => ids.map((id) => pathOf(id)).filter((p): p is string => !!p);
    const snap: SessionSnapshot = {
      leftPaths: paths(leftTabs),
      leftActivePath: pathOf(leftActive),
      rightPaths: paths(rightTabs),
      rightActivePath: pathOf(rightActive),
      split,
      activeGroup,
    };
    localStorage.setItem('session', JSON.stringify(snap));
    localStorage.setItem('recent', JSON.stringify(get().recent));
  };

  const pushRecent = (path: string) => {
    const recent = [
      { path, name: base(path), ts: Date.now() },
      ...get().recent.filter((r) => r.path !== path),
    ].slice(0, 12);
    set({ recent });
  };

  const groupOf = (id: string): GroupIndex | -1 =>
    get().leftTabs.includes(id) ? 0 : get().rightTabs.includes(id) ? 1 : -1;

  /** Pick a group's active tab after `removed` left it (list already excludes removed). */
  const neighborActive = (list: string[], removed: string, prevActive: string | null) =>
    prevActive !== removed ? prevActive : list[list.length - 1] ?? null;

  return {
    tabs: [],
    leftTabs: [],
    leftActive: null,
    rightTabs: [],
    rightActive: null,
    split: false,
    activeGroup: 0,
    recent: loadRecent(),
    deletingPaths: new Set<string>(),

    tabById: (id) => get().tabs.find((t) => t.id === id),
    activeTab: () => {
      const { activeGroup, split, leftActive, rightActive } = get();
      const id = split && activeGroup === 1 ? rightActive : leftActive;
      return get().tabs.find((t) => t.id === id) ?? null;
    },
    activeStore: () => {
      const t = get().activeTab();
      return t && t.kind === 'map' ? (t.store as MapStore) : null;
    },
    activeNoteStore: () => {
      const t = get().activeTab();
      return t && t.kind === 'note' ? (t.store as NoteStore) : null;
    },

    openPath: (path, content) => {
      const existing = get().tabs.find((t) => t.path === path);
      if (existing) {
        const g = groupOf(existing.id);
        if (g === 1) set({ rightActive: existing.id, activeGroup: 1 });
        else set({ leftActive: existing.id, activeGroup: 0 });
        pushRecent(path);
        persist();
        return;
      }
      const tab = tryMakeTab(path, content);
      if (!tab) {
        useUi.getState().toast('파일을 열 수 없습니다 — 손상된 마인드맵');
        return;
      }
      const toRight = get().split && get().activeGroup === 1;
      set((s) => ({
        tabs: [...s.tabs, tab],
        ...(toRight
          ? { rightTabs: [...s.rightTabs, tab.id], rightActive: tab.id, activeGroup: 1 as const }
          : { leftTabs: [...s.leftTabs, tab.id], leftActive: tab.id, activeGroup: 0 as const }),
      }));
      pushRecent(path);
      persist();
    },

    openInRight: (path, content) => {
      let tab = get().tabs.find((t) => t.path === path);
      let tabs = get().tabs;
      if (!tab) {
        const made = tryMakeTab(path, content);
        if (!made) {
          useUi.getState().toast('파일을 열 수 없습니다');
          return;
        }
        tab = made;
        tabs = [...tabs, made];
      }
      const id = tab.id;
      const s = get();
      const leftTabs = s.leftTabs.filter((t) => t !== id);
      if (leftTabs.length === 0) {
        // nothing to split against → open/activate in the single (left) group
        const lt = s.leftTabs.includes(id) ? s.leftTabs : [...s.leftTabs, id];
        set({ tabs, leftTabs: lt, leftActive: id, activeGroup: 0 });
        pushRecent(path);
        persist();
        return;
      }
      const rightTabs = s.rightTabs.includes(id) ? s.rightTabs : [...s.rightTabs, id];
      set({
        tabs,
        leftTabs,
        leftActive: neighborActive(leftTabs, id, s.leftActive),
        rightTabs,
        rightActive: id,
        split: true,
        activeGroup: 1,
      });
      pushRecent(path);
      persist();
    },

    openBeside: (path, content, sourceGroup) => {
      // source on the LEFT → target on the right is exactly openInRight
      if (sourceGroup === 0) return get().openInRight(path, content);

      // source on the RIGHT → open the target in the LEFT, keep the source on the right
      let tab = get().tabs.find((t) => t.path === path);
      let tabs = get().tabs;
      if (!tab) {
        const made = tryMakeTab(path, content);
        if (!made) {
          useUi.getState().toast('파일을 열 수 없습니다');
          return;
        }
        tab = made;
        tabs = [...tabs, made];
      }
      const id = tab.id;
      const s = get();
      const rightTabs = s.rightTabs.filter((t) => t !== id); // pull target out of the right if it lived there
      const leftTabs = s.leftTabs.includes(id) ? s.leftTabs : [...s.leftTabs, id];
      if (rightTabs.length === 0) {
        // moving the target emptied the right → collapse the split
        set({ tabs, leftTabs, leftActive: id, rightTabs: [], rightActive: null, split: false, activeGroup: 0 });
      } else {
        set({
          tabs,
          leftTabs,
          leftActive: id,
          rightTabs,
          rightActive: neighborActive(rightTabs, id, s.rightActive),
          split: true,
          activeGroup: 0,
        });
      }
      pushRecent(path);
      persist();
    },

    selectTab: (tabId, group) => {
      if (group === 1 && !get().split) return;
      set(group === 0 ? { leftActive: tabId, activeGroup: 0 } : { rightActive: tabId, activeGroup: 1 });
      persist();
    },

    setActiveGroup: (group) => {
      if (group === 1 && !get().split) return;
      set({ activeGroup: group });
      persist();
    },

    closeTab: (tabId) => {
      const g = groupOf(tabId);
      if (g === -1) return;
      const s = get();
      const tabs = s.tabs.filter((t) => t.id !== tabId);

      if (g === 0) {
        const leftTabs = s.leftTabs.filter((id) => id !== tabId);
        let { rightTabs, rightActive, split, activeGroup } = s;
        let leftActive = neighborActive(leftTabs, tabId, s.leftActive);
        // if left emptied while split, pull the right group back into the left
        if (leftTabs.length === 0 && split) {
          set({
            tabs,
            leftTabs: rightTabs,
            leftActive: rightActive,
            rightTabs: [],
            rightActive: null,
            split: false,
            activeGroup: 0,
          });
          persist();
          return;
        }
        set({ tabs, leftTabs, leftActive, rightTabs, rightActive, split, activeGroup });
      } else {
        const rightTabs = s.rightTabs.filter((id) => id !== tabId);
        const rightActive = neighborActive(rightTabs, tabId, s.rightActive);
        if (rightTabs.length === 0) {
          // right emptied → collapse the split
          set({ tabs, rightTabs: [], rightActive: null, split: false, activeGroup: 0 });
        } else {
          set({ tabs, rightTabs, rightActive });
        }
      }
      persist();
    },

    moveTab: (tabId, toGroup) => {
      const from = groupOf(tabId);
      if (from === -1 || from === toGroup) return;
      const s = get();

      if (toGroup === 1) {
        // moving to the right creates the split if needed
        const leftTabs = s.leftTabs.filter((id) => id !== tabId);
        if (leftTabs.length === 0) return; // don't strand the left empty
        set({
          leftTabs,
          leftActive: neighborActive(leftTabs, tabId, s.leftActive),
          rightTabs: [...s.rightTabs, tabId],
          rightActive: tabId,
          split: true,
          activeGroup: 1,
        });
      } else {
        const rightTabs = s.rightTabs.filter((id) => id !== tabId);
        set({
          rightTabs,
          rightActive: neighborActive(rightTabs, tabId, s.rightActive),
          leftTabs: [...s.leftTabs, tabId],
          leftActive: tabId,
          activeGroup: 0,
          split: rightTabs.length > 0,
        });
      }
      persist();
    },

    closeAllTabs: () => {
      set({
        tabs: [],
        leftTabs: [],
        leftActive: null,
        rightTabs: [],
        rightActive: null,
        split: false,
        activeGroup: 0,
      });
      persist();
    },

    closeOtherTabs: (keepId) => {
      const keep = get().tabs.find((t) => t.id === keepId);
      if (!keep) return;
      set({
        tabs: [keep],
        leftTabs: [keepId],
        leftActive: keepId,
        rightTabs: [],
        rightActive: null,
        split: false,
        activeGroup: 0,
      });
      persist();
    },

    reorderTab: (tabId, group, beforeTabId) => {
      const s = get();
      const src = group === 0 ? s.leftTabs : s.rightTabs;
      if (!src.includes(tabId)) {
        // not in this group → treat as a cross-group move
        get().moveTab(tabId, group);
        return;
      }
      let arr = src.filter((t) => t !== tabId);
      const idx = beforeTabId ? arr.indexOf(beforeTabId) : arr.length;
      arr.splice(idx < 0 ? arr.length : idx, 0, tabId);
      set(group === 0 ? { leftTabs: arr } : { rightTabs: arr });
      persist();
    },

    toggleSplit: () => {
      const s = get();
      if (s.split) {
        // merge the right group back into the left
        set({
          leftTabs: [...s.leftTabs, ...s.rightTabs],
          leftActive: s.leftActive ?? s.rightActive,
          rightTabs: [],
          rightActive: null,
          split: false,
          activeGroup: 0,
        });
      } else {
        if (s.leftTabs.length < 2) return; // need at least two tabs to split
        const moving = s.leftActive ?? s.leftTabs[s.leftTabs.length - 1];
        const leftTabs = s.leftTabs.filter((id) => id !== moving);
        set({
          leftTabs,
          leftActive: leftTabs[leftTabs.length - 1] ?? null,
          rightTabs: [moving],
          rightActive: moving,
          split: true,
          activeGroup: 1,
        });
      }
      persist();
    },

    renamePath: (oldPath, newPath) => {
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.path === oldPath || t.path.startsWith(oldPath + '/')) {
            // Anchor the replacement to the path prefix — a plain String.replace
            // would rewrite the first match anywhere in the path.
            const np = newPath + t.path.slice(oldPath.length);
            t.store.getState().setFilePath(np);
            return { ...t, path: np, title: base(np) };
          }
          return t;
        }),
      }));
      persist();
    },

    flushSaves: async (target) => {
      // Write out any pending (debounced) edits for tabs at/under `target` before a
      // rename/move, so the disk operation can't race the autosave onto a stale path.
      const affected = get().tabs.filter(
        (t) => t.path === target || t.path.startsWith(target + '/'),
      );
      await Promise.all(
        affected.map(async (t) => {
          if (t.kind === 'note') {
            const st = (t.store as NoteStore).getState();
            if (st.dirty && st.filePath) {
              const p = await window.api.save(st.filePath, serializeNote(st.note));
              if (p) (t.store as NoteStore).getState().markSaved(p);
            }
          } else {
            const st = (t.store as MapStore).getState();
            if (st.dirty && st.filePath) {
              const p = await window.api.save(st.filePath, serialize(st.doc));
              if (p) (t.store as MapStore).getState().markSaved(p);
            }
          }
        }),
      );
    },

    beginDelete: (path) =>
      set((s) => ({ deletingPaths: new Set(s.deletingPaths).add(path) })),
    endDelete: (path) =>
      set((s) => {
        const next = new Set(s.deletingPaths);
        next.delete(path);
        return { deletingPaths: next };
      }),
    isDeleting: (path) => {
      for (const p of get().deletingPaths) if (path === p || path.startsWith(p + '/')) return true;
      return false;
    },

    closeByPath: (path) => {
      const victims = get().tabs.filter((t) => t.path === path || t.path.startsWith(path + '/'));
      victims.forEach((t) => get().closeTab(t.id));
      // drop the deleted file (or anything under a deleted folder) from recents
      set((s) => ({
        recent: s.recent.filter((r) => r.path !== path && !r.path.startsWith(path + '/')),
      }));
      persist();
    },

    hydrate: (files, snap) => {
      // Skip any corrupt file so one bad doc can't abort restoring the whole session.
      const pool = files
        .map((f) => tryMakeTab(f.path, f.content))
        .filter((t): t is Tab => t !== null);
      const skipped = files.length - pool.length;
      if (skipped > 0) {
        window.api?.log?.('warn', 'session', `restore skipped ${skipped} corrupt file(s)`);
        setTimeout(() => useUi.getState().toast(`${skipped}개 파일을 열 수 없어 건너뛰었습니다`), 0);
      }
      const byPath = new Map(pool.map((t) => [t.path, t.id]));
      const ids = (paths: string[]) =>
        paths.map((p) => byPath.get(p)).filter((id): id is string => !!id);
      const leftTabs = ids(snap.leftPaths);
      const rightTabs = ids(snap.rightPaths);
      const split = snap.split && rightTabs.length > 0;
      set({
        tabs: pool,
        leftTabs,
        leftActive: (snap.leftActivePath && byPath.get(snap.leftActivePath)) || leftTabs[0] || null,
        rightTabs,
        rightActive:
          (snap.rightActivePath && byPath.get(snap.rightActivePath)) || rightTabs[0] || null,
        split,
        activeGroup: split ? snap.activeGroup : 0,
      });
    },
  };
});
