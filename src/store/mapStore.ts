import { createStore, useStore, type StoreApi } from 'zustand';
import { createContext, useContext } from 'react';
import type { MindMapDoc, MindNode } from '../types';
import { emptyDoc, newId } from '../io/formats';

const HISTORY_LIMIT = 100;

export type NavDir = 'up' | 'down' | 'left' | 'right';

/** A detached, id-free copy of a subtree, held on the in-app clipboard. */
interface ClipNode {
  text: string;
  done?: boolean;
  color?: string;
  icon?: string;
  note?: string;
  link?: string;
  children: ClipNode[];
}
let clipboard: ClipNode | null = null;

// The reminder-sync engine registers a callback here so that deleting a node also
// removes its mirrored macOS reminder. Kept as an injected hook to avoid a store↔sync
// import cycle. No-op until reminder sync starts.
let reminderDeleteHook: ((reminderIds: string[]) => void) | null = null;
export function setReminderDeleteHook(fn: ((reminderIds: string[]) => void) | null) {
  reminderDeleteHook = fn;
}

interface MapState {
  doc: MindMapDoc;
  selectedId: string | null; // primary selection (last clicked)
  selectedIds: string[]; // full multi-selection
  editingId: string | null;
  filePath: string | null;
  dirty: boolean;
  past: MindMapDoc[];
  future: MindMapDoc[];
  // timestamp (ms) of the last edit-commit; used to swallow the Enter that ends editing
  editCommittedAt: number;
  // bumped whenever a whole new document is loaded — the canvas re-fits the view on change
  docEpoch: number;

  // document lifecycle
  loadDoc: (doc: MindMapDoc, filePath: string | null) => void;
  newDoc: () => void;
  markSaved: (filePath: string) => void;
  setFilePath: (filePath: string) => void;

  // selection / editing
  select: (id: string | null) => void;
  toggleSelect: (id: string) => void;
  startEdit: (id: string) => void;
  commitEdit: (text: string) => void;
  commitText: (id: string, text: string) => void;
  cancelEdit: () => void;

  // focus mode (isolate a subtree)
  focusRootId: string | null;
  setFocus: (id: string | null) => void;

  // color filter: by default only the colored nodes; ancestors/descendants optional
  colorFilter: string | null;
  setColorFilter: (color: string | null) => void;
  filterAncestors: boolean;
  filterDescendants: boolean;
  toggleFilterAncestors: () => void;
  toggleFilterDescendants: () => void;

  // structure mutations (history-tracked)
  addRoot: () => void;
  addRootAt: (x: number, y: number) => void;
  addChild: (parentId: string) => void;
  addSibling: (id: string) => void;
  duplicateNode: (id: string) => void;
  deleteNode: (id: string) => void;
  deleteSelected: () => void;
  reparentMany: (ids: string[], newParentId: string | null) => void;
  setColor: (id: string, color: string | undefined) => void;
  setNote: (id: string, note: string) => void;
  setLink: (id: string, link: string | undefined) => void;
  addNodeLink: (id: string, url: string) => void;
  removeNodeLink: (id: string, url: string) => void;
  setIcon: (id: string, icon: string | undefined) => void;
  toggleDone: (id: string) => void;
  // schedule / reminders
  setScheduled: (id: string, on: boolean) => void; // applies to the node + all descendants
  setScheduleAt: (id: string, iso: string | undefined) => void;
  setReminderOn: (id: string, on: boolean) => void;
  applyReminderPatch: (id: string, fields: Partial<MindNode>) => void; // no history; used by sync
  moveSibling: (id: string, dir: 'up' | 'down') => void;
  reparent: (nodeId: string, newParentId: string | null, index?: number) => void;
  setManualPos: (rootId: string, pos: { x: number; y: number }) => void;
  toggleCollapse: (id: string) => void;

  // connections (node-to-node cross links)
  addConnection: (from: string, to: string) => void;
  removeConnection: (id: string) => void;
  setConnectionNote: (id: string, note: string) => void;
  setConnectionLabelPos: (id: string, pos: { x: number; y: number } | undefined) => void;

  // sections (grouping regions)
  addSection: (nodeIds: string[]) => void;
  removeSection: (id: string) => void;
  setSectionTitle: (id: string, title: string) => void;
  setSectionColor: (id: string, color: string | undefined) => void;
  setSectionLabelPos: (id: string, pos: { x: number; y: number } | undefined) => void;

  // clipboard (subtree copy/paste)
  copyNode: (id: string) => void;
  pasteNode: (targetId: string | null) => void;
  hasClipboard: () => boolean;

  // keyboard navigation
  navigate: (dir: NavDir) => void;

  // history
  undo: () => void;
  redo: () => void;

  // view (not history-tracked, but persisted)
  setView: (view: Partial<MindMapDoc['view']>) => void;
}

/** Is `maybeAncestor` an ancestor of (or equal to) `id`? Guards against cycles. */
function isAncestor(nodes: Record<string, MindNode>, maybeAncestor: string, id: string): boolean {
  let cur: string | null = id;
  while (cur) {
    if (cur === maybeAncestor) return true;
    cur = nodes[cur]?.parentId ?? null;
  }
  return false;
}

/** Drop connections touching removed nodes and remove them from sections. */
function pruneRefs(doc: MindMapDoc, removed: Set<string>) {
  if (doc.connections) {
    doc.connections = doc.connections.filter((c) => !removed.has(c.from) && !removed.has(c.to));
  }
  if (doc.sections) {
    doc.sections = doc.sections
      .map((s) => ({ ...s, nodeIds: s.nodeIds.filter((id) => !removed.has(id)) }))
      .filter((s) => s.nodeIds.length > 0);
  }
}

/** Detach a node from its parent's children list or from the root list. */
function detach(doc: MindMapDoc, id: string) {
  const node = doc.nodes[id];
  if (node.parentId) {
    const parent = doc.nodes[node.parentId];
    parent.children = parent.children.filter((c) => c !== id);
  } else {
    doc.rootIds = doc.rootIds.filter((r) => r !== id);
  }
}

export type MapStore = StoreApi<MapState>;

/** Each open document/tab owns its own isolated store instance. */
export function createMapStore(): MapStore {
  return createStore<MapState>((set, get) => {
  /** Apply a mutation to a cloned doc, recording history. */
  const commit = (mutate: (draft: MindMapDoc) => void, keepSelection = true) => {
    const { doc, past } = get();
    const snapshot = structuredClone(doc);
    const draft = structuredClone(doc);
    mutate(draft);
    set({
      doc: draft,
      past: [...past.slice(-HISTORY_LIMIT + 1), snapshot],
      future: [],
      dirty: true,
      ...(keepSelection ? {} : {}),
    });
  };

  return {
    doc: emptyDoc(),
    selectedId: null,
    selectedIds: [],
    editingId: null,
    filePath: null,
    dirty: false,
    past: [],
    future: [],
    editCommittedAt: 0,
    docEpoch: 0,
    focusRootId: null,
    colorFilter: null,
    filterAncestors: false,
    filterDescendants: false,

    setFocus: (id) => set((s) => ({ focusRootId: id, docEpoch: s.docEpoch + 1 })),
    setColorFilter: (color) => set((s) => ({ colorFilter: color, docEpoch: s.docEpoch + 1 })),
    toggleFilterAncestors: () =>
      set((s) => ({ filterAncestors: !s.filterAncestors, docEpoch: s.docEpoch + 1 })),
    toggleFilterDescendants: () =>
      set((s) => ({ filterDescendants: !s.filterDescendants, docEpoch: s.docEpoch + 1 })),

    loadDoc: (doc, filePath) =>
      set((s) => ({
        doc,
        filePath,
        dirty: false,
        past: [],
        future: [],
        selectedId: doc.rootIds[0] ?? null,
        selectedIds: doc.rootIds[0] ? [doc.rootIds[0]] : [],
        editingId: null,
        focusRootId: null,
        colorFilter: null,
        docEpoch: s.docEpoch + 1,
      })),

    newDoc: () => {
      const doc = emptyDoc();
      set((s) => ({
        doc,
        filePath: null,
        dirty: false,
        past: [],
        future: [],
        selectedId: doc.rootIds[0] ?? null,
        selectedIds: doc.rootIds[0] ? [doc.rootIds[0]] : [],
        editingId: null,
        focusRootId: null,
        colorFilter: null,
        docEpoch: s.docEpoch + 1,
      }));
    },

    markSaved: (filePath) => set({ filePath, dirty: false }),
    setFilePath: (filePath) => set({ filePath }),

    select: (id) => set({ selectedId: id, selectedIds: id ? [id] : [], editingId: null }),
    toggleSelect: (id) => {
      const cur = get().selectedIds;
      const has = cur.includes(id);
      const next = has ? cur.filter((x) => x !== id) : [...cur, id];
      set({ selectedIds: next, selectedId: has ? next[next.length - 1] ?? null : id, editingId: null });
    },
    startEdit: (id) => set({ selectedId: id, selectedIds: [id], editingId: id }),
    cancelEdit: () => set({ editingId: null }),

    commitEdit: (text) => {
      const { editingId } = get();
      if (!editingId) return;
      get().commitText(editingId, text);
    },

    // commit text for a specific node — independent of editingId, so a click on the
    // canvas background (which clears editingId) can't drop the in-progress text.
    commitText: (id, text) => {
      commit((d) => {
        const n = d.nodes[id];
        if (n) {
          // trim so a whitespace-only commit equals an empty one (undeletable
          // nodes, e.g. a sole root, would otherwise keep an invisible " " title)
          n.text = text.trim();
          n.updatedAt = Date.now(); // mark for reminder push
        }
      });
      set({ editingId: null, editCommittedAt: Date.now() });
    },

    addRoot: () => {
      const id = newId();
      commit((d) => {
        d.nodes[id] = { id, text: '', parentId: null, children: [], collapsed: false };
        d.rootIds.push(id);
      });
      set({ selectedId: id, selectedIds: [id], editingId: id });
    },

    addRootAt: (x, y) => {
      const id = newId();
      commit((d) => {
        d.nodes[id] = {
          id,
          text: '',
          parentId: null,
          children: [],
          collapsed: false,
          manualPos: { x, y },
        };
        d.rootIds.push(id);
      });
      set({ selectedId: id, selectedIds: [id], editingId: id });
    },

    duplicateNode: (id) => {
      const src = get().doc.nodes[id];
      if (!src) return;
      let topId: string | null = null;
      commit((d) => {
        const clone = (nid: string, parentId: string | null): string => {
          const o = d.nodes[nid];
          const cid = newId();
          d.nodes[cid] = { ...structuredClone(o), id: cid, parentId, children: [] };
          // A clone must not inherit the original's reminder identity, or both nodes
          // would map to one reminder. If still reminder-enabled, sync creates a new one.
          delete d.nodes[cid].reminderId;
          delete d.nodes[cid].reminderSyncedAt;
          d.nodes[cid].children = o.children.map((c) => clone(c, cid));
          return cid;
        };
        const top = clone(id, src.parentId);
        topId = top;
        if (src.parentId) {
          const p = d.nodes[src.parentId];
          p.children.splice(p.children.indexOf(id) + 1, 0, top);
        } else {
          d.rootIds.splice(d.rootIds.indexOf(id) + 1, 0, top);
          const mp = d.nodes[top].manualPos;
          if (mp) d.nodes[top].manualPos = { x: mp.x + 40, y: mp.y + 40 };
        }
      });
      if (topId) set({ selectedId: topId, selectedIds: [topId] });
    },

    addChild: (parentId) => {
      const id = newId();
      commit((d) => {
        const parent = d.nodes[parentId];
        if (!parent) return;
        parent.collapsed = false;
        d.nodes[id] = { id, text: '', parentId, children: [], collapsed: false };
        // a child of a scheduled node is scheduled too
        if (parent.scheduled) d.nodes[id].scheduled = true;
        parent.children.push(id);
      });
      set({ selectedId: id, selectedIds: [id], editingId: id });
    },

    addSibling: (refId) => {
      const ref = get().doc.nodes[refId];
      if (!ref) return;
      const id = newId();
      commit((d) => {
        const node = d.nodes[refId];
        if (node.parentId) {
          const parent = d.nodes[node.parentId];
          const idx = parent.children.indexOf(refId);
          d.nodes[id] = { id, text: '', parentId: node.parentId, children: [], collapsed: false };
          // inherit the scheduled state of the surrounding level
          if (parent.scheduled || node.scheduled) d.nodes[id].scheduled = true;
          parent.children.splice(idx + 1, 0, id);
        } else {
          // sibling of a root is a new root
          d.nodes[id] = { id, text: '', parentId: null, children: [], collapsed: false };
          if (node.scheduled) d.nodes[id].scheduled = true;
          d.rootIds.splice(d.rootIds.indexOf(refId) + 1, 0, id);
        }
      });
      set({ selectedId: id, selectedIds: [id], editingId: id });
    },

    deleteNode: (id) => {
      const { doc } = get();
      const node = doc.nodes[id];
      if (!node) return;
      // pick what to select after deletion
      let nextSel: string | null = node.parentId;
      if (node.parentId) {
        const sibs = doc.nodes[node.parentId].children;
        const idx = sibs.indexOf(id);
        nextSel = sibs[idx + 1] ?? sibs[idx - 1] ?? node.parentId;
      } else {
        const idx = doc.rootIds.indexOf(id);
        nextSel = doc.rootIds[idx + 1] ?? doc.rootIds[idx - 1] ?? null;
      }
      commit((d) => {
        // collect subtree ids
        const toRemove: string[] = [];
        const reminders: string[] = [];
        const collect = (nid: string) => {
          toRemove.push(nid);
          if (d.nodes[nid].reminderId) reminders.push(d.nodes[nid].reminderId!);
          d.nodes[nid].children.forEach(collect);
        };
        collect(id);
        detach(d, id);
        toRemove.forEach((nid) => delete d.nodes[nid]);
        pruneRefs(d, new Set(toRemove));
        if (reminders.length && reminderDeleteHook) reminderDeleteHook(reminders);
      });
      set({ selectedId: nextSel, selectedIds: nextSel ? [nextSel] : [], editingId: null });
    },

    setColor: (id, color) =>
      commit((d) => {
        if (d.nodes[id]) d.nodes[id].color = color;
      }),

    setNote: (id, note) =>
      commit((d) => {
        if (d.nodes[id]) d.nodes[id].note = note || undefined;
      }),

    setLink: (id, link) =>
      commit((d) => {
        if (d.nodes[id]) d.nodes[id].link = link || undefined;
      }),

    addNodeLink: (id, url) =>
      commit((d) => {
        const n = d.nodes[id];
        const u = url.trim();
        if (!n || !u) return;
        const list = n.links ?? [];
        if (u !== n.link && !list.includes(u)) n.links = [...list, u];
      }),

    removeNodeLink: (id, url) =>
      commit((d) => {
        const n = d.nodes[id];
        if (!n) return;
        if (n.link === url) n.link = undefined;
        if (n.links) n.links = n.links.filter((u) => u !== url);
      }),

    setIcon: (id, icon) =>
      commit((d) => {
        if (d.nodes[id]) d.nodes[id].icon = icon || undefined;
      }),

    toggleDone: (id) =>
      commit((d) => {
        const n = d.nodes[id];
        if (n) {
          n.done = !n.done;
          n.updatedAt = Date.now(); // mark for reminder push
        }
      }),

    setScheduled: (id, on) =>
      commit((d) => {
        const removedReminders: string[] = [];
        const visit = (nid: string) => {
          const n = d.nodes[nid];
          if (!n) return;
          n.scheduled = on || undefined;
          if (!on) {
            // un-scheduling also clears the date and detaches any reminder
            n.scheduleAt = undefined;
            if (n.reminderId) removedReminders.push(n.reminderId);
            n.reminderOn = undefined;
            n.reminderId = undefined;
            n.reminderSyncedAt = undefined;
          }
          n.children.forEach(visit);
        };
        visit(id);
        if (removedReminders.length && reminderDeleteHook) reminderDeleteHook(removedReminders);
      }),

    setScheduleAt: (id, iso) =>
      commit((d) => {
        const n = d.nodes[id];
        if (!n) return;
        n.scheduleAt = iso;
        if (iso) n.scheduled = true;
        n.updatedAt = Date.now(); // mark for reminder push
      }),

    setReminderOn: (id, on) =>
      commit((d) => {
        const n = d.nodes[id];
        if (!n) return;
        if (on) {
          n.reminderOn = true;
          n.scheduled = true;
        } else {
          n.reminderOn = undefined;
          if (n.reminderId && reminderDeleteHook) reminderDeleteHook([n.reminderId]);
          n.reminderId = undefined;
          n.reminderSyncedAt = undefined;
        }
        n.updatedAt = Date.now();
      }),

    applyReminderPatch: (id, fields) => {
      // Non-history update used by the sync engine. Only mark dirty when a persisted,
      // user-meaningful field actually changes — pure bookkeeping (reminderSyncedAt/
      // updatedAt) must not trigger autosave churn on every poll.
      const { doc } = get();
      const n = doc.nodes[id];
      if (!n) return;
      const persistKeys = [
        'text',
        'done',
        'scheduleAt',
        'reminderId',
        'reminderOn',
        'reminderBase',
      ] as const;
      const dirtied = persistKeys.some(
        (k) => k in fields && (fields as Record<string, unknown>)[k] !== n[k],
      );
      set({
        doc: { ...doc, nodes: { ...doc.nodes, [id]: { ...n, ...fields } } },
        ...(dirtied ? { dirty: true } : {}),
      });
    },

    moveSibling: (id, dir) => {
      const { doc } = get();
      const node = doc.nodes[id];
      if (!node) return;
      const list = node.parentId ? doc.nodes[node.parentId].children : doc.rootIds;
      const idx = list.indexOf(id);
      const swap = dir === 'up' ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= list.length) return;
      commit((d) => {
        const l = node.parentId ? d.nodes[node.parentId].children : d.rootIds;
        [l[idx], l[swap]] = [l[swap], l[idx]];
      });
    },

    copyNode: (id) => {
      const { doc } = get();
      const build = (nid: string): ClipNode | null => {
        const n = doc.nodes[nid];
        if (!n) return null;
        return {
          text: n.text,
          done: n.done,
          color: n.color,
          icon: n.icon,
          note: n.note,
          link: n.link,
          children: n.children.map(build).filter((c): c is ClipNode => c !== null),
        };
      };
      clipboard = build(id);
    },

    pasteNode: (targetId) => {
      if (!clipboard) return;
      let pastedId: string | null = null;
      commit((d) => {
        const add = (clip: ClipNode, parentId: string | null): string => {
          const id = newId();
          d.nodes[id] = {
            id,
            text: clip.text,
            parentId,
            children: [],
            collapsed: false,
            done: clip.done,
            color: clip.color,
            icon: clip.icon,
            note: clip.note,
            link: clip.link,
          };
          d.nodes[id].children = clip.children.map((c) => add(c, id));
          return id;
        };
        // paste as a child of the target, or as a new root when nothing is selected
        const rootOfPaste = add(clipboard!, targetId);
        pastedId = rootOfPaste;
        if (targetId) {
          const parent = d.nodes[targetId];
          parent.collapsed = false;
          parent.children.push(rootOfPaste);
        } else {
          d.rootIds.push(rootOfPaste);
        }
      });
      if (pastedId) set({ selectedId: pastedId, selectedIds: [pastedId] });
    },

    hasClipboard: () => clipboard !== null,

    reparent: (nodeId, newParentId, index) => {
      const { doc } = get();
      if (nodeId === newParentId) return;
      // can't move a node under its own descendant
      if (newParentId && isAncestor(doc.nodes, nodeId, newParentId)) return;
      commit((d) => {
        const node = d.nodes[nodeId];
        if (!node) return;
        detach(d, nodeId);
        if (newParentId) {
          const parent = d.nodes[newParentId];
          parent.collapsed = false;
          node.parentId = newParentId;
          const at = index ?? parent.children.length;
          parent.children.splice(at, 0, nodeId);
        } else {
          node.parentId = null;
          const at = index ?? d.rootIds.length;
          d.rootIds.splice(at, 0, nodeId);
        }
      });
      set({ selectedId: nodeId, selectedIds: [nodeId] });
    },

    reparentMany: (ids, newParentId) => {
      const { doc } = get();
      // drop invalid moves (onto self or a descendant of the moved node)
      const valid = ids.filter(
        (id) => id !== newParentId && !(newParentId && isAncestor(doc.nodes, id, newParentId)),
      );
      // keep only the top-most of any nested selection (don't move a node and its ancestor both)
      const sel = new Set(valid);
      const topLevel = valid.filter((id) => {
        let p = doc.nodes[id]?.parentId ?? null;
        while (p) {
          if (sel.has(p)) return false;
          p = doc.nodes[p]?.parentId ?? null;
        }
        return true;
      });
      if (!topLevel.length) return;
      commit((d) => {
        topLevel.forEach((id) => {
          const node = d.nodes[id];
          if (!node) return;
          detach(d, id);
          if (newParentId) {
            const parent = d.nodes[newParentId];
            parent.collapsed = false;
            node.parentId = newParentId;
            parent.children.push(id);
          } else {
            node.parentId = null;
            d.rootIds.push(id);
          }
        });
      });
      set({ selectedIds: topLevel, selectedId: topLevel[topLevel.length - 1] });
    },

    deleteSelected: () => {
      const sel = get().selectedIds.length
        ? get().selectedIds
        : get().selectedId
          ? [get().selectedId as string]
          : [];
      if (!sel.length) return;
      commit((d) => {
        const remove = new Set<string>();
        const collect = (nid: string) => {
          if (!d.nodes[nid] || remove.has(nid)) return;
          remove.add(nid);
          d.nodes[nid].children.forEach(collect);
        };
        sel.forEach(collect);
        const reminders: string[] = [];
        remove.forEach((id) => {
          const n = d.nodes[id];
          if (!n) return;
          if (n.reminderId) reminders.push(n.reminderId);
          if (n.parentId) {
            if (!remove.has(n.parentId)) {
              const p = d.nodes[n.parentId];
              p.children = p.children.filter((c) => c !== id);
            }
          } else {
            d.rootIds = d.rootIds.filter((r) => r !== id);
          }
        });
        remove.forEach((id) => delete d.nodes[id]);
        pruneRefs(d, remove);
        if (reminders.length && reminderDeleteHook) reminderDeleteHook(reminders);
      });
      set({ selectedId: null, selectedIds: [], editingId: null });
    },

    setManualPos: (rootId, pos) =>
      commit((d) => {
        const n = d.nodes[rootId];
        if (n) n.manualPos = pos;
      }),

    toggleCollapse: (id) =>
      commit((d) => {
        const n = d.nodes[id];
        if (n && n.children.length > 0) n.collapsed = !n.collapsed;
      }),

    // ── connections ──
    addConnection: (from, to) => {
      if (from === to) return;
      commit((d) => {
        d.connections ??= [];
        const exists = d.connections.some(
          (c) => (c.from === from && c.to === to) || (c.from === to && c.to === from),
        );
        if (!exists) d.connections.push({ id: newId(), from, to });
      });
    },
    removeConnection: (id) =>
      commit((d) => {
        d.connections = (d.connections ?? []).filter((c) => c.id !== id);
      }),
    setConnectionNote: (id, note) =>
      commit((d) => {
        const c = (d.connections ?? []).find((x) => x.id === id);
        if (c) c.note = note;
      }),
    setConnectionLabelPos: (id, pos) =>
      commit((d) => {
        const c = (d.connections ?? []).find((x) => x.id === id);
        if (c) c.labelPos = pos;
      }),

    // ── sections ──
    addSection: (nodeIds) => {
      if (nodeIds.length === 0) return;
      commit((d) => {
        d.sections ??= [];
        d.sections.push({ id: newId(), nodeIds: [...nodeIds], title: '섹션' });
      });
    },
    removeSection: (id) =>
      commit((d) => {
        d.sections = (d.sections ?? []).filter((s) => s.id !== id);
      }),
    setSectionTitle: (id, title) =>
      commit((d) => {
        const s = (d.sections ?? []).find((x) => x.id === id);
        if (s) s.title = title;
      }),
    setSectionColor: (id, color) =>
      commit((d) => {
        const s = (d.sections ?? []).find((x) => x.id === id);
        if (s) s.color = color;
      }),
    setSectionLabelPos: (id, pos) =>
      commit((d) => {
        const s = (d.sections ?? []).find((x) => x.id === id);
        if (s) s.labelPos = pos;
      }),

    navigate: (dir) => {
      const { doc, selectedId } = get();
      if (!selectedId) {
        set({ selectedId: doc.rootIds[0] ?? null });
        return;
      }
      const node = doc.nodes[selectedId];
      if (!node) return;

      const siblings = node.parentId ? doc.nodes[node.parentId].children : doc.rootIds;
      const idx = siblings.indexOf(selectedId);

      let target: string | null = null;
      switch (dir) {
        case 'right':
          if (!node.collapsed && node.children.length) target = node.children[0];
          break;
        case 'left':
          target = node.parentId;
          break;
        case 'up':
          target = siblings[idx - 1] ?? null;
          break;
        case 'down':
          target = siblings[idx + 1] ?? null;
          break;
      }
      if (target) set({ selectedId: target, selectedIds: [target], editingId: null });
    },

    undo: () => {
      const { past, future, doc, selectedId, selectedIds } = get();
      if (past.length === 0) return;
      const prev = past[past.length - 1];
      const sid = prev.nodes[selectedId ?? ''] ? selectedId : prev.rootIds[0] ?? null;
      const sids = selectedIds.filter((i) => prev.nodes[i]);
      set({
        doc: prev,
        past: past.slice(0, -1),
        future: [doc, ...future].slice(0, HISTORY_LIMIT),
        dirty: true,
        editingId: null,
        selectedId: sid,
        selectedIds: sids.length ? sids : sid ? [sid] : [],
      });
    },

    redo: () => {
      const { past, future, doc, selectedId, selectedIds } = get();
      if (future.length === 0) return;
      const next = future[0];
      const sid = next.nodes[selectedId ?? ''] ? selectedId : next.rootIds[0] ?? null;
      const sids = selectedIds.filter((i) => next.nodes[i]);
      set({
        doc: next,
        past: [...past, doc].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        dirty: true,
        editingId: null,
        selectedId: sid,
        selectedIds: sids.length ? sids : sid ? [sid] : [],
      });
    },

    setView: (view) =>
      set((s) => ({
        doc: { ...s.doc, view: { ...s.doc.view, ...view } },
        dirty: true,
      })),
  };
  });
}

// ── React context: components read the store of the pane they're rendered in ──

export const MapContext = createContext<MapStore | null>(null);

export function useMapStore(): MapStore {
  const store = useContext(MapContext);
  if (!store) throw new Error('useMapStore must be used within a MapContext.Provider');
  return store;
}

export function useMap<T>(selector: (s: MapState) => T): T {
  return useStore(useMapStore(), selector);
}
