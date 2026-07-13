import { describe, it, expect } from 'vitest';
import { createMapStore } from './mapStore';

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
  it('setScheduled applies to the node and all descendants', () => {
    const s = createMapStore();
    const [root, kids] = rootWithChildren(s, 2);
    s.getState().setScheduled(root, true);
    expect(s.getState().doc.nodes[root].scheduled).toBe(true);
    for (const k of kids) expect(s.getState().doc.nodes[k].scheduled).toBe(true);
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

  it('duplicateNode does not copy the reminder id (Closes #6/#10)', () => {
    const s = createMapStore();
    const [, [c]] = rootWithChildren(s, 1);
    s.getState().applyReminderPatch(c, { reminderOn: true, reminderId: 'rem-1', reminderSyncedAt: 5 });
    s.getState().duplicateNode(c);
    const clone = Object.values(s.getState().doc.nodes).find(
      (n) => n.id !== c && n.reminderOn,
    );
    expect(clone).toBeDefined();
    expect(clone!.reminderId).toBeUndefined();
    expect(clone!.reminderSyncedAt).toBeUndefined();
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
