// 공유 방 진단 로그: 연결 상태 전이·문서 실패·소켓 종료가 `[share]` 로그로 남고, 반복은 억제되며, 비밀은 새지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShareMarker } from '../types';
import { useShare } from '../store/shareStore';
import { connectRoom, disconnectRoom, refreshParticipants, refreshShareMarkers, stopAllRooms } from './rooms';
import { REVOKED_CLOSE_CODE } from './shareClient';
import { THROTTLE_WINDOW_MS, resetShareLogState, setShareLogSink } from './shareLog';
import { memSink } from './commentTestKit';
import { makeFakeFactories, makeFakeShareApi, type FakeProvider, type FakeSocket } from './testFakes';

const R1 = 'room-AAAAAAAA';
const PID = 'pid-AAAAAAAAAAAA';
const T0 = 5_000_000;
const SECRET_TOKEN = 'tok-SECRET-1234567890';
const FOLDER_NAME = '비밀프로젝트';
const DISPLAY_NAME = '지호킴';

function marker(over: Partial<ShareMarker> = {}): ShareMarker {
  return { v: 1, roomId: R1, relayUrl: 'https://relay.example.com', role: 'participant', participantId: PID, folderName: FOLDER_NAME, displayName: DISPLAY_NAME, ...over };
}

function setup(m: ShareMarker = marker(), apiOver = {}) {
  const fake = makeFakeShareApi({ listMarkers: async () => [{ folderPath: `/ws/${FOLDER_NAME}`, marker: m }], ...apiOver });
  fake.tokens.set(R1, SECRET_TOKEN);
  const f = makeFakeFactories();
  const deps = { api: fake.api, factories: f.factories, sidecarDebounceMs: 10, markerRescanDelayMs: 0 };
  return { ...fake, ...f, deps };
}

let lines: string[];
const share = () => lines.filter((l) => l.includes('conn room='));

beforeEach(() => {
  lines = [];
  resetShareLogState();
  setShareLogSink((level, message) => lines.push(`${level}: ${message}`));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  useShare.setState({ rooms: {} });
});
afterEach(async () => {
  await stopAllRooms();
  vi.useRealTimers();
  setShareLogSink(null);
});

async function connected() {
  const ctx = setup();
  await refreshShareMarkers(ctx.deps);
  await connectRoom(R1, ctx.deps);
  const sock = ctx.sockets[0] as FakeSocket;
  sock.setStatus('connected');
  (ctx.providers[0] as FakeProvider).authenticate();
  return { ...ctx, sock, provider: ctx.providers[0] as FakeProvider };
}

describe('연결 상태 전이 로그', () => {
  it('연결 시작 → 연결됨 → 끊김을 이전 상태와 함께 남긴다', async () => {
    const { sock } = await connected();
    sock.setStatus('disconnected');
    expect(share()).toEqual([
      'info: conn room=room-AAA idle->connecting',
      'info: conn room=room-AAA connecting->connected',
      'info: conn room=room-AAA connected->disconnected',
    ]);
  });

  it('재접속 백오프로 같은 전이가 반복되면 60초에 1회만 남기고 다음 기록에 (+N)으로 요약한다', async () => {
    const { sock, provider } = await connected();
    for (let i = 0; i < 5; i++) {
      sock.setStatus('disconnected');
      sock.setStatus('connecting');
      sock.setStatus('connected');
      provider.authenticate();
    }
    // 같은 (방, 상태, 사유)는 창 안에서 다시 남기지 않는다 — 5번 끊겨도 각 상태는 한 번씩(connecting·connected는 최초 연결에서 이미 남음).
    expect(share()).toEqual([
      'info: conn room=room-AAA idle->connecting',
      'info: conn room=room-AAA connecting->connected',
      'info: conn room=room-AAA connected->disconnected',
    ]);
    const total = lines.length;
    vi.setSystemTime(T0 + THROTTLE_WINDOW_MS + 1);
    sock.setStatus('disconnected');
    expect(lines.length).toBe(total + 1);
    expect(lines[lines.length - 1]).toBe('info: conn room=room-AAA connected->disconnected (+4)');
  });

  it('강퇴(4403 revoked)와 방 삭제(room_deleted)는 warn + 사유 코드, 소켓 종료 코드도 남긴다', async () => {
    const { sock } = await connected();
    sock.close(REVOKED_CLOSE_CODE, 'revoked');
    expect(lines).toContain('warn: conn room=room-AAA connected->denied reason=revoked');
    expect(lines).toContain('warn: socket closed room=room-AAA code=4403 reason=revoked');

    lines.length = 0;
    await disconnectRoom(R1);
    useShare.setState({ rooms: {} });
    resetShareLogState(); // 같은 방을 새 시나리오로 다시 연결한다 — 억제 상태를 비운다
    const again = await connected();
    again.sock.close(REVOKED_CLOSE_CODE, 'room_deleted');
    expect(lines).toContain('warn: conn room=room-AAA connected->denied reason=room_deleted');
  });

  it('정상 종료(1000)는 소켓 종료 로그를 남기지 않고, 비정상(1006)은 info로 남긴다', async () => {
    const { sock } = await connected();
    sock.close(1000);
    expect(lines.some((l) => l.includes('socket closed'))).toBe(false);
    sock.close(1006);
    expect(lines).toContain('info: socket closed room=room-AAA code=1006');
  });

  it('토큰 없음 · 릴레이 불일치 · 릴레이 미설정 사유를 코드로 남긴다', async () => {
    let ctx = setup();
    ctx.tokens.clear();
    await refreshShareMarkers(ctx.deps);
    await connectRoom(R1, ctx.deps);
    expect(lines).toContain('warn: conn room=room-AAA connecting->denied reason=no_token');

    useShare.setState({ rooms: {} });
    lines.length = 0;
    resetShareLogState();
    ctx = setup(marker({ relayUrl: 'https://evil.example.com' }));
    await refreshShareMarkers(ctx.deps);
    await connectRoom(R1, ctx.deps);
    expect(lines).toContain('warn: conn room=room-AAA connecting->idle reason=relay_mismatch');

    useShare.setState({ rooms: {} });
    lines.length = 0;
    resetShareLogState();
    ctx = setup(marker(), { relayUrl: async () => ({ ok: false as const, error: 'relay_not_configured' as const }) });
    await refreshShareMarkers(ctx.deps);
    await connectRoom(R1, ctx.deps);
    expect(lines).toContain('warn: conn room=room-AAA connecting->idle reason=relay_not_configured');
  });

  it('연결을 정리하면(로컬) idle 전이를 stopped 사유로 남기고, 참가자 목록 거부(denied)도 전이로 남긴다', async () => {
    await connected();
    await disconnectRoom(R1);
    expect(lines).toContain('info: conn room=room-AAA connected->idle reason=stopped'); // 정리 중 잠깐의 connecting은 억제돼도 이어 읽힌다

    lines.length = 0;
    resetShareLogState();
    const ctx = setup(marker(), { participants: async () => ({ ok: false as const, error: 'denied' as const }) });
    useShare.setState({ rooms: {} });
    await refreshShareMarkers(ctx.deps);
    await connectRoom(R1, ctx.deps);
    (ctx.sockets[0] as FakeSocket).setStatus('connected');
    (ctx.providers[0] as FakeProvider).authenticate();
    await refreshParticipants(R1, ctx.deps);
    expect(lines).toContain('warn: conn room=room-AAA connected->denied reason=denied');
  });
});

describe('문서 단위 실패 로그', () => {
  it('문서 종류와 사유 코드만 남기고(문서 id는 앞 8자), 같은 (방·종류·사유)는 억제한다', async () => {
    const { provider } = await connected();
    provider.denyAuth('room_full');
    expect(lines).toContain('warn: doc failed room=room-AAA doc=manifest reason=room_full');
    provider.denyAuth('room_full');
    provider.denyAuth('room_full');
    expect(lines.filter((l) => l.includes('doc failed'))).toHaveLength(1);
    provider.authenticate();
    expect(lines).toContain('info: doc recovered room=room-AAA doc=manifest');
  });

  it('한도 초과로 닫힌 문서(doc_too_large)는 사유와 함께, 재시도가 소진되면 error로 남긴다', async () => {
    const { deps, sockets } = await connected();
    const { openSharedDoc } = await import('./rooms');
    const handle = await openSharedDoc(R1, 'note:0123456789abcdefghij', deps, { persist: false });
    expect(handle).not.toBeNull();
    const provider = handle!.provider as unknown as FakeProvider;
    void sockets;
    for (let i = 0; i < 3; i++) provider.emit('close', { event: { code: 1000, reason: 'doc_too_large' } });
    expect(lines).toContain('warn: doc failed room=room-AAA doc=note:01234567 reason=doc_too_large');
    expect(lines).toContain('error: doc gave up room=room-AAA doc=note:01234567 reason=doc_too_large (retries exhausted)');
    // 문서 id는 앞 8자까지만 — 전체 id는 어디에도 없다.
    expect(lines.join('\n')).not.toContain('0123456789abcdef');
  });
});

describe('표식 스캔 로그', () => {
  it('스캔 실패는 warn(기존 방 유지), 표식이 사라져 연결을 정리하면 info로 남긴다', async () => {
    const ctx = setup();
    await refreshShareMarkers(ctx.deps);
    await connectRoom(R1, ctx.deps);
    const api = ctx.api as unknown as { listMarkers: () => Promise<unknown[]> };
    const original = api.listMarkers;
    api.listMarkers = async () => {
      throw new Error('ipc');
    };
    await refreshShareMarkers(ctx.deps);
    expect(lines).toContain('warn: markers scan failed — existing rooms kept');
    api.listMarkers = original;
    api.listMarkers = async () => [];
    await refreshShareMarkers(ctx.deps);
    expect(lines.some((l) => l.startsWith('info: marker gone room=room-AAA'))).toBe(true);
  });
});

describe('시작 실패 로그', () => {
  it('코멘트 동기화 시작에 실패해도 연결은 살리고, 오류 이름만 error로 남긴다(메시지 없음)', async () => {
    const ctx = setup();
    const mem = memSink();
    mem.sink.ready = async () => {
      throw new Error('disk exploded while reading /Users/me/secret.json');
    };
    const deps = { ...ctx.deps, commentHooks: {}, commentSink: mem.sink };
    await refreshShareMarkers(deps);
    expect(await connectRoom(R1, deps)).toBe(true);
    expect(lines).toContain('error: comments start failed room=room-AAA error=Error');
    expect(lines.join('\n')).not.toContain('secret.json');
  });
});

describe('개인정보', () => {
  it('어떤 전이·실패 로그에도 토큰·폴더 이름·표시 이름·경로·전체 방 id가 없다', async () => {
    const { sock, provider } = await connected();
    provider.denyAuth('room_full');
    sock.close(1006);
    sock.close(4429, 'rate_limited');
    sock.close(REVOKED_CLOSE_CODE, 'revoked');
    await disconnectRoom(R1);
    const all = lines.join('\n');
    expect(all.length).toBeGreaterThan(0);
    for (const secret of [SECRET_TOKEN, FOLDER_NAME, DISPLAY_NAME, '/ws/', R1, PID]) {
      expect(all.includes(secret), `log leaked: ${secret}`).toBe(false);
    }
  });
});
