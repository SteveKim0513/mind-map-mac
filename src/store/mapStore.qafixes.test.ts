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

// A1 · duplicateNode must start reminder-free — all 4 reminder fields stripped (ADR 0016).
describe('A1 · duplicate strips all reminder fields', () => {
  it('clone carries none of reminderOn/reminderId/reminderSyncedAt/reminderBase', () => {
    const s = createMapStore();
    const [, [c]] = rootWithChildren(s, 1);
    s.getState().applyReminderPatch(c, {
      reminderOn: true,
      reminderId: 'rem-1',
      reminderSyncedAt: 42,
      reminderBase: { title: 'x', due: null, done: false },
    });
    s.getState().duplicateNode(c);
    const clone = s.getState().doc.nodes[s.getState().selectedId!];
    expect(clone.id).not.toBe(c);
    expect(clone.reminderOn).toBeUndefined();
    expect(clone.reminderId).toBeUndefined();
    expect(clone.reminderSyncedAt).toBeUndefined();
    expect(clone.reminderBase).toBeUndefined();
  });

  it('strips reminder fields deep in the duplicated subtree too', () => {
    const s = createMapStore();
    const [, [c]] = rootWithChildren(s, 1);
    s.getState().addChild(c);
    const grand = s.getState().selectedId!;
    s.getState().commitText(grand, '손자'); // resolve pending edit
    s.getState().applyReminderPatch(grand, { reminderOn: true, reminderId: 'rem-2' });

    s.getState().duplicateNode(c);
    const cloneTop = s.getState().doc.nodes[s.getState().selectedId!];
    const cloneGrand = s.getState().doc.nodes[cloneTop.children[0]];
    expect(cloneGrand.text).toBe('손자');
    expect(cloneGrand.reminderOn).toBeUndefined();
    expect(cloneGrand.reminderId).toBeUndefined();
  });
});

// A2/A3 · copy→paste must preserve todo + durationMin, and still strip reminders.
describe('A2/A3 · copy→paste carries todo + durationMin, strips reminders', () => {
  it('preserves todo and durationMin across a paste', () => {
    const s = createMapStore();
    const [root, [c]] = rootWithChildren(s, 1);
    s.getState().setTodo(c, true);
    s.getState().setScheduleAt(c, '2026-07-01T09:00:00');
    s.getState().setDuration(c, 45);
    s.getState().setReminderOn(c, true);
    s.getState().applyReminderPatch(c, { reminderId: 'rem-9', reminderSyncedAt: 3 });

    s.getState().copyNode(c);
    s.getState().pasteNode(root);
    const pasted = s.getState().doc.nodes[s.getState().selectedId!];

    expect(pasted.id).not.toBe(c);
    expect(pasted.todo).toBe(true);
    expect(pasted.durationMin).toBe(45);
    expect(pasted.scheduleAt).toBe('2026-07-01T09:00:00');
    // never carry reminder identity
    expect(pasted.reminderOn).toBeUndefined();
    expect(pasted.reminderId).toBeUndefined();
    expect(pasted.reminderSyncedAt).toBeUndefined();
    expect(pasted.reminderBase).toBeUndefined();
  });

  it('carries todo + durationMin for nested children too', () => {
    const s = createMapStore();
    const [root, [c]] = rootWithChildren(s, 1);
    s.getState().addChild(c);
    const kid = s.getState().selectedId!;
    s.getState().commitText(kid, '자식');
    s.getState().setTodo(kid, true);
    s.getState().setDuration(kid, 30);

    s.getState().copyNode(c);
    s.getState().pasteNode(root);
    const pastedTop = s.getState().doc.nodes[s.getState().selectedId!];
    const pastedKid = s.getState().doc.nodes[pastedTop.children[0]];
    expect(pastedKid.text).toBe('자식');
    expect(pastedKid.todo).toBe(true);
    expect(pastedKid.durationMin).toBe(30);
  });
});

// A4 · deleting a multi-selection must leave a valid surviving neighbour selected.
describe('A4 · deleteSelected selects a surviving neighbour', () => {
  it('picks a sibling when siblings survive', () => {
    const s = createMapStore();
    const [, kids] = rootWithChildren(s, 4); // k0..k3
    s.getState().select(kids[1]);
    s.getState().toggleSelect(kids[2]);
    s.getState().deleteSelected(); // remove k1, k2
    const { selectedId, doc } = s.getState();
    expect(selectedId).not.toBeNull();
    expect(doc.nodes[selectedId!]).toBeDefined();
    // k3 (forward) or k0 (backward) survives — never null
    expect([kids[0], kids[3]]).toContain(selectedId);
  });

  it('falls back to the parent when all siblings are deleted', () => {
    const s = createMapStore();
    const [root, kids] = rootWithChildren(s, 2);
    s.getState().select(kids[0]);
    s.getState().toggleSelect(kids[1]);
    s.getState().deleteSelected(); // remove both children
    expect(s.getState().selectedId).toBe(root); // parent survives → selected
  });

  it('single-selection delete still leaves something selected', () => {
    const s = createMapStore();
    const [root, [c]] = rootWithChildren(s, 1);
    s.getState().select(c);
    s.getState().deleteSelected();
    expect(s.getState().selectedId).toBe(root);
    expect(s.getState().doc.nodes[root]).toBeDefined();
  });
});

// A6 · undoing a delete restores selection to the deleted node(s), not rootIds[0].
describe('A6 · undo of a delete reselects the deleted nodes', () => {
  it('restores the deleted top-level nodes as the selection', () => {
    const s = createMapStore();
    const [, kids] = rootWithChildren(s, 3);
    s.getState().select(kids[0]);
    s.getState().toggleSelect(kids[1]);
    s.getState().deleteSelected();
    s.getState().undo();
    const { selectedIds, selectedId } = s.getState();
    expect(selectedIds.sort()).toEqual([kids[0], kids[1]].sort());
    expect(selectedIds).toContain(selectedId);
  });

  it('restores a single deleted node (deleteNode path) as the selection', () => {
    const s = createMapStore();
    const [, [c]] = rootWithChildren(s, 1);
    s.getState().commitText(c, '삭제될 노드');
    s.getState().deleteNode(c);
    s.getState().undo();
    expect(s.getState().selectedId).toBe(c);
    expect(s.getState().doc.nodes[c]).toBeDefined();
  });
});

// A7 · collapsing an ancestor of the selection lifts selection to the collapsed node.
describe('A7 · collapse lifts a now-hidden selection to the collapsed node', () => {
  it('moves selection from a hidden descendant up to the collapsed node', () => {
    const s = createMapStore();
    const [root, [c]] = rootWithChildren(s, 1);
    s.getState().addChild(c);
    const grand = s.getState().selectedId!;
    s.getState().commitText(grand, '손자');
    s.getState().select(grand);

    s.getState().toggleCollapse(root); // hides c and grand
    expect(s.getState().selectedId).toBe(root);
    expect(s.getState().selectedIds).toEqual([root]);
  });

  it('leaves selection alone when the selected node is not hidden', () => {
    const s = createMapStore();
    const [root, [c]] = rootWithChildren(s, 1);
    s.getState().addChild(c);
    const grand = s.getState().selectedId!;
    s.getState().commitText(grand, '손자');
    s.getState().select(root); // selecting the node we collapse

    s.getState().toggleCollapse(c); // collapsing c; root is not a descendant of c
    expect(s.getState().selectedId).toBe(root);
  });
});

// B4 · setColorFilter resets the ancestor/descendant expansion toggles.
describe('B4 · setColorFilter resets ancestor/descendant flags', () => {
  it('clearing the filter (null) resets both flags to false', () => {
    const s = createMapStore();
    s.getState().setColorFilter('red');
    s.getState().toggleFilterAncestors();
    s.getState().toggleFilterDescendants();
    expect(s.getState().filterAncestors).toBe(true);
    expect(s.getState().filterDescendants).toBe(true);

    s.getState().setColorFilter(null);
    expect(s.getState().filterAncestors).toBe(false);
    expect(s.getState().filterDescendants).toBe(false);
  });

  it('switching to a different color also resets both flags', () => {
    const s = createMapStore();
    s.getState().setColorFilter('red');
    s.getState().toggleFilterAncestors();
    expect(s.getState().filterAncestors).toBe(true);

    s.getState().setColorFilter('blue');
    expect(s.getState().filterAncestors).toBe(false);
    expect(s.getState().filterDescendants).toBe(false);
  });
});

// E2 · subtree schedule propagates the target's date; no-op when the target has none.
describe('E2 · setScheduled propagates a real date, never a dateless flag', () => {
  it('propagates the target scheduleAt (and todo) to the whole subtree', () => {
    const s = createMapStore();
    const [root, kids] = rootWithChildren(s, 2);
    s.getState().setScheduleAt(root, '2026-08-10T14:00:00');
    s.getState().setScheduled(root, true);
    for (const id of [root, ...kids]) {
      const n = s.getState().doc.nodes[id];
      expect(n.scheduled).toBe(true);
      expect(n.todo).toBe(true);
      expect(n.scheduleAt).toBe('2026-08-10T14:00:00');
    }
  });

  it('is a no-op when the target node has no scheduleAt (no dateless chips)', () => {
    const s = createMapStore();
    const [root, kids] = rootWithChildren(s, 2);
    s.getState().setScheduled(root, true); // target has no date
    for (const id of [root, ...kids]) {
      const n = s.getState().doc.nodes[id];
      expect(n.scheduled).toBeFalsy();
      expect(n.scheduleAt).toBeUndefined();
    }
  });

  it('subtree clear still unschedules the whole subtree', () => {
    const s = createMapStore();
    const [root, kids] = rootWithChildren(s, 2);
    s.getState().setScheduleAt(root, '2026-08-10T14:00:00');
    s.getState().setScheduled(root, true);
    s.getState().setScheduled(root, false);
    for (const id of [root, ...kids]) {
      const n = s.getState().doc.nodes[id];
      expect(n.scheduled).toBeFalsy();
      expect(n.scheduleAt).toBeUndefined();
    }
  });
});

// A5 · node create + first text = ONE undo step (no empty ghost after one ⌘Z).
describe('A5 · create + first text is a single undo step', () => {
  it('one undo after typing text removes the node entirely (no empty ghost)', () => {
    const s = createMapStore();
    const [root] = rootWithChildren(s, 0);
    s.getState().commitText(root, '루트'); // resolve the root's own pending edit
    const before = Object.keys(s.getState().doc.nodes).length;

    s.getState().addChild(root); // create empty child for editing
    const child = s.getState().selectedId!;
    s.getState().commitText(child, '첫 텍스트'); // first text commit
    expect(s.getState().doc.nodes[child].text).toBe('첫 텍스트');

    s.getState().undo(); // ONE undo
    expect(s.getState().doc.nodes[child]).toBeUndefined(); // gone, not an empty ghost
    expect(Object.keys(s.getState().doc.nodes).length).toBe(before);
  });

  it('empty cancel (deleteNode) of a fresh node leaves no history noise', () => {
    const s = createMapStore();
    const [root] = rootWithChildren(s, 0);
    s.getState().commitText(root, '루트');
    const pastLen = s.getState().past.length;

    s.getState().addChild(root); // create empty child
    const child = s.getState().selectedId!;
    s.getState().deleteNode(child); // cancel empty → auto-delete

    expect(s.getState().doc.nodes[child]).toBeUndefined();
    // creation + cancel pushed no history entries
    expect(s.getState().past.length).toBe(pastLen);
  });
});
