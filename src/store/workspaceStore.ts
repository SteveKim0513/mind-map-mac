import { create } from 'zustand';
import type { TreeNode } from '../../electron/preload';

interface WorkspaceState {
  root: string;
  tree: TreeNode[];
  expanded: Record<string, boolean>; // folder path → open?
  refresh: () => Promise<void>;
  choose: () => Promise<void>;
  toggle: (path: string) => void;
  setExpanded: (path: string, open: boolean) => void;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  root: '',
  tree: [],
  expanded: {},

  refresh: async () => {
    const { root, tree } = await window.api.workspaceTree();
    set({ root, tree });
  },

  choose: async () => {
    const next = await window.api.workspaceChoose();
    if (next) {
      set({ expanded: {} });
      await get().refresh();
    }
  },

  toggle: (path) => set((s) => ({ expanded: { ...s.expanded, [path]: !s.expanded[path] } })),
  setExpanded: (path, open) => set((s) => ({ expanded: { ...s.expanded, [path]: open } })),
}));
