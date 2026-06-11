import type { NoteLink, NoteMeta } from '../types';
import { parseNote, serializeNote } from '../io/noteFormat';
import { serialize } from '../io/formats';
import { useWorkspace } from '../store/workspaceStore';
import { useSession } from '../store/sessionStore';
import { useUi } from '../store/uiStore';
import type { MapStore } from '../store/mapStore';
import type { NoteStore } from '../store/noteStore';

function noteName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/, '');
}

/**
 * Persist an open map to disk so its (backfilled) doc.id survives — required
 * before a note can durably link to one of its nodes. No-op if not open.
 */
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

/** Reindex a note from its store state into the workspace link index. */
export function reindexFromNote(path: string, note: { id: string; title: string; links: NoteLink[] }) {
  useWorkspace.getState().reindexNote({ path, id: note.id, title: note.title, links: note.links });
}

/**
 * Add a link to a note FILE — works whether or not the note is open in a tab.
 * Also persists the target map's id and updates the workspace index.
 */
export async function addLinkToNoteFile(notePath: string, link: NoteLink): Promise<void> {
  await ensureMapPersisted(link.mapId);

  const tab = useSession.getState().tabs.find((t) => t.kind === 'note' && t.path === notePath);
  if (tab) {
    const store = tab.store as NoteStore;
    store.getState().addLink(link);
    await useSession.getState().flushSaves(notePath); // write immediately
    reindexFromNote(notePath, store.getState().note);
    return;
  }

  // closed note → read / modify / write the file directly
  const content = await window.api.readFile(notePath);
  const note = parseNote(content, noteName(notePath));
  if (!note.links.some((l) => l.mapId === link.mapId && l.nodeId === link.nodeId)) {
    note.links.push(link);
  }
  await window.api.save(notePath, serializeNote(note));
  reindexFromNote(notePath, note);
}

/**
 * Remove a node link from a note FILE — symmetric with addLinkToNoteFile, so
 * the node side can unlink too (spec: docs/product/specs/2026-06-11-entrypoint-matrix.md).
 */
export async function removeLinkFromNoteFile(
  notePath: string,
  mapId: string,
  nodeId: string,
): Promise<void> {
  const tab = useSession.getState().tabs.find((t) => t.kind === 'note' && t.path === notePath);
  if (tab) {
    const store = tab.store as NoteStore;
    store.getState().removeLink(mapId, nodeId);
    await useSession.getState().flushSaves(notePath);
    reindexFromNote(notePath, store.getState().note);
    return;
  }

  // closed note → read / modify / write the file directly
  const content = await window.api.readFile(notePath);
  const note = parseNote(content, noteName(notePath));
  note.links = note.links.filter((l) => !(l.mapId === mapId && l.nodeId === nodeId));
  await window.api.save(notePath, serializeNote(note));
  reindexFromNote(notePath, note);
}

/** Does this file content belong to the map we're looking for? */
function isMapContent(content: string, mapId: string): boolean {
  try {
    return (JSON.parse(content) as { id?: string }).id === mapId;
  } catch {
    return false;
  }
}

/**
 * Find a map file by its document id — the link's path is only a hint and goes
 * stale whenever the map is renamed (untitled auto-naming does this routinely).
 */
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

/** Open (or focus) the map a link points at and center the linked node. */
export async function revealNode(link: NoteLink): Promise<void> {
  const sess = useSession.getState();
  const open = sess.tabs.find(
    (t) => t.kind === 'map' && (t.store as MapStore).getState().doc.id === link.mapId,
  );
  if (open && open.path) {
    sess.openPath(open.path, ''); // already open → just activates its tab/group
  } else {
    // closed → try the path hint, fall back to resolving by doc id, and never
    // fail silently (the user just clicked a chip and expects SOMETHING)
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
  const tab = useSession
    .getState()
    .tabs.find((t) => t.kind === 'map' && (t.store as MapStore).getState().doc.id === link.mapId);
  if (!tab) return;
  (tab.store as MapStore).getState().select(link.nodeId);
  // let the pane mount/activate, then center the node
  setTimeout(() => useUi.getState().focusNode(link.nodeId), 0);
}

export type { NoteMeta };
