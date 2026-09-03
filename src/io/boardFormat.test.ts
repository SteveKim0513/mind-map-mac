import { describe, it, expect } from 'vitest';
import { emptyBoard, serializeBoard, parseBoard } from './boardFormat';
import type { BoardDoc, BoardStickyElement, BoardConnectorElement } from '../types';

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
