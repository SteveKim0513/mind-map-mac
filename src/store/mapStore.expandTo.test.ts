import { describe, it, expect } from 'vitest';
import { createMapStore } from './mapStore';

/** root → child → grandchild; returns their ids. */
function chain(s: ReturnType<typeof createMapStore>) {
  s.getState().addRoot();
  const root = s.getState().doc.rootIds[0];
  s.getState().addChild(root);
  const child = s.getState().selectedId!;
  s.getState().addChild(child);
  const grand = s.getState().selectedId!;
  return { root, child, grand };
}

describe('expandTo', () => {
  it('opens every collapsed ancestor in one undo step', () => {
    const s = createMapStore();
    const { root, child, grand } = chain(s);
    s.getState().toggleCollapse(child);
    s.getState().toggleCollapse(root);
    const before = s.getState().past.length;
    s.getState().expandTo(grand);
    expect(s.getState().doc.nodes[root].collapsed).toBe(false);
    expect(s.getState().doc.nodes[child].collapsed).toBe(false);
    expect(s.getState().past.length).toBe(before + 1);
    s.getState().undo();
    expect(s.getState().doc.nodes[root].collapsed).toBe(true);
    expect(s.getState().doc.nodes[child].collapsed).toBe(true);
  });

  it('is a no-op when nothing above the node is collapsed', () => {
    const s = createMapStore();
    const { grand } = chain(s);
    const before = s.getState().past.length;
    const doc = s.getState().doc;
    s.getState().expandTo(grand);
    expect(s.getState().past.length).toBe(before);
    expect(s.getState().doc).toBe(doc);
  });

  it('works on a read-only (viewer) map, where collapse state is local display', () => {
    const s = createMapStore();
    const { root, grand } = chain(s);
    s.getState().toggleCollapse(root);
    s.getState().setReadOnly(true);
    s.getState().expandTo(grand);
    expect(s.getState().doc.nodes[root].collapsed).toBe(false);
  });
});
