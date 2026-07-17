import { describe, it, expect } from 'vitest';
import {
  createMapStore,
  setNoteLinkDeleteHook,
  setNoteLinkRenameHook,
  setReminderDeleteHook,
} from './mapStore';

/** Build a root with `n` children and return [rootId, childIds]. */
function rootWithChildren(s: ReturnType<typeof createMapStore>, n: number): [string, string[]] {
  s.getState().addRoot();
  const rootId = s.getState().doc.rootIds[0];
  const kids: string[] = [];
  for (let i = 0; i < n; i++) {
    s.getState().addChild(rootId);
    kids.push(s.getState().selectedId!);
  }
  return [rootId, kids];
}

describe('tree mutations', () => {
  it('addChild links parent and child both ways', () => {
    const s = createMapStore();
    const [root, [c]] = rootWithChildren(s, 1);
    expect(s.getState().doc.nodes[root].children).toContain(c);
    expect(s.getState().doc.nodes[c].parentId).toBe(root);
  });

  it('deleteNode removes the whole subtree', () => {
    const s = createMapStore();
    const [root, [c]] = rootWithChildren(s, 1);
    s.getState().addChild(c);
    const grandchild = s.getState().selectedId!;
    s.getState().deleteNode(c);
    const { nodes } = s.getState().doc;
    expect(nodes[c]).toBeUndefined();
    expect(nodes[grandchild]).toBeUndefined();
    expect(nodes[root].children).not.toContain(c);
  });

  it('reparent refuses to move a node under its own descendant (cycle guard)', () => {
    const s = createMapStore();
    const [root, [c]] = rootWithChildren(s, 1);
    s.getState().reparent(root, c); // root under its child → illegal
    expect(s.getState().doc.nodes[root].parentId).toBeNull();
    expect(s.getState().doc.nodes[c].parentId).toBe(root);
  });

  it('reparentMany moves ALL selected roots under a target and clears their manualPos', () => {
    // 여러 부모(루트) 노드를 한 번에 다른 노드의 자식으로 — "오늘의 생각"에 쌓인
    // 루트들을 선택해 한꺼번에 옮기는 시나리오. 이전엔 하나만 옮겨졌다.
    const s = createMapStore();
    const newRoot = (): string => {
      const before = new Set(s.getState().doc.rootIds);
      s.getState().addRoot();
      return s.getState().doc.rootIds.find((id) => !before.has(id))!;
    };
    const r1 = newRoot();
    const r2 = newRoot();
    const r3 = newRoot();
    s.getState().setManualPos(r2, { x: 100, y: 100 }); // free-placed on canvas
    s.getState().setManualPos(r3, { x: 200, y: 200 });

    s.getState().reparentMany([r2, r3], r1);

    const { nodes, rootIds } = s.getState().doc;
    expect(nodes[r2].parentId).toBe(r1);
    expect(nodes[r3].parentId).toBe(r1);
    expect(nodes[r1].children).toEqual(expect.arrayContaining([r2, r3]));
    expect(rootIds).toEqual([r1]); // r2·r3 are no longer roots
    expect(nodes[r2].manualPos).toBeUndefined(); // laid out by the tree now
    expect(nodes[r3].manualPos).toBeUndefined();
  });

  it('copy-paste keeps content (links, schedule) but never reminder identity (decisions/0005)', () => {
    const s = createMapStore();
    const [root, [c]] = rootWithChildren(s, 1);
    s.getState().addNodeLink(c, 'https://a.example');
    s.getState().addNodeLink(c, 'https://b.example');
    s.getState().setScheduled(c, true);
    s.getState().setScheduleAt(c, '2026-07-01T09:00:00');
    s.getState().setReminderOn(c, true);

    s.getState().copyNode(c);
    s.getState().pasteNode(root);
    const pasted = s.getState().doc.nodes[s.getState().selectedId!];

    expect(pasted.id).not.toBe(c);
    expect(pasted.links).toEqual(['https://a.example', 'https://b.example']);
    expect(pasted.scheduled).toBe(true);
    expect(pasted.scheduleAt).toBe('2026-07-01T09:00:00');
    expect(pasted.reminderOn).toBeUndefined();
    expect(pasted.reminderId).toBeUndefined();
  });

  it('commitText trims so a whitespace-only title equals an empty one', () => {
    const s = createMapStore();
    const [root] = rootWithChildren(s, 0);
    s.getState().commitText(root, '  ');
    expect(s.getState().doc.nodes[root].text).toBe('');
    s.getState().commitText(root, ' 출시 준비 ');
    expect(s.getState().doc.nodes[root].text).toBe('출시 준비');
  });
});

describe('schedule + reminder', () => {
  it('setScheduled propagates the target date to the node and all descendants (E2)', () => {
    const s = createMapStore();
    const [root, kids] = rootWithChildren(s, 2);
    s.getState().setScheduleAt(root, '2026-07-01T09:00:00'); // give the target a date first
    s.getState().setScheduled(root, true);
    expect(s.getState().doc.nodes[root].scheduled).toBe(true);
    for (const k of kids) {
      expect(s.getState().doc.nodes[k].scheduled).toBe(true);
      // descendants inherit the target's date — no dateless "일정" chips (E2)
      expect(s.getState().doc.nodes[k].scheduleAt).toBe('2026-07-01T09:00:00');
    }
  });

  it('un-scheduling clears the date and reminder fields across the subtree', () => {
    const s = createMapStore();
    const [root, [c]] = rootWithChildren(s, 1);
    s.getState().setScheduled(root, true);
    s.getState().setScheduleAt(c, '2026-06-15T09:00:00');
    s.getState().setScheduled(root, false);
    expect(s.getState().doc.nodes[c].scheduled).toBeFalsy();
    expect(s.getState().doc.nodes[c].scheduleAt).toBeUndefined();
  });

  it('setScheduleAt(id, undefined) fully unschedules the node (not just the date)', () => {
    // Regression: it used to only clear scheduleAt and leave `scheduled: true`,
    // so scheduleInfo(undefined)'s "일정" fallback label kept the chip showing
    // forever — SchedulePopover's "스케줄 지우기" button looked like a no-op.
    const s = createMapStore();
    const [, [c]] = rootWithChildren(s, 1);
    s.getState().setScheduleAt(c, '2026-06-15T09:00:00');
    expect(s.getState().doc.nodes[c].scheduled).toBe(true);
    s.getState().setScheduleAt(c, undefined);
    expect(s.getState().doc.nodes[c].scheduled).toBeFalsy();
    expect(s.getState().doc.nodes[c].scheduleAt).toBeUndefined();
  });

  it('setScheduleAt(id, undefined) also detaches a synced reminder', () => {
    const s = createMapStore();
    const [, [c]] = rootWithChildren(s, 1);
    s.getState().setScheduleAt(c, '2026-06-15T09:00:00');
    s.getState().applyReminderPatch(c, { reminderOn: true, reminderId: 'rem-1', reminderSyncedAt: 5 });
    s.getState().setScheduleAt(c, undefined);
    expect(s.getState().doc.nodes[c].reminderOn).toBeFalsy();
    expect(s.getState().doc.nodes[c].reminderId).toBeUndefined();
  });

  it('duplicateNode strips ALL reminder fields (ADR 0016; Closes #6/#10)', () => {
    const s = createMapStore();
    const [, [c]] = rootWithChildren(s, 1);
    s.getState().applyReminderPatch(c, {
      reminderOn: true,
      reminderId: 'rem-1',
      reminderSyncedAt: 5,
      reminderBase: { title: 'x', due: null, done: false },
    });
    s.getState().duplicateNode(c);
    // duplicateNode selects the clone — a reminder-free copy (matches copy/paste)
    const clone = s.getState().doc.nodes[s.getState().selectedId!];
    expect(clone.id).not.toBe(c);
    expect(clone.reminderOn).toBeUndefined();
    expect(clone.reminderId).toBeUndefined();
    expect(clone.reminderSyncedAt).toBeUndefined();
    expect(clone.reminderBase).toBeUndefined();
  });

  it('toggleDone stamps updatedAt for reminder push', () => {
    const s = createMapStore();
    const [, [c]] = rootWithChildren(s, 1);
    expect(s.getState().doc.nodes[c].updatedAt).toBeUndefined();
    s.getState().toggleDone(c);
    expect(typeof s.getState().doc.nodes[c].updatedAt).toBe('number');
  });
});

describe('undo / redo selection consistency (Closes #7)', () => {
  it('keeps selectedIds a subset of the document and consistent with selectedId', () => {
    const s = createMapStore();
    const [, kids] = rootWithChildren(s, 3);
    // multi-select all children, then delete them
    s.getState().select(kids[0]);
    s.getState().toggleSelect(kids[1]);
    s.getState().toggleSelect(kids[2]);
    s.getState().deleteSelected();
    s.getState().undo();
    const { doc, selectedId, selectedIds } = s.getState();
    // invariant: every selected id exists, and selectedId is among them (or all empty)
    for (const id of selectedIds) expect(doc.nodes[id]).toBeDefined();
    if (selectedIds.length) expect(selectedIds).toContain(selectedId);
  });
});

// IF-05 · dead-link GC — deleting a node must signal note-link cleanup so notes
// that link to the (now-gone) node can drop the dead link. Reproduction: today
// deleteNode fires the reminder hook but nothing tells the note side, so notes
// keep chips pointing at deleted nodes.
describe('IF-05 · deleting a node signals note-link cleanup (dead-link GC)', () => {
  it('deleteNode reports the whole removed subtree so linked notes can drop dead links', () => {
    const reported: string[] = [];
    setNoteLinkDeleteHook((_mapId, nodeIds) => reported.push(...nodeIds));
    try {
      const s = createMapStore();
      s.getState().addRoot();
      const root = s.getState().doc.rootIds[0];
      s.getState().addChild(root);
      const child = s.getState().selectedId!;
      s.getState().addChild(child);
      const grandchild = s.getState().selectedId!;

      s.getState().deleteNode(child); // deletes child + grandchild

      expect(reported.sort()).toEqual([child, grandchild].sort());
    } finally {
      setNoteLinkDeleteHook(null);
    }
  });
});

// IF-05 · editing a node's text should signal note-label refresh so linked
// notes update the cached chip label (the link itself keeps working via nodeId).
describe('IF-05 · editing a node text signals note-label refresh', () => {
  it('commitText reports the node id + new text so linked notes refresh the label', () => {
    const events: { mapId: string; nodeId: string; text: string }[] = [];
    setNoteLinkRenameHook((mapId, nodeId, text) => events.push({ mapId, nodeId, text }));
    try {
      const s = createMapStore();
      s.getState().addRoot();
      const root = s.getState().doc.rootIds[0];
      s.getState().commitText(root, '  주간 회의 준비  '); // trimmed on commit
      expect(events.some((e) => e.nodeId === root && e.text === '주간 회의 준비')).toBe(true);
    } finally {
      setNoteLinkRenameHook(null);
    }
  });
});

describe('todo node (decision 0014)', () => {
  it('setTodo(true) marks a plain node as a 할 일 node', () => {
    const s = createMapStore();
    const [root] = rootWithChildren(s, 0);
    expect(s.getState().doc.nodes[root].todo).toBeUndefined();
    s.getState().setTodo(root, true);
    expect(s.getState().doc.nodes[root].todo).toBe(true);
  });

  it('scheduling, capturing, and completing auto-promote to todo', () => {
    const s = createMapStore();
    const [root, [c1, c2]] = rootWithChildren(s, 2);
    s.getState().setScheduleAt(c1, '2026-07-01T09:00:00');
    expect(s.getState().doc.nodes[c1].todo).toBe(true);
    s.getState().toggleDone(c2);
    expect(s.getState().doc.nodes[c2].todo).toBe(true);
    const capId = s.getState().captureScheduled('회의', '2026-07-02T10:00:00');
    expect(s.getState().doc.nodes[capId].todo).toBe(true);
    // plain sibling untouched
    expect(s.getState().doc.nodes[root].todo).toBeUndefined();
  });

  it('setTodo(false) reverts to a plain node and cleans up done/schedule/reminder', () => {
    const removed: string[] = [];
    setReminderDeleteHook((ids) => removed.push(...ids));
    try {
      const s = createMapStore();
      const [root, [c]] = rootWithChildren(s, 1);
      s.getState().setScheduleAt(c, '2026-06-15T09:00:00');
      s.getState().setReminderOn(c, true);
      s.getState().applyReminderPatch(c, { reminderId: 'x-apple://1' });
      s.getState().toggleDone(c);
      expect(s.getState().doc.nodes[c].todo).toBe(true);

      s.getState().setTodo(c, false);
      const n = s.getState().doc.nodes[c];
      expect(n.todo).toBeUndefined();
      expect(n.done).toBeUndefined();
      expect(n.scheduled).toBeUndefined();
      expect(n.scheduleAt).toBeUndefined();
      expect(n.reminderOn).toBeUndefined();
      expect(n.reminderId).toBeUndefined();
      expect(removed).toContain('x-apple://1'); // reminder detached, no orphan
      expect(root).toBeDefined();
    } finally {
      setReminderDeleteHook(null);
    }
  });
});
