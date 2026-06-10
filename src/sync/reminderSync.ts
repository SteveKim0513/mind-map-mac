// Two-way sync between schedule nodes and macOS Reminders.
//
// Outbound (app → Reminders) is event-driven: any edit to a synced node schedules a
// reconcile. Inbound (Reminders → app) is polled, because Reminders gives no change
// push — we reconcile on window focus and on a slow interval, only while there are
// tracked nodes and the window is visible, so idle cost is ~zero.
//
// Change detection is CONTENT-based: a field is "changed" iff its value differs from
// the last agreed snapshot (node.reminderBase), independent of clocks. Only a genuine
// both-sides conflict falls back to a timestamp tiebreak.
//
// A heartbeat/health layer guards the AppleScript bridge: osascript can hang or be
// denied, so failures flip the engine to a "down/denied" state that pauses real work
// and probes for recovery with exponential backoff instead of hammering.
import { useSession } from '../store/sessionStore';
import { useUi } from '../store/uiStore';
import { setReminderDeleteHook, type MapStore } from '../store/mapStore';
import type { MindNode } from '../types';
import type { ReminderInfo } from '../../electron/preload';

const POLL_MS = 45000;
const DEBOUNCE_MS = 1200;
const BACKOFF_MS = [5000, 15000, 45000, 120000]; // heartbeat retry schedule while down

type Health = 'unknown' | 'ok' | 'down' | 'denied';
type Base = { title: string; due: string | null; done: boolean };

let started = false;
let health: Health = 'unknown';
let warned = false;
let syncing = false;
let pending = false;
// keep polling a cycle longer if a reminder may still need reaping even with no
// node currently tracked (e.g. a registration was undone)
let pollUntracked = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let backoffIndex = 0;

// per-tab store subscriptions + the last doc we saw (to fire only on real mutations)
const subs = new Map<string, { unsub: () => void; lastDoc: unknown }>();

function setStatus(s: 'idle' | 'syncing' | 'ok' | 'down' | 'denied') {
  useUi.getState().setSyncStatus(s);
}

function titleOf(n: MindNode): string {
  return (n.text || '').replace(/\s+/g, ' ').trim() || '제목 없음';
}

function ms(iso: string | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function baseEq(a: Base | undefined, b: Base): boolean {
  return !!a && a.title === b.title && a.due === b.due && a.done === b.done;
}

function scheduleReconcile() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void reconcile(), DEBOUNCE_MS);
}

// True while sync applies its own write. zustand fires store subscriptions
// synchronously inside the set(), so the subscription can check this flag to avoid
// treating sync's own writes as user edits (which would re-trigger an osascript poll).
let applyingSync = false;

/** Apply a sync-originated patch without re-triggering a reconcile. */
function patch(store: MapStore, id: string, fields: Record<string, unknown>) {
  applyingSync = true;
  try {
    store.getState().applyReminderPatch(id, fields);
  } finally {
    applyingSync = false;
  }
}

/** Keep one subscription per open tab; reconcile when a tab's document mutates. */
function refreshSubs() {
  const tabs = useSession.getState().tabs;
  const live = new Set(tabs.map((t) => t.id));
  for (const [id, s] of subs) {
    if (!live.has(id)) {
      s.unsub();
      subs.delete(id);
    }
  }
  for (const t of tabs) {
    if (subs.has(t.id)) continue;
    const store = t.store;
    const entry = { lastDoc: store.getState().doc, unsub: () => {} };
    entry.unsub = store.subscribe(() => {
      const d = store.getState().doc;
      if (d !== entry.lastDoc) {
        entry.lastDoc = d;
        if (!applyingSync) scheduleReconcile(); // ignore sync's own writes
      }
    });
    subs.set(t.id, entry);
  }
}

// ── Health / heartbeat ────────────────────────────────────────────────────────

function onFailure(err: unknown) {
  const msg = String((err as Error)?.message ?? '');
  const denied = msg.includes('OSA_DENIED');
  health = denied ? 'denied' : 'down';
  setStatus(health);
  if (!warned) {
    warned = true;
    useUi
      .getState()
      .toast(
        denied
          ? '미리알림 권한이 필요합니다 — 시스템 설정 › 개인정보 보호 › 자동화'
          : '미리알림 동기화 일시 중지 — 자동 재시도 중',
      );
  }
  startHeartbeat();
}

function startHeartbeat() {
  if (heartbeatTimer) return; // already probing
  const delay = BACKOFF_MS[Math.min(backoffIndex, BACKOFF_MS.length - 1)];
  heartbeatTimer = setTimeout(runHeartbeat, delay);
}

async function runHeartbeat() {
  heartbeatTimer = null;
  let res: { ok: boolean; kind?: string };
  try {
    res = await window.api.reminderHeartbeat();
  } catch {
    res = { ok: false, kind: 'error' };
  }
  if (res.ok) {
    health = 'ok';
    backoffIndex = 0;
    warned = false; // allow a fresh warning if it breaks again
    setStatus('ok');
    void reconcile(); // catch up on anything we deferred
  } else {
    health = res.kind === 'denied' ? 'denied' : 'down';
    setStatus(health);
    backoffIndex = Math.min(backoffIndex + 1, BACKOFF_MS.length - 1);
    startHeartbeat();
  }
}

// ── Reconcile ──────────────────────────────────────────────────────────────────

async function reconcile() {
  if (syncing) {
    pending = true;
    return;
  }
  if (health === 'down' || health === 'denied') {
    pending = true; // a heartbeat success will resume us
    return;
  }
  syncing = true;
  try {
    // Map every open node id → its store, and note which nodes are reminder-related.
    const owners = new Map<string, MapStore>();
    let trackedCount = 0;
    for (const t of useSession.getState().tabs) {
      const nodes = t.store.getState().doc.nodes;
      for (const id in nodes) {
        owners.set(id, t.store);
        const n = nodes[id];
        if (n.reminderOn || n.reminderId) trackedCount++;
      }
    }
    if (trackedCount === 0 && !pollUntracked) {
      setStatus('idle');
      return;
    }

    // First contact: a long-timeout availability probe handles the one-time
    // permission dialog. Failures route through the heartbeat/backoff path.
    if (health === 'unknown') {
      const ok = await window.api.remindersAvailable();
      if (!ok) {
        health = 'denied';
        setStatus('denied');
        startHeartbeat();
        return;
      }
      health = 'ok';
    }

    setStatus('syncing');
    const list = await window.api.reminderQuery();
    const byId = new Map<string, ReminderInfo>(list.map((r) => [r.id, r]));
    // Ownership is keyed by the node id stamped in the reminder body, so the link
    // survives even when undo strips reminderId. Duplicate tags → keep newest, reap rest.
    const byTag = new Map<string, ReminderInfo>();
    const dupes: ReminderInfo[] = [];
    for (const r of list) {
      if (!r.tag) continue;
      const existing = byTag.get(r.tag);
      if (!existing) {
        byTag.set(r.tag, r);
      } else {
        const keep = ms(r.modifiedAt) >= ms(existing.modifiedAt) ? r : existing;
        byTag.set(r.tag, keep);
        dupes.push(keep === r ? existing : r);
      }
    }
    for (const d of dupes) {
      if (d.tag && owners.has(d.tag)) {
        await window.api.reminderDelete(d.id);
      }
    }

    const workIds = new Set<string>();
    for (const [id, store] of owners) {
      const n = store.getState().doc.nodes[id];
      if (n && (n.reminderOn || n.reminderId)) workIds.add(id);
    }
    for (const tag of byTag.keys()) if (owners.has(tag)) workIds.add(tag);

    for (const id of workIds) {
      const store = owners.get(id)!;
      const n = store.getState().doc.nodes[id];
      if (!n) continue;
      const rem = byTag.get(id) ?? (n.reminderId ? byId.get(n.reminderId) : undefined);

      // not wanted → delete the reminder (covers toggle-off and undone registration)
      if (!n.reminderOn) {
        if (rem) {
          await window.api.reminderDelete(rem.id);
        }
        if (n.reminderId || n.reminderBase)
          patch(store, id, { reminderId: undefined, reminderSyncedAt: undefined, reminderBase: undefined });
        continue;
      }

      // wanted but none exists → create (stamped with this node id)
      if (!rem) {
        const res = await window.api.reminderCreate({
          title: titleOf(n),
          dueDate: n.scheduleAt ?? null,
          nodeId: id,
        });
        patch(store, id, {
          reminderId: res.id,
          updatedAt: ms(res.modifiedAt),
          reminderBase: { title: titleOf(n), due: n.scheduleAt ?? null, done: !!n.done },
        });
        continue;
      }

      if (n.reminderId !== rem.id) patch(store, id, { reminderId: rem.id });

      // ── content-based change detection ──
      const base = n.reminderBase;
      const cur: Base = { title: titleOf(n), due: n.scheduleAt ?? null, done: !!n.done };
      const remote: Base = { title: rem.title, due: rem.dueDate, done: rem.completed };
      const localChanged = !baseEq(base, cur);
      const remoteChanged = !baseEq(base, remote);
      if (!localChanged && !remoteChanged) {
        if (!base) patch(store, id, { reminderBase: remote }); // first link → record base
        continue;
      }

      // both changed → tiebreak by recency; otherwise the changed side wins
      const remMs = ms(rem.modifiedAt);
      const local = n.updatedAt ?? 0;
      const pull = remoteChanged && (!localChanged || remMs >= local);

      if (pull) {
        // Don't clobber the node's text while it's being edited, or when the remote
        // title is merely the whitespace-normalized form of the local text.
        const editing = store.getState().editingId === id;
        const titleIsNormalizedLocal = remote.title === cur.title;
        const fields: Record<string, unknown> = {
          done: remote.done || undefined,
          scheduleAt: remote.due ?? undefined,
          reminderBase: remote,
        };
        if (!editing && !titleIsNormalizedLocal) fields.text = remote.title;
        patch(store, id, fields);
      } else {
        const newMod = await window.api.reminderUpdate({
          id: rem.id,
          title: cur.title,
          completed: cur.done,
          dueDate: cur.due,
        });
        if (newMod === null)
          patch(store, id, { reminderId: undefined, reminderBase: undefined });
        else patch(store, id, { reminderBase: cur });
      }
    }

    pollUntracked = [...byTag.keys()].some((tag) => owners.has(tag)) || workIds.size > 0;
    setStatus('ok');
  } catch (err) {
    onFailure(err);
  } finally {
    syncing = false;
    if (pending && health === 'ok') {
      pending = false;
      scheduleReconcile();
    }
  }
}

/** Start the sync engine once, at app startup. Safe to call on non-macOS (no-op). */
export function startReminderSync() {
  if (started) return;
  started = true;
  if (!window.api?.reminderQuery) return;

  // deleting a node removes its mirrored reminder (fire-and-forget)
  setReminderDeleteHook((ids) => {
    for (const rid of ids) void window.api.reminderDelete(rid).catch(() => {});
  });

  refreshSubs();
  useSession.subscribe(refreshSubs);

  const pollIfVisible = () => {
    if (document.visibilityState === 'visible') void reconcile();
  };
  pollTimer = setInterval(pollIfVisible, POLL_MS);
  window.addEventListener('focus', () => void reconcile());
  document.addEventListener('visibilitychange', pollIfVisible);

  void reconcile();
}

export function stopReminderSync() {
  if (pollTimer) clearInterval(pollTimer);
  if (debounceTimer) clearTimeout(debounceTimer);
  if (heartbeatTimer) clearTimeout(heartbeatTimer);
  for (const [, s] of subs) s.unsub();
  subs.clear();
  setReminderDeleteHook(null);
  started = false;
}
