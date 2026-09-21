import type { BoardNoteRef, NoteLink } from '../types';
import { serialize } from '../io/formats';
import { isPathInsideRoot } from '../io/linkSafety';
import { useSession } from '../store/sessionStore';
import { useWorkspace } from '../store/workspaceStore';
import { useUi } from '../store/uiStore';
import type { MapStore } from '../store/mapStore';

/** "Open a board and select a sticky" now lives in store/workspaceStore.ts —
 *  it only touches store/ state, so canvas/NodeView.tsx and note/NotePane.tsx
 *  can call it too (for the "referenced from a board" backlink chip) without
 *  importing board/ directly, which the domain-boundary rule forbids. Re-
 *  exported here so this module's existing callers (search/GlobalSearch.tsx)
 *  don't need to change their import path. */
export { openBoardSticky } from '../store/workspaceStore';

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
  if (st.readOnly) return; // 공유로 받은 읽기 전용 맵(뷰어)은 소유자의 미러 파일이다 — 여기서 쓰지 않는다
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
    // mapPath는 "어디 있었나" 힌트일 뿐이다 — 워크스페이스 밖·`..` 경로면(공유로 받은 보드는 원격이 채울 수 있다) 무시하고 id 검색으로 간다.
    if (link.mapPath && isPathInsideRoot(useWorkspace.getState().root, link.mapPath, '.mind')) {
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

const NOTE_NOT_FOUND_LEGACY = '연결된 노트를 찾을 수 없습니다 — 이동되었거나 삭제된 것 같아요';
const NOTE_NOT_FOUND_SHARED = '노트를 찾지 못했어요. 아직 동기화 중이거나 삭제됐을 수 있어요';

/** Open a note file beside the board — false if it can't be opened. The path is opened only if it is a `.md`
 *  inside the workspace root (last line of defence: a shared board's link can be filled in by a remote). */
async function openNoteBeside(path: string | null | undefined): Promise<boolean> {
  if (!isPathInsideRoot(useWorkspace.getState().root, path, '.md')) return false;
  try {
    const content = await window.api.readFile(path);
    useSession.getState().openInRight(path, content);
    return true;
  } catch {
    return false;
  }
}

/** Open a sticky's/image's linked note beside the board (ADR 0022). Resolution order:
 *   1. `noteId` → the note's CURRENT path in the LOCAL workspace note index (survives renames/moves; this is
 *      also the only way a shared-folder participant's chip works — the copy carries no path, and no path
 *      taken from the link is ever trusted for an id link),
 *   2. legacy `notePath` (boards linked before 0022, or a note without a usable id),
 *   3. one rescan + retry of the id (the index can lag a rename/materialisation),
 *   4. otherwise a toast — never a silent failure.
 *  Old boards (no `noteId`) behave exactly as before: `notePath` only. */
export async function revealBoardNoteLink(ref: Pick<BoardNoteRef, 'notePath' | 'noteId'>): Promise<void> {
  const ws = useWorkspace.getState;
  const noteId = typeof ref.noteId === 'string' && ref.noteId ? ref.noteId : null;
  const notePath = typeof ref.notePath === 'string' && ref.notePath ? ref.notePath : null;
  if (noteId && (await openNoteBeside(ws().noteById(noteId)?.path))) return;
  if (notePath && (await openNoteBeside(notePath))) return;
  if (noteId) {
    try {
      await ws().refresh();
    } catch {
      /* rescan failed — fall through to the toast */
    }
    if (await openNoteBeside(ws().noteById(noteId)?.path)) return;
  }
  useUi.getState().toast(notePath ? NOTE_NOT_FOUND_LEGACY : NOTE_NOT_FOUND_SHARED);
}
