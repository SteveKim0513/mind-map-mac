// 보드 노트 링크 발행(ADR 0022) — 소유자 발행 매니저가 링크 대상을 "공유 폴더 안 노트"로 해석해 사본에는 `{noteId,title}`만 남기고,
// 소유자의 실제 파일은 1바이트도 고치지 않는지 확인한다. 가짜 소켓·프로바이더 + 메모리 파일시스템(네트워크 없음).
import { afterEach, describe, expect, it } from 'vitest';
import { emptyBoard, serializeBoard } from '../io/boardFormat';
import type { NoteLinkResolver } from '../io/sharedFile';
import type { BoardDoc, ShareRole } from '../types';
import { MANIFEST_KEY, fileKey } from './docKeys';
import { createFileReplicaManager, readFileDoc, type FileReplicaManager } from './fileReplica';
import { MemFileFs, until } from './replicaTestKit';
import { createShareSession } from './shareClient';
import { makeFakeFactories, makeFakeShareApi } from './testFakes';

const ROOM = 'room-AAAAAAAA';
const FOLDER = '/ws/team';
const BOARD_PATH = `${FOLDER}/아이디어.board`;
const SHARED_NOTE_PATH = `${FOLDER}/회의.md`;
const OUTSIDE_PATH = '/ws/private/일기.md';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function boardText(links: Record<string, Record<string, unknown> | undefined>): string {
  const doc: BoardDoc = emptyBoard();
  doc.id = 'board-1';
  doc.elements = {};
  doc.order = [];
  for (const [id, noteLink] of Object.entries(links)) {
    doc.elements[id] = { id, kind: 'sticky', x: 0, y: 0, width: 100, height: 100, text: id, ...(noteLink ? { noteLink } : {}) } as never;
    doc.order.push(id);
  }
  return serializeBoard(doc);
}

async function setup(role: ShareRole, text: string, resolveNoteLink?: NoteLinkResolver) {
  const fs = new MemFileFs(FOLDER);
  fs.put(BOARD_PATH, text);
  const { factories } = makeFakeFactories();
  const fake = makeFakeShareApi();
  const session = createShareSession({ roomId: ROOM, wsUrl: 'ws://relay.example', getToken: async () => 't', factories });
  const manifest = session.openDoc(MANIFEST_KEY);
  const manager: FileReplicaManager = createFileReplicaManager({
    roomId: ROOM,
    folderPath: FOLDER,
    role,
    api: fake.api,
    manifest,
    fs,
    host: {
      openDoc: async (docKey, initialState) => session.openDoc(docKey, { initialState }),
      closeDoc: async (docKey) => session.closeDoc(docKey),
    },
    publishDebounceMs: 5,
    deleteConfirmScans: 1,
    missingRecheckMs: 0,
    resolveNoteLink,
  });
  cleanups.push(async () => {
    await manager.stop();
    session.destroy();
  });
  await manager.start();
  await manager.idle();
  const published = (): Record<string, { noteLink?: Record<string, unknown> }> | null => {
    const snap = readFileDoc(session.getDoc(fileKey('board-1'))!.ydoc);
    return snap ? (JSON.parse(snap.content) as { elements: Record<string, { noteLink?: Record<string, unknown> }> }).elements : null;
  };
  return { fs, manager, published };
}

describe('소유자 발행 — 보드 노트 링크', () => {
  it('공유 폴더 안 노트는 {noteId,title}만, 밖 노트·id 없는 미해석 링크는 제거 — 소유자 파일은 바이트 불변', async () => {
    const shared = 'note-shared-1';
    const resolve: NoteLinkResolver = (ref) => (ref.noteId === shared ? shared : ref.notePath === SHARED_NOTE_PATH ? shared : null);
    const text = boardText({
      byId: { notePath: SHARED_NOTE_PATH, noteId: shared, title: '회의' },
      byPathOnly: { notePath: SHARED_NOTE_PATH, title: '옛 링크' },
      outside: { notePath: OUTSIDE_PATH, noteId: 'note-private-1', title: '일기' },
      none: undefined,
    });
    const { fs, published } = await setup('owner', text, resolve);
    const els = published()!;
    expect(els.byId.noteLink).toEqual({ noteId: shared, title: '회의' });
    expect(els.byPathOnly.noteLink).toEqual({ noteId: shared, title: '옛 링크' });
    expect(els.outside.noteLink).toBeUndefined();
    expect(els.none.noteLink).toBeUndefined();
    expect(JSON.stringify(els)).not.toContain('/ws/'); // 어떤 절대 경로도 사본에 없다
    expect(fs.get(BOARD_PATH)).toBe(text); // 소유자의 실제 파일은 1바이트도 안 바뀐다
    expect(fs.writes).toEqual([]);
  });

  it('해석기가 없으면(안전한 기본값) 모든 노트 링크를 사본에서 뺀다', async () => {
    const text = boardText({ a: { notePath: SHARED_NOTE_PATH, noteId: 'note-shared-1', title: '회의' } });
    const { fs, published } = await setup('owner', text);
    expect(published()!.a.noteLink).toBeUndefined();
    expect(fs.get(BOARD_PATH)).toBe(text);
  });

  it('노트가 나중에 공유되면 refreshNoteLinks가 링크를 사본에 되살린다(그리고 공유에서 빠지면 다시 제거)', async () => {
    let sharedIds = new Set<string>(); // 아직 공유되지 않은 노트
    const resolve: NoteLinkResolver = (ref) => (ref.noteId && sharedIds.has(ref.noteId) ? ref.noteId : null);
    const text = boardText({ a: { notePath: SHARED_NOTE_PATH, noteId: 'note-new-1', title: '새 노트' } });
    const { fs, manager, published } = await setup('owner', text, resolve);
    expect(published()!.a.noteLink).toBeUndefined(); // 대상이 아직 manifest에 없다

    sharedIds = new Set(['note-new-1']); // 노트가 공유 폴더에서 시드됐다
    manager.refreshNoteLinks();
    await until(() => published()!.a.noteLink !== undefined, '링크 복원');
    expect(published()!.a.noteLink).toEqual({ noteId: 'note-new-1', title: '새 노트' });

    sharedIds = new Set(); // 삭제·이동으로 공유에서 빠졌다
    manager.refreshNoteLinks();
    await until(() => published()!.a.noteLink === undefined, '링크 제거');

    expect(fs.get(BOARD_PATH)).toBe(text);
    expect(fs.writes).toEqual([]);
  });

  it('노트 링크가 없는 보드는 refreshNoteLinks가 다시 읽지 않는다', async () => {
    const { fs, manager } = await setup('owner', boardText({ a: undefined }), () => 'x');
    let reads = 0;
    const read = fs.read.bind(fs);
    fs.read = async (p: string) => {
      reads++;
      return read(p);
    };
    manager.refreshNoteLinks();
    await manager.idle();
    expect(reads).toBe(0);
  });

  it('처음에는 링크가 없다가 (공유 전) 링크를 추가해 저장해도 사본이 같아 일찍 돌아가는 경우 후보로 기억한다', async () => {
    let shared = false;
    const resolve: NoteLinkResolver = (ref) => (shared && ref.noteId === 'n-1' ? 'n-1' : null);
    const { fs, manager, published } = await setup('owner', boardText({ a: undefined }), resolve);
    // 링크 대상이 아직 공유 전이라 사본은 그대로(링크 없음) — 그래도 이 보드는 링크 후보로 기억돼야 한다
    const withLink = boardText({ a: { notePath: SHARED_NOTE_PATH, noteId: 'n-1', title: 'N' } });
    fs.put(BOARD_PATH, withLink);
    manager.onFileSaved(BOARD_PATH);
    await manager.flush();
    await manager.idle();
    await until(() => published() !== null, '발행');
    expect(published()!.a.noteLink).toBeUndefined();
    shared = true;
    manager.refreshNoteLinks();
    await until(() => published()!.a.noteLink !== undefined, '링크 복원');
    expect(published()!.a.noteLink).toEqual({ noteId: 'n-1', title: 'N' });
  });

  it('참가자 매니저의 refreshNoteLinks는 아무것도 하지 않는다', async () => {
    const { manager } = await setup('participant', boardText({ a: undefined }));
    expect(() => manager.refreshNoteLinks()).not.toThrow();
  });
});
