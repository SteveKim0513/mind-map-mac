import { describe, it, expect } from 'vitest';
import { emptyBoard, serializeBoard, parseBoard, boardNoteRef } from './boardFormat';
import type { BoardDoc, BoardStickyElement, BoardConnectorElement, BoardImageElement } from '../types';

describe('boardFormat round-trip', () => {
  it('round-trips an empty board', () => {
    const doc = emptyBoard();
    const back = parseBoard(serializeBoard(doc));
    expect(back).toEqual(doc);
  });

  it('round-trips elements and z-order', () => {
    const doc = emptyBoard();
    const sticky: BoardStickyElement = {
      id: 's1',
      kind: 'sticky',
      x: 10,
      y: 20,
      width: 160,
      height: 160,
      text: '아이디어',
      color: 'yellow',
    };
    const connector: BoardConnectorElement = {
      id: 'c1',
      kind: 'connector',
      fromId: 's1',
      fromAnchor: 'right',
      toId: 's1', // self-reference is fine for a serialization round-trip test
      toAnchor: 'left',
      arrow: true,
    };
    doc.elements = { s1: sticky, c1: connector };
    doc.order = ['s1', 'c1'];
    const back = parseBoard(serializeBoard(doc));
    expect(back.elements).toEqual(doc.elements);
    expect(back.order).toEqual(['s1', 'c1']);
  });

  it('throws a Korean error message on corrupt JSON', () => {
    expect(() => parseBoard('{not json')).toThrow('손상된 보드');
  });

  it('throws on structurally invalid content', () => {
    expect(() => parseBoard(JSON.stringify({ foo: 'bar' }))).toThrow('Invalid .board file');
  });

  it('backfills missing id and view on load', () => {
    const raw: Partial<BoardDoc> = { version: 1, elements: {}, order: [] };
    const back = parseBoard(JSON.stringify(raw));
    expect(back.id).toBeTruthy();
    expect(back.view).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });

  it('drops order entries whose element is missing (hand-edited file)', () => {
    const raw = { version: 1, elements: {}, order: ['ghost'] };
    const back = parseBoard(JSON.stringify(raw));
    expect(back.order).toEqual([]);
  });

  it('appends elements missing from order (hand-edited file)', () => {
    const sticky: BoardStickyElement = {
      id: 's1',
      kind: 'sticky',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      text: 'x',
    };
    const raw = { version: 1, elements: { s1: sticky }, order: [] };
    const back = parseBoard(JSON.stringify(raw));
    expect(back.order).toEqual(['s1']);
  });
});

describe('boardFormat — 노트 링크 noteId (ADR 0022, version 무범프 선택 필드)', () => {
  const sticky = (noteLink: unknown): BoardStickyElement =>
    ({ id: 's1', kind: 'sticky', x: 0, y: 0, width: 160, height: 160, text: '카드', noteLink }) as BoardStickyElement;
  const withEl = (el: BoardStickyElement | BoardImageElement) => {
    const doc = emptyBoard();
    doc.elements = { [el.id]: el };
    doc.order = [el.id];
    return doc;
  };

  it('noteId·notePath·title이 왕복하고 version은 1 그대로다', () => {
    const doc = withEl(sticky({ notePath: '/ws/a.md', noteId: 'note-1', title: 'A' }));
    const back = parseBoard(serializeBoard(doc));
    expect(back.version).toBe(1);
    expect((back.elements.s1 as BoardStickyElement).noteLink).toEqual({ notePath: '/ws/a.md', noteId: 'note-1', title: 'A' });
  });

  it('공유 사본 모양({noteId,title}, notePath 없음)도 그대로 왕복한다', () => {
    const doc = withEl(sticky({ noteId: 'note-1', title: 'A' }));
    expect((parseBoard(serializeBoard(doc)).elements.s1 as BoardStickyElement).noteLink).toEqual({ noteId: 'note-1', title: 'A' });
  });

  it('옛 보드(noteId 없음)는 파싱해도 노트 링크가 바뀌지 않고, 직렬화하면 바이트가 같다', () => {
    const doc = withEl(sticky({ notePath: '/ws/a.md', title: 'A' }));
    const text = serializeBoard(doc);
    const back = parseBoard(text);
    expect((back.elements.s1 as BoardStickyElement).noteLink).toEqual({ notePath: '/ws/a.md', title: 'A' });
    expect(serializeBoard(back)).toBe(text);
  });

  it('형식이 틀린 noteId는 그 값만 버린다(notePath 폴백·title 유지)', () => {
    for (const bad of ['../x', '/abs', '.hidden', 'a b', 'x'.repeat(200), '', 5, null]) {
      const text = JSON.stringify(withEl(sticky({ notePath: '/ws/a.md', noteId: bad, title: 'A' })));
      const back = parseBoard(text);
      expect((back.elements.s1 as BoardStickyElement).noteLink).toEqual({ notePath: '/ws/a.md', title: 'A' });
    }
  });

  it('이미지 요소의 noteId도 검증·보존한다', () => {
    const img = (noteLink: unknown): BoardImageElement => ({ id: 'i1', kind: 'image', x: 0, y: 0, width: 10, height: 10, src: 'a.png', noteLink }) as BoardImageElement;
    expect((parseBoard(serializeBoard(withEl(img({ noteId: 'n-1' })))).elements.i1 as BoardImageElement).noteLink).toEqual({ noteId: 'n-1' });
    expect((parseBoard(JSON.stringify(withEl(img({ noteId: '../x', notePath: '/a.md' })))).elements.i1 as BoardImageElement).noteLink).toEqual({ notePath: '/a.md' });
  });

  it('boardNoteRef: 유효한 id만 함께 저장하고 그 밖에는 경로만 저장한다', () => {
    expect(boardNoteRef('/ws/a.md', 'A', 'note-1')).toEqual({ notePath: '/ws/a.md', noteId: 'note-1', title: 'A' });
    expect(boardNoteRef('/ws/a.md', 'A')).toEqual({ notePath: '/ws/a.md', title: 'A' });
    expect(boardNoteRef('/ws/a.md', 'A', '../x')).toEqual({ notePath: '/ws/a.md', title: 'A' });
    expect('noteId' in boardNoteRef('/ws/a.md', 'A', '')).toBe(false);
  });
});
