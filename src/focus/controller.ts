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
import { SESSION_BODY } from './sessionNote';

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

// A start is a two-step process: a goal prompt, then the actual start. The store
// + node are held here (not in uiStore) so the prompt stays serializable and the
// map id never has to be resolved from a possibly-unsaved doc.
let pendingStart: { store: MapStore; nodeId: string } | null = null;

/** Entry point for every "집중 세션 시작" trigger: refuse if busy, else open the
 *  goal prompt. The session itself begins on confirmFocusStart. */
export function requestFocusStart(store: MapStore, nodeId: string): void {
  const ui = useUi.getState();
  if (ui.activeFocus) {
    ui.toast(`이미 「${ui.activeFocus.nodeText}」 집중이 진행 중이에요 — 먼저 종료해 주세요`);
    return;
  }
  const node = store.getState().doc.nodes[nodeId];
  if (!node) return;
  pendingStart = { store, nodeId };
  ui.openFocusPrompt({ nodeText: (node.text || '').trim() || '제목 없음' });
}

/** Confirm the goal prompt → begin the session (goal optional, blank = skip). */
export async function confirmFocusStart(goal?: string): Promise<void> {
  const p = pendingStart;
  pendingStart = null;
  useUi.getState().closeFocusPrompt();
  if (p) await startFocusSession(p.store, p.nodeId, goal);
}

/** Dismiss the goal prompt without starting. */
export function cancelFocusStart(): void {
  pendingStart = null;
  useUi.getState().closeFocusPrompt();
}

/**
 * Start a focus session on a node of the given (open) map store.
 * Creates work-log/, the session note (the free work LOG — the "process"), links
 * it to the node, opens it in the right split, and arms the timer. The goal is
 * structured data captured up front (not parsed from the note). One session at a
 * time — a second start is refused.
 */
export async function startFocusSession(store: MapStore, nodeId: string, goal?: string): Promise<void> {
  const ui = useUi.getState();
  if (ui.activeFocus) {
    ui.toast(`이미 「${ui.activeFocus.nodeText}」 집중이 진행 중이에요 — 먼저 종료해 주세요`);
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
    goal: goal?.trim() || undefined, // captured up front via the start prompt
  };

  const root = useWorkspace.getState().root;
  const note = {
    ...emptyNote(titleFor(start, nodeText)),
    body: SESSION_BODY,
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

  // first-run coachmark: a session silently spawns a note + timer, so explain it
  // once (and only once) so the first-time user isn't surprised. (B2)
  try {
    if (!localStorage.getItem('focusCoachShown')) {
      localStorage.setItem('focusCoachShown', '1');
      ui.toast('집중 시작 — 이 노트에 과정을 기록하고, 끝나면 “종료”를 누르세요');
    }
  } catch {
    /* localStorage unavailable — skip the hint */
  }
}

/** Read → patch (end/duration/goal/reflect) → write the session note's frontmatter. */
async function stampEnd(notePath: string, end: number, reflect?: string): Promise<FocusSession | null> {
  let content: string;
  try {
    content = await window.api.readFile(notePath);
  } catch {
    return null; // note gone — nothing to stamp
  }
  const note = parseNote(content, '집중');
  if (!note.session) return null;
  const { durationSec, suspect } = sanitizeDuration(note.session.start, end);
  note.session = {
    ...note.session,
    end,
    durationSec,
    estimated: suspect || undefined,
    // goal was captured up front (structured); the result is the reflection
    reflect: reflect?.trim() || note.session.reflect,
  };
  await window.api.save(notePath, serializeNote(note));
  reindexFromNote(notePath, note);
  syncOpenSessionTab(notePath, note.session);
  return note.session;
}

/** Push a session struct into the note tab's store if it's open, so the banner
 *  reflects the latest goal/result immediately and a pending autosave can't
 *  clobber the just-written frontmatter with a stale session (§14-I). */
function syncOpenSessionTab(notePath: string, session: FocusSession): void {
  const openTab = useSession.getState().tabs.find((t) => t.kind === 'note' && t.path === notePath);
  if (!openTab) return;
  type NoteStoreApi = { getState: () => { applySession: (s: FocusSession) => void } };
  (openTab.store as unknown as NoteStoreApi).getState().applySession(session);
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
    goal: ended?.goal,
    todaySec: sum.todaySec,
    focusDays7: sum.focusDays7,
    nodeRolledSec: stat?.rolledSec ?? 0,
    notePath: active.notePath,
  });
}

/** Append a reflection to an already-ended session (from the completion card). */
export async function attachReflection(notePath: string, reflect: string): Promise<void> {
  if (!reflect.trim()) return;
  try {
    const content = await window.api.readFile(notePath);
    const note = parseNote(content, '집중');
    if (!note.session) return;
    note.session = { ...note.session, reflect: reflect.trim() };
    await window.api.save(notePath, serializeNote(note));
    reindexFromNote(notePath, note);
    syncOpenSessionTab(notePath, note.session); // banner shows ✅ result right away
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
