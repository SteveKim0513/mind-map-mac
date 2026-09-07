import { create } from 'zustand';
import type { TreeNode } from '../../electron/preload';
import type { NoteMeta, FocusSession, BoardMeta } from '../types';
import { parseNote } from '../io/noteFormat';
import { parseBoard } from '../io/boardFormat';
import { extractWikiTargets } from '../note/wikiLinkText';
import { useSession } from './sessionStore';
import { useUi } from './uiStore';
import type { BoardStore } from './boardStore';

interface WorkspaceState {
  root: string;
  tree: TreeNode[];
  expanded: Record<string, boolean>; // folder path → open?
  noteIndex: NoteMeta[]; // every note's frontmatter, for resolving links
  boardIndex: BoardMeta[]; // every board's sticky node/note links, for reverse ("referenced from a board") lookups

  refresh: () => Promise<void>;
  choose: () => Promise<void>;
  toggle: (path: string) => void;
  setExpanded: (path: string, open: boolean) => void;
  /** Expand every ancestor folder of `path` (and `path` itself, if it's a folder)
   *  so the sidebar tree can scroll it into view — used by the path bar's
   *  "reveal in sidebar" click (App.tsx `revealPathReq`). */
  expandAncestors: (path: string) => void;

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

  // board reverse-link index (see types.ts's BoardMeta)
  boardsForNode: (mapId: string, nodeId: string) => BoardMeta[];
  boardsForNote: (notePath: string) => BoardMeta[];
  reindexBoard: (meta: BoardMeta) => void; // upsert one board (after save)
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

function collectBoardPaths(tree: TreeNode[], out: string[] = []): string[] {
  for (const n of tree) {
    if (n.type === 'dir' && n.children) collectBoardPaths(n.children, out);
    else if (n.type === 'file' && n.path.endsWith('.board')) out.push(n.path);
  }
  return out;
}

async function buildBoardIndex(tree: TreeNode[]): Promise<BoardMeta[]> {
  const paths = collectBoardPaths(tree);
  const metas = await Promise.all(
    paths.map(async (path): Promise<BoardMeta | null> => {
      try {
        const content = await window.api.readFile(path);
        const board = parseBoard(content);
        const nodeLinks: BoardMeta['nodeLinks'] = [];
        const noteLinks: BoardMeta['noteLinks'] = [];
        for (const el of Object.values(board.elements)) {
          if (el.kind !== 'sticky') continue;
          if (el.nodeLink) nodeLinks.push({ stickyId: el.id, link: el.nodeLink });
          if (el.noteLink) noteLinks.push({ stickyId: el.id, notePath: el.noteLink.notePath });
        }
        return { path, nodeLinks, noteLinks };
      } catch {
        return null;
      }
    }),
  );
  return metas.filter((m): m is BoardMeta => m !== null);
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
  boardIndex: [],

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
    // scan note frontmatter / board links in the background; the tree shows immediately
    const [noteIndex, boardIndex] = await Promise.all([buildNoteIndex(tree), buildBoardIndex(tree)]);
    set({ noteIndex, boardIndex });
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
  expandAncestors: (path) =>
    set((s) => {
      if (!s.root || !path.startsWith(`${s.root}/`)) return {};
      const rel = path.slice(s.root.length + 1);
      const parts = rel.split('/');
      const next = { ...s.expanded };
      let cur = s.root;
      for (const part of parts) {
        cur = `${cur}/${part}`;
        if (cur !== path || (!path.endsWith('.md') && !path.endsWith('.mind') && !path.endsWith('.board')))
          next[cur] = true;
      }
      return { expanded: next };
    }),

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

  boardsForNode: (mapId, nodeId) =>
    get().boardIndex.filter((m) => m.nodeLinks.some((l) => l.link.mapId === mapId && l.link.nodeId === nodeId)),
  boardsForNote: (notePath) => get().boardIndex.filter((m) => m.noteLinks.some((l) => l.notePath === notePath)),
  reindexBoard: (meta) =>
    set((s) => {
      const rest = s.boardIndex.filter((m) => m.path !== meta.path);
      return { boardIndex: [...rest, meta] };
    }),
}));

/** Open a board (by path) and select + pan to a specific sticky. Lives here
 *  (not board/boardLinks.ts) — it only touches store/ state (useSession,
 *  useUi, window.api, BoardStore) — so canvas/NodeView.tsx and
 *  note/NotePane.tsx can call it too, for the "referenced from a board"
 *  backlink chip, without importing board/ directly (canvas/note/board are
 *  domain-boundary siblings — cross-imports between them are forbidden, but
 *  all three may depend on store/). board/boardLinks.ts re-exports this for
 *  its own existing caller (search/GlobalSearch.tsx). */
export async function openBoardSticky(boardPath: string, stickyId: string): Promise<void> {
  const sess = useSession.getState();
  const open = sess.tabs.find((t) => t.kind === 'board' && t.path === boardPath);
  if (open) {
    sess.openPath(boardPath, '');
  } else {
    try {
      const content = await window.api.readFile(boardPath);
      sess.openPath(boardPath, content);
    } catch {
      useUi.getState().toast('연결된 보드를 찾을 수 없습니다 — 이동되었거나 삭제된 것 같아요');
      return;
    }
  }
  const tab = useSession.getState().tabs.find((t) => t.kind === 'board' && t.path === boardPath);
  if (!tab) return;
  (tab.store as BoardStore).getState().setSelection([stickyId]);
  setTimeout(() => useUi.getState().focusNode(stickyId), 0);
}
