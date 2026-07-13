import { create } from 'zustand';

interface PinState {
  paths: string[];
  refresh: () => Promise<void>;
  toggle: (path: string) => Promise<void>;
}

/** Favorites (즐겨찾기) — pinned file paths, backed by <workspace>/.pins.json. */
export const usePins = create<PinState>((set) => ({
  paths: [],
  refresh: async () => {
    try {
      set({ paths: await window.api.pins.list() });
    } catch {
      set({ paths: [] });
    }
  },
  toggle: async (path) => {
    const next = await window.api.pins.toggle(path);
    set({ paths: next });
  },
}));
