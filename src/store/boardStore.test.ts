import { describe, it, expect } from 'vitest';
import { createBoardStore } from './boardStore';
import { emptyBoard } from '../io/boardFormat';
import type { BoardStickyElement, BoardConnectorElement } from '../types';

function sticky(id: string, x = 0, y = 0): BoardStickyElement {
  return { id, kind: 'sticky', x, y, width: 160, height: 160, text: '' };
}

describe('boardStore — dirty flag', () => {
  it('starts clean', () => {
    const s = createBoardStore();
    expect(s.getState().dirty).toBe(false);
    expect(s.getState().filePath).toBeNull();
  });

  it('loadBoard clears dirty, sets path, and clears selection', () => {
    const s = createBoardStore();
    s.getState().setSelection(['x']);
    s.getState().loadBoard(emptyBoard(), '/a.board');
    expect(s.getState().dirty).toBe(false);
    expect(s.getState().filePath).toBe('/a.board');
    expect(s.getState().selection).toEqual([]);
  });

  it('markSaved clears dirty and updates path (rename case)', () => {
    const s = createBoardStore();
    s.getState().loadBoard(emptyBoard(), '/old.board');
    s.getState().addElement(sticky('s1'));
    expect(s.getState().dirty).toBe(true);
    s.getState().markSaved('/new.board');
    expect(s.getState().dirty).toBe(false);
    expect(s.getState().filePath).toBe('/new.board');
  });
});

describe('boardStore — element CRUD', () => {
  it('addElement appends to elements + order, marks dirty, selects it', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    expect(s.getState().board.elements.s1).toBeDefined();
    expect(s.getState().board.order).toEqual(['s1']);
    expect(s.getState().dirty).toBe(true);
    expect(s.getState().selection).toEqual(['s1']);
  });

  it('updateElement merges a patch into the existing element', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    s.getState().updateElement('s1', { text: '아이디어', color: 'yellow' });
    const el = s.getState().board.elements.s1 as BoardStickyElement;
    expect(el.text).toBe('아이디어');
    expect(el.color).toBe('yellow');
  });

  it('updateElement is a no-op for a missing id', () => {
    const s = createBoardStore();
    const before = s.getState().board;
    s.getState().updateElement('missing', { text: 'x' });
    expect(s.getState().board).toBe(before);
    expect(s.getState().dirty).toBe(false);
  });

  it('moveElements shifts x/y for box elements and leaves connectors alone (derived geometry)', () => {
    const s = createBoardStore();
    const conn: BoardConnectorElement = {
      id: 'c1',
      kind: 'connector',
      fromId: 's1',
      fromAnchor: 'right',
      toId: 's2',
      toAnchor: 'left',
    };
    s.getState().addElement(sticky('s1', 5, 5));
    s.getState().addElement(sticky('s2', 100, 5));
    s.getState().addElement(conn);
    s.getState().moveElements(['s1', 'c1'], 3, 4);
    expect(s.getState().board.elements.s1).toMatchObject({ x: 8, y: 9 });
    expect(s.getState().board.elements.c1).toEqual(conn);
  });

  it('removeElements drops from elements/order/selection', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    s.getState().addElement(sticky('s2'));
    s.getState().setSelection(['s1', 's2']);
    s.getState().removeElements(['s1']);
    expect(s.getState().board.elements.s1).toBeUndefined();
    expect(s.getState().board.order).toEqual(['s2']);
    expect(s.getState().selection).toEqual(['s2']);
  });

  it('removeElements cascades to connectors attached to a removed element', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    s.getState().addElement(sticky('s2'));
    s.getState().addElement({
      id: 'c1',
      kind: 'connector',
      fromId: 's1',
      fromAnchor: 'right',
      toId: 's2',
      toAnchor: 'left',
    });
    s.getState().removeElements(['s1']);
    expect(s.getState().board.elements.c1).toBeUndefined();
    expect(s.getState().board.elements.s2).toBeDefined();
    expect(s.getState().board.order).toEqual(['s2']);
  });

  it('addElements adds multiple elements atomically and selects the last one', () => {
    const s = createBoardStore();
    const a = sticky('s1');
    const b = sticky('s2');
    s.getState().addElements([a, b]);
    expect(s.getState().board.order).toEqual(['s1', 's2']);
    expect(s.getState().selection).toEqual(['s2']);
    expect(s.getState().dirty).toBe(true);
  });

  it('bringToFront/sendToBack reorder without changing membership', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    s.getState().addElement(sticky('s2'));
    s.getState().addElement(sticky('s3'));
    s.getState().bringToFront('s1');
    expect(s.getState().board.order).toEqual(['s2', 's3', 's1']);
    s.getState().sendToBack('s3');
    expect(s.getState().board.order).toEqual(['s3', 's2', 's1']);
  });
});

describe('boardStore — selection/filters are not persisted state', () => {
  it('setSelection does NOT mark dirty', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    s.getState().markSaved('/a.board');
    s.getState().setSelection(['s1']);
    expect(s.getState().dirty).toBe(false);
  });

  it('setColorFilter/setShapeFilter do NOT mark dirty', () => {
    const s = createBoardStore();
    s.getState().markSaved('/a.board');
    s.getState().setColorFilter('yellow');
    s.getState().setShapeFilter('ellipse');
    expect(s.getState().dirty).toBe(false);
    expect(s.getState().colorFilter).toBe('yellow');
    expect(s.getState().shapeFilter).toBe('ellipse');
  });

  it('loadBoard resets colorFilter/shapeFilter', () => {
    const s = createBoardStore();
    s.getState().setColorFilter('yellow');
    s.getState().setShapeFilter('ellipse');
    s.getState().loadBoard(emptyBoard(), '/a.board');
    expect(s.getState().colorFilter).toBeNull();
    expect(s.getState().shapeFilter).toBeNull();
  });
});

describe('boardStore — view', () => {
  it('setView merges into board.view and marks dirty', () => {
    const s = createBoardStore();
    s.getState().markSaved('/a.board');
    s.getState().setView({ zoom: 2 });
    expect(s.getState().board.view).toEqual({ zoom: 2, panX: 0, panY: 0 });
    expect(s.getState().dirty).toBe(true);
  });
});
