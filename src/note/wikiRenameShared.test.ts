// @vitest-environment jsdom
// 공유 노트 rename 시 위키링크 중복 방지 규칙(F1b 테스트 공백) — "[[옛]] → [[새]]" 일괄 치환은 **제목을 바꾼 기기 한 곳에서만** 해야 한다.
// 다른 참가자가 원격으로 받은 제목 변경에서까지 각자 치환하면 CRDT가 두 삽입을 모두 살려 `[[새]]`가 중복된다(단계 6b 실측).
//
// 규칙은 NotePane의 rename 이펙트(`store.remoteTitle !== newTitle`일 때만 renameWikiLinks)가 집행한다. React 컴포넌트는 단위 테스트
// 대상이 아니라서, 여기서는 그 규칙이 기대는 것 세 가지를 각각 고정한다:
//   1) 스토어: 원격 제목을 받으면 remoteTitle === note.title, 이후 로컬 편집이면 서로 다르다 → 규칙이 원격/로컬을 가른다.
//   2) renameWikiLinks: 공유 노트는 탭 스토어를 건드리지 않고(파일 경유), 일반 노트는 예전처럼 정확히 한 번 치환한다.
//   3) CRDT: 한 기기만 치환하면 `[[새]]`가 정확히 1개, 두 기기가 동시에 치환하면 중복된다(= 규칙이 필요한 이유의 재현).
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { emptyNote, parseNote, serializeNote } from '../io/noteFormat';
import { createNoteCodec } from './collabCodec';
import { createNoteStore, type NoteStore } from '../store/noteStore';
import type { ShareMarker } from '../types';

const disk = new Map<string, string>();
const mockSave = vi.fn(async (path: string, content: string) => {
  disk.set(path, content);
  return path;
});
const mockReadFile = vi.fn(async (path: string) => {
  const v = disk.get(path);
  if (v === undefined) throw new Error('ENOENT');
  return v;
});
vi.stubGlobal('api', { save: mockSave, readFile: mockReadFile });

const { useSession } = await import('../store/sessionStore');
const { useShare } = await import('../store/shareStore');
const { useWorkspace } = await import('../store/workspaceStore');
const { renameWikiLinks } = await import('./noteLinks');

const count = (s: string, sub: string) => s.split(sub).length - 1;

describe('1) noteStore — 원격 제목 vs 로컬 제목 구분(NotePane 규칙의 입력)', () => {
  it('원격 제목을 받으면 remoteTitle이 새 제목과 같다 → rename 이펙트는 위키링크를 치환하지 않는다', () => {
    const s = createNoteStore();
    s.getState().loadNote({ ...emptyNote('옛 제목'), body: '본문' }, '/ws/n.md');
    s.getState().setTitleFromShare('새 제목');
    const st = s.getState();
    expect(st.note.title).toBe('새 제목');
    expect(st.remoteTitle).toBe(st.note.title); // NotePane: remoteTitle !== newTitle 이 거짓
    expect(st.dirty).toBe(false);
  });

  it('내가 고친 제목이면 remoteTitle과 달라 치환이 실행된다(원격 값이 남아 있어도)', () => {
    const s = createNoteStore();
    s.getState().loadNote({ ...emptyNote('옛 제목'), body: '본문' }, '/ws/n.md');
    s.getState().setTitleFromShare('원격이 바꾼 제목');
    s.getState().setTitle('내가 바꾼 제목');
    const st = s.getState();
    expect(st.remoteTitle).toBe('원격이 바꾼 제목');
    expect(st.remoteTitle).not.toBe(st.note.title); // NotePane: 참 → renameWikiLinks 호출
  });

  it('일반(비공유) 노트는 remoteTitle이 항상 null이라 기존처럼 치환된다', () => {
    const s = createNoteStore();
    s.getState().loadNote({ ...emptyNote('옛'), body: '' }, '/ws/n.md');
    s.getState().setTitle('새');
    expect(s.getState().remoteTitle).toBeNull();
  });
});

describe('2) renameWikiLinks — 공유 노트는 파일 경유, 일반 노트는 한 번만 치환', () => {
  const SHARED = '/ws/기획/참조.md';
  const LOCAL_OPEN = '/ws/개인/열림.md';
  const LOCAL_CLOSED = '/ws/개인/닫힘.md';

  const noteFile = (id: string, title: string, body: string) => serializeNote({ ...emptyNote(title), id, body });

  beforeEach(() => {
    disk.clear();
    mockSave.mockClear();
    mockReadFile.mockClear();
    useSession.setState({ tabs: [], leftTabs: [], leftActive: null, rightTabs: [], rightActive: null, split: false, activeGroup: 0, recent: [] });
    useShare.setState({
      rooms: {
        'room-AAAAAAAA': {
          marker: { v: 1, roomId: 'room-AAAAAAAA', relayUrl: 'https://relay.example.com', role: 'participant', participantId: 'p1', folderName: '기획', displayName: '나' } as ShareMarker,
          folderPath: '/ws/기획',
          status: 'connected',
          error: null,
          participants: [],
          docs: {},
          notes: { [SHARED]: 'shared-1' },
          files: {},
          replica: null,
        },
      },
    });
    disk.set(SHARED, noteFile('shared-1', '참조', '앞 [[옛 제목]] 뒤'));
    disk.set(LOCAL_OPEN, noteFile('open-1', '열림', '열린 노트 [[옛 제목]]'));
    disk.set(LOCAL_CLOSED, noteFile('closed-1', '닫힘', '닫힌 노트 [[옛 제목]] 그리고 [[ 옛 제목 ]]'));
    useWorkspace.setState({
      noteIndex: [
        { path: SHARED, id: 'shared-1', title: '참조', links: [] },
        { path: LOCAL_OPEN, id: 'open-1', title: '열림', links: [] },
        { path: LOCAL_CLOSED, id: 'closed-1', title: '닫힘', links: [] },
      ],
    });
  });

  it('공유 노트가 탭으로 열려 있어도 탭 스토어 본문은 건드리지 않고 파일을 직접 고친다(복제 매니저가 흡수)', async () => {
    useSession.getState().openPath(SHARED, disk.get(SHARED)!);
    const store = useSession.getState().tabs.find((t) => t.path === SHARED)!.store as NoteStore;

    await renameWikiLinks('옛 제목', '새 제목');

    expect(store.getState().note.body).toBe('앞 [[옛 제목]] 뒤'); // 탭 스토어(=화면 본문)는 그대로 — 본문의 진실은 공유 문서
    expect(store.getState().dirty).toBe(false);
    const written = parseNote(disk.get(SHARED)!).body;
    expect(count(written, '[[새 제목]]')).toBe(1);
    expect(count(written, '[[옛 제목]]')).toBe(0);
  });

  it('일반 노트는 열린 탭·닫힌 파일 모두 정확히 한 번 치환되고, 다시 호출해도 더 늘지 않는다(멱등)', async () => {
    useSession.getState().openPath(LOCAL_OPEN, disk.get(LOCAL_OPEN)!);
    const store = useSession.getState().tabs.find((t) => t.path === LOCAL_OPEN)!.store as NoteStore;

    await renameWikiLinks('옛 제목', '새 제목');
    await renameWikiLinks('옛 제목', '새 제목');

    expect(count(store.getState().note.body, '[[새 제목]]')).toBe(1);
    expect(count(parseNote(disk.get(LOCAL_OPEN)!).body, '[[새 제목]]')).toBe(1);
    const closed = parseNote(disk.get(LOCAL_CLOSED)!).body;
    expect(count(closed, '[[새 제목]]')).toBe(2); // 원문에 두 개가 있었다 — 늘지도 줄지도 않는다
    expect(count(closed, '[[옛 제목]]')).toBe(0);
  });

  it('제목이 사실상 안 바뀌었으면(대소문자만) 아무것도 쓰지 않는다', async () => {
    await renameWikiLinks('Old', 'old');
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe('3) CRDT — 한 기기만 치환하면 정확히 1개, 두 기기가 각자 치환하면 중복(규칙이 필요한 이유)', () => {
  const codec = createNoteCodec();
  afterAll(() => codec.destroy());

  const BODY = '참고: [[옛 제목]] 을 보세요';
  const REWRITTEN = BODY.replace('[[옛 제목]]', '[[새 제목]]');

  /** 같은 초기 내용을 가진 두 참가자의 Y.Doc(서로 연결 전) + 각자의 base(마지막 md 쓰기 시점 상태). */
  function twoReplicas() {
    const a = new Y.Doc();
    codec.markdownToYDoc(BODY, a);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    return { a, b, baseA: Y.encodeStateAsUpdate(a), baseB: Y.encodeStateAsUpdate(b) };
  }
  const syncBoth = (a: Y.Doc, b: Y.Doc) => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  };

  it('제목을 바꾼 한 기기만 치환 → 양쪽 모두 [[새 제목]] 정확히 1개, [[옛 제목]] 0개', () => {
    const { a, b, baseA } = twoReplicas();
    const r = codec.applyExternalMarkdown3Way(a, baseA, REWRITTEN); // A의 파일 치환을 A의 복제 매니저가 흡수
    expect(r.changed).toBe(true);
    syncBoth(a, b); // B는 원격 갱신을 받기만 한다(자기 치환 없음)
    for (const d of [a, b]) {
      const md = codec.yDocToMarkdown(d);
      expect(count(md, '[[새 제목]]')).toBe(1);
      expect(count(md, '[[옛 제목]]')).toBe(0);
    }
    expect(codec.yDocToMarkdown(a)).toBe(codec.yDocToMarkdown(b));
  });

  it('(재현) 두 기기가 같은 치환을 각자 흡수하면 병합 결과가 1개가 아니다 — 그래서 원격 제목 변경에서는 치환하지 않는다', () => {
    const { a, b, baseA, baseB } = twoReplicas();
    codec.applyExternalMarkdown3Way(a, baseA, REWRITTEN);
    codec.applyExternalMarkdown3Way(b, baseB, REWRITTEN); // 원격 제목 변경을 받은 B도 치환한 경우(금지된 경로)
    syncBoth(a, b);
    const md = codec.yDocToMarkdown(a);
    expect(codec.yDocToMarkdown(b)).toBe(md); // 수렴은 하지만
    expect(md).not.toBe(REWRITTEN); // 내용이 깨져 있다(중복 삽입)
    expect(md).not.toContain('[[옛 제목]]');
    expect(count(md, '[[새 제목]]')).not.toBe(1); // 정확한 링크가 없다(실측: `[[새새 제목]]` — 삽입이 두 번 살아남음)
  });
});
