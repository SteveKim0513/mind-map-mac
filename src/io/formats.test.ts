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
  return { version: 1, rootIds, nodes, view: { zoom: 1, panX: 0, panY: 0 } };
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
          scheduled: true,
          scheduleAt: '2026-06-15T09:00:00',
          reminderOn: true,
          reminderId: 'x-apple://1',
        },
        b: { id: 'b', text: 'child', parentId: 'a', children: [], collapsed: false, done: true },
      },
      ['a'],
    );
    const back = deserialize(serialize(doc));
    expect(back).toEqual(doc);
    // the new fields survive the round-trip
    expect(back.nodes.a.reminderId).toBe('x-apple://1');
    expect(back.nodes.a.scheduleAt).toBe('2026-06-15T09:00:00');
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
