// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { ShareConnStatus } from '../types';
import { AUTH_TIMEOUT_CLOSE_CODE, RATE_LIMITED_CLOSE_CODE, REVOKED_CLOSE_CODE, createShareSession, setLocalUser } from './shareClient';
import { makeFakeFactories, type FakeProvider, type FakeSocket } from './testFakes';

const ROOM = 'room-AAAAAAAA';

function setup() {
  const fake = makeFakeFactories();
  const statuses: { status: ShareConnStatus; reason?: string }[] = [];
  const tokens = ['tok-1', 'tok-2'];
  const getToken = vi.fn(async () => tokens.shift() ?? 'tok-n');
  const session = createShareSession({
    roomId: ROOM,
    wsUrl: 'wss://relay.example.com',
    getToken,
    factories: fake.factories,
    hooks: { onStatus: (status, reason) => statuses.push({ status, reason }) },
  });
  return { ...fake, session, statuses, getToken, socket: fake.sockets[0] as FakeSocket };
}

describe('createShareSession', () => {
  it('잘못된 roomId는 거부, 소켓은 하나만 만들고 연결은 connect() 전까지 시작하지 않는다', () => {
    expect(() => createShareSession({ roomId: '../x', wsUrl: 'wss://x', getToken: async () => null })).toThrow();
    const { session, socket, sockets } = setup();
    expect(sockets).toHaveLength(1);
    expect(socket.url).toBe('wss://relay.example.com');
    expect(socket.connectCalls).toBe(0);
    expect(session.status).toBe('idle');
  });

  it('openDoc: 새 Y.Doc, 문서 이름 규약, attach 호출, 같은 키는 같은 핸들', () => {
    const { session, providers } = setup();
    const a = session.openDoc('manifest');
    const b = session.openDoc('note:n1');
    expect(a.name).toBe(`${ROOM}/manifest`);
    expect(b.name).toBe(`${ROOM}/note:n1`);
    expect(a.ydoc).not.toBe(b.ydoc);
    expect(a.ydoc.clientID).not.toBe(b.ydoc.clientID);
    expect(providers).toHaveLength(2);
    expect(providers.every((p) => p.attached)).toBe(true); // 공유 소켓 프로바이더는 attach 필수
    expect(session.openDoc('manifest')).toBe(a);
    expect(providers).toHaveLength(2);
    expect(session.getDoc('note:n1')).toBe(b);
    expect(() => session.openDoc('note:../x' as never)).toThrow();
  });

  it('세션마다 새 Y.Doc — 같은 사이드카로 두 번 열어도 clientID가 다르다', () => {
    const src = new Y.Doc();
    src.getMap('notes').set('k', 'v');
    const bytes = Y.encodeStateAsUpdate(src);
    const s1 = setup();
    const s2 = setup();
    const d1 = s1.session.openDoc('manifest', { initialState: bytes });
    const d2 = s2.session.openDoc('manifest', { initialState: bytes });
    expect(d1.ydoc.getMap('notes').get('k')).toBe('v');
    expect(d2.ydoc.getMap('notes').get('k')).toBe('v');
    expect(d1.ydoc.clientID).not.toBe(d2.ydoc.clientID);
    expect(d1.ydoc.clientID).not.toBe(src.clientID);
  });

  it('손상된 initialState는 무시하고 빈 문서로 연다', () => {
    const { session } = setup();
    const h = session.openDoc('comments', { initialState: new Uint8Array([255, 1, 2, 3, 4, 5]) });
    expect(h.ydoc.share.size).toBe(0);
  });

  it('토큰은 프로바이더의 token 함수로 연결마다 새로 받는다', async () => {
    const { session, providers, getToken } = setup();
    session.openDoc('manifest');
    const p = providers[0] as FakeProvider;
    expect(await p.token()).toBe('tok-1');
    expect(await p.token()).toBe('tok-2');
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('토큰이 없으면 빈 문자열을 보낸다(서버가 거부)', async () => {
    const fake = makeFakeFactories();
    const session = createShareSession({ roomId: ROOM, wsUrl: 'wss://x', getToken: async () => null, factories: fake.factories });
    session.openDoc('manifest');
    expect(await fake.providers[0].token()).toBe('');
  });

  it('상태 흐름: idle → connecting → (소켓 연결 + 인증) connected → 끊김 disconnected → 재연결', () => {
    const { session, socket, providers, statuses } = setup();
    session.openDoc('manifest');
    session.connect();
    expect(socket.connectCalls).toBe(1);
    expect(session.status).toBe('connecting');

    socket.setStatus('connecting');
    socket.setStatus('connected');
    expect(session.status).toBe('connecting'); // 소켓만 열림 — 아직 인증 전
    providers[0].authenticate();
    expect(session.status).toBe('connected');

    socket.setStatus('disconnected');
    expect(session.status).toBe('disconnected');
    socket.setStatus('connecting');
    expect(session.status).toBe('connecting');
    socket.setStatus('connected');
    expect(session.status).toBe('connecting'); // 재인증 전까지 connected가 아님
    providers[0].authenticate();
    expect(session.status).toBe('connected');

    expect(statuses.map((s) => s.status)).toEqual(['connecting', 'connected', 'disconnected', 'connecting', 'connected']);
  });

  it('connect()를 두 번 불러도 한 번만 연결', () => {
    const { session, socket } = setup();
    session.connect();
    session.connect();
    expect(socket.connectCalls).toBe(1);
  });

  it('permission-denied → denied, 소켓을 끊고 내장 재접속(connect)도 막는다', () => {
    const { session, socket, providers, statuses } = setup();
    session.openDoc('manifest');
    session.connect();
    socket.setStatus('connected');
    providers[0].denyAuth();
    expect(session.status).toBe('denied');
    expect(socket.disconnectCalls).toBe(1);
    expect(statuses[statuses.length - 1]).toEqual({ status: 'denied', reason: 'permission-denied' });
    const before = socket.connectCalls;
    void socket.connect(); // 프로바이더가 재접속 타이머로 부르는 경로
    expect(socket.connectCalls).toBe(before); // 가드가 막음
    socket.setStatus('disconnected');
    expect(session.status).toBe('denied'); // 끊김이 denied를 덮지 않음
  });

  it('permission-denied 외의 인증 실패 사유(예: room_full)는 그 문서만 실패로 두고 세션 전체를 denied로 만들지 않는다', () => {
    const failedDocs: [string, string][] = [];
    const fake = makeFakeFactories();
    const statuses: { status: ShareConnStatus; reason?: string }[] = [];
    const session = createShareSession({
      roomId: ROOM,
      wsUrl: 'wss://relay.example.com',
      getToken: async () => 'tok',
      factories: fake.factories,
      hooks: { onStatus: (status, reason) => statuses.push({ status, reason }), onDocFailed: (k, r) => failedDocs.push([k, r]) },
    });
    const socket = fake.sockets[0] as FakeSocket;
    session.openDoc('manifest');
    session.openDoc('note:n1');
    session.connect();
    socket.setStatus('connected');
    (fake.providers[0] as FakeProvider).authenticate();
    expect(session.status).toBe('connected');
    (fake.providers[1] as FakeProvider).denyAuth('room_full'); // 서버가 이 문서만 거부
    expect(session.status).toBe('connected'); // manifest는 인증돼 있고 세션은 그대로
    expect(failedDocs).toEqual([['note:n1', 'room_full']]);
    expect(socket.disconnectCalls).toBe(0);
    expect(statuses.some((x) => x.status === 'denied')).toBe(false);
    // 내장 재접속도 막히지 않는다
    const before = socket.connectCalls;
    void socket.connect();
    expect(socket.connectCalls).toBe(before + 1);
  });

  it('모든 문서가 접근 해제 아닌 사유로 실패하면 connecting(재시도 가능)이고 denied가 아니다', () => {
    const { session, socket, providers } = setup();
    session.openDoc('manifest');
    session.connect();
    socket.setStatus('connected');
    providers[0].denyAuth('room_full');
    expect(session.status).toBe('connecting');
    providers[0].emit('authenticationFailed', {}); // 사유가 아예 없는 이상한 응답도 접근 해제로 오인하지 않는다
    expect(session.status).toBe('connecting');
    providers[0].denyAuth('Failed to get token during sendToken(): Error: ipc'); // 토큰을 못 읽은 경우
    expect(session.status).toBe('connecting');
  });

  it('revoked 사유의 인증 실패는 permission-denied와 같이 denied(사유 보존)', () => {
    const { session, socket, providers, statuses } = setup();
    session.openDoc('manifest');
    session.connect();
    socket.setStatus('connected');
    providers[0].denyAuth('revoked');
    expect(session.status).toBe('denied');
    expect(statuses[statuses.length - 1]).toEqual({ status: 'denied', reason: 'revoked' });
  });

  it('실패한 문서의 인증은 지수 백오프로 다시 시도하고(1s, 2s, 4s …) 성공하면 복구 훅을 부른다', () => {
    vi.useFakeTimers();
    try {
      const recovered: string[] = [];
      const fake = makeFakeFactories();
      const session = createShareSession({
        roomId: ROOM,
        wsUrl: 'wss://relay.example.com',
        getToken: async () => 'tok',
        factories: fake.factories,
        hooks: { onDocRecovered: (k) => recovered.push(k) },
      });
      const socket = fake.sockets[0] as FakeSocket;
      session.openDoc('note:n1');
      session.connect();
      socket.setStatus('connected');
      const p = fake.providers[0] as FakeProvider;
      p.denyAuth('room_full');
      vi.advanceTimersByTime(999);
      expect(p.sendTokenCalls).toBe(0);
      vi.advanceTimersByTime(1);
      expect(p.sendTokenCalls).toBe(1);
      p.denyAuth('room_full'); // 다시 거부
      vi.advanceTimersByTime(1999);
      expect(p.sendTokenCalls).toBe(1);
      vi.advanceTimersByTime(1);
      expect(p.sendTokenCalls).toBe(2);
      p.authenticate(); // 이번엔 통과
      expect(recovered).toEqual(['note:n1']);
      expect(session.status).toBe('connected');
      vi.advanceTimersByTime(120_000);
      expect(p.sendTokenCalls).toBe(2); // 복구된 뒤에는 더 시도하지 않는다
      session.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('재시도는 6번까지만 하고, 문서를 닫거나 세션을 파기하면 타이머가 정리된다', () => {
    vi.useFakeTimers();
    try {
      const { session, socket, providers } = setup();
      session.openDoc('note:n1');
      session.openDoc('note:n2');
      session.connect();
      socket.setStatus('connected');
      const p1 = providers[0] as FakeProvider;
      const p2 = providers[1] as FakeProvider;
      for (let i = 0; i < 10; i++) {
        p1.denyAuth('room_full');
        vi.advanceTimersByTime(60_000);
      }
      expect(p1.sendTokenCalls).toBe(6);
      p2.denyAuth('room_full');
      session.closeDoc('note:n2');
      vi.advanceTimersByTime(60_000);
      expect(p2.sendTokenCalls).toBe(0);
      p1.denyAuth('room_full');
      session.destroy();
      vi.advanceTimersByTime(60_000);
      expect(p1.sendTokenCalls).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it('접근 해제(denied)가 되면 대기 중이던 문서 재시도는 멈춘다', () => {
    vi.useFakeTimers();
    try {
      const { session, socket, providers } = setup();
      session.openDoc('note:n1');
      session.openDoc('manifest');
      session.connect();
      socket.setStatus('connected');
      const p1 = providers[0] as FakeProvider;
      p1.denyAuth('room_full');
      providers[1].denyAuth('permission-denied');
      expect(session.status).toBe('denied');
      vi.advanceTimersByTime(60_000);
      expect(p1.sendTokenCalls).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('강퇴(close 4403 revoked) → denied + 재접속 중단', () => {
    const { session, socket, statuses } = setup();
    session.openDoc('manifest');
    session.connect();
    socket.setStatus('connected');
    socket.close(REVOKED_CLOSE_CODE);
    expect(session.status).toBe('denied');
    expect(statuses[statuses.length - 1]).toEqual({ status: 'denied', reason: 'revoked' });
    expect(socket.disconnectCalls).toBe(1);
    const before = socket.connectCalls;
    void socket.connect();
    expect(socket.connectCalls).toBe(before);
  });

  it('close 4403 reason room_deleted(소유자가 공유를 끝냄)도 denied + 재접속 중단, 사유는 revoked와 구분된다', () => {
    const { session, socket, statuses } = setup();
    session.openDoc('manifest');
    session.connect();
    socket.setStatus('connected');
    socket.close(REVOKED_CLOSE_CODE, 'room_deleted');
    expect(session.status).toBe('denied');
    expect(statuses[statuses.length - 1]).toEqual({ status: 'denied', reason: 'room_deleted' });
    const before = socket.connectCalls;
    void socket.connect();
    expect(socket.connectCalls).toBe(before);
  });

  it('close 4408(auth_timeout)·4429(rate_limited)는 denied가 아니다 — 프로바이더의 즉시 재접속을 늘려 가는 대기로 미룬다', () => {
    vi.useFakeTimers();
    try {
      const { session, socket } = setup();
      session.openDoc('manifest');
      session.connect();
      socket.setStatus('connected');
      const c0 = socket.connectCalls;
      socket.close(RATE_LIMITED_CLOSE_CODE, 'rate_limited');
      expect(session.status).toBe('disconnected'); // denied가 아니다
      expect(socket.disconnectCalls).toBe(0);
      void socket.connect(); // 프로바이더가 close 뒤에 부르는 재접속
      expect(socket.connectCalls).toBe(c0); // 아직 대기 중
      vi.advanceTimersByTime(4999);
      expect(socket.connectCalls).toBe(c0);
      vi.advanceTimersByTime(1);
      expect(socket.connectCalls).toBe(c0 + 1); // 5초 뒤 한 번만
      // 또 4429면 두 배(10초)
      socket.close(RATE_LIMITED_CLOSE_CODE, 'too_many_connections');
      void socket.connect();
      void socket.connect(); // 중복 호출은 하나로 합쳐진다
      vi.advanceTimersByTime(9999);
      expect(socket.connectCalls).toBe(c0 + 1);
      vi.advanceTimersByTime(1);
      expect(socket.connectCalls).toBe(c0 + 2);
      session.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('4408은 1초부터, 인증에 성공하면 대기가 처음으로 돌아가며, 대기 중 disconnect/destroy하면 재접속하지 않는다', () => {
    vi.useFakeTimers();
    try {
      const { session, socket, providers } = setup();
      session.openDoc('manifest');
      session.connect();
      socket.setStatus('connected');
      const c0 = socket.connectCalls;
      socket.close(AUTH_TIMEOUT_CLOSE_CODE, 'auth_timeout');
      void socket.connect();
      vi.advanceTimersByTime(999);
      expect(socket.connectCalls).toBe(c0);
      vi.advanceTimersByTime(1);
      expect(socket.connectCalls).toBe(c0 + 1);
      // 인증 성공 → 백오프 초기화: 다음 4408도 다시 1초
      socket.setStatus('connected');
      (providers[0] as FakeProvider).authenticate();
      socket.close(AUTH_TIMEOUT_CLOSE_CODE, 'auth_timeout');
      void socket.connect();
      vi.advanceTimersByTime(1000);
      expect(socket.connectCalls).toBe(c0 + 2);
      // 대기 중에 세션을 끊으면 재접속하지 않는다
      socket.close(AUTH_TIMEOUT_CLOSE_CODE, 'auth_timeout');
      void socket.connect();
      session.disconnect();
      vi.advanceTimersByTime(120_000);
      expect(socket.connectCalls).toBe(c0 + 2);
      session.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('서버가 문서 한도(doc_too_large·room_over_budget)로 문서 하나를 닫으면 그 문서만 멈춘다 — 세션 유지, 실패 훅, 소켓에서 떼기, 재시도는 상한(2번)', () => {
    vi.useFakeTimers();
    try {
      const failed: [string, string][] = [];
      const fake = makeFakeFactories();
      const session = createShareSession({
        roomId: ROOM,
        wsUrl: 'wss://relay.example.com',
        getToken: async () => 'tok',
        factories: fake.factories,
        hooks: { onDocFailed: (k, r) => failed.push([k, r]) },
      });
      const socket = fake.sockets[0] as FakeSocket;
      session.openDoc('manifest');
      session.openDoc('note:big');
      session.connect();
      socket.setStatus('connected');
      const [pm, pb] = fake.providers as FakeProvider[];
      pm.authenticate();
      pb.authenticate();
      expect(session.status).toBe('connected');
      // provider는 문서 단위 close를 code 1000 + reason 문자열로 전달한다
      pb.emit('close', { event: { code: 1000, reason: 'doc_too_large' } });
      expect(failed).toEqual([['note:big', 'doc_too_large']]);
      expect(pb.detachCalls).toBe(1);
      expect(session.status).toBe('connected'); // manifest는 그대로
      expect(socket.disconnectCalls).toBe(0);
      // 60초 뒤 한 번 다시 붙여 본다
      const attach0 = pb.attachCalls;
      vi.advanceTimersByTime(59_999);
      expect(pb.attachCalls).toBe(attach0);
      vi.advanceTimersByTime(1);
      expect(pb.attachCalls).toBe(attach0 + 1);
      // 또 쫓겨나면 240초 뒤 한 번 더, 그 뒤로는 다시 붙이지 않는다(반복 축출 루프 방지)
      pb.emit('close', { event: { code: 1000, reason: 'room_over_budget' } });
      vi.advanceTimersByTime(240_000);
      expect(pb.attachCalls).toBe(attach0 + 2);
      pb.emit('close', { event: { code: 1000, reason: 'doc_too_large' } });
      vi.advanceTimersByTime(3_600_000);
      expect(pb.attachCalls).toBe(attach0 + 2);
      expect(failed.map(([, r]) => r)).toEqual(['doc_too_large', 'room_over_budget', 'doc_too_large']);
      expect(pm.detachCalls).toBe(0); // 다른 문서는 건드리지 않았다
      session.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('문서 한도와 무관한 close 사유·코드는 문서를 멈추지 않는다', () => {
    const { session, socket, providers } = setup();
    session.openDoc('manifest');
    session.connect();
    socket.setStatus('connected');
    const p = providers[0] as FakeProvider;
    p.emit('close', { event: { code: 1006 } });
    p.emit('close', { event: { code: 1000, reason: 'normal' } });
    p.emit('close', {});
    expect(p.detachCalls).toBe(0);
  });

  it('다른 close 코드는 denied가 아니다(재접속은 프로바이더에 맡김)', () => {
    const { session, socket } = setup();
    session.connect();
    socket.setStatus('connected');
    socket.close(1006);
    expect(session.status).toBe('disconnected');
    expect(socket.disconnectCalls).toBe(0);
  });

  it('reconnect()는 denied를 풀고 다시 연결한다', () => {
    const { session, socket, providers } = setup();
    session.openDoc('manifest');
    session.connect();
    providers[0].denyAuth();
    expect(session.status).toBe('denied');
    const before = socket.connectCalls;
    session.reconnect();
    expect(socket.connectCalls).toBe(before + 1);
    expect(session.status).toBe('connecting');
  });

  it('disconnect(): 연결만 끊고 문서는 유지, status idle', () => {
    const { session, socket } = setup();
    const h = session.openDoc('manifest');
    session.connect();
    socket.setStatus('connected');
    session.disconnect();
    expect(session.status).toBe('idle');
    expect(socket.disconnectCalls).toBe(1);
    expect(session.getDoc('manifest')).toBe(h);
  });

  it('closeDoc: 프로바이더 destroy 후 Y.Doc destroy, destroy(): 모두 정리하고 소켓 파기', () => {
    const { session, socket, providers } = setup();
    const a = session.openDoc('manifest');
    session.openDoc('note:n1');
    const destroyed = vi.fn();
    a.ydoc.on('destroy', destroyed);
    session.closeDoc('manifest');
    expect(providers[0].destroyed).toBe(true);
    expect(destroyed).toHaveBeenCalled();
    expect(session.getDoc('manifest')).toBeUndefined();
    session.closeDoc('manifest'); // 멱등

    session.destroy();
    expect(providers[1].destroyed).toBe(true);
    expect(socket.destroyed).toBe(true);
    expect(session.status).toBe('idle');
    expect(() => session.openDoc('comments')).toThrow();
    session.connect(); // 파기 후에는 무시
    expect(socket.connectCalls).toBe(0);
  });

  it('whenSynced: 이미 동기화면 즉시 true, 동기화 이벤트 시 true, timeout이면 false', async () => {
    vi.useFakeTimers();
    try {
      const { session, providers } = setup();
      const a = session.openDoc('manifest');
      const b = session.openDoc('comments');
      const c = session.openDoc('note:n1');
      providers[0].isSynced = true;
      await expect(a.whenSynced()).resolves.toBe(true);
      const pb = b.whenSynced(5000);
      providers[1].sync();
      await expect(pb).resolves.toBe(true);
      const pc = c.whenSynced(1000);
      await vi.advanceTimersByTimeAsync(1001);
      await expect(pc).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('setLocalUser는 awareness에 user 필드를 싣는다', () => {
    const { session } = setup();
    const h = session.openDoc('manifest');
    setLocalUser(h.awareness, { participantId: 'pid-AAAAAAAAAAAA', name: '지호' });
    expect(h.awareness.getLocalState()).toEqual({ user: { participantId: 'pid-AAAAAAAAAAAA', name: '지호' } });
  });
});

describe('진단 훅(로그용) — onSocketClose · onDocGaveUp', () => {
  function setupWithHooks() {
    const fake = makeFakeFactories();
    const closes: [number | undefined, string | undefined][] = [];
    const gaveUp: [string, string][] = [];
    const session = createShareSession({
      roomId: ROOM,
      wsUrl: 'wss://relay.example.com',
      getToken: async () => 'tok',
      factories: fake.factories,
      hooks: {
        onSocketClose: (code, reason) => closes.push([code, reason]),
        onDocGaveUp: (docKey, reason) => gaveUp.push([docKey, reason]),
      },
    });
    return { ...fake, session, closes, gaveUp, socket: fake.sockets[0] as FakeSocket };
  }

  it('소켓이 닫힐 때마다 close code와 서버가 보낸 사유(없으면 undefined)를 알린다', () => {
    const { session, socket, closes } = setupWithHooks();
    session.openDoc('manifest');
    session.connect();
    socket.setStatus('connected');
    socket.close(RATE_LIMITED_CLOSE_CODE, 'rate_limited');
    socket.close(1006);
    socket.emit('close', {}); // 이벤트 정보가 없는 close도 던지지 않는다
    expect(closes).toEqual([
      [RATE_LIMITED_CLOSE_CODE, 'rate_limited'],
      [1006, undefined],
      [undefined, undefined],
    ]);
    session.destroy();
  });

  it('인증 실패 재시도(최대 6번)를 다 쓰면 그 문서에 대해 한 번만 포기를 알린다', () => {
    vi.useFakeTimers();
    try {
      const { session, socket, providers, gaveUp } = setupWithHooks();
      session.openDoc('note:n1');
      session.connect();
      socket.setStatus('connected');
      const p = providers[0] as FakeProvider;
      p.denyAuth('room_full'); // 실패 → 재시도 1
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(30_000); // 재시도 실행(토큰 재전송)
        p.denyAuth('room_full'); // 또 실패 → 다음 재시도 예약(2…6)
      }
      expect(gaveUp).toEqual([]); // 여섯 번째 재시도는 아직 결과를 기다린다
      vi.advanceTimersByTime(30_000);
      p.denyAuth('room_full'); // 여섯 번째 재시도도 실패 → 포기
      p.denyAuth('room_full'); // 이후 반복은 다시 알리지 않는다
      expect(gaveUp).toEqual([['note:n1', 'room_full']]);
      session.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('서버 한도로 닫힌 문서를 다시 붙이는 횟수(2번)를 넘기면 포기를 알린다', () => {
    const { session, socket, providers, gaveUp } = setupWithHooks();
    session.openDoc('note:big');
    session.connect();
    socket.setStatus('connected');
    const pb = providers[0] as FakeProvider;
    pb.emit('close', { event: { code: 1000, reason: 'doc_too_large' } });
    pb.emit('close', { event: { code: 1000, reason: 'doc_too_large' } });
    expect(gaveUp).toEqual([]);
    pb.emit('close', { event: { code: 1000, reason: 'doc_too_large' } });
    expect(gaveUp).toEqual([['note:big', 'doc_too_large']]);
    session.destroy();
  });
});
