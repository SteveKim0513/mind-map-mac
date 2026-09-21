import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { ShareMarker } from '../types';
import { useShare } from '../store/shareStore';
import {
  bootShare,
  closeSharedDoc,
  connectRoom,
  disconnectRoom,
  getSession,
  openSharedDoc,
  MARKER_CONFIRM_SCANS,
  refreshParticipants,
  refreshShareMarkers,
  stopAllRooms,
} from './rooms';
import { REVOKED_CLOSE_CODE } from './shareClient';
import { encodeSidecar } from './sidecar';
import { makeFakeFactories, makeFakeShareApi, noteSidecarId, type FakeProvider, type FakeSocket } from './testFakes';

const R1 = 'room-AAAAAAAA';
const R2 = 'room-BBBBBBBB';
const PID = 'pid-AAAAAAAAAAAA';

function marker(roomId: string, over: Partial<ShareMarker> = {}): ShareMarker {
  return {
    v: 1,
    roomId,
    relayUrl: 'https://relay.example.com',
    role: 'participant',
    participantId: PID,
    folderName: 'team',
    displayName: '지호',
    ...over,
  };
}

function setup(entries = [{ folderPath: '/ws/team', marker: marker(R1) }], apiOver = {}) {
  const fake = makeFakeShareApi({ listMarkers: async () => entries, ...apiOver });
  fake.tokens.set(R1, 'tok-1');
  fake.tokens.set(R2, 'tok-2');
  const f = makeFakeFactories();
  const deps = { api: fake.api, factories: f.factories, sidecarDebounceMs: 10, markerRescanDelayMs: 0 };
  return { ...fake, ...f, deps };
}

beforeEach(() => {
  useShare.setState({ rooms: {} });
});
afterEach(async () => {
  await stopAllRooms();
});

describe('refreshShareMarkers', () => {
  it('표식을 store에 반영하고, 경계에서 검증 실패한 항목은 버린다', async () => {
    const { deps } = setup([
      { folderPath: '/ws/team', marker: marker(R1) },
      { folderPath: '/ws/evil', marker: { ...marker(R2), relayUrl: 'file:///etc/passwd' } as ShareMarker },
    ]);
    await refreshShareMarkers(deps);
    expect(Object.keys(useShare.getState().rooms)).toEqual([R1]);
  });

  it('listMarkers가 실패해도 던지지 않는다', async () => {
    const { deps } = setup([], {
      listMarkers: async () => {
        throw new Error('ipc');
      },
    });
    await expect(refreshShareMarkers(deps)).resolves.toBeUndefined();
    expect(useShare.getState().rooms).toEqual({});
  });

  it('표식이 사라진 방은 연결을 정리한다', async () => {
    const { deps, api } = setup();
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    expect(getSession(R1)).toBeDefined();
    (api as unknown as { listMarkers: () => Promise<unknown[]> }).listMarkers = async () => [];
    await refreshShareMarkers(deps);
    expect(getSession(R1)).toBeUndefined();
    expect(useShare.getState().getRoom(R1)).toBeUndefined();
  });
});

describe('refreshShareMarkers — 일시적 실패·부분 결과에 강하다', () => {
  const listOf = (...folders: string[]) => folders.map((folderPath, i) => ({ folderPath, marker: marker(i === 0 ? R1 : R2) }));

  it('스캔 자체가 실패(IPC 오류)하면 기존 방·연결을 그대로 둔다', async () => {
    const { deps, api } = setup();
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    const session = getSession(R1);
    (api as unknown as { listMarkers: () => Promise<unknown[]> }).listMarkers = async () => {
      throw new Error('EBUSY');
    };
    await refreshShareMarkers(deps);
    expect(useShare.getState().getRoom(R1)).toBeDefined();
    expect(getSession(R1)).toBe(session); // 연결이 끊기지 않았다
  });

  it('listMarkers가 배열이 아닌 값을 주면 스캔 실패로 본다(방을 지우지 않는다)', async () => {
    const { deps, api } = setup();
    await refreshShareMarkers(deps);
    (api as unknown as { listMarkers: () => Promise<unknown> }).listMarkers = async () => null;
    await refreshShareMarkers(deps);
    expect(useShare.getState().getRoom(R1)).toBeDefined();
  });

  it('이번 스캔에만 안 보이는 방(부분 결과)은 다시 훑어 보이면 유지한다 — 연결이 끊기지 않는다', async () => {
    const { deps, api } = setup();
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    const session = getSession(R1);
    let calls = 0;
    (api as unknown as { listMarkers: () => Promise<unknown[]> }).listMarkers = async () => (++calls === 1 ? [] : listOf('/ws/team'));
    await refreshShareMarkers(deps);
    expect(calls).toBe(2);
    expect(useShare.getState().getRoom(R1)).toBeDefined();
    expect(getSession(R1)).toBe(session);
  });

  it('두 번 연속 안 보이다 세 번째에 보이면 유지, 세 번 연속 안 보여야 정리한다', async () => {
    const { deps, api } = setup();
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    let calls = 0;
    (api as unknown as { listMarkers: () => Promise<unknown[]> }).listMarkers = async () => (++calls < 3 ? [] : listOf('/ws/team'));
    await refreshShareMarkers(deps);
    expect(calls).toBe(3);
    expect(getSession(R1)).toBeDefined();

    calls = 0;
    (api as unknown as { listMarkers: () => Promise<unknown[]> }).listMarkers = async () => (calls++, []);
    await refreshShareMarkers(deps);
    expect(calls).toBe(MARKER_CONFIRM_SCANS);
    expect(useShare.getState().getRoom(R1)).toBeUndefined();
    expect(getSession(R1)).toBeUndefined();
  });

  it('확인 재스캔 중에 오류가 나면 확인하지 못한 것이므로 안 보이는 방을 모두 유지한다', async () => {
    const { deps, api } = setup();
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    let calls = 0;
    (api as unknown as { listMarkers: () => Promise<unknown[]> }).listMarkers = async () => {
      if (++calls === 2) throw new Error('EBUSY');
      return [];
    };
    await refreshShareMarkers(deps);
    expect(useShare.getState().getRoom(R1)).toBeDefined();
    expect(getSession(R1)).toBeDefined();
  });

  it('보이는 방의 새 표식은 확인 재스캔과 무관하게 바로 반영된다', async () => {
    const { deps, api } = setup();
    await refreshShareMarkers(deps);
    (api as unknown as { listMarkers: () => Promise<unknown[]> }).listMarkers = async () => [
      { folderPath: '/ws/new', marker: marker(R2) },
    ];
    await refreshShareMarkers(deps); // R1은 안 보이고(연속 3번) R2는 새로 보인다
    expect(Object.keys(useShare.getState().rooms)).toEqual([R2]);
  });

  it('동시에 여러 번 불러도 직렬로 처리한다(스캔·정리가 겹치지 않는다)', async () => {
    const { deps, api } = setup();
    let active = 0;
    let maxActive = 0;
    (api as unknown as { listMarkers: () => Promise<unknown[]> }).listMarkers = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return listOf('/ws/team');
    };
    await Promise.all([refreshShareMarkers(deps), refreshShareMarkers(deps), refreshShareMarkers(deps)]);
    expect(maxActive).toBe(1);
  });
});

describe('refreshShareMarkers — 같은 roomId의 표식이 여러 폴더에 있을 때', () => {
  it('기존 방이 연결된 폴더에만 연결하고, 복사본은 충돌로 남기며 방을 가로채지 못한다', async () => {
    const both = [
      { folderPath: '/ws/team', marker: marker(R1) },
      { folderPath: '/ws/team 복사본', marker: marker(R1) },
    ];
    const { deps, api } = setup(both);
    await refreshShareMarkers(deps);
    let room = useShare.getState().getRoom(R1)!;
    expect(room.folderPath).toBe('/ws/team');
    expect(room.conflictPaths).toEqual(['/ws/team 복사본']);
    // 복사본이 경로순으로 앞서더라도 이미 연결된 폴더가 이긴다
    (api as unknown as { listMarkers: () => Promise<unknown[]> }).listMarkers = async () => [
      { folderPath: '/ws/a 복사본', marker: marker(R1) },
      { folderPath: '/ws/team', marker: marker(R1) },
    ];
    await refreshShareMarkers(deps);
    room = useShare.getState().getRoom(R1)!;
    expect(room.folderPath).toBe('/ws/team');
    expect(room.conflictPaths).toEqual(['/ws/a 복사본']);
    // 연결은 하나만 만들어진다
    await connectRoom(R1, deps);
    expect(getSession(R1)).toBeDefined();
  });

  it('충돌이 해소되면(복사본 삭제) conflictPaths가 비워진다', async () => {
    const { deps, api } = setup([
      { folderPath: '/ws/team', marker: marker(R1) },
      { folderPath: '/ws/copy', marker: marker(R1) },
    ]);
    await refreshShareMarkers(deps);
    expect(useShare.getState().getRoom(R1)!.conflictPaths).toHaveLength(1);
    (api as unknown as { listMarkers: () => Promise<unknown[]> }).listMarkers = async () => [{ folderPath: '/ws/team', marker: marker(R1) }];
    await refreshShareMarkers(deps);
    expect(useShare.getState().getRoom(R1)!.conflictPaths).toEqual([]);
  });
});

describe('공유 폴더 이름 변경·이동 — 방을 새 경로로 다시 시작한다', () => {
  it('폴더 경로가 바뀌면 옛 세션을 정리하고 새 경로로 다시 연결한다(옛 경로를 붙잡은 매니저·사이드카가 남지 않는다)', async () => {
    const { deps, api, sockets, sidecars } = setup();
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    const first = getSession(R1)!;
    const doc = useShare.getState().getDoc(R1, 'manifest')!.ydoc;
    (api as unknown as { listMarkers: () => Promise<unknown[]> }).listMarkers = async () => [{ folderPath: '/ws/renamed', marker: marker(R1) }];
    await refreshShareMarkers(deps);
    const second = getSession(R1)!;
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(sockets[0].destroyed).toBe(true);
    expect(sockets).toHaveLength(2);
    expect(useShare.getState().getRoom(R1)).toMatchObject({ folderPath: '/ws/renamed', status: 'connecting' });
    // 새 세션의 사이드카는 새 경로에 저장된다
    const newDoc = useShare.getState().getDoc(R1, 'manifest')!.ydoc;
    expect(newDoc).not.toBe(doc);
    newDoc.getMap('notes').set('n1', { path: 'a.md', title: 'A', rev: 1, seeded: false });
    await vi.waitFor(() => expect(sidecars.has('/ws/renamed|_manifest')).toBe(true));
    expect(sidecars.has('/ws/team|_manifest')).toBe(false);
  });

  it('폴더가 그대로면 다시 시작하지 않는다(멱등)', async () => {
    const { deps, sockets } = setup();
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    await refreshShareMarkers(deps);
    await refreshShareMarkers(deps);
    expect(sockets).toHaveLength(1);
  });

  it('bootShare(트리 변경마다 App이 다시 부른다)도 이름이 바뀐 폴더에 다시 연결한다', async () => {
    const { deps, api, sockets } = setup([{ folderPath: '/ws/a', marker: marker(R1) }]);
    await bootShare(deps);
    (api as unknown as { listMarkers: () => Promise<unknown[]> }).listMarkers = async () => [{ folderPath: '/ws/b', marker: marker(R1) }];
    await bootShare(deps);
    expect(useShare.getState().getRoom(R1)!.folderPath).toBe('/ws/b');
    expect(sockets).toHaveLength(2);
    expect(getSession(R1)).toBeDefined();
  });

  it('내 역할이 표식 파일에서 바뀌면(편집·복사) 역할이 다른 매니저를 새 역할로 다시 시작한다', async () => {
    const { deps, api, sockets } = setup();
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    (api as unknown as { listMarkers: () => Promise<unknown[]> }).listMarkers = async () => [
      { folderPath: '/ws/team', marker: marker(R1, { role: 'owner' }) },
    ];
    await refreshShareMarkers(deps);
    expect(useShare.getState().getRoom(R1)!.marker.role).toBe('owner');
    expect(sockets).toHaveLength(2);
  });
});

describe('서버 값으로 내 역할을 확인한다(표식 role은 로컬 파일이라 신뢰하지 않는다)', () => {
  const me = (role: 'owner' | 'participant') => ({ participantId: PID, displayName: '지호', role, joinedAt: 1, online: true });

  it('표식은 owner인데 서버는 participant라고 하면 서버 값을 따르고, 표식 파일도 정정하고, 소유자 모드로 돌던 연결을 다시 시작한다', async () => {
    const written: ShareMarker[] = [];
    const { deps, sockets } = setup(
      [{ folderPath: '/ws/team', marker: marker(R1, { role: 'owner' }) }],
      {
        participants: async () => ({ ok: true as const, participants: [me('participant')] }),
        writeMarker: async (_f: string, m: ShareMarker) => (written.push(m), { ok: true as const }),
      },
    );
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    expect(await refreshParticipants(R1, deps)).toBe(true);
    expect(useShare.getState().getRoom(R1)!.marker.role).toBe('participant');
    expect(written.map((m) => m.role)).toEqual(['participant']);
    expect(sockets).toHaveLength(2); // 새 역할로 다시 시작
  });

  it('표식 파일을 정정하지 못해도 다음 재스캔이 옛 역할로 되돌리지 못한다(보정값 유지) — 재시작 루프도 없다', async () => {
    const { deps, sockets, api } = setup(
      [{ folderPath: '/ws/team', marker: marker(R1, { role: 'owner' }) }],
      {
        participants: async () => ({ ok: true as const, participants: [me('participant')] }),
        writeMarker: async () => ({ ok: false as const, error: 'io' as const }),
      },
    );
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    await refreshParticipants(R1, deps);
    expect(useShare.getState().getRoom(R1)!.marker.role).toBe('participant');
    const before = sockets.length;
    // 디스크의 표식은 여전히 owner다
    (api as unknown as { listMarkers: () => Promise<unknown[]> }).listMarkers = async () => [
      { folderPath: '/ws/team', marker: marker(R1, { role: 'owner' }) },
    ];
    await refreshShareMarkers(deps);
    await refreshParticipants(R1, deps);
    await refreshShareMarkers(deps);
    expect(useShare.getState().getRoom(R1)!.marker.role).toBe('participant');
    expect(sockets.length).toBe(before); // 더 다시 시작하지 않는다
  });

  it('서버 값과 표식이 같거나 서버 목록에 내가 없으면 아무것도 바꾸지 않는다', async () => {
    const { deps, sockets } = setup(undefined, { participants: async () => ({ ok: true as const, participants: [me('participant')] }) });
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    await refreshParticipants(R1, deps);
    expect(sockets).toHaveLength(1);
    const s2 = setup(undefined, { participants: async () => ({ ok: true as const, participants: [{ ...me('owner'), participantId: 'pid-ZZZZZZZZZZZZ' }] }) });
    useShare.setState({ rooms: {} });
    await refreshShareMarkers(s2.deps);
    await connectRoom(R1, s2.deps);
    await refreshParticipants(R1, s2.deps);
    expect(useShare.getState().getRoom(R1)!.marker.role).toBe('participant');
  });
});

describe('connectRoom', () => {
  it('릴레이 wsUrl로 세션을 만들고 manifest를 연 뒤 소켓을 연결한다', async () => {
    const { deps, sockets, providers } = setup();
    await refreshShareMarkers(deps);
    expect(await connectRoom(R1, deps)).toBe(true);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('wss://relay.example.com');
    expect(providers.map((p) => p.name)).toEqual([`${R1}/manifest`]);
    expect(providers[0].attached).toBe(true);
    expect(sockets[0].connectCalls).toBe(1);
    const room = useShare.getState().getRoom(R1)!;
    expect(room.status).toBe('connecting');
    expect(Object.keys(room.docs)).toEqual(['manifest']);
    expect(room.docs.manifest.awareness.getLocalState()).toEqual({ user: { participantId: PID, name: '지호' } });
  });

  it('멱등 — 두 번 불러도(동시 포함) 세션은 하나', async () => {
    const { deps, sockets } = setup();
    await refreshShareMarkers(deps);
    const [a, b] = await Promise.all([connectRoom(R1, deps), connectRoom(R1, deps)]);
    expect([a, b]).toEqual([true, true]);
    expect(await connectRoom(R1, deps)).toBe(true);
    expect(sockets).toHaveLength(1);
  });

  it('릴레이 미설정이면 연결하지 않고 status idle + 오류 코드', async () => {
    const { deps, sockets } = setup(undefined, {
      relayUrl: async () => ({ ok: false as const, error: 'relay_not_configured' as const }),
    });
    await refreshShareMarkers(deps);
    expect(await connectRoom(R1, deps)).toBe(false);
    expect(sockets).toHaveLength(0);
    expect(useShare.getState().getRoom(R1)).toMatchObject({ status: 'idle', error: 'relay_not_configured' });
  });

  it('표식의 릴레이 origin이 설정과 다르면 연결하지 않는다(토큰 유출 방지)', async () => {
    const { deps, sockets, api } = setup([{ folderPath: '/ws/team', marker: marker(R1, { relayUrl: 'https://evil.example.org' }) }]);
    const tokenSpy = vi.spyOn(api, 'tokenGet');
    await refreshShareMarkers(deps);
    expect(await connectRoom(R1, deps)).toBe(false);
    expect(sockets).toHaveLength(0);
    expect(tokenSpy).not.toHaveBeenCalled(); // 토큰을 꺼내지도 않는다
    expect(useShare.getState().getRoom(R1)).toMatchObject({ status: 'idle', error: 'relay_mismatch' });
  });

  it('토큰이 없으면 denied(no_token)', async () => {
    const { deps, sockets, tokens } = setup();
    tokens.delete(R1);
    await refreshShareMarkers(deps);
    expect(await connectRoom(R1, deps)).toBe(false);
    expect(sockets).toHaveLength(0);
    expect(useShare.getState().getRoom(R1)).toMatchObject({ status: 'denied', error: 'no_token' });
  });

  it('없는 방은 false', async () => {
    const { deps } = setup();
    expect(await connectRoom(R2, deps)).toBe(false);
  });

  it('소켓·인증 이벤트가 store status에 반영되고, 연결되면 참가자 목록을 받는다', async () => {
    const list = [{ participantId: PID, displayName: '지호', role: 'participant' as const, joinedAt: 1, online: true }];
    const { deps, sockets, providers } = setup(undefined, { participants: async () => ({ ok: true as const, participants: list }) });
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    (sockets[0] as FakeSocket).setStatus('connected');
    (providers[0] as FakeProvider).authenticate();
    expect(useShare.getState().getRoom(R1)!.status).toBe('connected');
    await vi.waitFor(() => expect(useShare.getState().getRoom(R1)!.participants).toEqual(list));

    (sockets[0] as FakeSocket).setStatus('disconnected');
    expect(useShare.getState().getRoom(R1)!.status).toBe('disconnected');
  });

  it('강퇴(4403)되면 denied로 표시하고 재접속을 멈춘다', async () => {
    const { deps, sockets, providers } = setup();
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    const sock = sockets[0] as FakeSocket;
    sock.setStatus('connected');
    (providers[0] as FakeProvider).authenticate();
    sock.close(REVOKED_CLOSE_CODE);
    expect(useShare.getState().getRoom(R1)).toMatchObject({ status: 'denied', error: 'revoked' });
    const before = sock.connectCalls;
    void sock.connect();
    expect(sock.connectCalls).toBe(before);
  });
});

describe('문서 하나의 인증 실패는 세션 전체를 접근 해제로 만들지 않는다', () => {
  it('room_full 같은 사유는 docProblems에 기록되고 status는 denied가 아니다 — 다시 인증되면 지워진다', async () => {
    const { deps, sockets, providers } = setup();
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    (sockets[0] as FakeSocket).setStatus('connected');
    const p = providers[0] as FakeProvider;
    p.denyAuth('room_full');
    let room = useShare.getState().getRoom(R1)!;
    expect(room.status).not.toBe('denied');
    expect(room.docProblems).toEqual({ manifest: 'room_full' });
    expect(sockets[0].disconnectCalls).toBe(0);
    p.authenticate();
    room = useShare.getState().getRoom(R1)!;
    expect(room.status).toBe('connected');
    expect(room.docProblems).toEqual({});
  });

  it('permission-denied·revoked는 denied(접근 해제)', async () => {
    const { deps, sockets, providers } = setup();
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    (sockets[0] as FakeSocket).setStatus('connected');
    (providers[0] as FakeProvider).denyAuth('revoked');
    expect(useShare.getState().getRoom(R1)).toMatchObject({ status: 'denied', error: 'revoked' });
  });

  it('연결을 끊으면 문서 문제 기록도 비워진다', async () => {
    const { deps, sockets, providers } = setup();
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    (sockets[0] as FakeSocket).setStatus('connected');
    (providers[0] as FakeProvider).denyAuth('room_full');
    await disconnectRoom(R1);
    expect(useShare.getState().getRoom(R1)!.docProblems).toEqual({});
  });
});

describe('disconnectRoom ↔ connectRoom 경쟁', () => {
  it('해제 중에 온 연결 요청은 해제가 끝난 뒤에 새 세션으로 연결한다(이미 연결된 것으로 오인하지 않는다)', async () => {
    const { deps, sockets } = setup();
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    const first = getSession(R1);
    const closing = disconnectRoom(R1);
    const reopened = connectRoom(R1, deps); // 해제가 끝나기 전에 요청
    expect(await reopened).toBe(true);
    await closing;
    const second = getSession(R1);
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(sockets).toHaveLength(2);
    expect(sockets[0].destroyed).toBe(true);
    expect(sockets[1].destroyed).toBe(false);
    expect(useShare.getState().getRoom(R1)!.status).toBe('connecting');
  });

  it('여러 번 동시에 해제해도 한 번만 실행되고 같은 결과를 기다린다', async () => {
    const { deps, sockets } = setup();
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    const a = disconnectRoom(R1);
    const b = disconnectRoom(R1);
    expect(b).toBe(a);
    await Promise.all([a, b]);
    expect(getSession(R1)).toBeUndefined();
    expect(sockets[0].destroyed).toBe(true);
  });

  it('연결이 진행되는 중에 해제를 요청하면 그 연결이 끝난 뒤 해제한다(연결이 해제를 무시하고 살아남지 않는다)', async () => {
    const { deps } = setup(undefined, {
      relayUrl: async () => {
        await new Promise((r) => setTimeout(r, 20));
        return { ok: true as const, info: { url: 'https://relay.example.com', wsUrl: 'wss://relay.example.com' } };
      },
    });
    await refreshShareMarkers(deps);
    const connecting = connectRoom(R1, deps);
    const closing = disconnectRoom(R1);
    await Promise.all([connecting, closing]);
    expect(getSession(R1)).toBeUndefined();
    expect(useShare.getState().getRoom(R1)!.status).toBe('idle');
  });
});

describe('사이드카 로드·저장 연동', () => {
  it('manifest를 열 때 사이드카를 읽어 새 Y.Doc에 적용한다', async () => {
    const { deps, sidecars } = setup();
    const src = new Y.Doc();
    src.getMap('notes').set('n1', { path: 'a.md', title: 'A', rev: 1, seeded: true });
    sidecars.set('/ws/team|_manifest', encodeSidecar(src));
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    const doc = useShare.getState().getDoc(R1, 'manifest')!.ydoc;
    expect(doc.getMap('notes').get('n1')).toEqual({ path: 'a.md', title: 'A', rev: 1, seeded: true });
    expect(doc.clientID).not.toBe(src.clientID);
  });

  it('로컬 변경은 디바운스 후 사이드카에 저장되고, disconnect는 flush한다', async () => {
    const { deps, sidecars, calls } = setup();
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    const doc = useShare.getState().getDoc(R1, 'manifest')!.ydoc;
    doc.getMap('notes').set('n1', { path: 'a.md', title: 'A', rev: 1, seeded: false });
    await vi.waitFor(() => expect(calls).toContain('write:_manifest'));
    doc.getMap('notes').set('n2', { path: 'b.md', title: 'B', rev: 1, seeded: false });
    await disconnectRoom(R1); // 디바운스 만료 전이라도 flush
    const restored = new Y.Doc();
    Y.applyUpdate(restored, sidecars.get('/ws/team|_manifest')!);
    expect(Object.keys(restored.getMap('notes').toJSON()).sort()).toEqual(['n1', 'n2']);
  });
});

describe('openSharedDoc / closeSharedDoc', () => {
  it('노트 문서를 열면 store에 등록되고, 같은 키는 같은 핸들이며, persist:false면 자동 저장을 붙이지 않는다', async () => {
    const { deps, calls } = setup();
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    const [a, b] = await Promise.all([
      openSharedDoc(R1, 'note:n1', deps, { persist: false }),
      openSharedDoc(R1, 'note:n1', deps, { persist: false }),
    ]);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(useShare.getState().getDoc(R1, 'note:n1')?.ydoc).toBe(a!.ydoc);
    a!.ydoc.getText('t').insert(0, 'hello');
    await new Promise((r) => setTimeout(r, 40));
    expect(calls.filter((c) => c === `write:${noteSidecarId('n1')}`)).toEqual([]);

    await closeSharedDoc(R1, 'note:n1');
    expect(useShare.getState().getDoc(R1, 'note:n1')).toBeUndefined();
    expect(getSession(R1)!.getDoc('note:n1')).toBeUndefined();
  });

  it('연결되지 않은 방·없는 방에는 null', async () => {
    const { deps } = setup();
    await refreshShareMarkers(deps);
    expect(await openSharedDoc(R1, 'note:n1', deps)).toBeNull();
    expect(await openSharedDoc(R2, 'note:n1', deps)).toBeNull();
  });

  it('규약 밖 docKey는 던진다(프로그래머 오류)', async () => {
    const { deps } = setup();
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    await expect(openSharedDoc(R1, 'note:../x' as never, deps)).rejects.toThrow();
  });
});

describe('disconnectRoom / stopAllRooms', () => {
  it('세션을 파기하고 문서 등록을 해제하며 status를 idle로 되돌린다(방·표식은 유지)', async () => {
    const { deps, sockets, providers } = setup();
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    await disconnectRoom(R1);
    expect(sockets[0].destroyed).toBe(true);
    expect(providers.every((p) => p.destroyed)).toBe(true);
    expect(getSession(R1)).toBeUndefined();
    expect(useShare.getState().getRoom(R1)).toMatchObject({ status: 'idle', docs: {} });
    await disconnectRoom(R1); // 멱등
    // 다시 연결 가능 — 새 세션·새 Y.Doc
    expect(await connectRoom(R1, deps)).toBe(true);
    expect(sockets).toHaveLength(2);
  });

  it('stopAllRooms', async () => {
    const { deps } = setup([
      { folderPath: '/ws/a', marker: marker(R1) },
      { folderPath: '/ws/b', marker: marker(R2) },
    ]);
    await refreshShareMarkers(deps);
    await Promise.all([connectRoom(R1, deps), connectRoom(R2, deps)]);
    await stopAllRooms();
    expect(getSession(R1)).toBeUndefined();
    expect(getSession(R2)).toBeUndefined();
  });
});

describe('refreshParticipants', () => {
  it('성공 시 store 갱신, denied면 방을 denied로', async () => {
    let reply: unknown = { ok: true, participants: [] };
    const { deps } = setup(undefined, { participants: async () => reply });
    await refreshShareMarkers(deps);
    expect(await refreshParticipants(R1, deps)).toBe(true);
    reply = { ok: false, error: 'denied' };
    expect(await refreshParticipants(R1, deps)).toBe(false);
    expect(useShare.getState().getRoom(R1)).toMatchObject({ status: 'denied', error: 'denied' });
    reply = { ok: false, error: 'network' };
    useShare.getState().setStatus(R1, 'connected');
    expect(await refreshParticipants(R1, deps)).toBe(false);
    expect(useShare.getState().getRoom(R1)!.status).toBe('connected'); // 네트워크 오류는 상태를 바꾸지 않음
  });
});

describe('bootShare', () => {
  it('표식을 훑어 모든 방에 연결하고, 재호출해도 세션이 늘지 않으며, 반환 함수로 정리한다', async () => {
    const { deps, sockets } = setup([
      { folderPath: '/ws/a', marker: marker(R1) },
      { folderPath: '/ws/b', marker: marker(R2) },
    ]);
    const stop = await bootShare(deps);
    expect(sockets).toHaveLength(2);
    expect(Object.keys(useShare.getState().rooms).sort()).toEqual([R1, R2]);
    await bootShare(deps);
    expect(sockets).toHaveLength(2);
    stop();
    await vi.waitFor(() => expect(getSession(R1)).toBeUndefined());
    expect(getSession(R2)).toBeUndefined();
  });

  it('한 방이 실패해도 다른 방은 연결된다', async () => {
    const { deps, sockets, tokens } = setup([
      { folderPath: '/ws/a', marker: marker(R1) },
      { folderPath: '/ws/b', marker: marker(R2) },
    ]);
    tokens.delete(R1);
    await bootShare(deps);
    expect(sockets).toHaveLength(1);
    expect(useShare.getState().getRoom(R1)!.status).toBe('denied');
    expect(useShare.getState().getRoom(R2)!.status).toBe('connecting');
  });
});
