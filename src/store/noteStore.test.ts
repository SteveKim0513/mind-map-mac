import { describe, it, expect } from 'vitest';
import { createNoteStore } from './noteStore';
import { emptyNote } from '../io/noteFormat';

describe('noteStore — dirty flag', () => {
  it('starts clean', () => {
    const s = createNoteStore();
    expect(s.getState().dirty).toBe(false);
    expect(s.getState().filePath).toBeNull();
  });

  it('loadNote clears dirty and sets path', () => {
    const s = createNoteStore();
    s.getState().loadNote(emptyNote('hi'), '/a.md');
    expect(s.getState().dirty).toBe(false);
    expect(s.getState().filePath).toBe('/a.md');
    expect(s.getState().note.title).toBe('hi');
  });

  it('setTitle marks dirty', () => {
    const s = createNoteStore();
    s.getState().loadNote(emptyNote('hello'), '/a.md');
    s.getState().setTitle('world');
    expect(s.getState().dirty).toBe(true);
    expect(s.getState().note.title).toBe('world');
  });

  it('setBody marks dirty', () => {
    const s = createNoteStore();
    s.getState().loadNote(emptyNote(), '/a.md');
    s.getState().setBody('# heading\n\nbody text');
    expect(s.getState().dirty).toBe(true);
    expect(s.getState().note.body).toBe('# heading\n\nbody text');
  });

  it('markSaved clears dirty and updates path (rename case)', () => {
    const s = createNoteStore();
    s.getState().loadNote(emptyNote(), '/old.md');
    s.getState().setTitle('changed');
    expect(s.getState().dirty).toBe(true);
    s.getState().markSaved('/new.md');
    expect(s.getState().dirty).toBe(false);
    expect(s.getState().filePath).toBe('/new.md');
  });

  it('setTitle strips control characters (e.g. a literal backspace from a paste)', () => {
    const s = createNoteStore();
    s.getState().loadNote(emptyNote(), '/a.md');
    s.getState().setTitle('\b시장 리서치 - claude');
    expect(s.getState().note.title).toBe('시장 리서치 - claude');
  });

  it('reloading with loadNote resets dirty even when currently dirty', () => {
    const s = createNoteStore();
    s.getState().loadNote(emptyNote(), '/a.md');
    s.getState().setTitle('unsaved');
    expect(s.getState().dirty).toBe(true);
    s.getState().loadNote(emptyNote('fresh'), '/b.md');
    expect(s.getState().dirty).toBe(false);
    expect(s.getState().note.title).toBe('fresh');
  });
});

describe('noteStore — links', () => {
  it('addLink appends a link and marks dirty', () => {
    const s = createNoteStore();
    s.getState().loadNote(emptyNote(), '/a.md');
    s.getState().addLink({ mapId: 'm1', nodeId: 'n1', nodeText: 'Node A' });
    expect(s.getState().note.links).toHaveLength(1);
    expect(s.getState().dirty).toBe(true);
  });

  it('addLink deduplicates — same mapId+nodeId not added twice', () => {
    const s = createNoteStore();
    s.getState().loadNote(emptyNote(), '/a.md');
    s.getState().addLink({ mapId: 'm1', nodeId: 'n1', nodeText: 'A' });
    s.getState().addLink({ mapId: 'm1', nodeId: 'n1', nodeText: 'A (duplicate)' });
    expect(s.getState().note.links).toHaveLength(1);
  });

  it('addLink allows different nodeId under same mapId', () => {
    const s = createNoteStore();
    s.getState().loadNote(emptyNote(), '/a.md');
    s.getState().addLink({ mapId: 'm1', nodeId: 'n1', nodeText: 'A' });
    s.getState().addLink({ mapId: 'm1', nodeId: 'n2', nodeText: 'B' });
    expect(s.getState().note.links).toHaveLength(2);
  });

  it('removeLink removes only the targeted link', () => {
    const s = createNoteStore();
    s.getState().loadNote(emptyNote(), '/a.md');
    s.getState().addLink({ mapId: 'm1', nodeId: 'n1', nodeText: 'A' });
    s.getState().addLink({ mapId: 'm1', nodeId: 'n2', nodeText: 'B' });
    s.getState().markSaved('/a.md');
    s.getState().removeLink('m1', 'n1');
    expect(s.getState().note.links).toHaveLength(1);
    expect(s.getState().note.links[0].nodeId).toBe('n2');
    expect(s.getState().dirty).toBe(true);
  });

  it('removeLink is a no-op when link does not exist', () => {
    const s = createNoteStore();
    s.getState().loadNote(emptyNote(), '/a.md');
    s.getState().addLink({ mapId: 'm1', nodeId: 'n1', nodeText: 'A' });
    s.getState().markSaved('/a.md');
    s.getState().removeLink('m1', 'NONEXISTENT');
    expect(s.getState().note.links).toHaveLength(1);
    expect(s.getState().dirty).toBe(true); // removeLink always marks dirty
  });
});

describe('noteStore — applySession does NOT mark dirty', () => {
  it('applySession updates session field without triggering autosave', () => {
    const s = createNoteStore();
    s.getState().loadNote(emptyNote(), '/a.md');
    const session = {
      sessionId: 'sess-1',
      link: { mapId: 'm1', nodeId: 'n1', nodeText: 'Node' },
      ancestorIds: [],
      ancestorTexts: [],
      start: Date.now(),
      end: null,
      durationSec: 0,
    };
    s.getState().applySession(session);
    expect(s.getState().dirty).toBe(false);
    expect(s.getState().note.session).toEqual(session);
  });
});
