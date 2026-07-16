import { describe, it, expect } from 'vitest';
import {
  serialize,
  deserialize,
  toMarkdown,
  fromMarkdown,
  emptyDoc,
} from './formats';
import type { MindMapDoc } from '../types';

function docWith(nodes: MindMapDoc['nodes'], rootIds: string[]): MindMapDoc {
  // a fixed id keeps round-trip equality exact (deserialize backfills one if missing)
  return { version: 1, id: 'doc-test', rootIds, nodes, view: { zoom: 1, panX: 0, panY: 0 } };
}

describe('serialize / deserialize', () => {
  it('round-trips a document including schedule/reminder fields', () => {
    const doc = docWith(
      {
        a: {
          id: 'a',
          text: 'root',
          parentId: null,
          children: ['b'],
          collapsed: false,
          todo: true, // execution state ⇒ 할 일 node (decision 0014); explicit so round-trip equals
          scheduled: true,
          scheduleAt: '2026-06-15T09:00:00',
          reminderOn: true,
          reminderId: 'x-apple://1',
        },
        b: { id: 'b', text: 'child', parentId: 'a', children: [], collapsed: false, todo: true, done: true },
      },
      ['a'],
    );
    const back = deserialize(serialize(doc));
    expect(back).toEqual(doc);
    // the new fields survive the round-trip
    expect(back.nodes.a.reminderId).toBe('x-apple://1');
    expect(back.nodes.a.scheduleAt).toBe('2026-06-15T09:00:00');
  });

  it('round-trips durationMin without bumping the schema version (decision 0012)', () => {
    const doc = docWith(
      {
        a: {
          id: 'a',
          text: 'time-blocked',
          parentId: null,
          children: [],
          collapsed: false,
          scheduled: true,
          scheduleAt: '2026-06-15T09:00:00',
          durationMin: 90,
        },
      },
      ['a'],
    );
    const back = deserialize(serialize(doc));
    expect(back.nodes.a.durationMin).toBe(90);
    expect(back.version).toBe(1); // additive optional field — no migration, version stays 1
  });

  it('backfills todo on legacy nodes that carry an execution state (decision 0014)', () => {
    const raw = JSON.stringify({
      version: 1,
      rootIds: ['a', 'b', 'c', 'd'],
      nodes: {
        a: { id: 'a', text: 'done', parentId: null, children: [], collapsed: false, done: true },
        b: { id: 'b', text: 'sched', parentId: null, children: [], collapsed: false, scheduled: true, scheduleAt: '2026-06-15T09:00:00' },
        c: { id: 'c', text: 'remind', parentId: null, children: [], collapsed: false, reminderOn: true },
        d: { id: 'd', text: 'plain thought', parentId: null, children: [], collapsed: false },
      },
    });
    const doc = deserialize(raw);
    expect(doc.nodes.a.todo).toBe(true); // had done → todo
    expect(doc.nodes.b.todo).toBe(true); // had schedule → todo
    expect(doc.nodes.c.todo).toBe(true); // had reminder → todo
    expect(doc.nodes.d.todo).toBeUndefined(); // pure thought stays a plain node
  });

  it('leaves an explicit todo flag untouched on load', () => {
    const raw = JSON.stringify({
      version: 1,
      rootIds: ['a'],
      nodes: { a: { id: 'a', text: 'x', parentId: null, children: [], collapsed: false, todo: true } },
    });
    expect(deserialize(raw).nodes.a.todo).toBe(true);
  });

  it('loads a legacy doc that predates durationMin (field simply absent)', () => {
    const raw = JSON.stringify({
      version: 1,
      rootIds: ['a'],
      nodes: { a: { id: 'a', text: 'old', parentId: null, children: [], collapsed: false } },
    });
    const doc = deserialize(raw);
    expect(doc.nodes.a.durationMin).toBeUndefined();
    expect(doc.version).toBe(1);
  });

  it('throws a clear error on corrupt JSON instead of leaking a SyntaxError', () => {
    expect(() => deserialize('{ not valid json')).toThrow(/손상된/);
  });

  it('rejects JSON that is missing required fields', () => {
    expect(() => deserialize('{}')).toThrow(/Invalid/);
    expect(() => deserialize('null')).toThrow();
  });

  it('backfills children/collapsed defaults on legacy nodes', () => {
    const raw = JSON.stringify({
      version: 1,
      rootIds: ['a'],
      nodes: { a: { id: 'a', text: 'x', parentId: null } },
    });
    const doc = deserialize(raw);
    expect(doc.nodes.a.children).toEqual([]);
    expect(doc.nodes.a.collapsed).toBe(false);
  });
});

describe('markdown round-trip', () => {
  it('preserves the tree text structure', () => {
    const doc = docWith(
      {
        a: { id: 'a', text: 'Root', parentId: null, children: ['b'], collapsed: false },
        b: { id: 'b', text: 'Child', parentId: 'a', children: [], collapsed: false },
      },
      ['a'],
    );
    const back = fromMarkdown(toMarkdown(doc));
    const roots = back.rootIds.map((id) => back.nodes[id]);
    expect(roots).toHaveLength(1);
    expect(roots[0].text).toBe('Root');
    const child = back.nodes[roots[0].children[0]];
    expect(child.text).toBe('Child');
  });

  it('returns an empty doc for non-bullet markdown', () => {
    const back = fromMarkdown('# Heading\n\nsome paragraph text');
    expect(back.rootIds).toEqual(emptyDoc().rootIds);
  });
});
