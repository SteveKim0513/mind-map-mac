import { describe, expect, it } from 'vitest';
import { serialize, emptyDoc } from './formats';
import { emptyBoard, serializeBoard } from './boardFormat';
import { MAX_SHARED_FILE_CHARS, prepareSharedContent, rawDocId, sharedFileId, sharedFileKind } from './sharedFile';
import type { MindMapDoc } from '../types';

function mapWithReminder(): MindMapDoc {
  const doc = emptyDoc();
  doc.rootIds = ['a'];
  doc.nodes = {
    a: {
      id: 'a',
      text: '일정',
      parentId: null,
      children: [],
      collapsed: false,
      todo: true,
      scheduled: true,
      scheduleAt: '2026-10-01T09:00:00.000Z',
      reminderOn: true,
      reminderId: 'x-apple-reminder://ABC',
      reminderSyncedAt: 123,
      reminderBase: { title: '일정', due: null, done: false },
    } as MindMapDoc['nodes'][string],
  };
  return doc;
}

describe('sharedFileKind / ids', () => {
  it('확장자로 종류를 판별한다', () => {
    expect(sharedFileKind('/a/b.mind')).toBe('map');
    expect(sharedFileKind('/a/b.board')).toBe('board');
    expect(sharedFileKind('/a/b.md')).toBeNull();
  });

  it('문서에 안정 id가 있으면 그것을, 없으면 상대 경로 해시 기반 결정론적 id를 쓴다', () => {
    const withId = serialize(emptyDoc());
    expect(sharedFileId(withId, 'x/y.mind')).toBe(rawDocId(withId));
    const noId = JSON.stringify({ version: 1, rootIds: [], nodes: {}, view: { zoom: 1, panX: 0, panY: 0 } });
    expect(rawDocId(noId)).toBeNull();
    const id1 = sharedFileId(noId, 'x/y.mind');
    expect(id1).toBe(sharedFileId(noId, 'x/y.mind')); // 결정론적
    expect(id1).not.toBe(sharedFileId(noId, 'x/z.mind'));
    expect(id1).toMatch(/^f-[0-9a-f]+$/);
  });

  it('문서 id 규칙에 안 맞는 id는 무시하고 경로 해시로 대체한다', () => {
    const bad = JSON.stringify({ version: 1, id: '../evil', rootIds: [], nodes: {}, view: {} });
    expect(rawDocId(bad)).toBeNull();
    expect(sharedFileId(bad, 'a.mind')).toMatch(/^f-/);
  });
});

describe('prepareSharedContent', () => {
  it('맵: 리마인더 신원 4개 필드를 제거하고 나머지(일정·할 일)는 그대로 둔다', () => {
    const out = prepareSharedContent('map', serialize(mapWithReminder()))!;
    expect(out).not.toBeNull();
    const n = (JSON.parse(out) as MindMapDoc).nodes.a;
    expect(n.reminderOn).toBeUndefined();
    expect(n.reminderId).toBeUndefined();
    expect(n.reminderSyncedAt).toBeUndefined();
    expect(n.reminderBase).toBeUndefined();
    expect(n.scheduleAt).toBe('2026-10-01T09:00:00.000Z');
    expect(n.todo).toBe(true);
    expect(n.text).toBe('일정');
  });

  it('멱등이고 결정론적이다(정제된 내용을 다시 넣어도, 같은 입력을 두 번 넣어도 같은 결과)', () => {
    const src = serialize(mapWithReminder());
    const once = prepareSharedContent('map', src)!;
    expect(prepareSharedContent('map', src)).toBe(once);
    expect(prepareSharedContent('map', once)).toBe(once);
  });

  it('id가 없는 옛 파일도 무작위 id를 넣지 않는다(내용이 매번 바뀌지 않는다)', () => {
    const noId = JSON.stringify({ version: 1, rootIds: [], nodes: {}, view: { zoom: 1, panX: 0, panY: 0 } });
    const a = prepareSharedContent('map', noId)!;
    expect(a).toBe(prepareSharedContent('map', noId));
    expect(JSON.parse(a).id).toBeUndefined();
  });

  it('보드: 유효한 보드는 통과하고, 위험한 이미지 src(.. · 절대 경로 · 스킴)는 비운다', () => {
    const board = emptyBoard();
    board.elements = {
      ok: { id: 'ok', kind: 'image', x: 0, y: 0, width: 10, height: 10, src: '.b.assets/img.png' },
      up: { id: 'up', kind: 'image', x: 0, y: 0, width: 10, height: 10, src: '../../secret.png' },
      abs: { id: 'abs', kind: 'image', x: 0, y: 0, width: 10, height: 10, src: '/etc/passwd' },
      url: { id: 'url', kind: 'image', x: 0, y: 0, width: 10, height: 10, src: 'file:///etc/passwd' },
      enc: { id: 'enc', kind: 'image', x: 0, y: 0, width: 10, height: 10, src: '%2e%2e/%2e%2e/x.png' },
      st: { id: 'st', kind: 'sticky', x: 0, y: 0, width: 10, height: 10, text: '안녕' },
    } as never;
    board.order = Object.keys(board.elements);
    const out = JSON.parse(prepareSharedContent('board', serializeBoard(board))!) as { elements: Record<string, { src?: string; text?: string }> };
    expect(out.elements.ok.src).toBe('.b.assets/img.png');
    for (const k of ['up', 'abs', 'url', 'enc']) expect(out.elements[k].src).toBe('');
    expect(out.elements.st.text).toBe('안녕');
  });

  it('손상된 JSON·구조가 틀린 파일·종류가 안 맞는 파일은 거부한다', () => {
    expect(prepareSharedContent('map', '{not json')).toBeNull();
    expect(prepareSharedContent('map', '{}')).toBeNull();
    expect(prepareSharedContent('board', '{"elements":{}}')).toBeNull();
    expect(prepareSharedContent('map', serializeBoard(emptyBoard()))).toBeNull(); // 보드 내용을 맵으로
    expect(prepareSharedContent('board', serialize(emptyDoc()))).toBeNull(); // 맵 내용을 보드로
    expect(prepareSharedContent('map', '')).toBeNull();
    expect(prepareSharedContent('map', 'null')).toBeNull();
  });

  it('너무 큰 내용은 거부한다', () => {
    expect(prepareSharedContent('map', 'x'.repeat(MAX_SHARED_FILE_CHARS + 1))).toBeNull();
  });
});
