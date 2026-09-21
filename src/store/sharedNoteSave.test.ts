import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeNote, parseNote } from '../io/noteFormat';
import type { NoteDoc, ShareMarker } from '../types';
import { useShare } from './shareStore';
import { patchNoteFile, renameSharedNoteTitle, saveSharedNote } from './sharedNoteSave';

const disk = { text: '' as string | null };
const saved: { path: string; content: string }[] = [];

beforeEach(() => {
  saved.length = 0;
  vi.stubGlobal('window', {
    api: {
      readFile: vi.fn(async () => {
        if (disk.text === null) throw new Error('ENOENT');
        return disk.text;
      }),
      save: vi.fn(async (path: string, content: string) => {
        saved.push({ path, content });
        disk.text = content;
        return path;
      }),
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useShare.setState({ rooms: {} });
});

const NOTE: NoteDoc = { id: 'n1', title: '회의 메모', body: '로컬 화면 상태의 (오래된) 본문', links: [], metaBlocks: undefined };
const onDisk = (over: Partial<NoteDoc> = {}) => serializeNote({ ...NOTE, body: '디스크의 진짜 본문\n\n다른 참가자가 쓴 문장', ...over });

function registerRoom(onLocalTitleChanged = vi.fn(), patchLocalNote: (p: string, m: (n: NoteDoc) => NoteDoc | null, h?: { noteId: string }) => Promise<unknown> = async () => ({ status: 'not_shared' as const })) {
  const marker = { roomId: 'room1', role: 'participant', participantId: 'p1', displayName: '나' } as unknown as ShareMarker;
  useShare.setState({
    rooms: {
      room1: {
        marker,
        folderPath: '/ws/기획',
        status: 'connected',
        error: null,
        participants: [],
        docs: {},
        notes: { '/ws/기획/memo.md': 'n1' },
        files: {},
        replica: { onLocalTitleChanged, ensureNoteDoc: vi.fn(async () => null), patchLocalNote: patchLocalNote as never },
      },
    },
  });
  return onLocalTitleChanged;
}

describe('saveSharedNote — 공유 노트는 본문을 절대 쓰지 않는다', () => {
  it('화면 상태의 본문이 달라도 디스크의 본문을 그대로 보존하고 노드 연결·메타 블록만 갈아 끼운다', async () => {
    registerRoom();
    disk.text = onDisk();
    const link = { mapId: 'm1', nodeId: 'x', nodeText: '노드' };
    const meta = [{ templateId: 't1', values: { a: '1' } }];
    const p = await saveSharedNote('/ws/기획/memo.md', { ...NOTE, links: [link], metaBlocks: meta }, { pushTitle: false });
    expect(p).toBe('/ws/기획/memo.md');
    const written = parseNote(saved[0].content);
    expect(written.body).toBe('디스크의 진짜 본문\n\n다른 참가자가 쓴 문장');
    expect(written.links).toEqual([link]);
    expect(written.metaBlocks).toEqual(meta);
    expect(written.title).toBe('회의 메모');
  });

  it('제목을 보낼 때만 공유 문서로 전파하고 프론트매터 제목을 바꾼다(본문은 여전히 그대로)', async () => {
    const push = registerRoom();
    disk.text = onDisk();
    await saveSharedNote('/ws/기획/memo.md', { ...NOTE, title: '새 제목' }, { pushTitle: true });
    expect(push).toHaveBeenCalledWith('n1', '새 제목');
    const written = parseNote(saved[0].content);
    expect(written.title).toBe('새 제목');
    expect(written.body).toContain('다른 참가자가 쓴 문장');
  });

  it('제목을 안 고쳤으면(pushTitle false) 낡은 화면 제목으로 공유 제목을 덮어쓰지 않는다', async () => {
    const push = registerRoom();
    disk.text = onDisk({ title: '상대가 바꾼 제목' });
    await saveSharedNote('/ws/기획/memo.md', { ...NOTE, title: '낡은 제목', links: [{ mapId: 'm', nodeId: 'n', nodeText: 't' }] }, { pushTitle: false });
    expect(push).not.toHaveBeenCalled();
    expect(parseNote(saved[0].content).title).toBe('상대가 바꾼 제목');
  });

  it('바뀐 게 없으면 파일을 쓰지 않는다', async () => {
    registerRoom();
    disk.text = onDisk();
    const p = await saveSharedNote('/ws/기획/memo.md', NOTE, { pushTitle: false });
    expect(p).toBe('/ws/기획/memo.md');
    expect(saved).toHaveLength(0);
  });

  it('파일이 사라졌으면 쓰지 않는다(삭제된 노트를 되살리지 않는다)', async () => {
    registerRoom();
    disk.text = null;
    expect(await saveSharedNote('/ws/기획/memo.md', NOTE, { pushTitle: true })).toBeNull();
    expect(saved).toHaveLength(0);
  });

  it('파일 이름이 막 바뀌어 경로가 아직 등록되기 전이어도 고정된 정보로 제목을 보낸다', async () => {
    const push = registerRoom();
    disk.text = onDisk();
    await saveSharedNote('/ws/기획/새이름.md', { ...NOTE, title: '새 제목' }, { pushTitle: true, info: { roomId: 'room1', noteId: 'n1', role: 'participant' } });
    expect(push).toHaveBeenCalledWith('n1', '새 제목');
  });
});


describe('공유 노트는 복제 매니저의 큐 경유(patchLocalNote)로 고친다 — 큐 밖 readFile → save가 아니다', () => {
  /** 매니저 대역: 디스크 본문을 읽어 mutator를 적용한 결과를 돌려준다(쓰기는 큐 안에서 매니저가 한다고 가정). */
  const queued = () =>
    vi.fn(async (_p: string, mutator: (n: NoteDoc) => NoteDoc | null) => {
      const before = parseNote(disk.text ?? '');
      const after = mutator(structuredClone(before));
      return after ? { status: 'written' as const, note: after, path: '/ws/기획/memo.md' } : { status: 'unchanged' as const, note: before, path: '/ws/기획/memo.md' };
    });

  it('saveSharedNote: 매니저 큐에 맡기고 직접 readFile/save를 하지 않는다', async () => {
    const patch = queued();
    registerRoom(vi.fn(), patch);
    disk.text = onDisk();
    const link = { mapId: 'm1', nodeId: 'x', nodeText: '노드' };
    const p = await saveSharedNote('/ws/기획/memo.md', { ...NOTE, links: [link] }, { pushTitle: false });
    expect(p).toBe('/ws/기획/memo.md');
    expect(patch).toHaveBeenCalledTimes(1);
    expect((patch.mock.calls[0] as unknown[])[2]).toEqual({ noteId: 'n1' }); // 이름이 막 바뀐 경로도 찾도록 noteId 힌트를 준다
    expect((window as unknown as { api: { readFile: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> } }).api.readFile).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it('mutator는 본문을 건드리지 않고 링크·메타·(제목을 보낼 때만) 제목만 바꾼다', async () => {
    let seen: NoteDoc | null = null;
    const patch = vi.fn(async (_p: string, m: (n: NoteDoc) => NoteDoc | null) => {
      const cur: NoteDoc = { ...NOTE, title: '디스크 제목', body: '디스크의 진짜 본문', links: [] };
      seen = m(cur);
      return { status: 'written' as const, note: seen!, path: '/ws/기획/memo.md' };
    });
    registerRoom(vi.fn(), patch);
    await saveSharedNote('/ws/기획/memo.md', { ...NOTE, title: '화면 제목', body: '낡은 화면 본문', links: [{ mapId: 'm', nodeId: 'n', nodeText: 't' }] }, { pushTitle: false });
    expect(seen).toMatchObject({ title: '디스크 제목', body: '디스크의 진짜 본문', links: [{ mapId: 'm', nodeId: 'n', nodeText: 't' }] });
    await saveSharedNote('/ws/기획/memo.md', { ...NOTE, title: '화면 제목', body: '낡은 화면 본문' }, { pushTitle: true });
    expect(seen).toMatchObject({ title: '화면 제목', body: '디스크의 진짜 본문' });
  });

  it('큐 안에서 실패하면 null이고 직접 쓰기로 우회하지 않는다(삭제된 파일을 되살리거나 큐를 건너뛰지 않는다)', async () => {
    registerRoom(vi.fn(), vi.fn(async () => ({ status: 'failed' as const })));
    disk.text = onDisk();
    expect(await saveSharedNote('/ws/기획/memo.md', { ...NOTE, links: [{ mapId: 'm', nodeId: 'n', nodeText: 't' }] }, { pushTitle: false })).toBeNull();
    expect(saved).toHaveLength(0);
  });

  it('patchNoteFile: 공유 노트가 아니거나 복제가 멈춘 방(핸들 없음)이면 not_shared', async () => {
    expect(await patchNoteFile('/ws/개인/x.md', () => null)).toEqual({ status: 'not_shared' });
    registerRoom();
    useShare.setState((s) => ({ rooms: { room1: { ...s.rooms.room1, replica: null } } }));
    expect(await patchNoteFile('/ws/기획/memo.md', () => null)).toEqual({ status: 'not_shared' });
    // 매니저가 던져도 failed로 흡수한다
    registerRoom(vi.fn(), async () => {
      throw new Error('queue broke');
    });
    expect(await patchNoteFile('/ws/기획/memo.md', () => null)).toEqual({ status: 'failed' });
  });

  it('renameSharedNoteTitle: 제목을 공유 문서로 보내고 프론트매터 제목만 큐 안에서 바꾸며, 이전 제목을 돌려준다', async () => {
    const push = vi.fn();
    const patch = queued();
    registerRoom(push, patch);
    disk.text = onDisk({ title: '옛 제목' });
    const res = await renameSharedNoteTitle('/ws/기획/memo.md', '새 제목');
    expect(push).toHaveBeenCalledWith('n1', '새 제목');
    expect(res).toMatchObject({ status: 'written', oldTitle: '옛 제목' });
    // 공유 노트가 아니면 아무것도 하지 않는다
    expect(await renameSharedNoteTitle('/ws/개인/x.md', '제목')).toEqual({ status: 'not_shared' });
  });
});
