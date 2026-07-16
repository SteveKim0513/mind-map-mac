import { createContext, useContext } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import type { FocusSession, NoteDoc, NoteLink, NoteMetaBlock } from '../types';
import { emptyNote } from '../io/noteFormat';

interface NoteState {
  note: NoteDoc;
  filePath: string | null;
  dirty: boolean;

  loadNote: (note: NoteDoc, filePath: string | null) => void;
  markSaved: (filePath: string) => void;
  setFilePath: (filePath: string) => void;

  setTitle: (title: string) => void;
  setBody: (body: string) => void;
  applySession: (session: FocusSession) => void; // system write (focus end) — never user-editable
  addLink: (link: NoteLink) => void;
  removeLink: (mapId: string, nodeId: string) => void;
  updateLinkText: (mapId: string, nodeId: string, nodeText: string) => void;
  setMetaBlocks: (blocks: NoteMetaBlock[]) => void;
}

export type NoteStore = StoreApi<NoteState>;

export function createNoteStore(): NoteStore {
  return createStore<NoteState>((set, get) => ({
    note: emptyNote(),
    filePath: null,
    dirty: false,

    loadNote: (note, filePath) => set({ note, filePath, dirty: false }),
    markSaved: (filePath) => set({ filePath, dirty: false }),
    setFilePath: (filePath) => set({ filePath }),

    // Strip C0 control characters (incl. a literal backspace, which a paste can
    // insert as real text rather than deleting anything) — an unfiltered one
    // flows straight into the file name via note-title-filename-sync and
    // produces an invisible, hard-to-select prefix on the actual file.
    setTitle: (title) => set({ note: { ...get().note, title: title.replace(/[\x00-\x1f\x7f]/g, '') }, dirty: true }),
    setBody: (body) => set({ note: { ...get().note, body }, dirty: true }),
    // keep an open session note's meta in sync after the app stamps end — does
    // NOT set dirty (disk already written), so a later autosave keeps the new end.
    applySession: (session) => set({ note: { ...get().note, session } }),

    addLink: (link) => {
      const { note } = get();
      if (note.links.some((l) => l.mapId === link.mapId && l.nodeId === link.nodeId)) return;
      set({ note: { ...note, links: [...note.links, link] }, dirty: true });
    },
    removeLink: (mapId, nodeId) => {
      const { note } = get();
      set({
        note: { ...note, links: note.links.filter((l) => !(l.mapId === mapId && l.nodeId === nodeId)) },
        dirty: true,
      });
    },
    // IF-05 · refresh the cached chip label after the linked node's text changed.
    updateLinkText: (mapId, nodeId, nodeText) => {
      const { note } = get();
      let changed = false;
      const links = note.links.map((l) => {
        if (l.mapId === mapId && l.nodeId === nodeId && l.nodeText !== nodeText) {
          changed = true;
          return { ...l, nodeText };
        }
        return l;
      });
      if (changed) set({ note: { ...note, links }, dirty: true });
    },
    setMetaBlocks: (metaBlocks) =>
      set({ note: { ...get().note, metaBlocks }, dirty: true }),
  }));
}

// ── React context: components read the note store of the pane they render in ──
export const NoteContext = createContext<NoteStore | null>(null);

export function useNoteStore(): NoteStore {
  const store = useContext(NoteContext);
  if (!store) throw new Error('useNoteStore must be used within a NoteContext.Provider');
  return store;
}

export function useNote<T>(selector: (s: NoteState) => T): T {
  return useStore(useNoteStore(), selector);
}
