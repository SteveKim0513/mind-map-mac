// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { recordCommandUsage, sortByUsage, quickKeyAssignments } from './commandUsage';

describe('commandUsage', () => {
  beforeEach(() => localStorage.clear());

  it('keeps original order when nothing has been used', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(sortByUsage(items).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('ranks more-used commands first, stable on ties', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    recordCommandUsage('c');
    recordCommandUsage('c');
    recordCommandUsage('b');
    expect(sortByUsage(items).map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });

  it('only assigns a quick key once a command clears the usage threshold', () => {
    recordCommandUsage('once');
    const assignments = quickKeyAssignments(['once', 'never-used']);
    expect(assignments.size).toBe(0);
  });

  it('assigns sequential 1-9 slots to the top eligible commands in order', () => {
    recordCommandUsage('a');
    recordCommandUsage('a');
    recordCommandUsage('b');
    recordCommandUsage('b');
    recordCommandUsage('b');
    const ranked = sortByUsage([{ id: 'a' }, { id: 'b' }, { id: 'c' }]).map((i) => i.id);
    const assignments = quickKeyAssignments(ranked);
    expect(assignments.get('b')).toBe(1);
    expect(assignments.get('a')).toBe(2);
    expect(assignments.has('c')).toBe(false);
  });

  it('keeps a command’s digit after another command overtakes it in usage', () => {
    recordCommandUsage('a');
    recordCommandUsage('a');
    recordCommandUsage('b');
    recordCommandUsage('b');
    // tie → original order [a, b] → a=1, b=2
    const first = quickKeyAssignments(sortByUsage([{ id: 'a' }, { id: 'b' }]).map((i) => i.id));
    expect(first.get('a')).toBe(1);
    expect(first.get('b')).toBe(2);

    // b now surges past a in rank…
    recordCommandUsage('b');
    recordCommandUsage('b');
    recordCommandUsage('b');
    const ranked = sortByUsage([{ id: 'a' }, { id: 'b' }]).map((i) => i.id);
    expect(ranked).toEqual(['b', 'a']); // rank flipped
    // …but the earned digits do NOT reshuffle (muscle memory holds).
    const second = quickKeyAssignments(ranked);
    expect(second.get('a')).toBe(1);
    expect(second.get('b')).toBe(2);
  });

  it('gives a newly-qualifying command the next free digit, not an occupied one', () => {
    recordCommandUsage('a');
    recordCommandUsage('a');
    recordCommandUsage('b');
    recordCommandUsage('b');
    quickKeyAssignments(['a', 'b']); // persist a=1, b=2
    // c qualifies later and outranks a/b, but must not steal digit 1.
    recordCommandUsage('c');
    recordCommandUsage('c');
    recordCommandUsage('c');
    const ranked = sortByUsage([{ id: 'a' }, { id: 'b' }, { id: 'c' }]).map((i) => i.id);
    const m = quickKeyAssignments(ranked);
    expect(m.get('a')).toBe(1);
    expect(m.get('b')).toBe(2);
    expect(m.get('c')).toBe(3);
  });

  it('caps assignments at 9 slots', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `cmd${i}`);
    ids.forEach((id) => {
      recordCommandUsage(id);
      recordCommandUsage(id);
    });
    const assignments = quickKeyAssignments(ids);
    expect(assignments.size).toBe(9);
  });
});
