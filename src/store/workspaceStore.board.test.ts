import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspace, boardNoteLinkEntry, linkedNotePath } from './workspaceStore';
import type { BoardMeta, NoteMeta } from '../types';

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

// 노트 링크는 id 우선(ADR 0022) — 이름 변경·이동 뒤에도 "보드에서 참조됨"이 맞고, 옛 링크(경로만)는 이전과 같다.
describe('workspaceStore — 노트 id 링크 (ADR 0022)', () => {
  const note = (id: string, path: string): NoteMeta => ({ id, path, title: id, links: [] });

  beforeEach(() => useWorkspace.setState({ boardIndex: [], noteIndex: [] }));

  it('boardNoteLinkEntry는 id와 옛 경로를 함께 싣고, 없는 쪽은 키를 만들지 않는다', () => {
    expect(boardNoteLinkEntry('s1', { notePath: '/a.md', noteId: 'n1', title: 'A' })).toEqual({ stickyId: 's1', notePath: '/a.md', noteId: 'n1' });
    expect(boardNoteLinkEntry('s1', { notePath: '/a.md' })).toEqual({ stickyId: 's1', notePath: '/a.md' });
    expect(boardNoteLinkEntry('s1', { noteId: 'n1' })).toEqual({ stickyId: 's1', noteId: 'n1' });
  });

  it('noteById는 로컬 노트 인덱스에서만 찾는다', () => {
    useWorkspace.setState({ noteIndex: [note('n1', '/ws/a.md')] });
    expect(useWorkspace.getState().noteById('n1')?.path).toBe('/ws/a.md');
    expect(useWorkspace.getState().noteById('nope')).toBeUndefined();
  });

  it('linkedNotePath: id → 현재 경로, 없으면 옛 경로, 둘 다 없으면 null', () => {
    const idx = [note('n1', '/ws/새이름.md')];
    expect(linkedNotePath(idx, { noteId: 'n1', notePath: '/ws/옛이름.md' })).toBe('/ws/새이름.md');
    expect(linkedNotePath(idx, { noteId: 'ghost', notePath: '/ws/옛이름.md' })).toBe('/ws/옛이름.md');
    expect(linkedNotePath(idx, { notePath: '/ws/x.md' })).toBe('/ws/x.md');
    expect(linkedNotePath(idx, { noteId: 'ghost' })).toBeNull();
  });

  it('boardsForNote: 노트 이름을 바꾼 뒤에도 id 링크는 새 경로로 찾히고, 옛 경로로는 안 찾힌다', () => {
    const meta: BoardMeta = { path: '/b.board', nodeLinks: [], noteLinks: [{ stickyId: 's1', notePath: '/ws/옛이름.md', noteId: 'n1' }] };
    useWorkspace.setState({ boardIndex: [meta], noteIndex: [note('n1', '/ws/새이름.md')] });
    expect(useWorkspace.getState().boardsForNote('/ws/새이름.md')).toEqual([meta]);
    expect(useWorkspace.getState().boardsForNote('/ws/옛이름.md')).toEqual([]);
  });

  it('boardsForNote: 공유 참가자의 사본(noteId만)도 로컬 경로로 찾힌다', () => {
    const meta: BoardMeta = { path: '/b.board', nodeLinks: [], noteLinks: [{ stickyId: 's1', noteId: 'n1' }] };
    useWorkspace.setState({ boardIndex: [meta], noteIndex: [note('n1', '/ws/기획/회의.md')] });
    expect(useWorkspace.getState().boardsForNote('/ws/기획/회의.md')).toEqual([meta]);
  });

  it('boardsForNote: 옛 링크(noteId 없음)는 이전과 똑같이 경로로만 찾는다', () => {
    const meta: BoardMeta = { path: '/b.board', nodeLinks: [], noteLinks: [{ stickyId: 's1', notePath: '/ws/a.md' }] };
    useWorkspace.setState({ boardIndex: [meta], noteIndex: [note('n9', '/ws/a.md')] });
    expect(useWorkspace.getState().boardsForNote('/ws/a.md')).toEqual([meta]);
  });
});
