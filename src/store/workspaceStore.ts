import { create } from 'zustand';
import type { TreeNode } from '../../electron/preload';
import type { NoteMeta, FocusSession } from '../types';
import { parseNote } from '../io/noteFormat';
import { extractWikiTargets } from '../note/wikiLinkText';
import { useSession } from './sessionStore';

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
  /** resolve a `[[wiki link]]` by note title (case-insensitive); excludes session
   *  notes so a work-log can't shadow a real note. Undefined ⇒ unresolved link. */
  noteByTitle: (title: string) => NoteMeta | undefined;
  /** notes that wiki-link TO `title` (backlinks). `selfPath` excludes the note
   *  itself; session notes are excluded as link sources. */
  backlinks: (title: string, selfPath?: string) => NoteMeta[];
  sessions: () => import('../types').FocusSession[]; // every indexed focus session
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
  // dedup paths — a note that's both in the tree AND returned as attached must be
  // indexed once, else its session counts twice / shows a duplicate node chip.
  const paths = [...new Set([...collectMdPaths(tree), ...attached])];
  const metas = await Promise.all(
    paths.map(async (path): Promise<NoteMeta | null> => {
      try {
        const content = await window.api.readFile(path);
        const n = parseNote(content, nameOf(path));
        return { path, id: n.id, title: n.title, links: n.links, session: n.session, refs: extractWikiTargets(n.body) };
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
    // one-time surface: older builds stashed node-created notes in a hidden
    // .notes/ folder (invisible in the sidebar). Node notes now live in the map's
    // folder, so move any legacy ones out to the workspace root → they show up.
    const legacy = await window.api.attachedNotes().catch(() => [] as string[]);
    if (legacy.length) {
      const { root: r } = await window.api.workspaceTree();
      for (const p of legacy) { try { await window.api.move(p, r); } catch { /* leave it; still indexed */ } }
    }
    const { root, tree } = await window.api.workspaceTree();
    set({ root, tree });
    // scan note frontmatter in the background; the tree shows immediately
    const noteIndex = await buildNoteIndex(tree);
    set({ noteIndex });
  },

  choose: async () => {
    const next = await window.api.workspaceChoose();
    if (!next) return; // picker cancelled
    if (next !== get().root) {
      // Actual switch: every open tab belongs to the OLD workspace. Flush their
      // pending autosaves and close them, which also resets (and persists) an
      // empty session snapshot — otherwise old-workspace files keep autosaving in
      // the background and reopen on next launch even though we switched away.
      // (Re-picking the same folder skips this so open tabs are left untouched.)
      await useSession.getState().closeAllTabs();
    }
    set({ expanded: {} });
    await get().refresh();
  },

  toggle: (path) => set((s) => ({ expanded: { ...s.expanded, [path]: !s.expanded[path] } })),
  setExpanded: (path, open) => set((s) => ({ expanded: { ...s.expanded, [path]: open } })),

  notesForNode: (mapId, nodeId) =>
    get().noteIndex.filter((m) => m.links.some((l) => l.mapId === mapId && l.nodeId === nodeId)),
  noteByPath: (path) => get().noteIndex.find((m) => m.path === path),
  noteByTitle: (title) => {
    const t = title.trim().toLowerCase();
    return get().noteIndex.find((m) => !m.session && m.title.trim().toLowerCase() === t);
  },
  backlinks: (title, selfPath) => {
    const t = title.trim().toLowerCase();
    if (!t) return [];
    return get().noteIndex.filter(
      (m) => m.path !== selfPath && !m.session && (m.refs ?? []).includes(t),
    );
  },
  // Dedup by sessionId (the promised "dedup key", types.ts) — a copied or
  // double-indexed session note must not double-count in history/rollups. When two
  // copies share an id, the ENDED one wins so a completed session is always counted.
  sessions: () => {
    const bySid = new Map<string, FocusSession>();
    const anon: FocusSession[] = [];
    for (const m of get().noteIndex) {
      const s = m.session;
      if (!s) continue;
      if (!s.sessionId) {
        anon.push(s);
        continue;
      }
      const prev = bySid.get(s.sessionId);
      if (!prev || (prev.end == null && s.end != null)) bySid.set(s.sessionId, s);
    }
    return [...bySid.values(), ...anon];
  },
  reindexNote: (meta) =>
    set((s) => {
      const rest = s.noteIndex.filter((m) => m.path !== meta.path);
      return { noteIndex: [...rest, meta] };
    }),
}));
