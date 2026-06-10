// Two-way sync between schedule nodes and macOS Reminders.
//
// Outbound (app → Reminders) is event-driven: any edit to a synced node schedules a
// reconcile. Inbound (Reminders → app) is polled, because Reminders gives no change
// push — we reconcile on window focus and on a slow interval, but only while there
// are tracked nodes and the window is visible, so idle cost is ~zero.
//
// Conflict resolution is last-write-wins via timestamps: node.updatedAt (local edit)
// vs the reminder's modification date. Whichever is newer wins.
import { useSession } from '../store/sessionStore';
import { useUi } from '../store/uiStore';
import { setReminderDeleteHook, type MapStore } from '../store/mapStore';
import type { MindNode } from '../types';
import type { ReminderInfo } from '../../electron/preload';

const POLL_MS = 45000;
const DEBOUNCE_MS = 1200;

let started = false;
let available: boolean | null = null;
let warned = false;
let syncing = false;
let pending = false;
// true while any reminder may still need reaping even if no node is currently
// tracked (e.g. a registration was undone) — lets the poll keep running briefly.
let pollUntracked = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

// per-tab store subscriptions + the last doc we saw (to fire only on real mutations)
const subs = new Map<string, { unsub: () => void; lastDoc: unknown }>();

function titleOf(n: MindNode): string {
  return (n.text || '').replace(/\s+/g, ' ').trim() || '제목 없음';
}

function ms(iso: string | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
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

async function reconcile() {
  if (syncing) {
    pending = true;
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
    // Nothing to sync and no lingering reminders to reap → never touch osascript.
    if (trackedCount === 0 && !pollUntracked) return;

    // Re-probe until access is granted (so enabling permission in System Settings
    // takes effect without an app restart); once true, trust it for the session.
    if (available !== true) {
      try {
        available = await window.api.remindersAvailable();
      } catch {
        available = false;
      }
      if (available !== true) return;
    }

    const list = await window.api.reminderQuery();
    const byId = new Map<string, ReminderInfo>(list.map((r) => [r.id, r]));
    // Reminder ownership is keyed by the node id stamped in the reminder body, so the
    // link survives even when undo strips reminderId off the node. If two reminders
    // share a tag (a duplicate slipped through), keep the newest and reap the rest.
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
      if (d.tag && owners.has(d.tag)) await window.api.reminderDelete(d.id);
    }

    // Work set: nodes that want a reminder OR own an existing reminder.
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

      if (!n.reminderOn) {
        // reminder no longer wanted (toggled off, OR the registration was undone) →
        // delete it so the Reminders app stays in sync.
        if (rem) await window.api.reminderDelete(rem.id);
        if (n.reminderId || n.reminderSyncedAt)
          patch(store, id, { reminderId: undefined, reminderSyncedAt: undefined });
        continue;
      }

      if (!rem) {
        // wanted but no reminder exists yet → create (stamped with this node id)
        const res = await window.api.reminderCreate({
          title: titleOf(n),
          dueDate: n.scheduleAt ?? null,
          nodeId: id,
        });
        patch(store, id, {
          reminderId: res.id,
          reminderSyncedAt: ms(res.modifiedAt),
          updatedAt: ms(res.modifiedAt),
        });
        continue;
      }

      // wanted and a reminder exists → ensure the node caches its id, then reconcile
      if (n.reminderId !== rem.id) patch(store, id, { reminderId: rem.id });

      const remMs = ms(rem.modifiedAt);
      const synced = n.reminderSyncedAt ?? 0;
      const local = n.updatedAt ?? 0;
      const remoteChanged = remMs > synced;
      const localChanged = local > synced;

      if (remoteChanged && (!localChanged || remMs >= local)) {
        // pull: Reminders → node. Don't clobber the node's text when (a) it's being
        // edited, or (b) the remote title is merely the whitespace-normalized form of
        // the local text (which would silently strip newlines/extra spaces).
        const editing = store.getState().editingId === id;
        const titleIsNormalizedLocal = rem.title === titleOf(n);
        const fields: Record<string, unknown> = {
          done: rem.completed || undefined,
          scheduleAt: rem.dueDate ?? undefined,
          reminderSyncedAt: remMs,
          updatedAt: remMs,
        };
        if (!editing && !titleIsNormalizedLocal) fields.text = rem.title;
        patch(store, id, fields);
      } else if (localChanged) {
        // push: node → Reminders
        const newMod = await window.api.reminderUpdate({
          id: rem.id,
          title: titleOf(n),
          completed: !!n.done,
          dueDate: n.scheduleAt ?? null,
        });
        if (newMod === null) patch(store, id, { reminderId: undefined, reminderSyncedAt: undefined });
        else patch(store, id, { reminderSyncedAt: ms(newMod) });
      }
    }

    // Keep polling next cycle if any reminder remains that we could still act on
    // (so an undo-orphaned reminder gets reaped even after the node is untracked).
    pollUntracked = [...byTag.keys()].some((tag) => owners.has(tag)) || workIds.size > 0;
  } catch {
    if (!warned) {
      warned = true;
      useUi.getState().toast('미리알림 동기화 오류 — 권한을 확인하세요');
    }
  } finally {
    syncing = false;
    if (pending) {
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
  for (const [, s] of subs) s.unsub();
  subs.clear();
  setReminderDeleteHook(null);
  started = false;
}
