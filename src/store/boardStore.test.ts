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
    s.getState().bringToFront(['s1']);
    expect(s.getState().board.order).toEqual(['s2', 's3', 's1']);
    s.getState().sendToBack(['s3']);
    expect(s.getState().board.order).toEqual(['s3', 's2', 's1']);
  });

  it('bringToFront/sendToBack accept multiple ids and preserve their relative order among themselves', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    s.getState().addElement(sticky('s2'));
    s.getState().addElement(sticky('s3'));
    s.getState().addElement(sticky('s4'));
    // s1, s2 currently precede s3, s4 in order — bring [s2, s1] to front,
    // passed in reverse order, and expect them to land in their EXISTING
    // relative order (s1 before s2), not the order passed in.
    s.getState().bringToFront(['s2', 's1']);
    expect(s.getState().board.order).toEqual(['s3', 's4', 's1', 's2']);
    s.getState().sendToBack(['s4', 's3']);
    expect(s.getState().board.order).toEqual(['s3', 's4', 's1', 's2']);
  });

  it('bringToFront/sendToBack with ids not in board.order is a no-op', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    const before = s.getState().board;
    s.getState().bringToFront(['missing']);
    expect(s.getState().board).toBe(before);
    s.getState().sendToBack([]);
    expect(s.getState().board).toBe(before);
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

describe('boardStore — undo/redo', () => {
  it('undo reverts a one-shot mutation (addElement)', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    s.getState().undo();
    expect(s.getState().board.elements.s1).toBeUndefined();
    expect(s.getState().board.order).toEqual([]);
  });

  it('redo re-applies an undone mutation', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    s.getState().undo();
    s.getState().redo();
    expect(s.getState().board.elements.s1).toBeDefined();
  });

  it('undo restores a deleted element and reselects it (mirrors mapStore A6)', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    s.getState().removeElements(['s1']);
    expect(s.getState().board.elements.s1).toBeUndefined();
    s.getState().undo();
    expect(s.getState().board.elements.s1).toBeDefined();
    expect(s.getState().selection).toEqual(['s1']);
  });

  it('undo with empty history is a no-op', () => {
    const s = createBoardStore();
    const before = s.getState().board;
    s.getState().undo();
    expect(s.getState().board).toBe(before);
  });

  it('a whole drag gesture (beginTransaction + many moveElements + endTransaction) undoes in ONE step', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1', 0, 0));
    // simulates ~20 pointermove frames of a real drag
    s.getState().beginTransaction();
    for (let i = 0; i < 20; i++) s.getState().moveElements(['s1'], 1, 1);
    s.getState().endTransaction();
    const el = s.getState().board.elements.s1 as BoardStickyElement;
    expect(el.x).toBe(20);
    expect(el.y).toBe(20);
    expect(s.getState().past.length).toBe(2); // addElement, then the whole drag as one entry
    s.getState().undo();
    const back = s.getState().board.elements.s1 as BoardStickyElement;
    expect(back.x).toBe(0);
    expect(back.y).toBe(0);
  });

  it('a click with no movement (beginTransaction immediately followed by endTransaction) pushes no history', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    const pastAfterAdd = s.getState().past.length;
    s.getState().beginTransaction();
    s.getState().endTransaction(); // no moveElements/updateElement call in between — nothing changed
    expect(s.getState().past.length).toBe(pastAfterAdd);
  });

  it('mutations during a transaction (beginTransaction..endTransaction) push no per-call history', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    s.getState().beginTransaction();
    s.getState().moveElements(['s1'], 5, 5);
    s.getState().moveElements(['s1'], 5, 5);
    expect(s.getState().past.length).toBe(1); // still just the addElement entry
    s.getState().endTransaction();
    expect(s.getState().past.length).toBe(2); // endTransaction adds exactly one more
  });

  it('a one-shot action after undo clears redo history', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    s.getState().addElement(sticky('s2'));
    s.getState().undo();
    expect(s.getState().future.length).toBe(1);
    s.getState().addElement(sticky('s3'));
    expect(s.getState().future.length).toBe(0);
  });

  it('a whole text-edit session (beginTransaction + per-keystroke updateElement + endTransaction) undoes in ONE step — not one per keystroke', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    const pastAfterAdd = s.getState().past.length;
    s.getState().beginTransaction();
    // simulates typing "hi" — a controlled <textarea>'s onChange fires per keystroke
    for (const partial of ['h', 'hi']) s.getState().updateElement('s1', { text: partial });
    expect(s.getState().past.length).toBe(pastAfterAdd); // no per-keystroke history push
    s.getState().endTransaction();
    expect(s.getState().past.length).toBe(pastAfterAdd + 1); // exactly one entry for the whole session
    expect((s.getState().board.elements.s1 as BoardStickyElement).text).toBe('hi');
    s.getState().undo();
    expect((s.getState().board.elements.s1 as BoardStickyElement).text).toBe(''); // back to pre-edit, in one step
  });

  it('cancelTransaction reverts to the pre-edit text and pushes no history (Escape-to-cancel)', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    s.getState().updateElement('s1', { text: '원본' });
    const pastBefore = s.getState().past.length;
    s.getState().beginTransaction();
    s.getState().updateElement('s1', { text: '원본 수정중' });
    expect((s.getState().board.elements.s1 as BoardStickyElement).text).toBe('원본 수정중');
    s.getState().cancelTransaction();
    expect((s.getState().board.elements.s1 as BoardStickyElement).text).toBe('원본');
    expect(s.getState().past.length).toBe(pastBefore); // no history entry from the cancelled edit
    expect(s.getState().future.length).toBe(0);
  });

  it('cancelTransaction with no open transaction is a no-op', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    const before = s.getState().board;
    s.getState().cancelTransaction();
    expect(s.getState().board).toBe(before);
  });

  it('endTransaction after cancelTransaction is a harmless no-op (Escape then blur both fire)', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    s.getState().updateElement('s1', { text: '원본' });
    const pastBefore = s.getState().past.length;
    s.getState().beginTransaction();
    s.getState().updateElement('s1', { text: '수정중' });
    s.getState().cancelTransaction();
    s.getState().endTransaction(); // the textarea's onBlur still fires after Escape's programmatic blur()
    expect(s.getState().past.length).toBe(pastBefore);
    expect((s.getState().board.elements.s1 as BoardStickyElement).text).toBe('원본');
  });
});

describe('boardStore — clipboard (copyElements/pasteElements)', () => {
  // NOTE: the clipboard is a module-level variable (mirrors mapStore's `let
  // clipboard`), so it persists across `it()` blocks within this file. This
  // no-op test relies on running BEFORE any other test in this describe
  // populates it — keep it first.
  it('copyElements on an empty selection is a no-op — pasteElements has nothing to do yet', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    s.getState().setSelection([]);
    s.getState().copyElements();
    expect(s.getState().hasClipboard()).toBe(false);
    const before = s.getState().board;
    s.getState().pasteElements();
    expect(s.getState().board).toBe(before);
  });

  it('copyElements + pasteElements pastes a fresh id, never reusing the copied one', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    s.getState().setSelection(['s1']);
    s.getState().copyElements();
    s.getState().pasteElements();
    const ids = s.getState().board.order;
    expect(ids.length).toBe(2);
    const pastedId = ids.find((id) => id !== 's1')!;
    expect(pastedId).toBeDefined();
    expect(pastedId).not.toBe('s1');
    expect((s.getState().board.elements[pastedId] as BoardStickyElement).text).toBe('');
  });

  it('pasteElements offsets the pasted copy from the original position, accumulating on repeated pastes', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1', 10, 10));
    s.getState().setSelection(['s1']);
    s.getState().copyElements();
    s.getState().pasteElements();
    const firstPastedId = s.getState().selection[0];
    const first = s.getState().board.elements[firstPastedId] as BoardStickyElement;
    expect(first.x).toBe(30); // 10 + 20
    expect(first.y).toBe(30);
    s.getState().pasteElements(); // same clipboard, second consecutive paste
    const secondPastedId = s.getState().selection[0];
    const second = s.getState().board.elements[secondPastedId] as BoardStickyElement;
    expect(second.x).toBe(50); // 10 + 40 — offset accumulates so copies don't stack
    expect(second.y).toBe(50);
  });

  it('copyElements includes a connector only when BOTH endpoints are selected, and pasteElements remaps its fromId/toId to the new pasted ids', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1', 0, 0));
    s.getState().addElement(sticky('s2', 100, 0));
    s.getState().addElement({
      id: 'c1',
      kind: 'connector',
      fromId: 's1',
      fromAnchor: 'right',
      toId: 's2',
      toAnchor: 'left',
    });
    s.getState().setSelection(['s1', 's2']); // connector not directly selected, but both endpoints are
    s.getState().copyElements();
    s.getState().pasteElements();
    const pastedIds = s.getState().selection;
    expect(pastedIds.length).toBe(3); // 2 stickies + the connector between them
    const pastedConn = pastedIds
      .map((id) => s.getState().board.elements[id])
      .find((el): el is BoardConnectorElement => el.kind === 'connector')!;
    expect(pastedConn).toBeDefined();
    expect(pastedConn.fromId).not.toBe('s1');
    expect(pastedConn.toId).not.toBe('s2');
    expect(pastedIds).toContain(pastedConn.fromId);
    expect(pastedIds).toContain(pastedConn.toId);
  });

  it('copyElements excludes a connector when only one endpoint is selected', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1', 0, 0));
    s.getState().addElement(sticky('s2', 100, 0));
    s.getState().addElement({
      id: 'c1',
      kind: 'connector',
      fromId: 's1',
      fromAnchor: 'right',
      toId: 's2',
      toAnchor: 'left',
    });
    s.getState().setSelection(['s1']); // only one endpoint selected
    s.getState().copyElements();
    s.getState().pasteElements();
    const pastedIds = s.getState().selection;
    expect(pastedIds.length).toBe(1); // just the pasted sticky, no dangling connector
    expect(s.getState().board.elements[pastedIds[0]].kind).toBe('sticky');
  });

  it('undo removes a pasted element (paste is one undo step, like addElements)', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    s.getState().setSelection(['s1']);
    s.getState().copyElements();
    s.getState().pasteElements();
    expect(s.getState().board.order.length).toBe(2);
    s.getState().undo();
    expect(s.getState().board.order).toEqual(['s1']);
  });
});

describe('boardStore — cutElements (⌘/Ctrl+X)', () => {
  it('cutElements copies the selection into the clipboard AND removes it, in one undo step', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    s.getState().addElement(sticky('s2'));
    s.getState().setSelection(['s1']);
    const pastBefore = s.getState().past.length;
    s.getState().cutElements();
    expect(s.getState().board.elements.s1).toBeUndefined();
    expect(s.getState().board.order).toEqual(['s2']);
    expect(s.getState().past.length).toBe(pastBefore + 1); // one history entry, not two
    expect(s.getState().hasClipboard()).toBe(true);
    s.getState().pasteElements();
    // pasted copy carries the cut element's text — proves the clipboard got it
    const pastedId = s.getState().selection[0];
    expect((s.getState().board.elements[pastedId] as BoardStickyElement).text).toBe('');
    expect(s.getState().board.order).toContain(pastedId);
  });

  it('cutElements on an empty selection is a no-op', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    s.getState().setSelection([]);
    const before = s.getState().board;
    s.getState().cutElements();
    expect(s.getState().board).toBe(before);
  });

  it('undo restores the cut element (single step)', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    s.getState().setSelection(['s1']);
    s.getState().cutElements();
    expect(s.getState().board.elements.s1).toBeUndefined();
    s.getState().undo();
    expect(s.getState().board.elements.s1).toBeDefined();
  });
});

describe('boardStore — selectAll (⌘/Ctrl+A)', () => {
  it('selects every sticky/image but excludes connectors', () => {
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
    s.getState().setSelection([]);
    s.getState().selectAll();
    expect(new Set(s.getState().selection)).toEqual(new Set(['s1', 's2']));
  });

  it('does not mark the board dirty (selection is ephemeral state)', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    s.getState().markSaved('/a.board');
    s.getState().selectAll();
    expect(s.getState().dirty).toBe(false);
  });

  it('on an empty board, selects nothing', () => {
    const s = createBoardStore();
    s.getState().selectAll();
    expect(s.getState().selection).toEqual([]);
  });
});

describe('boardStore — duplicateElements (우클릭 복제)', () => {
  it('duplicates the current selection — new ids, offset position, new selection, one undo step', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1', 10, 10));
    s.getState().setSelection(['s1']);
    const pastBefore = s.getState().past.length;
    s.getState().duplicateElements();
    expect(s.getState().board.order.length).toBe(2);
    const dupId = s.getState().board.order.find((id) => id !== 's1')!;
    expect(dupId).toBeDefined();
    expect(s.getState().selection).toEqual([dupId]); // the duplicate is the new selection
    const dup = s.getState().board.elements[dupId] as BoardStickyElement;
    expect(dup.x).toBe(30); // offset from the original, same as a manual paste
    expect(dup.y).toBe(30);
    expect(s.getState().past.length).toBe(pastBefore + 1); // one undo step
    s.getState().undo();
    expect(s.getState().board.order).toEqual(['s1']); // duplicate removed, original untouched
  });

  it('duplicating a connected pair also duplicates the connector between them', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1', 0, 0));
    s.getState().addElement(sticky('s2', 100, 0));
    s.getState().addElement({
      id: 'c1',
      kind: 'connector',
      fromId: 's1',
      fromAnchor: 'right',
      toId: 's2',
      toAnchor: 'left',
    });
    s.getState().setSelection(['s1', 's2']);
    s.getState().duplicateElements();
    expect(s.getState().selection.length).toBe(3); // 2 duplicated stickies + their connector
  });

  it('on an empty selection is a no-op', () => {
    const s = createBoardStore();
    s.getState().addElement(sticky('s1'));
    s.getState().setSelection([]);
    const before = s.getState().board;
    s.getState().duplicateElements();
    expect(s.getState().board).toBe(before);
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
