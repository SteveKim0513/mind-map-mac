import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TreeNode } from '../../electron/preload';
import type { ShareMarker } from '../types';
import { useShare, type ShareRoom } from '../store/shareStore';
import {
  createSharedFolder,
  forgetSharedFolder,
  issueInvite,
  joinSharedFolder,
  listShareableFolders,
  removeParticipant,
  shareBlockReason,
  unshareFolder,
  type ShareFlowDeps,
} from './flows';
import { SHARE_MAX_FOLDER_DEPTH } from '../io/shareLimits';
import { getSession, stopAllRooms } from './rooms';
import { resetShareLogState, setShareLogSink } from './shareLog';
import { makeFakeFactories, makeFakeShareApi } from './testFakes';

const ROOT = '/ws';
const R1 = 'room-AAAAAAAA';
const R2 = 'room-BBBBBBBB';
const PID = 'pid-AAAAAAAAAAAA';
const PID2 = 'pid-BBBBBBBBBBBB';

function room(folderPath: string, over: Partial<ShareMarker> = {}): ShareRoom {
  return {
    marker: {
      v: 1,
      roomId: R1,
      relayUrl: 'https://relay.example.com',
      role: 'participant',
      participantId: PID,
      folderName: 'team',
      displayName: '지호',
      ...over,
    },
    folderPath,
    status: 'idle',
    error: null,
    participants: [],
    docs: {},
    notes: {},
    files: {},
    replica: null,
  };
}
const rooms = (...list: ShareRoom[]) => Object.fromEntries(list.map((r) => [r.marker.roomId, r]));

/** 표식을 메모리에 쌓는 가짜 IPC + 가짜 소켓·프로바이더. */
function setup(apiOver: Record<string, unknown> = {}, opts: { root?: string } = {}) {
  const markers: { folderPath: string; marker: ShareMarker }[] = [];
  const created: string[] = [];
  const fake = makeFakeShareApi({
    listMarkers: async () => [...markers],
    writeMarker: async (folderPath: string, marker: ShareMarker) => {
      const i = markers.findIndex((m) => m.folderPath === folderPath);
      if (i >= 0) markers[i] = { folderPath, marker };
      else markers.push({ folderPath, marker });
      return { ok: true as const };
    },
    removeMarker: async (folderPath: string) => {
      const i = markers.findIndex((m) => m.folderPath === folderPath);
      if (i >= 0) markers.splice(i, 1);
      return { ok: true as const };
    },
    ...apiOver,
  });
  const f = makeFakeFactories();
  const deps: ShareFlowDeps = {
    api: fake.api,
    runtime: { api: fake.api, factories: f.factories, sidecarDebounceMs: 10, markerRescanDelayMs: 0 },
    root: () => opts.root ?? ROOT,
    createFolder: async (dir, name) => {
      const path = `${dir}/${name}`;
      created.push(path);
      return path;
    },
  };
  return { ...fake, ...f, deps, markers, created };
}

beforeEach(() => {
  useShare.setState({ rooms: {} });
});
afterEach(async () => {
  await stopAllRooms();
});

describe('shareBlockReason', () => {
  it.each([
    ['/ws', 'root'],
    ['/ws/', 'root'],
    ['/elsewhere/a', 'outside'],
    ['/ws2/a', 'outside'],
    ['/ws/.trash/a', 'hidden'],
    ['/ws/a/.mindshare', 'hidden'],
    ['/ws/team', 'already_shared'],
    ['/ws/team/deep/er', 'inside_shared'],
    ['/ws/parent', 'contains_shared'],
    ['/ws/x'.padEnd(120, 'x'), 'bad_name'],
  ] as const)('%s → %s', (path, expected) => {
    const rs = rooms(room('/ws/team'), room('/ws/parent/child', { roomId: R2 }));
    expect(shareBlockReason(path, ROOT, rs)).toBe(expected);
  });

  it('main의 표식 스캔 깊이(4)를 넘는 폴더는 too_deep — 만들기가 성공해도 다음 스캔에서 안 보여 연결되지 않는 폴더가 된다', () => {
    expect(SHARE_MAX_FOLDER_DEPTH).toBe(4);
    expect(shareBlockReason('/ws/a/b/c/d', ROOT, {})).toBeNull(); // 깊이 4 — 스캔이 도달한다
    expect(shareBlockReason('/ws/a/b/c/d/e', ROOT, {})).toBe('too_deep');
    expect(shareBlockReason('/ws/a/b/c/d/e/f', ROOT, {})).toBe('too_deep');
    // 숨김 폴더 검사가 먼저다
    expect(shareBlockReason('/ws/a/b/c/d/.x', ROOT, {})).toBe('hidden');
  });

  it('공유할 수 있는 폴더는 null', () => {
    expect(shareBlockReason('/ws/notes', ROOT, rooms(room('/ws/team')))).toBeNull();
    expect(shareBlockReason('/ws/team2', ROOT, rooms(room('/ws/team')))).toBeNull(); // 접두사만 같은 형제
  });
});

describe('listShareableFolders', () => {
  const tree: TreeNode[] = [
    { name: 'work-log', path: '/ws/work-log', type: 'dir', children: [] },
    { name: 'a', path: '/ws/a', type: 'dir', children: [{ name: 'b', path: '/ws/a/b', type: 'dir', children: [] }] },
    { name: 'team', path: '/ws/team', type: 'dir', children: [{ name: 'in', path: '/ws/team/in', type: 'dir', children: [] }] },
    { name: 'x.md', path: '/ws/x.md', type: 'file' },
  ];
  it('폴더만, work-log·이미 공유된 폴더(안팎)는 제외하고 라벨은 상위 / 하위', () => {
    expect(listShareableFolders(tree, ROOT, rooms(room('/ws/team')))).toEqual([
      { path: '/ws/a', label: 'a' },
      { path: '/ws/a/b', label: 'a / b' },
    ]);
  });
});

describe('listShareableFolders — 깊이 한계', () => {
  it('스캔 깊이를 넘는 폴더는 목록에 없다', () => {
    const leaf = (name: string, path: string): TreeNode => ({ name, path, type: 'dir', children: [] });
    const tree: TreeNode[] = [
      {
        name: 'a', path: '/ws/a', type: 'dir',
        children: [{ name: 'b', path: '/ws/a/b', type: 'dir', children: [{ name: 'c', path: '/ws/a/b/c', type: 'dir', children: [{ name: 'd', path: '/ws/a/b/c/d', type: 'dir', children: [leaf('e', '/ws/a/b/c/d/e')] }] }] }],
      },
    ];
    expect(listShareableFolders(tree, ROOT, {}).map((f) => f.path)).toEqual(['/ws/a', '/ws/a/b', '/ws/a/b/c', '/ws/a/b/c/d']);
  });
});

describe('createSharedFolder', () => {
  it('서버 등록 → 소유자 표식 기록 → 연결, 초대 코드를 돌려준다', async () => {
    const { deps, api, markers, tokens } = setup({
      createRoom: async (args: { ownerName: string; folderName?: string }) => {
        expect(args).toEqual({ ownerName: '지호', folderName: '기획' });
        tokens.set(R1, 'owner-token');
        return { ok: true as const, room: { roomId: R1, participantId: PID, inviteCode: 'ABCD2345', inviteExpiresAt: 99 } };
      },
    });
    const res = await createSharedFolder({ folderPath: '/ws/기획', ownerName: '  지호 ' }, deps);
    expect(res).toEqual({ ok: true, roomId: R1, folderPath: '/ws/기획', invite: { inviteCode: 'ABCD2345', inviteExpiresAt: 99 } });
    expect(markers).toHaveLength(1);
    expect(markers[0].marker).toEqual({
      v: 1,
      roomId: R1,
      relayUrl: 'https://relay.example.com',
      role: 'owner',
      participantId: PID,
      folderName: '기획',
      displayName: '지호',
    });
    expect(useShare.getState().getRoom(R1)?.folderPath).toBe('/ws/기획');
    expect(getSession(R1)).toBeDefined(); // 연결 시도까지 했다
    expect(await api.tokenGet(R1)).toBe('owner-token');
  });

  it('공유 불가 폴더는 네트워크 전에 이유와 함께 거부한다', async () => {
    let calls = 0;
    const { deps } = setup({ relayUrl: async () => (calls++, { ok: false as const, error: 'network' as const }) });
    expect(await createSharedFolder({ folderPath: '/ws', ownerName: '지호' }, deps)).toEqual({ ok: false, error: 'root' });
    useShare.setState({ rooms: rooms(room('/ws/team')) });
    expect(await createSharedFolder({ folderPath: '/ws/team/in', ownerName: '지호' }, deps)).toEqual({
      ok: false,
      error: 'inside_shared',
    });
    expect(await createSharedFolder({ folderPath: '/ws/a', ownerName: '<x>' }, deps)).toEqual({ ok: false, error: 'invalid_input' });
    expect(calls).toBe(0);
  });

  it('릴레이 미설정·서버 오류는 코드 그대로 전달하고 아무것도 쓰지 않는다', async () => {
    const s1 = setup({ relayUrl: async () => ({ ok: false as const, error: 'relay_not_configured' as const }) });
    expect(await createSharedFolder({ folderPath: '/ws/a', ownerName: '지호' }, s1.deps)).toEqual({
      ok: false,
      error: 'relay_not_configured',
    });
    const s2 = setup(); // 기본 createRoom = network 오류
    expect(await createSharedFolder({ folderPath: '/ws/a', ownerName: '지호' }, s2.deps)).toEqual({ ok: false, error: 'network' });
    expect(s2.markers).toHaveLength(0);
  });

  it('표식 쓰기가 실패하면 방금 저장한 토큰을 지운다', async () => {
    const { deps, tokens } = setup({
      createRoom: async () => {
        tokens.set(R1, 'owner-token');
        return { ok: true as const, room: { roomId: R1, participantId: PID, inviteCode: 'ABCD2345', inviteExpiresAt: 99 } };
      },
      writeMarker: async () => ({ ok: false as const, error: 'io' as const }),
    });
    expect(await createSharedFolder({ folderPath: '/ws/a', ownerName: '지호' }, deps)).toEqual({ ok: false, error: 'io' });
    expect(tokens.has(R1)).toBe(false);
    expect(useShare.getState().getRoom(R1)).toBeUndefined();
  });

  it('표식 쓰기가 실패하면 서버에 만든 빈 방도 지우려 시도한다(토큰이 있을 때)', async () => {
    const deleted: string[] = [];
    const s = setup({
      createRoom: async () => {
        s.tokens.set(R1, 'owner-token');
        return { ok: true as const, room: { roomId: R1, participantId: PID, inviteCode: 'ABCD2345', inviteExpiresAt: 99 } };
      },
      writeMarker: async () => ({ ok: false as const, error: 'io' as const }),
      deleteRoom: async (r: string) => (deleted.push(r), { ok: true as const }),
    });
    await createSharedFolder({ folderPath: '/ws/a', ownerName: '지호' }, s.deps);
    expect(deleted).toEqual([R1]);
  });

  it('깊이 한계를 넘는 폴더는 서버 호출 전에 too_deep으로 거부한다', async () => {
    let calls = 0;
    const s = setup({ createRoom: async () => (calls++, { ok: false as const, error: 'network' as const }) });
    expect(await createSharedFolder({ folderPath: '/ws/a/b/c/d/e', ownerName: '지호' }, s.deps)).toEqual({ ok: false, error: 'too_deep' });
    expect(calls).toBe(0);
  });

  it('표식을 썼는데 방이 store에 나타나지 않으면(스캔에 안 잡힘) 성공이 아니다 — 표식·토큰·서버 방을 되돌린다', async () => {
    const deleted: string[] = [];
    const s = setup({
      createRoom: async () => {
        s.tokens.set(R1, 'owner-token');
        return { ok: true as const, room: { roomId: R1, participantId: PID, inviteCode: 'ABCD2345', inviteExpiresAt: 99 } };
      },
      listMarkers: async () => [], // 표식이 스캔 한계 밖이라 안 보이는 상황
      deleteRoom: async (r: string) => (deleted.push(r), { ok: true as const }),
    });
    const res = await createSharedFolder({ folderPath: '/ws/a', ownerName: '지호' }, s.deps);
    expect(res).toEqual({ ok: false, error: 'too_deep' }); // 초대 코드를 성공으로 돌려주지 않는다
    expect(s.markers).toHaveLength(0);
    expect(s.tokens.has(R1)).toBe(false);
    expect(deleted).toEqual([R1]);
    expect(useShare.getState().getRoom(R1)).toBeUndefined();
    expect(getSession(R1)).toBeUndefined();
  });

  it('롤백 중 서버 방 삭제가 실패해도(네트워크) 로컬 정리는 끝까지 한다', async () => {
    const s = setup({
      createRoom: async () => {
        s.tokens.set(R1, 'owner-token');
        return { ok: true as const, room: { roomId: R1, participantId: PID, inviteCode: 'ABCD2345', inviteExpiresAt: 99 } };
      },
      listMarkers: async () => [],
      deleteRoom: async () => {
        throw new Error('ipc closed');
      },
    });
    expect(await createSharedFolder({ folderPath: '/ws/a', ownerName: '지호' }, s.deps)).toEqual({ ok: false, error: 'too_deep' });
    expect(s.markers).toHaveLength(0);
    expect(s.tokens.has(R1)).toBe(false);
  });
});

describe('joinSharedFolder', () => {
  const joinedOk = (folderName: string | null) => async () => ({
    ok: true as const,
    joined: { roomId: R1, participantId: PID2, role: 'participant' as const, folderName },
  });

  it('서버가 준 폴더 이름으로 워크스페이스 루트에 폴더를 만들고 참가자 표식을 쓴다', async () => {
    const { deps, markers, created } = setup({ join: joinedOk('팀 자료') });
    const res = await joinSharedFolder({ code: 'abcd-2345', displayName: ' 민수 ' }, deps);
    expect(res).toEqual({ ok: true, roomId: R1, folderPath: '/ws/팀 자료', folderName: '팀 자료' });
    expect(created).toEqual(['/ws/팀 자료']);
    expect(markers[0].marker).toMatchObject({ role: 'participant', participantId: PID2, folderName: '팀 자료', displayName: '민수' });
    expect(useShare.getState().getRoom(R1)?.marker.role).toBe('participant');
  });

  it('폴더 이름이 없으면(옛 서버·이름 없는 방) 기본 이름을 쓴다', async () => {
    const { deps, created } = setup({ join: joinedOk(null) });
    const res = await joinSharedFolder({ code: 'ABCD2345', displayName: '민수' }, deps);
    expect(res.ok).toBe(true);
    expect(created).toEqual(['/ws/공유 폴더']);
  });

  it('오류 코드를 그대로 전달하고, 잘못된 입력은 네트워크 전에 거부한다', async () => {
    let calls = 0;
    const { deps } = setup({
      join: async () => (calls++, { ok: false as const, error: 'invalid_code' as const }),
    });
    expect(await joinSharedFolder({ code: 'ZZZZZZZZ', displayName: '민수' }, deps)).toEqual({ ok: false, error: 'invalid_code' });
    expect(calls).toBe(1);
    expect(await joinSharedFolder({ code: 'bad;code!', displayName: '민수' }, deps)).toEqual({ ok: false, error: 'invalid_code' });
    expect(await joinSharedFolder({ code: 'ABCD2345', displayName: '' }, deps)).toEqual({ ok: false, error: 'invalid_input' });
    expect(calls).toBe(1);
  });

  it('폴더/표식 생성이 실패하면 저장된 참가 토큰을 지운다', async () => {
    const s1 = setup({
      join: async () => {
        s1.tokens.set(R1, 'part-token');
        return { ok: true as const, joined: { roomId: R1, participantId: PID2, role: 'participant' as const, folderName: 'x' } };
      },
    });
    s1.deps.createFolder = async () => {
      throw new Error('EACCES');
    };
    expect(await joinSharedFolder({ code: 'ABCD2345', displayName: '민수' }, s1.deps)).toEqual({ ok: false, error: 'io' });
    expect(s1.tokens.has(R1)).toBe(false);

    const s2 = setup({
      join: async () => {
        s2.tokens.set(R1, 'part-token');
        return { ok: true as const, joined: { roomId: R1, participantId: PID2, role: 'participant' as const, folderName: 'x' } };
      },
      writeMarker: async () => ({ ok: false as const, error: 'io' as const }),
    });
    expect(await joinSharedFolder({ code: 'ABCD2345', displayName: '민수' }, s2.deps)).toEqual({ ok: false, error: 'io' });
    expect(s2.tokens.has(R1)).toBe(false);
  });

  it('이 컴퓨터가 소유한 방의 코드를 넣으면 소유자 토큰을 되돌리고 거부한다', async () => {
    const s = setup({
      join: async () => {
        s.tokens.set(R1, 'participant-token'); // main.join이 덮어쓴 것을 흉내
        return { ok: true as const, joined: { roomId: R1, participantId: PID2, role: 'participant' as const, folderName: 'x' } };
      },
    });
    s.tokens.set(R1, 'owner-token');
    useShare.setState({ rooms: rooms(room('/ws/mine', { role: 'owner' })) });
    const res = await joinSharedFolder({ code: 'ABCD2345', displayName: '나' }, s.deps);
    expect(res).toEqual({ ok: false, error: 'already_owner' });
    expect(s.tokens.get(R1)).toBe('owner-token');
    expect(s.created).toEqual([]);
  });

  it('소유자 토큰 복구가 실패하면 조용히 넘기지 않는다 — token_restore_failed, 유령 참가자의 토큰은 지우고 방을 권한 없음 상태로 표시', async () => {
    const s = setup({
      join: async () => {
        s.tokens.set(R1, 'participant-token');
        return { ok: true as const, joined: { roomId: R1, participantId: PID2, role: 'participant' as const, folderName: 'x' } };
      },
      tokenSet: async () => ({ ok: false as const, error: 'io' as const }),
    });
    s.tokens.set(R1, 'owner-token');
    useShare.setState({ rooms: rooms(room('/ws/mine', { role: 'owner' })) });
    const res = await joinSharedFolder({ code: 'ABCD2345', displayName: '나' }, s.deps);
    expect(res).toEqual({ ok: false, error: 'token_restore_failed' });
    expect(s.tokens.has(R1)).toBe(false); // 유령 참가자의 토큰으로 조용히 참가자처럼 접속하지 않는다
    expect(useShare.getState().getRoom(R1)).toMatchObject({ status: 'denied', error: 'no_token' });
    expect(s.created).toEqual([]);
  });

  it('토큰 복구 API가 던져도 같은 결과(token_restore_failed)', async () => {
    const s = setup({
      join: async () => ({ ok: true as const, joined: { roomId: R1, participantId: PID2, role: 'participant' as const, folderName: 'x' } }),
      tokenSet: async () => {
        throw new Error('ipc');
      },
    });
    s.tokens.set(R1, 'owner-token');
    useShare.setState({ rooms: rooms(room('/ws/mine', { role: 'owner' })) });
    expect(await joinSharedFolder({ code: 'ABCD2345', displayName: '나' }, s.deps)).toEqual({ ok: false, error: 'token_restore_failed' });
  });

  it('토큰 복구에 성공하면 방금 생긴 유령 참가자를 소유자 권한으로 내보내려 시도한다(실패해도 already_owner)', async () => {
    const revoked: string[] = [];
    const s = setup({
      join: async () => {
        s.tokens.set(R1, 'participant-token');
        return { ok: true as const, joined: { roomId: R1, participantId: PID2, role: 'participant' as const, folderName: 'x' } };
      },
      revoke: async (_r: string, pid: string) => (revoked.push(pid), { ok: false as const, error: 'network' as const }),
    });
    s.tokens.set(R1, 'owner-token');
    useShare.setState({ rooms: rooms(room('/ws/mine', { role: 'owner' })) });
    const res = await joinSharedFolder({ code: 'ABCD2345', displayName: '나' }, s.deps);
    expect(res).toEqual({ ok: false, error: 'already_owner' });
    expect(revoked).toEqual([PID2]);
    expect(s.tokens.get(R1)).toBe('owner-token');
  });

  it('참가 표식을 썼는데 방이 나타나지 않으면 성공이 아니다 — 표식·토큰을 되돌린다', async () => {
    const s = setup({
      join: async () => {
        s.tokens.set(R1, 'part-token');
        return { ok: true as const, joined: { roomId: R1, participantId: PID2, role: 'participant' as const, folderName: '팀' } };
      },
      listMarkers: async () => [],
    });
    const res = await joinSharedFolder({ code: 'ABCD2345', displayName: '민수' }, s.deps);
    expect(res).toEqual({ ok: false, error: 'too_deep' });
    expect(s.markers).toHaveLength(0);
    expect(s.tokens.has(R1)).toBe(false);
    expect(useShare.getState().getRoom(R1)).toBeUndefined();
  });

  it('이미 참가 중인 방(재참가)은 새 폴더를 만들지 않고 기존 폴더의 표식을 새 신원으로 갱신한다', async () => {
    const s = setup({ join: joinedOk('팀 자료') });
    s.markers.push({ folderPath: '/ws/old', marker: room('/ws/old').marker });
    useShare.setState({ rooms: rooms(room('/ws/old')) });
    const res = await joinSharedFolder({ code: 'ABCD2345', displayName: '민수' }, s.deps);
    expect(res).toEqual({ ok: true, roomId: R1, folderPath: '/ws/old', folderName: 'team' });
    expect(s.created).toEqual([]);
    expect(s.markers).toHaveLength(1);
    expect(s.markers[0].marker).toMatchObject({ folderName: 'team', participantId: PID2, displayName: '민수' });
  });
});

describe('issueInvite / removeParticipant', () => {
  it('새 초대 코드를 돌려주고, 내보내면 목록을 새로 받는다', async () => {
    const list = [{ participantId: PID, displayName: '지호', role: 'owner' as const, joinedAt: 1, online: true }];
    const revoked: string[] = [];
    const s = setup({
      invite: async () => ({ ok: true as const, invite: { inviteCode: 'WXYZ2345', inviteExpiresAt: 5 } }),
      revoke: async (_r: string, pid: string) => (revoked.push(pid), { ok: true as const }),
      participants: async () => ({ ok: true as const, participants: list }),
    });
    useShare.setState({ rooms: rooms(room('/ws/team', { role: 'owner' })) });
    expect(await issueInvite(R1, s.deps)).toEqual({ ok: true, invite: { inviteCode: 'WXYZ2345', inviteExpiresAt: 5 } });
    expect(await removeParticipant(R1, PID2, s.deps)).toEqual({ ok: true });
    expect(revoked).toEqual([PID2]);
    expect(useShare.getState().getRoom(R1)?.participants).toEqual(list);
  });

  it('서버 오류는 코드로 돌려준다', async () => {
    const s = setup({ revoke: async () => ({ ok: false as const, error: 'denied' as const }) });
    expect(await removeParticipant(R1, PID2, s.deps)).toEqual({ ok: false, error: 'denied' });
    expect(await issueInvite(R1, s.deps)).toEqual({ ok: false, error: 'network' });
  });
});

describe('forgetSharedFolder / unshareFolder', () => {
  function shared(role: 'owner' | 'participant') {
    const s = setup();
    s.markers.push({ folderPath: '/ws/team', marker: room('/ws/team', { role }).marker });
    s.tokens.set(R1, 'tok');
    useShare.setState({ rooms: rooms(room('/ws/team', { role })) });
    return s;
  }

  it('나가기(로컬 정리): 표식·토큰을 지우고 store에서 제거하며 폴더 파일은 건드리지 않는다', async () => {
    const s = shared('participant');
    expect(await forgetSharedFolder(R1, s.deps)).toEqual({ ok: true });
    expect(s.markers).toHaveLength(0);
    expect(s.tokens.has(R1)).toBe(false);
    expect(useShare.getState().getRoom(R1)).toBeUndefined();
    expect(getSession(R1)).toBeUndefined();
  });

  it('표식을 지우지 못하면 아무것도 바꾸지 않는다(토큰 유지)', async () => {
    const s = shared('participant');
    s.deps.api.removeMarker = async () => ({ ok: false as const, error: 'io' as const });
    expect(await forgetSharedFolder(R1, s.deps)).toEqual({ ok: false, error: 'io' });
    expect(s.tokens.get(R1)).toBe('tok');
    expect(useShare.getState().getRoom(R1)).toBeDefined();
  });

  it('이미 없는 방은 성공으로 본다(멱등)', async () => {
    const s = setup();
    expect(await forgetSharedFolder(R2, s.deps)).toEqual({ ok: true });
  });

  it('공유 해제: 서버 방을 지우면(DELETE /rooms/:id) 그것으로 끝 — 참가자를 하나씩 내보내지 않고 로컬 정리, 안내 없음', async () => {
    const s = shared('owner');
    const revoked: string[] = [];
    const deleted: string[] = [];
    s.deps.api.deleteRoom = async (r: string) => (deleted.push(r), { ok: true as const });
    s.deps.api.revoke = async (_r: string, pid: string) => (revoked.push(pid), { ok: true as const });
    s.deps.api.participants = async () => {
      throw new Error('방을 지웠으면 목록을 받을 필요가 없다');
    };
    expect(await unshareFolder(R1, s.deps)).toEqual({ ok: true });
    expect(deleted).toEqual([R1]);
    expect(revoked).toEqual([]);
    expect(useShare.getState().getRoom(R1)).toBeUndefined();
    expect(s.markers).toHaveLength(0);
    expect(s.tokens.has(R1)).toBe(false);
  });

  it('공유 해제: 서버 방 삭제는 토큰이 살아 있을 때 한다(로컬 토큰 삭제보다 먼저)', async () => {
    const s = shared('owner');
    let tokenAtDelete: string | null = null;
    s.deps.api.deleteRoom = async () => {
      tokenAtDelete = (await s.deps.api.tokenGet(R1)) ?? null;
      return { ok: true as const };
    };
    await unshareFolder(R1, s.deps);
    expect(tokenAtDelete).toBe('tok');
  });

  it('공유 해제: 서버가 방 삭제를 지원하지 않으면(404) 예전처럼 참가자를 모두 내보낸 뒤 로컬 정리 — 서버에 남은 정보 안내(serverLeftover)', async () => {
    const s = shared('owner');
    const revoked: string[] = [];
    s.deps.api.deleteRoom = async () => ({ ok: false as const, error: 'not_found' as const });
    s.deps.api.participants = async () => ({
      ok: true as const,
      participants: [
        { participantId: PID, displayName: '나', role: 'owner', joinedAt: 1, online: true },
        { participantId: PID2, displayName: '민수', role: 'participant', joinedAt: 2, online: false },
        { participantId: 'pid-CCCCCCCCCCCC', displayName: '영희', role: 'participant', joinedAt: 3, online: true },
      ],
    });
    s.deps.api.revoke = async (_r: string, pid: string) => (revoked.push(pid), { ok: true as const });
    expect(await unshareFolder(R1, s.deps)).toEqual({ ok: true, serverLeftover: true });
    expect(revoked).toEqual([PID2, 'pid-CCCCCCCCCCCC']);
    expect(useShare.getState().getRoom(R1)).toBeUndefined();
    expect(s.markers).toHaveLength(0);
  });

  it('공유 해제: IPC 핸들러가 없어 deleteRoom이 던져도(구버전 main) 같은 폴백을 쓴다', async () => {
    const s = shared('owner');
    s.deps.api.deleteRoom = async () => {
      throw new Error("No handler registered for 'share:deleteRoom'");
    };
    s.deps.api.participants = async () => ({ ok: true as const, participants: [] });
    expect(await unshareFolder(R1, s.deps)).toEqual({ ok: true, serverLeftover: true });
    expect(useShare.getState().getRoom(R1)).toBeUndefined();
  });

  it('공유 해제: 방 삭제도, 참가자 목록·내보내기도 네트워크로 못 하면 아무것도 지우지 않는다(다시 시도할 수 있게)', async () => {
    const s1 = shared('owner');
    s1.deps.api.deleteRoom = async () => ({ ok: false as const, error: 'network' as const });
    s1.deps.api.participants = async () => ({ ok: false as const, error: 'network' as const });
    expect(await unshareFolder(R1, s1.deps)).toEqual({ ok: false, error: 'network' });
    expect(useShare.getState().getRoom(R1)).toBeDefined();
    expect(s1.markers).toHaveLength(1);
    expect(s1.tokens.get(R1)).toBe('tok');

    const s2 = shared('owner');
    s2.deps.api.deleteRoom = async () => ({ ok: false as const, error: 'timeout' as const });
    s2.deps.api.participants = async () => ({
      ok: true as const,
      participants: [{ participantId: PID2, displayName: '민수', role: 'participant', joinedAt: 2, online: false }],
    });
    s2.deps.api.revoke = async () => ({ ok: false as const, error: 'timeout' as const });
    expect(await unshareFolder(R1, s2.deps)).toEqual({ ok: false, error: 'timeout' });
    expect(useShare.getState().getRoom(R1)).toBeDefined();
  });

  it('공유 해제: 내 권한이 이미 없으면(denied) 로컬 정리만 한다', async () => {
    const s = shared('owner');
    s.deps.api.deleteRoom = async () => ({ ok: false as const, error: 'denied' as const });
    s.deps.api.participants = async () => ({ ok: false as const, error: 'denied' as const });
    expect(await unshareFolder(R1, s.deps)).toEqual({ ok: true, serverLeftover: true });
    expect(useShare.getState().getRoom(R1)).toBeUndefined();
  });
});

describe('공유 흐름 진단 로그 — 시작·성공·실패(오류 코드)·롤백, 이름·코드·토큰·경로는 남기지 않는다', () => {
  let lines: string[];
  const flow = () => lines.filter((l) => l.includes('flow '));
  const OWNER_TOKEN = 'owner-token-SECRET-987654';
  const createOk = (s: ReturnType<typeof setup>) => async () => {
    s.tokens.set(R1, OWNER_TOKEN);
    return { ok: true as const, room: { roomId: R1, participantId: PID, inviteCode: 'ABCD2345', inviteExpiresAt: 99 } };
  };

  beforeEach(() => {
    lines = [];
    resetShareLogState();
    setShareLogSink((level, message) => lines.push(`${level}: ${message}`));
  });
  afterEach(() => setShareLogSink(null));

  it('만들기 성공: 시작 → 성공(방 id 앞 8자)', async () => {
    const s = setup();
    s.deps.api.createRoom = createOk(s);
    expect((await createSharedFolder({ folderPath: '/ws/기획', ownerName: '지호' }, s.deps)).ok).toBe(true);
    expect(flow()).toEqual(['info: flow create start', 'info: flow create ok room=room-AAA']);
  });

  it('만들기 실패: 차단 사유·서버 오류 코드를 warn으로', async () => {
    const s = setup({ createRoom: async () => ({ ok: false as const, error: 'rate_limited' as const }) });
    await createSharedFolder({ folderPath: '/ws/a/b/c/d/e', ownerName: '지호' }, s.deps);
    await createSharedFolder({ folderPath: '/ws/a', ownerName: '지호' }, s.deps);
    expect(flow()).toEqual([
      'info: flow create start',
      'warn: flow create failed error=too_deep',
      'info: flow create start',
      'warn: flow create failed error=rate_limited',
    ]);
  });

  it('표식 쓰기 실패 롤백과 스캔 밖 롤백(서버 방 삭제 실패 포함)을 사유·단계와 함께 남긴다', async () => {
    const a = setup({ writeMarker: async () => ({ ok: false as const, error: 'io' as const }) });
    a.deps.api.createRoom = createOk(a);
    await createSharedFolder({ folderPath: '/ws/a', ownerName: '지호' }, a.deps);
    expect(flow()).toContain('warn: flow create rollback room=room-AAA reason=marker_write_failed error=io');
    expect(flow()).toContain('warn: flow create failed error=io');

    lines.length = 0;
    useShare.setState({ rooms: {} });
    const b = setup({
      listMarkers: async () => [],
      deleteRoom: async () => {
        throw new TypeError('ipc closed for /Users/me/secret-folder');
      },
    });
    b.deps.api.createRoom = createOk(b);
    b.deps.api.removeMarker = async () => {
      throw new RangeError('removeMarker exploded');
    };
    await createSharedFolder({ folderPath: '/ws/a', ownerName: '지호' }, b.deps);
    expect(flow()).toEqual([
      'info: flow create start',
      'warn: flow rollback room=room-AAA owner=true reason=not_registered',
      'warn: flow server room delete threw room=room-AAA error=TypeError',
      'warn: flow rollback step failed step=remove_marker error=RangeError',
      'warn: flow create failed error=too_deep',
    ]);
    expect(lines.join('\n')).not.toContain('secret-folder'); // 오류 메시지(경로)는 남기지 않는다
  });

  it('참가: 성공(역할)·잘못된 코드·서버 거부는 코드만, 소유자 토큰 복구 실패는 error', async () => {
    const ok = setup({ join: async () => ({ ok: true as const, joined: { roomId: R1, participantId: PID2, role: 'participant' as const, folderName: '팀 자료' } }) });
    await joinSharedFolder({ code: 'abcd-2345', displayName: '민수' }, ok.deps);
    expect(flow()).toEqual(['info: flow join start', 'info: flow join ok room=room-AAA role=participant']);

    lines.length = 0;
    const bad = setup({ join: async () => ({ ok: false as const, error: 'invalid_code' as const }) });
    await joinSharedFolder({ code: 'ZZZZZZZZ', displayName: '민수' }, bad.deps);
    await joinSharedFolder({ code: 'bad;code!', displayName: '민수' }, bad.deps);
    expect(flow()).toEqual([
      'info: flow join start',
      'warn: flow join failed error=invalid_code',
      'info: flow join start',
      'warn: flow join failed error=invalid_code',
    ]);

    lines.length = 0;
    useShare.setState({ rooms: {} });
    const s = setup({
      join: async () => {
        s.tokens.set(R1, 'participant-token');
        return { ok: true as const, joined: { roomId: R1, participantId: PID2, role: 'participant' as const, folderName: 'x' } };
      },
      tokenSet: async () => ({ ok: false as const, error: 'io' as const }),
    });
    s.tokens.set(R1, OWNER_TOKEN);
    useShare.setState({ rooms: rooms(room('/ws/mine', { role: 'owner' })) });
    await joinSharedFolder({ code: 'ABCD2345', displayName: '나' }, s.deps);
    expect(flow()).toContain('error: flow join could not restore owner token room=room-AAA — token deleted, room marked denied');
    expect(flow()).toContain('warn: flow join failed error=token_restore_failed');
  });

  it('초대 발급·참가자 내보내기: 시작과 결과(오류 코드)', async () => {
    const s = setup({ invite: async () => ({ ok: true as const, invite: { inviteCode: 'ABCD2345', inviteExpiresAt: 5 } }) });
    await issueInvite(R1, s.deps);
    s.deps.api.invite = async () => ({ ok: false as const, error: 'rate_limited' as const });
    await issueInvite(R1, s.deps);
    s.deps.api.revoke = async () => ({ ok: false as const, error: 'denied' as const });
    await removeParticipant(R1, PID2, s.deps);
    expect(flow()).toEqual([
      'info: flow invite start room=room-AAA',
      'info: flow invite ok room=room-AAA',
      'info: flow invite start room=room-AAA',
      'warn: flow invite failed room=room-AAA error=rate_limited',
      'info: flow remove-participant start room=room-AAA',
      'warn: flow remove-participant failed room=room-AAA error=denied',
    ]);
  });

  it('나가기(forget)와 공유 해제(unshare): 성공, 표식 삭제 실패, 서버 폴백 + serverLeftover', async () => {
    const shared = (role: 'owner' | 'participant') => {
      const s = setup();
      s.markers.push({ folderPath: '/ws/team', marker: room('/ws/team', { role }).marker });
      s.tokens.set(R1, OWNER_TOKEN);
      useShare.setState({ rooms: rooms(room('/ws/team', { role })) });
      return s;
    };
    const a = shared('participant');
    a.deps.api.removeMarker = async () => ({ ok: false as const, error: 'io' as const });
    await forgetSharedFolder(R1, a.deps);
    expect(flow()).toEqual(['info: flow forget start room=room-AAA role=participant', 'warn: flow forget failed room=room-AAA error=io']);

    lines.length = 0;
    useShare.setState({ rooms: {} });
    const b = shared('owner');
    b.deps.api.deleteRoom = async () => ({ ok: false as const, error: 'not_found' as const });
    b.deps.api.participants = async () => ({ ok: true as const, participants: [{ participantId: PID2, displayName: '민수', role: 'participant', joinedAt: 2, online: false }] });
    await unshareFolder(R1, b.deps);
    expect(flow()).toEqual([
      'info: flow unshare start room=room-AAA',
      'warn: flow server room delete failed room=room-AAA error=not_found',
      'warn: flow unshare falling back to participant revoke room=room-AAA',
      'info: flow forget start room=room-AAA role=owner',
      'info: flow forget ok room=room-AAA',
      'info: flow unshare ok room=room-AAA serverLeftover=true',
      'warn: flow unshare serverLeftover room=room-AAA — server room data could not be deleted',
    ]);

    lines.length = 0;
    useShare.setState({ rooms: {} });
    const c = shared('owner');
    c.deps.api.deleteRoom = async () => ({ ok: false as const, error: 'network' as const });
    c.deps.api.participants = async () => ({ ok: false as const, error: 'network' as const });
    await unshareFolder(R1, c.deps);
    expect(flow()).toContain('warn: flow unshare fallback participant list failed room=room-AAA error=network');
    expect(flow()).toContain('warn: flow unshare failed room=room-AAA error=network');
  });

  it('모든 흐름의 로그에 토큰·이름·폴더 이름·초대 코드·경로·전체 방 id가 없다', async () => {
    const s = setup({
      join: async () => ({ ok: true as const, joined: { roomId: R1, participantId: PID2, role: 'participant' as const, folderName: '팀 자료' } }),
      invite: async () => ({ ok: true as const, invite: { inviteCode: 'ABCD2345', inviteExpiresAt: 5 } }),
    });
    s.deps.api.createRoom = createOk(s);
    await createSharedFolder({ folderPath: '/ws/기획', ownerName: '지호' }, s.deps);
    await issueInvite(R1, s.deps);
    await unshareFolder(R1, s.deps);
    useShare.setState({ rooms: {} });
    await joinSharedFolder({ code: 'abcd-2345', displayName: '민수' }, s.deps);
    await forgetSharedFolder(R1, s.deps);
    const all = lines.join('\n');
    expect(flow().length).toBeGreaterThan(6);
    for (const secret of [OWNER_TOKEN, '지호', '민수', '기획', '팀 자료', 'ABCD2345', 'abcd-2345', '/ws/', R1, PID, PID2]) {
      expect(all.includes(secret), `log leaked: ${secret}`).toBe(false);
    }
  });
});
