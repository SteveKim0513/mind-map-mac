// Focus-session orchestration: start / end / recover. Keeps uiStore lean and
// isolates the file + note + link side effects in one place.
// Spec: docs/product/specs/2026-06-12-focus-session.md (§14 governs).

import type { FocusSession, MindNode, NoteLink } from '../types';
import { useUi } from '../store/uiStore';
import { useSession } from '../store/sessionStore';
import { useWorkspace } from '../store/workspaceStore';
import { newId } from '../io/formats';
import { emptyNote, serializeNote, parseNote } from '../io/noteFormat';
import { ensureMapPersisted, reindexFromNote } from '../note/noteLinks';
import type { MapStore } from '../store/mapStore';
import { sanitizeDuration, summary, perNode, nodeStat } from './aggregate';

const WORK_LOG = 'work-log';

function pad(n: number): number | string {
  return n < 10 ? `0${n}` : n;
}
function titleFor(start: number, nodeText: string): string {
  const d = new Date(start);
  // "2026-06-12 14:30 집중 · 출시 준비 로드맵" — start time is the title (per request),
  // node text appended so the list is scannable. (file name follows via uniquePath)
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${stamp} 집중 · ${nodeText || '제목 없음'}`.slice(0, 80);
}

/** ancestor chain (root→…→parent) ids + text snapshots, for subtree roll-up. */
function ancestorChain(nodes: Record<string, MindNode>, nodeId: string): { ids: string[]; texts: string[] } {
  const ids: string[] = [];
  const texts: string[] = [];
  let cur = nodes[nodeId]?.parentId ?? null;
  let guard = 0;
  while (cur && guard++ < 200) {
    ids.unshift(cur);
    texts.unshift(nodes[cur]?.text ?? '');
    cur = nodes[cur]?.parentId ?? null;
  }
  return { ids, texts };
}

/** Find an open map store by its doc id. */
function mapStoreById(mapId: string): MapStore | null {
  const tab = useSession
    .getState()
    .tabs.find((t) => t.kind === 'map' && (t.store as MapStore).getState().doc.id === mapId);
  return tab ? (tab.store as MapStore) : null;
}

// A scaffold for genuinely focused work, not just a blank page:
// intention → definition of done → live log → a parking lot so distractions
// get captured WITHOUT breaking flow (a real deep-work technique).
const BODY_TEMPLATE = [
  '## 🎯 이번 세션의 한 가지',
  '_무엇에 집중하나 — 한 문장으로_',
  '',
  '',
  '## ✅ 끝나면 이렇게 된다',
  '_무엇이 되면 “됐다”인가_',
  '',
  '',
  '---',
  '',
  '## 🔨 작업 기록',
  '_진행하며 적기 (결정·발견·막힌 점)_',
  '',
  '',
  '## 🅿️ 나중에',
  '_떠오른 딴 생각·할 일 — 흐름 끊지 말고 여기 적어두기_',
  '',
].join('\n');

/**
 * Start a focus session on a node of the given (open) map store.
 * Creates work-log/, the session note, links it to the node, opens the note in
 * the right split (you start a session to start WORKING in the note), and arms
 * the timer. Only one session runs at a time — a second start is refused.
 */
export async function startFocusSession(store: MapStore, nodeId: string): Promise<void> {
  const ui = useUi.getState();
  if (ui.activeFocus) {
    // single active session: refuse a second one. A light toast (not a modal) —
    // the always-visible pill lets the user jump to the running note.
    ui.toast(`이미 「${ui.activeFocus.nodeText}」 집중 세션이 진행 중이에요 — 먼저 종료해 주세요`);
    return;
  }

  const doc = store.getState().doc;
  const node = doc.nodes[nodeId];
  if (!node) return;
  const mapId = doc.id ?? '';
  await ensureMapPersisted(mapId); // stamp a stable map id before linking
  const mapPath = store.getState().filePath ?? undefined;
  const nodeText = (node.text || '').trim() || '제목 없음';
  const start = Date.now();
  const sessionId = newId();
  const chain = ancestorChain(doc.nodes, nodeId);

  const link: NoteLink = { mapId, nodeId, nodeText, mapPath };
  const session: FocusSession = {
    sessionId,
    link,
    ancestorIds: chain.ids,
    ancestorTexts: chain.texts,
    start,
    end: null,
    durationSec: 0,
  };

  const root = useWorkspace.getState().root;
  const note = {
    ...emptyNote(titleFor(start, nodeText)),
    body: BODY_TEMPLATE,
    links: [link],
    session,
  };
  const serialized = serializeNote(note);
  const path = await window.api.createFile(`${root}/${WORK_LOG}`, note.title, serialized, '.md');
  await useWorkspace.getState().refresh();
  reindexFromNote(path, note);

  ui.setActiveFocus({ sessionId, notePath: path, start, mapId, nodeId, nodeText });
  // open the note in the right split so the session = working in the note
  useSession.getState().openInRight(path, serialized);
}

/** Read → patch (end/duration/reflect) → write the session note's frontmatter. */
async function stampEnd(notePath: string, end: number, reflect?: string): Promise<FocusSession | null> {
  let content: string;
  try {
    content = await window.api.readFile(notePath);
  } catch {
    return null; // note gone — nothing to stamp
  }
  const note = parseNote(content, '집중 세션');
  if (!note.session) return null;
  const { durationSec, suspect } = sanitizeDuration(note.session.start, end);
  note.session = {
    ...note.session,
    end,
    durationSec,
    estimated: suspect || undefined,
    reflect: reflect?.trim() || note.session.reflect,
  };
  await window.api.save(notePath, serializeNote(note));
  reindexFromNote(notePath, note);
  // if the session note is open in a tab, sync its store so a pending autosave
  // can't clobber the just-written end with the stale (end:null) session (§14-I)
  const openTab = useSession.getState().tabs.find((t) => t.kind === 'note' && t.path === notePath);
  if (openTab) {
    type NoteStoreApi = { getState: () => { applySession: (s: FocusSession) => void } };
    (openTab.store as unknown as NoteStoreApi).getState().applySession(note.session);
  }
  return note.session;
}

/** End the active session: stamp the note, refresh the index, raise the completion card. */
export async function endFocusSession(reflect?: string): Promise<void> {
  const ui = useUi.getState();
  const active = ui.activeFocus;
  if (!active) return;
  ui.setActiveFocus(null); // disarm immediately (idempotent against double-clicks)

  const ended = await stampEnd(active.notePath, Date.now(), reflect);
  await useWorkspace.getState().refresh(); // pick up the stamped frontmatter

  const sessions = useWorkspace.getState().sessions();
  const now = Date.now();
  const sum = summary(sessions, now);
  const agg = perNode(sessions);
  const stat = nodeStat(agg, active.mapId, active.nodeId);

  ui.setFocusDone({
    durationSec: ended?.durationSec ?? Math.round((now - active.start) / 1000),
    nodeText: active.nodeText,
    todaySec: sum.todaySec,
    streak: sum.streak,
    nodeRolledSec: stat?.rolledSec ?? 0,
    notePath: active.notePath,
  });
}

/** Append a reflection to an already-ended session (from the completion card). */
export async function attachReflection(notePath: string, reflect: string): Promise<void> {
  if (!reflect.trim()) return;
  try {
    const content = await window.api.readFile(notePath);
    const note = parseNote(content, '집중 세션');
    if (!note.session) return;
    note.session = { ...note.session, reflect: reflect.trim() };
    await window.api.save(notePath, serializeNote(note));
    reindexFromNote(notePath, note);
  } catch {
    /* ignore */
  }
}

/** Open the active (or any) session note in the right split. */
export async function openSessionNote(notePath: string): Promise<void> {
  try {
    useSession.getState().openInRight(notePath, await window.api.readFile(notePath));
  } catch {
    /* gone */
  }
}

export { mapStoreById };
