// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useSession } from './sessionStore';

// Regression guard for the delete race: trashItem succeeds but a debounced
// autosave recreates the file. beginDelete()/isDeleting() lets the autosave
// skip a path that's mid-trash (Pane.tsx / NotePane.tsx check it).
describe('useSession deletingPaths', () => {
  beforeEach(() => useSession.setState({ deletingPaths: new Set() }));

  it('isDeleting() is true for the exact path being deleted', () => {
    useSession.getState().beginDelete('/ws/a.mind');
    expect(useSession.getState().isDeleting('/ws/a.mind')).toBe(true);
  });

  it('guards children when a folder is deleted', () => {
    useSession.getState().beginDelete('/ws/folder');
    expect(useSession.getState().isDeleting('/ws/folder/child.mind')).toBe(true);
  });

  it('does not over-match a sibling with a shared prefix', () => {
    useSession.getState().beginDelete('/ws/a.mind');
    expect(useSession.getState().isDeleting('/ws/ab.mind')).toBe(false);
  });

  it('endDelete() resumes autosave (failure / undo path)', () => {
    useSession.getState().beginDelete('/ws/a.mind');
    useSession.getState().endDelete('/ws/a.mind');
    expect(useSession.getState().isDeleting('/ws/a.mind')).toBe(false);
  });
});
