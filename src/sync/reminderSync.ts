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

interface Tracked {
  store: MapStore;
  id: string;
}

async function reconcile() {
  if (syncing) {
    pending = true;
    return;
  }
  syncing = true;
  try {
    // gather nodes that are (or should be) mirrored, across all open tabs
    const tracked: Tracked[] = [];
    for (const t of useSession.getState().tabs) {
      const nodes = t.store.getState().doc.nodes;
      for (const id in nodes) {
        const n = nodes[id];
        if (n.reminderOn || n.reminderId) tracked.push({ store: t.store, id });
      }
    }
    if (tracked.length === 0) return; // nothing to sync — never touch osascript

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
    // node id → its existing reminder (stamped in the reminder body) — lets create
    // be idempotent so undo/redo can't spawn duplicate reminders.
    const byTag = new Map<string, ReminderInfo>();
    for (const r of list) if (r.tag) byTag.set(r.tag, r);

    for (const { store, id } of tracked) {
      const n = store.getState().doc.nodes[id];
      if (!n) continue;

      if (n.reminderOn && !n.reminderId) {
        const existing = byTag.get(id);
        if (existing) {
          // a reminder for this node already exists (e.g. after undo) — adopt it
          patch(store, id, { reminderId: existing.id, reminderSyncedAt: ms(existing.modifiedAt) });
        } else {
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
        }
      } else if (!n.reminderOn && n.reminderId) {
        // user turned it off but id lingered — clean up
        await window.api.reminderDelete(n.reminderId);
        patch(store, id, { reminderId: undefined, reminderSyncedAt: undefined });
      } else if (n.reminderOn && n.reminderId) {
        const rem = byId.get(n.reminderId);
        if (!rem) {
          // deleted in the Reminders app → reflect by turning the toggle off
          patch(store, id, {
            reminderOn: undefined,
            reminderId: undefined,
            reminderSyncedAt: undefined,
          });
          continue;
        }
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
            id: n.reminderId,
            title: titleOf(n),
            completed: !!n.done,
            dueDate: n.scheduleAt ?? null,
          });
          if (newMod === null) {
            patch(store, id, {
              reminderOn: undefined,
              reminderId: undefined,
              reminderSyncedAt: undefined,
            });
          } else {
            patch(store, id, { reminderSyncedAt: ms(newMod) });
          }
        }
      }
    }
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
