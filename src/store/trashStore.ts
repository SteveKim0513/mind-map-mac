import { create } from 'zustand';
import type { TrashItem } from '../../electron/preload';

interface TrashState {
  items: TrashItem[];
  refresh: () => Promise<void>;
}

/** Workspace trash (.trash folder). The sidebar badge + Trash panel read from here. */
export const useTrash = create<TrashState>((set) => ({
  items: [],
  refresh: async () => {
    try {
      set({ items: await window.api.trashList() });
    } catch {
      set({ items: [] });
    }
  },
}));
