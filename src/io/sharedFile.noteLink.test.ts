import { describe, it, expect } from 'vitest';
import { emptyBoard, serializeBoard } from './boardFormat';
import { prepareSharedContent, checkSharedContent, type NoteLinkResolver } from './sharedFile';
import type { BoardDoc } from '../types';

// 보드 노트 링크의 공유 정제(ADR 0022). 발행(소유자)은 해석기를 주입받아 "공유 폴더 안 노트"만 `{noteId,title}`로 남기고,
// 수신 재검증은 해석기 없이 noteId 형식만 본다. 어느 쪽이든 사본에는 `notePath`가 없다.

const OWNER_ABS = '/Users/owner/Projects/team/기획/회의.md';
const OUTSIDE_ABS = '/Users/owner/Private/일기.md';
const SHARED_ID = 'note-shared-1';

function board(noteLink: unknown, kind: 'sticky' | 'image' = 'sticky'): string {
  const doc: BoardDoc = emptyBoard();
  const el =
    kind === 'sticky'
      ? { id: 'e1', kind: 'sticky', x: 0, y: 0, width: 100, height: 100, text: '카드' }
      : { id: 'e1', kind: 'image', x: 0, y: 0, width: 100, height: 100, src: '.a.assets/x.png' };
  doc.elements = { e1: (noteLink === undefined ? el : { ...el, noteLink }) as never };
  doc.order = ['e1'];
  return serializeBoard(doc);
}

type Parsed = { elements: Record<string, { noteLink?: Record<string, unknown>; text?: string }> };
const link = (text: string | null) => (text === null ? undefined : (JSON.parse(text) as Parsed).elements.e1.noteLink);

/** 소유자 기기의 해석기: 공유 폴더 안 노트 하나(SHARED_ID, 절대 경로 OWNER_ABS)만 안다. */
const ownerResolver: NoteLinkResolver = (ref) => {
  if (ref.noteId === SHARED_ID) return SHARED_ID;
  if (ref.notePath === OWNER_ABS) return SHARED_ID;
  return null;
};

describe('발행(소유자) — 노트 링크 정제', () => {
  it('noteId가 이미 있고 공유 폴더 안 노트면 {noteId,title}만 남기고 notePath(절대경로)는 사본에서 제거한다', () => {
    const src = board({ notePath: OWNER_ABS, noteId: SHARED_ID, title: '회의' });
    const out = prepareSharedContent('board', src, { resolveNoteLink: ownerResolver });
    expect(link(out)).toEqual({ noteId: SHARED_ID, title: '회의' });
    expect(out).not.toContain(OWNER_ABS); // 절대경로가 어디에도 새지 않는다
    expect(out).not.toContain('/Users/owner');
  });

  it('옛 링크(noteId 없음, 경로만): 해석기가 경로로 공유 노트 id를 찾으면 사본에 {noteId,title}를 남긴다', () => {
    const out = prepareSharedContent('board', board({ notePath: OWNER_ABS, title: '회의' }), { resolveNoteLink: ownerResolver });
    expect(link(out)).toEqual({ noteId: SHARED_ID, title: '회의' });
  });

  it('공유 폴더 밖 노트(경로만/id만)·해석 실패면 링크를 통째로 제거한다 — 스티키는 남는다', () => {
    for (const nl of [
      { notePath: OUTSIDE_ABS, title: '일기' },
      { notePath: OUTSIDE_ABS, noteId: 'note-private-9', title: '일기' },
      { noteId: 'note-private-9' },
      { notePath: '/x.md' },
      {},
    ]) {
      const out = prepareSharedContent('board', board(nl), { resolveNoteLink: ownerResolver });
      expect(out).not.toBeNull();
      expect(link(out)).toBeUndefined();
      expect((JSON.parse(out!) as Parsed).elements.e1.text).toBe('카드');
    }
  });

  it('해석기 없이 호출하면 안전하게 수신 모드로 동작한다(경로만 있는 링크는 제거)', () => {
    expect(link(prepareSharedContent('board', board({ notePath: OWNER_ABS, title: '회의' })))).toBeUndefined();
  });

  it('이미지 요소의 noteLink도 똑같이 처리한다', () => {
    const out = prepareSharedContent('board', board({ notePath: OWNER_ABS, noteId: SHARED_ID, title: '사진 메모' }, 'image'), { resolveNoteLink: ownerResolver });
    expect(link(out)).toEqual({ noteId: SHARED_ID, title: '사진 메모' });
    expect(link(prepareSharedContent('board', board({ notePath: OUTSIDE_ABS }, 'image'), { resolveNoteLink: ownerResolver }))).toBeUndefined();
  });

  it('해석기가 이상한 id(형식 위반)를 돌려주면 링크를 뺀다', () => {
    const bad: NoteLinkResolver = () => '../../etc/passwd';
    expect(link(prepareSharedContent('board', board({ notePath: OWNER_ABS }), { resolveNoteLink: bad }))).toBeUndefined();
  });

  it('title이 없거나 제어문자·문자열이 아니면 title만 뺀다(링크는 유지)', () => {
    const opts = { resolveNoteLink: ownerResolver };
    expect(link(prepareSharedContent('board', board({ noteId: SHARED_ID }), opts))).toEqual({ noteId: SHARED_ID });
    expect(link(prepareSharedContent('board', board({ noteId: SHARED_ID, title: 42 }), opts))).toEqual({ noteId: SHARED_ID });
    expect(link(prepareSharedContent('board', board({ noteId: SHARED_ID, title: `a${String.fromCharCode(0)}b` }), opts))).toEqual({ noteId: SHARED_ID });
  });

  it('멱등: 정제된 사본을 다시 발행 경로·수신 경로에 넣어도 같다', () => {
    const once = prepareSharedContent('board', board({ notePath: OWNER_ABS, noteId: SHARED_ID, title: '회의' }), { resolveNoteLink: ownerResolver })!;
    expect(prepareSharedContent('board', once, { resolveNoteLink: ownerResolver })).toBe(once);
    expect(prepareSharedContent('board', once)).toBe(once);
  });

  it('입력 문자열(=소유자의 실제 파일 내용)은 바뀌지 않는다', () => {
    const src = board({ notePath: OWNER_ABS, noteId: SHARED_ID, title: '회의' });
    const before = src.slice();
    prepareSharedContent('board', src, { resolveNoteLink: ownerResolver });
    expect(src).toBe(before);
    expect(link(src)?.notePath).toBe(OWNER_ABS);
  });
});

describe('수신 재검증(참가자) — 해석기 없음', () => {
  it('정상 사본 {noteId,title}는 그대로 통과한다', () => {
    expect(link(prepareSharedContent('board', board({ noteId: SHARED_ID, title: '회의' })))).toEqual({ noteId: SHARED_ID, title: '회의' });
  });

  it('악성 noteId(경로 조작·공백·너무 긴 값·문자열 아님)는 링크를 제거한다', () => {
    for (const noteId of ['../../etc/passwd', '/abs/path', '.hidden', 'a b', 'x'.repeat(200), '', 7, null, { a: 1 }]) {
      expect(link(prepareSharedContent('board', board({ noteId, title: '나쁨' })))).toBeUndefined();
    }
  });

  it('잔존 notePath(악성·옛 발행본)는 제거하고 유효한 noteId만 남긴다 — 상대 경로여도 마찬가지', () => {
    const out = prepareSharedContent('board', board({ noteId: SHARED_ID, notePath: '회의.md', title: '회의' }))!;
    expect(link(out)).toEqual({ noteId: SHARED_ID, title: '회의' });
    expect(out).not.toContain('notePath');
    // noteId 없이 notePath만 있으면(경로 기반 링크는 더 이상 받지 않는다) 링크 제거
    expect(link(prepareSharedContent('board', board({ notePath: '회의.md', title: '회의' })))).toBeUndefined();
    expect(link(prepareSharedContent('board', board({ notePath: '../../etc/hosts.md' })))).toBeUndefined();
    expect(link(prepareSharedContent('board', board({ notePath: '/etc/passwd' })))).toBeUndefined();
  });

  it('noteLink가 객체가 아니면 제거한다', () => {
    for (const nl of ['/etc/passwd', 5, ['a']]) {
      expect(link(prepareSharedContent('board', board(nl)))).toBeUndefined();
    }
  });

  it('checkSharedContent도 같은 정제를 하고 사유 코드 체계는 그대로다', () => {
    const r = checkSharedContent('board', board({ noteId: SHARED_ID, notePath: '/abs/a.md', title: 't' }));
    expect(r.ok).toBe(true);
    expect(link(r.ok ? r.content : null)).toEqual({ noteId: SHARED_ID, title: 't' });
    expect(checkSharedContent('board', '{"elements":{}}')).toEqual({ ok: false, reason: 'shape' });
    expect(checkSharedContent('board', '')).toEqual({ ok: false, reason: 'parse' });
  });
});

describe('맵 공유는 영향 없음', () => {
  it('맵은 해석기를 넘겨도 동일하게 처리된다(노트 링크는 보드 전용)', () => {
    const map = JSON.stringify({
      version: 1,
      id: 'm1',
      rootIds: ['r'],
      nodes: { r: { id: 'r', text: '루트', parentId: null, children: [], collapsed: false } },
      view: { zoom: 1, panX: 0, panY: 0 },
    });
    expect(prepareSharedContent('map', map, { resolveNoteLink: ownerResolver })).toBe(prepareSharedContent('map', map));
  });
});
