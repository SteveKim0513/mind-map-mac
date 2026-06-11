import { create } from 'zustand';
import type { TreeNode } from '../../electron/preload';
import type { NoteMeta } from '../types';
import { parseNote } from '../io/noteFormat';

interface WorkspaceState {
  root: string;
  tree: TreeNode[];
  expanded: Record<string, boolean>; // folder path → open?
  noteIndex: NoteMeta[]; // every note's frontmatter, for resolving links

  refresh: () => Promise<void>;
  choose: () => Promise<void>;
  toggle: (path: string) => void;
  setExpanded: (path: string, open: boolean) => void;

  // link-index queries / updates
  notesForNode: (mapId: string, nodeId: string) => NoteMeta[];
  noteByPath: (path: string) => NoteMeta | undefined;
  reindexNote: (meta: NoteMeta) => void; // upsert one note (after save/link change)
}

function collectMdPaths(tree: TreeNode[], out: string[] = []): string[] {
  for (const n of tree) {
    if (n.type === 'dir' && n.children) collectMdPaths(n.children, out);
    else if (n.type === 'file' && n.path.endsWith('.md')) out.push(n.path);
  }
  return out;
}

function nameOf(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/, '');
}

async function buildNoteIndex(tree: TreeNode[]): Promise<NoteMeta[]> {
  // visible notes (in the tree) + hidden attached notes (.notes/) — both indexed
  const attached = await window.api.attachedNotes().catch(() => [] as string[]);
  const paths = [...collectMdPaths(tree), ...attached];
  const metas = await Promise.all(
    paths.map(async (path): Promise<NoteMeta | null> => {
      try {
        const content = await window.api.readFile(path);
        const n = parseNote(content, nameOf(path));
        return { path, id: n.id, title: n.title, links: n.links };
      } catch {
        return null;
      }
    }),
  );
  return metas.filter((m): m is NoteMeta => m !== null);
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  root: '',
  tree: [],
  expanded: {},
  noteIndex: [],

  refresh: async () => {
    const { root, tree } = await window.api.workspaceTree();
    set({ root, tree });
    // scan note frontmatter in the background; the tree shows immediately
    const noteIndex = await buildNoteIndex(tree);
    set({ noteIndex });
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

  notesForNode: (mapId, nodeId) =>
    get().noteIndex.filter((m) => m.links.some((l) => l.mapId === mapId && l.nodeId === nodeId)),
  noteByPath: (path) => get().noteIndex.find((m) => m.path === path),
  reindexNote: (meta) =>
    set((s) => {
      const rest = s.noteIndex.filter((m) => m.path !== meta.path);
      return { noteIndex: [...rest, meta] };
    }),
}));
