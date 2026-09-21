// 맵·보드 파일 복제 매니저 단위 테스트 — 가짜 소켓·프로바이더(네트워크 없음) + 메모리 파일시스템.
// 실제 릴레이와의 통합은 fileReplica.integration.test.ts. 여기서는 상한(maxFiles)과 공유 검증 거부 안내를 다룬다.
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { emptyDoc, serialize } from '../io/formats';
import type { MindMapDoc, ShareRole } from '../types';
import { MANIFEST_KEY, fileKey } from './docKeys';
import { createFileReplicaManager, writeFileDoc, type FileReplicaHooks, type FileReplicaManager } from './fileReplica';
import { readManifestFiles, upsertManifestFileEntry } from './manifest';
import { MemFileFs, until } from './replicaTestKit';
import { createShareSession, type ShareSession } from './shareClient';
import { makeFakeFactories, makeFakeShareApi, type FakeProvider } from './testFakes';

const ROOM = 'room-AAAAAAAA';
const FOLDER = '/ws/team';

interface Env {
  fs: MemFileFs;
  session: ShareSession;
  providers: FakeProvider[];
  manager: FileReplicaManager;
  manifestDoc: Y.Doc;
  hooks: FileReplicaHooks & { messages: string[]; logs: string[] };
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function setup(role: ShareRole, o: { init?: (fs: MemFileFs) => void; maxFiles?: number } = {}): Promise<Env> {
  const fs = new MemFileFs(FOLDER);
  o.init?.(fs);
  const { factories, providers } = makeFakeFactories();
  const fake = makeFakeShareApi();
  const session = createShareSession({ roomId: ROOM, wsUrl: 'ws://relay.example', getToken: async () => 't', factories });
  const manifest = session.openDoc(MANIFEST_KEY);
  const hooks: Env['hooks'] = {
    messages: [],
    logs: [],
    notify: (m) => hooks.messages.push(m),
    log: (_l, m) => hooks.logs.push(m),
  };
  const manager = createFileReplicaManager({
    roomId: ROOM,
    folderPath: FOLDER,
    role,
    api: fake.api,
    manifest,
    fs,
    hooks,
    host: {
      openDoc: async (docKey, initialState) => session.openDoc(docKey, { initialState }),
      closeDoc: async (docKey) => session.closeDoc(docKey),
    },
    publishDebounceMs: 5,
    deleteConfirmScans: 1,
    missingRecheckMs: 0,
    maxFiles: o.maxFiles,
  });
  cleanups.push(async () => {
    await manager.stop();
    session.destroy();
  });
  await manager.start();
  return { fs, session, providers, manager, manifestDoc: manifest.ydoc, hooks };
}

function mapText(id: string, text: string): string {
  const doc: MindMapDoc = emptyDoc();
  doc.id = id;
  doc.rootIds = ['r'];
  doc.nodes = { r: { id: 'r', text, parentId: null, children: [], collapsed: false } };
  return serialize(doc);
}

describe('동시 복제 파일 수 상한(maxFiles)', () => {
  it('소유자: 상한을 넘는 파일은 발행하지 않는다(로그만) — 이미 발행한 파일은 그대로', async () => {
    const e = await setup('owner', {
      maxFiles: 2,
      init: (fs) => {
        fs.put(`${FOLDER}/a.mind`, mapText('map-a', 'A'));
        fs.put(`${FOLDER}/b.mind`, mapText('map-b', 'B'));
        fs.put(`${FOLDER}/c.mind`, mapText('map-c', 'C'));
      },
    });
    await e.manager.idle();
    expect(readManifestFiles(e.manifestDoc).size).toBe(2);
    expect(e.manager.stats().files).toBe(2);
    expect(e.hooks.logs.some((l) => l.includes('shared file limit (2) reached'))).toBe(true);
    // 상한 밖 파일은 그대로 로컬 파일로 남는다(삭제·변경 없음)
    expect(e.fs.get(`${FOLDER}/c.mind`)).toContain('C');
    // 다시 스캔해도 늘지 않는다
    await e.manager.scan();
    expect(readManifestFiles(e.manifestDoc).size).toBe(2);
  });

  it('참가자: 소유자가 올린 파일이 상한을 넘으면 상한까지만 미러링한다', async () => {
    const e = await setup('participant', { maxFiles: 2 });
    e.providers[0].sync();
    for (const id of ['f1', 'f2', 'f3']) {
      upsertManifestFileEntry(e.manifestDoc, id, { path: `${id}.mind`, kind: 'map', title: id });
    }
    await e.manager.reconcile();
    await e.manager.idle();
    expect(e.manager.stats().files).toBe(2);
    expect(e.hooks.logs.some((l) => l.includes('shared file limit (2) reached'))).toBe(true);
  });
});

describe('공유 검증 거부 — 사용자 안내와 로그(사유 코드만)', () => {
  const BAD = '{"this is": "not a mind map"}'; // 표준 형식이 아니다(parse/shape)
  const SECRET = 'TOP-SECRET-TEXT-12345';

  it('소유자: 발행이 거부되면 사유와 함께 토스트를 한 번 띄우고 로그에는 사유 코드만 남긴다 — 다시 유효해지면 발행하고, 또 깨지면 다시 알린다', async () => {
    const e = await setup('owner', { init: (fs) => fs.put(`${FOLDER}/plan.mind`, JSON.stringify({ [SECRET]: 1 })) });
    await e.manager.idle();
    expect(readManifestFiles(e.manifestDoc).size).toBe(0);
    expect(e.hooks.messages).toHaveLength(1);
    expect(e.hooks.messages[0]).toContain('"plan"');
    expect(e.hooks.messages[0]).toContain('표준 형식이 아니에요');
    const logs = e.hooks.logs.join('\n');
    expect(logs).toMatch(/skip file: rejected \((parse|shape|bad_field)\)/);
    expect(logs).not.toContain(SECRET); // 파일 내용은 로그에 남지 않는다
    expect(e.hooks.messages.join('\n')).not.toContain(SECRET);

    // 같은 파일을 다시 저장해도(거부 유지) 토스트는 반복되지 않는다
    e.manager.onFileSaved(`${FOLDER}/plan.mind`);
    await until(() => true, '디바운스');
    await e.manager.flush();
    expect(e.hooks.messages).toHaveLength(1);

    // 유효해지면 발행된다
    e.fs.put(`${FOLDER}/plan.mind`, mapText('map-plan', '계획'));
    e.manager.onFileSaved(`${FOLDER}/plan.mind`);
    await e.manager.flush();
    await until(() => readManifestFiles(e.manifestDoc).size === 1, '발행');

    // 또 깨지면 다시 알린다(이전에 발행한 내용은 유지)
    e.fs.put(`${FOLDER}/plan.mind`, BAD);
    e.manager.onFileSaved(`${FOLDER}/plan.mind`);
    await e.manager.flush();
    expect(e.hooks.messages).toHaveLength(2);
    expect(readManifestFiles(e.manifestDoc).size).toBe(1);
  });

  it('소유자: 크기·구조 상한 사유도 문구가 다르다(too_large)', async () => {
    const huge = mapText('map-huge', 'x'.repeat(5 * 1024 * 1024));
    const e = await setup('owner', { init: (fs) => fs.put(`${FOLDER}/huge.mind`, huge) });
    await e.manager.idle();
    expect(e.hooks.messages[0]).toContain('파일이 너무 커요');
    expect(e.hooks.logs.join('\n')).toContain('rejected (too_large)');
  });

  async function participantWithMirrorContent(content: string) {
    const e = await setup('participant');
    e.providers[0].sync();
    upsertManifestFileEntry(e.manifestDoc, 'f-plan', { path: 'plan.mind', kind: 'map', title: '계획' });
    await e.manager.reconcile();
    await e.manager.idle();
    const local = e.session.getDoc(fileKey('f-plan'))!.ydoc;
    // 참가자의 미러는 **원격**에서 온 변경만 처리한다 — 소유자의 문서에 쓴 뒤 update를 흘려 넣는 것으로 흉내 낸다.
    const owner = new Y.Doc();
    const doc = {
      set: (c: string, rev: number) => {
        writeFileDoc(owner, { content: c, kind: 'map', rev });
        Y.applyUpdate(local, Y.encodeStateAsUpdate(owner, Y.encodeStateVector(local)));
      },
    };
    doc.set(content, 1);
    return { e, doc };
  }

  it('참가자: 받은 내용이 거부되면 미러를 만들지 않고 토스트 한 번 + 사유 코드 로그(내용 없음)', async () => {
    const { e, doc } = await participantWithMirrorContent(JSON.stringify({ [SECRET]: 1, __proto__x: 1 }));
    await until(() => e.hooks.messages.length > 0, '거부 안내');
    await e.manager.idle();
    expect(e.fs.paths()).toEqual([]); // 미러 파일이 만들어지지 않았다
    expect(e.hooks.messages).toHaveLength(1);
    expect(e.hooks.messages[0]).toContain('소유자의 "계획"');
    expect(e.hooks.messages[0]).toContain('반영하지 않았어요');
    const logs = e.hooks.logs.join('\n');
    expect(logs).toMatch(/mirror rejected: (parse|shape|bad_field)/);
    expect(logs).not.toContain(SECRET);

    // 같은 거부가 반복돼도 토스트는 한 번(rev만 올려 다시 써 본다)
    doc.set(JSON.stringify({ [SECRET]: 2 }), 2);
    await e.manager.idle();
    expect(e.hooks.messages).toHaveLength(1);

    // 유효한 내용이 오면 미러가 만들어진다
    doc.set(mapText('map-plan', '계획'), 3);
    await until(() => e.fs.has(`${FOLDER}/plan.mind`), '미러 생성');
    // 이후 또 거부되면 다시 알린다
    doc.set(BAD, 4);
    await until(() => e.hooks.messages.length === 2, '두 번째 거부 안내');
  });

  it('참가자: 구조는 맞지만 위험한 값(__proto__ 키)이 든 내용은 unsafe_key로 거부한다', async () => {
    const evil = '{"id":"m","rootIds":["r"],"nodes":{"r":{"id":"r","text":"x","parentId":null,"children":[],"collapsed":false}},"__proto__":{"polluted":true}}';
    const { e } = await participantWithMirrorContent(evil);
    await until(() => e.hooks.messages.length > 0, '거부 안내');
    expect(e.fs.paths()).toEqual([]);
    expect(e.hooks.messages[0]).toContain('안전하지 않은 값');
    expect(e.hooks.logs.join('\n')).toContain('mirror rejected: unsafe_key');
  });
});
