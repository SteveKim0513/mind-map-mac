// @vitest-environment jsdom
// rooms.ts ↔ ReplicaManager 배선 — 주입된 noteCodec으로 방마다 복제 매니저가 만들어지고 store에 연결되는지.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createNoteCodec } from '../note/collabCodec';
import { serializeNote } from '../io/noteFormat';
import { useShare } from '../store/shareStore';
import type { ShareMarker } from '../types';
import { MANIFEST_KEY } from './docKeys';
import { readManifest } from './manifest';
import { bootShare, connectRoom, disconnectRoom, flushSharedRooms, getReplica, getReplicas, refreshShareMarkers, scanSharedFolders, stopAllRooms } from './rooms';
import { MemFs, appendParagraph, until } from './replicaTestKit';
import { connStatusText } from './messages';
import { makeFakeFactories, makeFakeShareApi, noteSidecarKey } from './testFakes';

const R1 = 'room-AAAAAAAA';
const PID = 'pid-AAAAAAAAAAAA';
const FOLDER = '/ws/team';
const codec = createNoteCodec();

const marker = (role: ShareMarker['role']): ShareMarker => ({
  v: 1,
  roomId: R1,
  relayUrl: 'https://relay.example.com',
  role,
  participantId: PID,
  folderName: 'team',
  displayName: '지호',
});

function setup(role: ShareMarker['role'], init: (fs: MemFs) => void = () => {}) {
  const fs = new MemFs(FOLDER);
  init(fs);
  const fake = makeFakeShareApi({ listMarkers: async () => [{ folderPath: FOLDER, marker: marker(role) }] });
  fake.tokens.set(R1, 'tok-1');
  const f = makeFakeFactories();
  const messages: string[] = [];
  const deps = {
    api: fake.api,
    factories: f.factories,
    sidecarDebounceMs: 10,
    noteCodec: codec,
    replicaFs: fs,
    replicaHooks: { notify: (m: string) => messages.push(m) },
    replicaOptions: { writeDebounceMs: 10, deleteConfirmScans: 1, missingRecheckMs: 0 },
    markerRescanDelayMs: 0,
  };
  return { fs, fake, ...f, deps, messages };
}

beforeEach(() => {
  useShare.setState({ rooms: {} });
});
afterEach(async () => {
  await stopAllRooms();
});

describe('connectRoom + noteCodec', () => {
  it('noteCodec이 없으면 복제 매니저를 만들지 않는다(기존 동작)', async () => {
    const { deps } = setup('participant');
    await refreshShareMarkers(deps);
    await connectRoom(R1, { ...deps, noteCodec: undefined });
    expect(getReplica(R1)).toBeUndefined();
    expect(useShare.getState().getRoom(R1)?.replica).toBeNull();
  });

  it('소유자: 연결하면 매니저가 시작되고 store에 제어 핸들·공유 노트 경로가 채워진다', async () => {
    const { deps, fs, providers } = setup('owner', (f) =>
      f.put(`${FOLDER}/a.md`, serializeNote({ id: 'n-a', title: '알파', body: '# 알파\n\n본문 충분히 긴 알파 노트입니다', links: [] })),
    );
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    const replica = getReplica(R1)!;
    expect(replica).toBeDefined();
    expect(getReplicas()).toHaveLength(1);
    expect(useShare.getState().getRoom(R1)?.replica).not.toBeNull();
    // manifest 동기화 전에는 시드하지 않는다
    await replica.idle();
    expect(useShare.getState().isSharedNote(`${FOLDER}/a.md`)).toBe(false);
    providers[0].sync(); // manifest 동기화
    await until(() => useShare.getState().isSharedNote(`${FOLDER}/a.md`), '시드 후 공유 노트로 등록');
    expect(useShare.getState().sharedNoteAt(`${FOLDER}/a.md`)).toEqual({ roomId: R1, noteId: 'n-a', role: 'owner' });
    // 노트 문서는 store에 등록돼 에디터(6b)가 찾을 수 있고, 사이드카 봉투로 저장된다
    const entry = useShare.getState().getDoc(R1, 'note:n-a');
    expect(entry?.ydoc).toBeInstanceOf(Y.Doc);
    expect(readManifest(useShare.getState().getDoc(R1, MANIFEST_KEY)!.ydoc).has('n-a')).toBe(true);
    expect(fs.get(`${FOLDER}/a.md`)).toContain('본문 충분히 긴 알파 노트입니다'); // 시드가 파일을 건드리지 않는다
    // 제어 핸들: ensureNoteDoc은 store 등록 문서를 돌려준다
    const doc = await useShare.getState().getRoom(R1)!.replica!.ensureNoteDoc('n-a');
    expect(doc?.ydoc).toBe(entry!.ydoc);
    expect(await useShare.getState().getRoom(R1)!.replica!.ensureNoteDoc('nope')).toBeNull();
  });

  it('disconnectRoom은 대기 중인 편집을 flush하고 매니저·store 등록을 정리한다', async () => {
    const { deps, fs, providers, fake } = setup('participant');
    deps.replicaOptions = { ...deps.replicaOptions, writeDebounceMs: 60_000 } as typeof deps.replicaOptions;
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    providers[0].sync();
    const mdoc = useShare.getState().getDoc(R1, MANIFEST_KEY)!.ydoc;
    const remote = new Y.Doc();
    const { upsertManifestEntry } = await import('./manifest');
    upsertManifestEntry(remote, 'n-a', { path: 'a.md', title: '알파', seeded: true });
    Y.applyUpdate(mdoc, Y.encodeStateAsUpdate(remote));
    await getReplica(R1)!.idle();
    const noteDoc = useShare.getState().getDoc(R1, 'note:n-a')!.ydoc;
    const seedDoc = new Y.Doc();
    codec.markdownToYDoc('# 알파\n\n알파 본문입니다', seedDoc);
    Y.applyUpdate(noteDoc, Y.encodeStateAsUpdate(seedDoc));
    await until(() => fs.has(`${FOLDER}/a.md`), '물질화');
    await getReplica(R1)!.idle();
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText('종료 직전 편집')]);
    noteDoc.transact(() => noteDoc.getXmlFragment('default').insert(noteDoc.getXmlFragment('default').length, [p]));
    expect(fs.get(`${FOLDER}/a.md`)).not.toContain('종료 직전 편집');
    await disconnectRoom(R1);
    expect(fs.get(`${FOLDER}/a.md`)).toContain('종료 직전 편집'); // flush
    expect(fake.sidecars.has(noteSidecarKey(FOLDER, 'n-a'))).toBe(true);
    expect(getReplica(R1)).toBeUndefined();
    const room = useShare.getState().getRoom(R1)!;
    expect(room.replica).toBeNull();
    expect(room.notes).toEqual({});
    expect(room.docs).toEqual({});
  });

  it('강퇴(denied)를 받으면 대기 중인 편집을 flush하지만 로컬 복제본은 유지한다', async () => {
    const { deps, fs, providers, sockets } = setup('participant');
    deps.replicaOptions = { ...deps.replicaOptions, writeDebounceMs: 60_000 } as typeof deps.replicaOptions;
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    providers[0].sync();
    const mdoc = useShare.getState().getDoc(R1, MANIFEST_KEY)!.ydoc;
    const remote = new Y.Doc();
    const { upsertManifestEntry } = await import('./manifest');
    upsertManifestEntry(remote, 'n-a', { path: 'a.md', title: '알파', seeded: true });
    Y.applyUpdate(mdoc, Y.encodeStateAsUpdate(remote));
    await getReplica(R1)!.idle();
    const noteDoc = useShare.getState().getDoc(R1, 'note:n-a')!.ydoc;
    const seedDoc = new Y.Doc();
    codec.markdownToYDoc('# 알파\n\n알파 본문입니다', seedDoc);
    Y.applyUpdate(noteDoc, Y.encodeStateAsUpdate(seedDoc));
    await until(() => fs.has(`${FOLDER}/a.md`), '물질화');
    await getReplica(R1)!.idle();
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText('강퇴 직전 편집')]);
    noteDoc.transact(() => noteDoc.getXmlFragment('default').insert(noteDoc.getXmlFragment('default').length, [p]));
    sockets[0].close(4403); // 릴레이가 보내는 강퇴 close code
    await until(() => (fs.get(`${FOLDER}/a.md`) ?? '').includes('강퇴 직전 편집'), 'denied 시 flush');
    expect(useShare.getState().getRoom(R1)?.status).toBe('denied');
    expect(useShare.getState().isSharedNote(`${FOLDER}/a.md`)).toBe(true); // 로컬 노트는 그대로
  });

  it('scanSharedFolders는 모든 방의 매니저를 스캔한다(새 노트 공유)', async () => {
    const { deps, fs, providers } = setup('participant');
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    providers[0].sync();
    await getReplica(R1)!.idle();
    fs.put(`${FOLDER}/new.md`, '# 새 노트\n\n앱 실행 중에 만든 노트');
    await scanSharedFolders();
    await until(() => readManifest(useShare.getState().getDoc(R1, MANIFEST_KEY)!.ydoc).size === 1, '새 노트 시드');
  });
});

describe('bootShare가 기억한 복제 설정', () => {
  it('이후 인자 없이 부르는 connectRoom(만들기·참가 흐름)도 같은 noteCodec으로 매니저를 만든다', async () => {
    const { deps } = setup('participant');
    await bootShare(deps); // noteCodec·훅을 기억하고 방에 연결
    expect(getReplica(R1)).toBeDefined();
    await disconnectRoom(R1);
    expect(getReplica(R1)).toBeUndefined();
    // flows.ts처럼 api·factories만 넘긴다
    await connectRoom(R1, { api: deps.api, factories: deps.factories, sidecarDebounceMs: 10 });
    expect(getReplica(R1)).toBeDefined();
  });
});

/** 폴더째 이름을 바꾼 것처럼 메모리 파일시스템·사이드카(가짜 IPC)의 경로를 옮긴다. */
function moveFolder(fs: MemFs, fake: { sidecars: Map<string, Uint8Array> }, from: string, to: string): void {
  for (const [p, f] of [...fs.files]) {
    if (!p.startsWith(from + '/')) continue;
    fs.files.delete(p);
    fs.files.set(to + p.slice(from.length), f);
  }
  for (const d of [...fs.dirs]) {
    if (d === from || d.startsWith(from + '/')) {
      fs.dirs.delete(d);
      fs.dirs.add(to + d.slice(from.length));
    }
  }
  for (const [k, v] of [...fake.sidecars]) {
    if (!k.startsWith(from + '|')) continue;
    fake.sidecars.delete(k);
    fake.sidecars.set(to + k.slice(from.length), v);
  }
}

describe('공유 폴더 이름 변경·이동 뒤에도 복제가 새 경로를 쓴다', () => {
  async function materializedParticipant(writeDebounceMs?: number) {
    const e = setup('participant');
    if (writeDebounceMs) e.deps.replicaOptions = { ...e.deps.replicaOptions, writeDebounceMs } as typeof e.deps.replicaOptions;
    await refreshShareMarkers(e.deps);
    await connectRoom(R1, e.deps);
    e.providers[0].sync();
    const mdoc = useShare.getState().getDoc(R1, MANIFEST_KEY)!.ydoc;
    const remote = new Y.Doc();
    const { upsertManifestEntry } = await import('./manifest');
    upsertManifestEntry(remote, 'n-a', { path: 'a.md', title: '알파', seeded: true });
    Y.applyUpdate(mdoc, Y.encodeStateAsUpdate(remote));
    await getReplica(R1)!.idle();
    const noteDoc = useShare.getState().getDoc(R1, 'note:n-a')!.ydoc;
    const seedDoc = new Y.Doc();
    codec.markdownToYDoc('# 알파\n\n알파 본문입니다', seedDoc);
    Y.applyUpdate(noteDoc, Y.encodeStateAsUpdate(seedDoc));
    await until(() => e.fs.has(`${FOLDER}/a.md`), '물질화');
    await getReplica(R1)!.idle();
    await until(() => e.fake.sidecars.has('/ws/team|_manifest'), 'manifest 사이드카 저장');
    return e;
  }

  it('폴더 이름을 바꾼 뒤 원격 편집이 새 경로 파일에 반영되고, 공유 노트 표식이 끊긴 틈 없이 새 경로를 따라간다', async () => {
    const e = await materializedParticipant();
    const NEW = '/ws/renamed';
    const before = getReplica(R1)!;
    moveFolder(e.fs, e.fake, FOLDER, NEW);
    // 사이드바가 디스크 이동 직후 부르는 즉시 재매핑 — 재스캔이 돌기 전에도 공유 노트다
    useShare.getState().relocateFolder(FOLDER, NEW);
    expect(useShare.getState().sharedNoteAt(`${NEW}/a.md`)).toEqual({ roomId: R1, noteId: 'n-a', role: 'participant' });
    expect(useShare.getState().isSharedNote(`${FOLDER}/a.md`)).toBe(false);
    // 표식 재스캔(트리 변경 → bootShare)이 방을 새 경로로 다시 시작한다
    e.fake.api.listMarkers = async () => [{ folderPath: NEW, marker: marker('participant') }];
    await refreshShareMarkers(e.deps);
    const after = getReplica(R1)!;
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
    await until(() => useShare.getState().isSharedNote(`${NEW}/a.md`), '새 경로에서 공유 노트 등록');
    await after.idle();
    const noteDoc = useShare.getState().getDoc(R1, 'note:n-a')!.ydoc;
    appendParagraph(noteDoc, '이름을 바꾼 뒤 원격이 추가한 문단');
    await until(() => (e.fs.get(`${NEW}/a.md`) ?? '').includes('이름을 바꾼 뒤 원격이 추가한 문단'), '새 경로 파일에 원격 편집 반영');
    expect(e.fs.has(`${FOLDER}/a.md`)).toBe(false); // 옛 경로에 아무것도 되살리지 않는다
    expect(e.fs.paths().every((p) => !p.startsWith(FOLDER + '/'))).toBe(true);
    // 사이드카도 새 경로에 저장된다
    await until(() => e.fake.sidecars.has(noteSidecarKey(NEW, 'n-a')), '사이드카가 새 경로에');
    expect([...e.fake.sidecars.keys()].some((k) => k.startsWith(`${FOLDER}|`))).toBe(false);
  });

  it('상위 폴더를 옮겨도(공유 폴더가 하위) 같다', async () => {
    const e = await materializedParticipant();
    // /ws/team → /ws/archive/team
    const NEW = '/ws/archive/team';
    moveFolder(e.fs, e.fake, FOLDER, NEW);
    e.fs.put(`${NEW}/.keep`, ''); // 상위 폴더가 생겼다
    useShare.getState().relocateFolder('/ws', '/ws'); // 같은 경로는 무시(안전)
    e.fake.api.listMarkers = async () => [{ folderPath: NEW, marker: marker('participant') }];
    await refreshShareMarkers(e.deps);
    await until(() => useShare.getState().isSharedNote(`${NEW}/a.md`), '새 경로');
    expect(useShare.getState().getRoom(R1)!.folderPath).toBe(NEW);
  });

  it('flushSharedRooms는 이동 직전에 대기 중인 원격 편집을 옛 경로 파일과 사이드카에 남긴다', async () => {
    const e = await materializedParticipant(60_000); // 디바운스가 끝나기 전에 flush가 써야 한다
    const noteDoc = useShare.getState().getDoc(R1, 'note:n-a')!.ydoc;
    appendParagraph(noteDoc, '이동 직전 편집');
    expect(e.fs.get(`${FOLDER}/a.md`)).not.toContain('이동 직전 편집');
    await flushSharedRooms();
    expect(e.fs.get(`${FOLDER}/a.md`)).toContain('이동 직전 편집');
  });
});

describe('토큰이 없는 방(no_token) — 이 기기는 아직 참가하지 않았다', () => {
  it('연결하지 않고 복제도 없다: 폴더의 파일은 서버와 주고받지 않고 일반 파일처럼 취급된다(공유 노트로 등록되지 않는다)', async () => {
    const e = setup('participant', (fs) => fs.put(`${FOLDER}/a.md`, serializeNote({ id: 'n-a', title: '알파', body: '# 알파\n\n로컬 본문', links: [] })));
    e.fake.tokens.delete(R1); // iCloud로 폴더만 받은 두 번째 Mac
    await refreshShareMarkers(e.deps);
    expect(await connectRoom(R1, e.deps)).toBe(false);
    const room = useShare.getState().getRoom(R1)!;
    expect(room).toMatchObject({ status: 'denied', error: 'no_token' });
    expect(e.sockets).toHaveLength(0); // 서버에 연결하지 않는다
    expect(e.providers).toHaveLength(0);
    expect(getReplica(R1)).toBeUndefined();
    expect(room.replica).toBeNull();
    // 로컬에서 고친 파일이 공유 노트로 잡히지 않는다 → 저장 경로가 일반 노트와 같다(공유 노트 보호 분기에 걸리지 않는다)
    e.fs.put(`${FOLDER}/a.md`, serializeNote({ id: 'n-a', title: '알파', body: '# 알파\n\n로컬에서 고침', links: [] }));
    await scanSharedFolders();
    expect(useShare.getState().isSharedNote(`${FOLDER}/a.md`)).toBe(false);
    expect(useShare.getState().sharedNoteAt(`${FOLDER}/a.md`)).toBeNull();
    expect(e.fs.get(`${FOLDER}/a.md`)).toContain('로컬에서 고침'); // 아무도 덮어쓰지 않는다
    expect(e.fake.sidecars.size).toBe(0);
  });

  it('상태 문구는 내보내짐(denied)과 다르다', () => {
    expect(connStatusText('denied', 'no_token')).toBe('참가 필요');
    expect(connStatusText('denied', 'revoked')).toBe('접근 해제됨');
    expect(connStatusText('denied', null)).toBe('접근 해제됨');
    expect(connStatusText('connected', null)).toBe('연결됨');
  });
});
