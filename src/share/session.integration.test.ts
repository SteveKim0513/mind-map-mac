// @vitest-environment node
// 세션 ↔ 실제 릴레이 통합: 소유자가 방을 지우면(DELETE /rooms/:id) 참가자의 라이브 소켓이 close 4403 `room_deleted`로 끊기고
// 클라이언트는 재접속 없이 denied(사유 room_deleted)로 표시한다. (사전 조건: `npm --prefix server run build`)
import { assertNodeNetworkGlobals } from './replicaDomSetup';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ShareConnStatus } from '../types';
import { MANIFEST_KEY } from './docKeys';
import { until } from './replicaTestKit';
import { createShareSession, type ShareSession } from './shareClient';

assertNodeNetworkGlobals();

const RELAY_ENTRY = resolve(process.cwd(), 'server/dist/relay.js');
interface Relay {
  url: string;
  wsUrl: string;
  stats(): { documents: number; connections: number };
  close(): Promise<void>;
}

let relay: Relay;
const cleanups: (() => void)[] = [];

beforeAll(async () => {
  if (!existsSync(RELAY_ENTRY)) {
    throw new Error('server/dist/relay.js 가 없습니다 — `npm --prefix server run build` 를 먼저 실행하세요 (릴레이 서버 빌드 산출물이 필요한 통합 테스트입니다).');
  }
  const mod = (await import(/* @vite-ignore */ pathToFileURL(RELAY_ENTRY).href)) as {
    startRelay(o: { port: number; silent: boolean }): Promise<Relay>;
  };
  relay = await mod.startRelay({ port: 0, silent: true });
  return async () => {
    await relay.close();
  };
});
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await fetch(relay.url + path, {
    method,
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, string>) : {} };
}

interface Live {
  session: ShareSession;
  statuses: { status: ShareConnStatus; reason?: string }[];
}
function connect(roomId: string, token: string): Live {
  const statuses: Live['statuses'] = [];
  const session = createShareSession({
    roomId,
    wsUrl: relay.wsUrl,
    getToken: async () => token,
    hooks: { onStatus: (status, reason) => statuses.push({ status, reason }) },
  });
  session.openDoc(MANIFEST_KEY);
  session.connect();
  cleanups.push(() => session.destroy());
  return { session, statuses };
}

describe('세션 ↔ 실제 릴레이', () => {
  it('소유자가 방을 지우면 참가자의 연결은 재접속 없이 denied(사유 room_deleted)가 되고, 지운 뒤에는 토큰이 무효하다', async () => {
    const created = await call('POST', '/rooms', { body: { ownerName: 'Owner', folderName: 'team' } });
    const roomId = created.json.roomId;
    const owner = { token: created.json.ownerToken };
    const inv = await call('POST', `/rooms/${roomId}/invites`, { token: owner.token });
    const joined = await call('POST', '/join', { body: { code: inv.json.inviteCode, displayName: 'Bea' } });

    const guest = connect(roomId, joined.json.token);
    const host = connect(roomId, owner.token);
    await until(() => guest.session.status === 'connected' && host.session.status === 'connected', '두 연결이 인증됨', 15_000);

    // 비소유자는 방을 지울 수 없다
    expect((await call('DELETE', `/rooms/${roomId}`, { token: joined.json.token })).status).toBe(403);
    expect(guest.session.status).toBe('connected');

    expect((await call('DELETE', `/rooms/${roomId}`, { token: owner.token })).status).toBe(204);
    await until(() => guest.session.status === 'denied', '참가자가 접근 해제로 표시됨', 15_000);
    expect(guest.statuses[guest.statuses.length - 1]).toEqual({ status: 'denied', reason: 'room_deleted' });
    await until(() => host.session.status === 'denied', '소유자 연결도 종료', 15_000);

    // 재접속을 시도하지 않는다(가드): 잠시 뒤에도 서버에 연결이 없다 — 양성 신호는 이미 denied가 됐다는 사실
    expect(relay.stats().connections).toBe(0);
    // 방과 토큰이 없어졌다
    expect((await call('GET', `/rooms/${roomId}/participants`, { token: owner.token })).status).toBe(401);
    expect((await call('DELETE', `/rooms/${roomId}`, { token: owner.token })).status).toBe(401);
  }, 60_000);

  it('강퇴(revoke)는 사유가 revoked로 구분된다', async () => {
    const created = await call('POST', '/rooms', { body: { ownerName: 'Owner', folderName: 'team' } });
    const roomId = created.json.roomId;
    const inv = await call('POST', `/rooms/${roomId}/invites`, { token: created.json.ownerToken });
    const joined = await call('POST', '/join', { body: { code: inv.json.inviteCode, displayName: 'Bea' } });
    const guest = connect(roomId, joined.json.token);
    await until(() => guest.session.status === 'connected', '연결됨', 15_000);
    expect((await call('DELETE', `/rooms/${roomId}/participants/${joined.json.participantId}`, { token: created.json.ownerToken })).status).toBe(204);
    await until(() => guest.session.status === 'denied', '강퇴됨', 15_000);
    expect(guest.statuses[guest.statuses.length - 1]).toEqual({ status: 'denied', reason: 'revoked' });
  }, 60_000);
});
