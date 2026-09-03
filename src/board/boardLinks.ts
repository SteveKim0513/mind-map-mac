import type { NoteLink } from '../types';
import { serialize } from '../io/formats';
import { useSession } from '../store/sessionStore';
import { useWorkspace } from '../store/workspaceStore';
import { useUi } from '../store/uiStore';
import type { MapStore } from '../store/mapStore';
import type { BoardStore } from '../store/boardStore';

/** Persist an open map to disk so its (backfilled) doc.id survives — required
 *  before a sticky can durably link to one of its nodes. No-op if not open.
 *  Duplicated from note/noteLinks.ts (not imported — board/ and note/ are
 *  siblings under the domain-boundary rule, neither imports the other). */
export async function ensureMapPersisted(mapId: string): Promise<void> {
  const tab = useSession
    .getState()
    .tabs.find((t) => t.kind === 'map' && (t.store as MapStore).getState().doc.id === mapId);
  if (!tab) return;
  const st = (tab.store as MapStore).getState();
  if (!st.filePath) return;
  const p = await window.api.save(st.filePath, serialize(st.doc));
  if (p) (tab.store as MapStore).getState().markSaved(p);
}

function isMapContent(content: string, mapId: string): boolean {
  try {
    return (JSON.parse(content) as { id?: string }).id === mapId;
  } catch {
    return false;
  }
}

async function findMapPathById(mapId: string): Promise<{ path: string; content: string } | null> {
  const mindPaths: string[] = [];
  const walk = (nodes: { type: string; path: string; children?: unknown }[]) => {
    for (const n of nodes) {
      if (n.type === 'dir' && Array.isArray(n.children)) walk(n.children as typeof nodes);
      else if (n.type === 'file' && n.path.endsWith('.mind')) mindPaths.push(n.path);
    }
  };
  walk(useWorkspace.getState().tree);
  for (const p of mindPaths) {
    try {
      const content = await window.api.readFile(p);
      if (isMapContent(content, mapId)) return { path: p, content };
    } catch {
      /* unreadable → skip */
    }
  }
  return null;
}

/** Open (or focus) the map a sticky's node link points at and center the
 *  node — same open/resolve/fail-gracefully shape as note/noteLinks.ts's
 *  revealNode. Duplicated rather than imported for the same domain-boundary
 *  reason as ensureMapPersisted above. */
export async function revealBoardNodeLink(link: NoteLink): Promise<void> {
  const sess = useSession.getState();
  const open = sess.tabs.find((t) => t.kind === 'map' && (t.store as MapStore).getState().doc.id === link.mapId);
  if (open && open.path) {
    sess.openPath(open.path, '');
  } else {
    let found: { path: string; content: string } | null = null;
    if (link.mapPath) {
      try {
        const content = await window.api.readFile(link.mapPath);
        if (isMapContent(content, link.mapId)) found = { path: link.mapPath, content };
      } catch {
        /* stale hint */
      }
    }
    if (!found) found = await findMapPathById(link.mapId);
    if (!found) {
      useUi.getState().toast('연결된 맵을 찾을 수 없습니다 — 이동되었거나 삭제된 것 같아요');
      return;
    }
    sess.openPath(found.path, found.content);
  }
  const tab = useSession.getState().tabs.find((t) => t.kind === 'map' && (t.store as MapStore).getState().doc.id === link.mapId);
  if (!tab) return;
  (tab.store as MapStore).getState().select(link.nodeId);
  setTimeout(() => useUi.getState().focusNode(link.nodeId), 0);
}

/** Open a board (by path) and select + pan to a specific sticky — the board
 *  equivalent of note/noteLinks.ts's revealNode, used by global search hits
 *  on sticky text. Boards are opened by path (not a stable doc id) since the
 *  caller already scanned the workspace tree and has the path in hand. */
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

/** Open a sticky's linked note file beside the board. */
export async function revealBoardNoteLink(notePath: string): Promise<void> {
  try {
    const content = await window.api.readFile(notePath);
    useSession.getState().openInRight(notePath, content);
  } catch {
    useUi.getState().toast('연결된 노트를 찾을 수 없습니다 — 이동되었거나 삭제된 것 같아요');
  }
}
