import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspace } from './workspaceStore';
import type { BoardMeta } from '../types';

// boardIndex reverse-link selectors (2026-09-07) — "which board(s) reference
// this node/note", the mirror of BoardStickyElement.nodeLink/noteLink. Set the
// index directly (bypassing refresh()/window.api) since these selectors are
// pure filters over it — same pattern as sessionStore.test.ts's setState reset.

function reset() {
  useWorkspace.setState({ boardIndex: [] });
}

describe('workspaceStore — boardsForNode / boardsForNote', () => {
  beforeEach(reset);

  it('finds a board whose sticky links to the given node', () => {
    const meta: BoardMeta = {
      path: '/b1.board',
      nodeLinks: [{ stickyId: 's1', link: { mapId: 'm1', nodeId: 'n1' } }],
      noteLinks: [],
    };
    useWorkspace.setState({ boardIndex: [meta] });
    expect(useWorkspace.getState().boardsForNode('m1', 'n1')).toEqual([meta]);
    expect(useWorkspace.getState().boardsForNode('m1', 'other')).toEqual([]);
    expect(useWorkspace.getState().boardsForNode('other-map', 'n1')).toEqual([]);
  });

  it('finds a board whose sticky links to the given note path', () => {
    const meta: BoardMeta = {
      path: '/b1.board',
      nodeLinks: [],
      noteLinks: [{ stickyId: 's1', notePath: '/notes/a.md' }],
    };
    useWorkspace.setState({ boardIndex: [meta] });
    expect(useWorkspace.getState().boardsForNote('/notes/a.md')).toEqual([meta]);
    expect(useWorkspace.getState().boardsForNote('/notes/other.md')).toEqual([]);
  });

  it('a board can appear for more than one distinct sticky link', () => {
    const meta: BoardMeta = {
      path: '/b1.board',
      nodeLinks: [
        { stickyId: 's1', link: { mapId: 'm1', nodeId: 'n1' } },
        { stickyId: 's2', link: { mapId: 'm1', nodeId: 'n2' } },
      ],
      noteLinks: [],
    };
    useWorkspace.setState({ boardIndex: [meta] });
    expect(useWorkspace.getState().boardsForNode('m1', 'n1')).toEqual([meta]);
    expect(useWorkspace.getState().boardsForNode('m1', 'n2')).toEqual([meta]);
  });

  it('reindexBoard upserts by path (replaces, not appends)', () => {
    const v1: BoardMeta = { path: '/b1.board', nodeLinks: [{ stickyId: 's1', link: { mapId: 'm1', nodeId: 'n1' } }], noteLinks: [] };
    const v2: BoardMeta = { path: '/b1.board', nodeLinks: [], noteLinks: [] }; // link removed, then re-saved
    useWorkspace.getState().reindexBoard(v1);
    expect(useWorkspace.getState().boardsForNode('m1', 'n1')).toEqual([v1]);
    useWorkspace.getState().reindexBoard(v2);
    expect(useWorkspace.getState().boardIndex).toEqual([v2]);
    expect(useWorkspace.getState().boardsForNode('m1', 'n1')).toEqual([]);
  });

  it('reindexBoard leaves other boards untouched', () => {
    const a: BoardMeta = { path: '/a.board', nodeLinks: [{ stickyId: 's1', link: { mapId: 'm1', nodeId: 'n1' } }], noteLinks: [] };
    const b: BoardMeta = { path: '/b.board', nodeLinks: [{ stickyId: 's2', link: { mapId: 'm1', nodeId: 'n2' } }], noteLinks: [] };
    useWorkspace.setState({ boardIndex: [a] });
    useWorkspace.getState().reindexBoard(b);
    expect(useWorkspace.getState().boardIndex).toEqual([a, b]);
  });
});
