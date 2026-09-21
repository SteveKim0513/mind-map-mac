// @vitest-environment jsdom
// rooms.ts ↔ FileReplicaManager 배선 — fileHooks/fileFs가 주어지면 방마다 맵·보드 복제 매니저가 만들어지고
// store(`files`·`isViewerFile`)와 저장 훅(`notifyFileSaved`)에 연결되는지.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { emptyDoc, serialize } from '../io/formats';
import { isViewerFile, notifyFileSaved, setFileSavedHook, useShare } from '../store/shareStore';
import type { MindMapDoc, ShareMarker } from '../types';
import { MANIFEST_KEY } from './docKeys';
import { readFileDoc, writeFileDoc } from './fileReplica';
import { upsertManifestFileEntry } from './manifest';
import { bootShare, connectRoom, disconnectRoom, getFileReplica, getFileReplicas, refreshShareMarkers, stopAllRooms } from './rooms';
import { MemFileFs, until } from './replicaTestKit';
import { makeFakeFactories, makeFakeShareApi } from './testFakes';

const R1 = 'room-AAAAAAAA';
const PID = 'pid-AAAAAAAAAAAA';
const FOLDER = '/ws/team';

const marker = (role: ShareMarker['role']): ShareMarker => ({
  v: 1,
  roomId: R1,
  relayUrl: 'https://relay.example.com',
  role,
  participantId: PID,
  folderName: 'team',
  displayName: '지호',
});

function mapText(id: string, text: string): string {
  const doc: MindMapDoc = emptyDoc();
  doc.id = id;
  doc.rootIds = ['r'];
  doc.nodes = { r: { id: 'r', text, parentId: null, children: [], collapsed: false } };
  return serialize(doc);
}

function setup(role: ShareMarker['role'], init: (fs: MemFileFs) => void = () => {}) {
  const fs = new MemFileFs(FOLDER);
  init(fs);
  const fake = makeFakeShareApi({ listMarkers: async () => [{ folderPath: FOLDER, marker: marker(role) }] });
  fake.tokens.set(R1, 'tok-1');
  const f = makeFakeFactories();
  const written: string[] = [];
  const deps = {
    api: fake.api,
    factories: f.factories,
    sidecarDebounceMs: 10,
    fileFs: fs,
    fileHooks: { onFileWritten: (p: string) => written.push(p) },
    fileOptions: { publishDebounceMs: 10, deleteConfirmScans: 1, missingRecheckMs: 0, remoteDeleteGraceMs: 20 },
  };
  return { fs, fake, ...f, deps, written };
}

beforeEach(() => {
  useShare.setState({ rooms: {} });
});
afterEach(async () => {
  await stopAllRooms();
  setFileSavedHook(null);
});

describe('connectRoom + fileHooks/fileFs', () => {
  it('fileHooks·fileFs가 없으면 파일 복제 매니저를 만들지 않는다(기존 동작)', async () => {
    const { deps } = setup('participant');
    await refreshShareMarkers(deps);
    await connectRoom(R1, { ...deps, fileFs: undefined, fileHooks: undefined });
    expect(getFileReplica(R1)).toBeUndefined();
    expect(useShare.getState().getRoom(R1)?.files).toEqual({});
  });

  it('소유자: 연결하면 첫 스캔에서 폴더의 맵을 발행하고 store에 경로를 채운다 — 뷰어 대상은 아니다', async () => {
    const { deps, fs } = setup('owner', (f) => f.put(`${FOLDER}/plan.mind`, mapText('map-plan', '계획')));
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    expect(getFileReplica(R1)).toBeDefined();
    expect(getFileReplicas()).toHaveLength(1);
    const room = useShare.getState().getRoom(R1)!;
    expect(room.files).toEqual({ [`${FOLDER}/plan.mind`]: 'map-plan' });
    expect(isViewerFile(useShare.getState().rooms, `${FOLDER}/plan.mind`)).toBe(false); // 소유자는 편집한다
    const doc = useShare.getState().getDoc(R1, 'file:map-plan')!.ydoc;
    expect(readFileDoc(doc)?.kind).toBe('map');
    expect(fs.writes).toEqual([]); // 소유자 파일은 건드리지 않는다
  });

  it('저장 훅: bootShare가 등록한 notifyFileSaved가 소유자 발행을 트리거한다', async () => {
    const { deps, fs, providers } = setup('owner', (f) => f.put(`${FOLDER}/plan.mind`, mapText('map-plan', '계획')));
    await bootShare(deps);
    providers[0].sync();
    fs.put(`${FOLDER}/plan.mind`, mapText('map-plan', '계획 (수정)'));
    notifyFileSaved(`${FOLDER}/plan.mind`);
    const doc = useShare.getState().getDoc(R1, 'file:map-plan')!.ydoc;
    await until(() => (readFileDoc(doc)?.content ?? '').includes('계획 (수정)'), '저장 → 발행');
    notifyFileSaved('/ws/elsewhere/other.mind'); // 공유 폴더 밖 — 무시
    notifyFileSaved(`${FOLDER}/note.md`); // 맵·보드가 아님 — 무시
  });

  it('참가자: 원격 항목·내용이 도착하면 미러 파일이 만들어지고 store에 뷰어 경로로 등록된다', async () => {
    const { deps, fs, providers, written } = setup('participant');
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    providers[0].sync();
    const room = () => useShare.getState().getRoom(R1)!;
    // 소유자 쪽 상태를 흉내 낸다: file 문서 내용 + manifest 항목
    const ownerFile = new Y.Doc();
    writeFileDoc(ownerFile, { content: mapText('map-plan', '계획'), kind: 'map', rev: 1 });
    const ownerManifest = new Y.Doc();
    upsertManifestFileEntry(ownerManifest, 'map-plan', { path: 'plan.mind', kind: 'map', title: 'plan' });
    Y.applyUpdate(useShare.getState().getDoc(R1, MANIFEST_KEY)!.ydoc, Y.encodeStateAsUpdate(ownerManifest));
    await until(() => !!useShare.getState().getDoc(R1, 'file:map-plan'), '파일 문서 열림');
    Y.applyUpdate(useShare.getState().getDoc(R1, 'file:map-plan')!.ydoc, Y.encodeStateAsUpdate(ownerFile));
    await until(() => fs.has(`${FOLDER}/plan.mind`), '미러 생성');
    await getFileReplica(R1)!.idle();
    expect(room().files).toEqual({ [`${FOLDER}/plan.mind`]: 'map-plan' });
    expect(isViewerFile(useShare.getState().rooms, `${FOLDER}/plan.mind`)).toBe(true);
    expect(isViewerFile(useShare.getState().rooms, `${FOLDER}/mine.mind`)).toBe(false); // 참가자가 직접 만든 파일은 편집 가능
    expect(written).toEqual([`${FOLDER}/plan.mind`]);
    // 공유 폴더 밖 경로는 뷰어가 아니다
    expect(isViewerFile(useShare.getState().rooms, '/ws/other/plan.mind')).toBe(false);
    // 연결을 끊어도 뷰어 표식은 유지된다(공유가 끝나도 읽기 전용 유지)
    await disconnectRoom(R1);
    expect(isViewerFile(useShare.getState().rooms, `${FOLDER}/plan.mind`)).toBe(true);
    expect(getFileReplica(R1)).toBeUndefined();
  });
});
