import { createContext, useContext } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import type { NoteDoc, NoteLink } from '../types';
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
  addLink: (link: NoteLink) => void;
  removeLink: (mapId: string, nodeId: string) => void;
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

    setTitle: (title) => set({ note: { ...get().note, title }, dirty: true }),
    setBody: (body) => set({ note: { ...get().note, body }, dirty: true }),

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
