import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MAX_SIDECAR_DOC_ID, sidecarIdForDocKey } from '../src/share/docKeys';
import { SHARE_MAX_FOLDER_DEPTH, SHARE_MAX_SCAN_DIRS } from '../src/io/shareLimits';
import {
  addCspHeader,
  buildConnectSrc,
  createShareHandlers,
  isSidecarId,
  LIST_MAX_DEPTH,
  LIST_MAX_DIRS,
  mapRelayError,
  MARKER_DIR,
  MAX_SIDECAR_BYTES,
  readBoundedText,
  resolveRelayConfig,
  resolveShareFolder,
  type ShareDeps,
} from './share';

const ROOM = 'room-AAAAAAAA';
const PID = 'pid-AAAAAAAAAAAA';
const marker = {
  v: 1,
  roomId: ROOM,
  relayUrl: 'https://relay.example.com',
  role: 'owner',
  participantId: PID,
  folderName: 'team',
  displayName: '지호',
};

let base: string; // 임시 루트
let ws: string; // 워크스페이스
let userData: string;
let logs: string[];

/** safeStorage 대역: base64로 "암호화"하되 평문과 구분되는 접두사를 붙인다. */
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from('ENC:' + Buffer.from(s).toString('base64')),
  decryptString: (b: Buffer) => {
    const t = b.toString();
    if (!t.startsWith('ENC:')) throw new Error('not encrypted');
    return Buffer.from(t.slice(4), 'base64').toString();
  },
};

type FetchFn = ShareDeps['fetch'];
function jsonResponse(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status, headers });
}

function makeDeps(over: Partial<ShareDeps> = {}): ShareDeps {
  return {
    userDataDir: () => userData,
    getWorkspace: async () => ws,
    atomicWrite: async (target, data) => {
      await fs.writeFile(target, data);
    },
    safeStorage: fakeSafeStorage,
    fetch: (async () => jsonResponse(500)) as unknown as FetchFn,
    envRelayUrl: 'https://relay.example.com',
    defaultRelayUrl: '',
    log: (_l, m) => logs.push(m),
    ...over,
  };
}

beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'share-test-')));
  ws = path.join(base, 'ws');
  userData = path.join(base, 'userData');
  await fs.mkdir(path.join(ws, 'shared'), { recursive: true });
  await fs.mkdir(userData, { recursive: true });
  logs = [];
});
afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

describe('resolveRelayConfig', () => {
  it('환경변수가 기본값보다 우선', () => {
    const r = resolveRelayConfig('https://env.example.com/', 'https://default.example.com');
    expect(r).toEqual({ ok: true, info: { url: 'https://env.example.com', wsUrl: 'wss://env.example.com' } });
  });
  it('환경변수 없으면 기본값, 둘 다 비면 relay_not_configured', () => {
    expect(resolveRelayConfig(undefined, 'https://default.example.com')).toMatchObject({ ok: true });
    expect(resolveRelayConfig('  ', '')).toEqual({ ok: false, error: 'relay_not_configured' });
    expect(resolveRelayConfig(undefined, '')).toEqual({ ok: false, error: 'relay_not_configured' });
  });
  it('패키지된 앱에서는 환경변수를 무시하고 기본값만 쓴다(비패키지는 환경변수 우선)', () => {
    const env = 'http://127.0.0.1:4000';
    const def = 'https://default.example.com';
    expect(resolveRelayConfig(env, def, true)).toEqual({ ok: true, info: { url: def, wsUrl: 'wss://default.example.com' } });
    expect(resolveRelayConfig(env, def, false)).toMatchObject({ ok: true, info: { url: env } });
    expect(resolveRelayConfig(env, def)).toMatchObject({ ok: true, info: { url: env } }); // 기본은 비패키지
    // 기본값이 비어 있으면 패키지 앱은 환경변수로 우회할 수 없고 미설정으로 남는다
    expect(resolveRelayConfig(env, '', true)).toEqual({ ok: false, error: 'relay_not_configured' });
  });

  it('createShareHandlers: isPackaged면 envRelayUrl을 무시한다', async () => {
    const packaged = createShareHandlers(makeDeps({ envRelayUrl: 'https://evil.example.org', defaultRelayUrl: 'https://relay.example.com', isPackaged: true }));
    expect(await packaged.relayUrl()).toMatchObject({ ok: true, info: { url: 'https://relay.example.com' } });
    const dev = createShareHandlers(makeDeps({ envRelayUrl: 'https://dev.example.org', defaultRelayUrl: 'https://relay.example.com' }));
    expect(await dev.relayUrl()).toMatchObject({ ok: true, info: { url: 'https://dev.example.org' } });
  });

  it('평문 http는 loopback만, 잘못된 URL은 relay_invalid', () => {
    expect(resolveRelayConfig('http://127.0.0.1:4000', '')).toEqual({
      ok: true,
      info: { url: 'http://127.0.0.1:4000', wsUrl: 'ws://127.0.0.1:4000' },
    });
    expect(resolveRelayConfig('http://localhost:4000', '')).toMatchObject({ ok: true });
    expect(resolveRelayConfig('http://relay.example.com', '')).toEqual({ ok: false, error: 'relay_invalid' });
    expect(resolveRelayConfig('ftp://x.com', '')).toEqual({ ok: false, error: 'relay_invalid' });
    expect(resolveRelayConfig('https://u:p@x.com', '')).toEqual({ ok: false, error: 'relay_invalid' });
  });
});

describe('CSP', () => {
  const relay = { url: 'https://relay.example.com/x', wsUrl: 'wss://relay.example.com/x' };
  it('connect-src만 만든다 — 다른 디렉티브 없음', () => {
    const csp = buildConnectSrc(relay, false);
    expect(csp).toBe("connect-src 'self' data: blob: https://relay.example.com wss://relay.example.com");
    expect(csp).not.toMatch(/default-src|script-src|style-src|img-src/);
  });
  it('릴레이 미설정이면 네트워크 origin 없음', () => {
    expect(buildConnectSrc(null, false)).toBe("connect-src 'self' data: blob:");
  });
  it('localhost는 비패키지(allowLocalhost)에서만', () => {
    expect(buildConnectSrc(relay, false)).not.toContain('localhost');
    const dev = buildConnectSrc(relay, true);
    expect(dev).toContain('http://localhost:*');
    expect(dev).toContain('ws://127.0.0.1:*');
  });
  it('addCspHeader — 새 헤더 추가·기존 CSP(대소문자 무관)에 덧붙임·원본 불변', () => {
    const orig = { 'Content-Type': ['text/html'] };
    const a = addCspHeader(orig, 'connect-src x');
    expect(a['Content-Security-Policy']).toEqual(['connect-src x']);
    expect(orig).toEqual({ 'Content-Type': ['text/html'] });
    const b = addCspHeader({ 'content-security-policy': ["default-src 'self'"] }, 'connect-src x');
    expect(b['content-security-policy']).toEqual(["default-src 'self'", 'connect-src x']);
    expect(Object.keys(b)).toHaveLength(1);
    expect(addCspHeader(undefined, 'c')['Content-Security-Policy']).toEqual(['c']);
  });
});

describe('resolveShareFolder (경로 경계)', () => {
  it('워크스페이스의 엄격한 비숨김 하위만 통과', () => {
    expect(resolveShareFolder('/w', '/w/a')).toBe('/w/a');
    expect(resolveShareFolder('/w', '/w/a/b/c')).toBe('/w/a/b/c');
    expect(resolveShareFolder('/w', '/w/a/../b')).toBe('/w/b');
  });
  it('루트 자체·바깥·접두사 우회·숨김·NUL·비문자열을 거부', () => {
    for (const bad of ['/w', '/', '/other', '/w-evil/a', '/w/../etc', '/w/.trash/x', '/w/a/.mindshare', '/w/.history', '/w/a\0b', '']) {
      expect(resolveShareFolder('/w', bad), bad).toBeNull();
    }
    expect(resolveShareFolder('/w', undefined)).toBeNull();
    expect(resolveShareFolder('/w', 5)).toBeNull();
    expect(resolveShareFolder('/w', 'x'.repeat(5000))).toBeNull();
  });
});

describe('mapRelayError', () => {
  it('HTTP 상태/서버 코드를 사용자용 코드로 정규화', () => {
    expect(mapRelayError(404, 'invalid_code')).toBe('invalid_code');
    expect(mapRelayError(404, 'not_found')).toBe('not_found');
    expect(mapRelayError(404, 'invite_expired')).toBe('expired');
    expect(mapRelayError(410, undefined)).toBe('expired');
    expect(mapRelayError(401, 'unauthorized')).toBe('denied');
    expect(mapRelayError(403, 'forbidden')).toBe('denied');
    expect(mapRelayError(429, 'rate_limited')).toBe('rate_limited');
    expect(mapRelayError(429, 'too_many_open_invites')).toBe('too_many_invites');
    expect(mapRelayError(400, 'invalid_json')).toBe('invalid_input');
    expect(mapRelayError(413, 'payload_too_large')).toBe('invalid_input');
    expect(mapRelayError(500, 'internal')).toBe('server');
    // 서버 방 총량 상한(503 capacity_reached)은 일반 서버 오류와 구분한다 — 다른 503 사유는 그대로 server
    expect(mapRelayError(503, 'capacity_reached')).toBe('capacity_reached');
    expect(mapRelayError(503, undefined)).toBe('server');
    expect(mapRelayError(503, 'overloaded')).toBe('server');
    // 전역 /join 실패·방 생성 상한(429 rate_limited)은 rate_limited
    expect(mapRelayError(429, 'rate_limited')).toBe('rate_limited');
    expect(mapRelayError(429, undefined)).toBe('rate_limited');
    expect(mapRelayError(502, undefined)).toBe('server');
  });
});

describe('표식 IPC', () => {
  const folder = () => path.join(ws, 'shared');

  it('write → read → list → remove 왕복', async () => {
    const h = createShareHandlers(makeDeps());
    expect(await h.readMarker(folder())).toBeNull();
    expect(await h.writeMarker(folder(), marker)).toEqual({ ok: true });
    expect(await h.readMarker(folder())).toEqual(marker);
    expect(await h.listMarkers()).toEqual([{ folderPath: folder(), marker }]);
    expect(await h.removeMarker(folder())).toEqual({ ok: true });
    expect(await h.readMarker(folder())).toBeNull();
    await expect(fs.access(path.join(folder(), MARKER_DIR))).rejects.toThrow();
    expect(await h.removeMarker(folder())).toEqual({ ok: true }); // 멱등
  });

  it('잘못된 표식·경계 밖 경로는 거부하고 아무것도 쓰지 않는다', async () => {
    const h = createShareHandlers(makeDeps());
    expect(await h.writeMarker(folder(), { ...marker, roomId: '../x' })).toEqual({ ok: false, error: 'invalid_input' });
    expect(await h.writeMarker(ws, marker)).toEqual({ ok: false, error: 'invalid_input' }); // 워크스페이스 루트
    expect(await h.writeMarker(base, marker)).toEqual({ ok: false, error: 'invalid_input' }); // 바깥
    expect(await h.writeMarker(path.join(ws, 'shared', '..', '..'), marker)).toEqual({ ok: false, error: 'invalid_input' });
    expect(await h.writeMarker(path.join(ws, 'nope'), marker)).toEqual({ ok: false, error: 'invalid_input' }); // 없는 폴더
    expect(await h.readMarker('/etc')).toBeNull();
    expect(await h.readMarker(undefined)).toBeNull();
    await expect(fs.access(path.join(folder(), MARKER_DIR))).rejects.toThrow();
  });

  it('심볼릭 링크로 워크스페이스를 벗어나는 폴더·.mindshare를 거부', async () => {
    const outside = path.join(base, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(ws, 'link'));
    const h = createShareHandlers(makeDeps());
    expect(await h.writeMarker(path.join(ws, 'link'), marker)).toEqual({ ok: false, error: 'invalid_input' });

    // .mindshare 자체가 바깥을 가리키는 링크인 경우
    await fs.symlink(outside, path.join(folder(), MARKER_DIR));
    expect(await h.writeMarker(folder(), marker)).toEqual({ ok: false, error: 'io' });
    expect(await fs.readdir(outside)).toEqual([]);
    expect(await h.removeMarker(folder())).toEqual({ ok: true });
    expect((await fs.lstat(outside)).isDirectory()).toBe(true); // 링크 대상은 그대로
  });

  it('손상된/악성 room.json은 null', async () => {
    const h = createShareHandlers(makeDeps());
    await fs.mkdir(path.join(folder(), MARKER_DIR));
    const file = path.join(folder(), MARKER_DIR, 'room.json');
    await fs.writeFile(file, '{ not json');
    expect(await h.readMarker(folder())).toBeNull();
    await fs.writeFile(file, JSON.stringify({ ...marker, relayUrl: 'file:///etc/passwd' }));
    expect(await h.readMarker(folder())).toBeNull();
    await fs.writeFile(file, 'x'.repeat(9 * 1024)); // 크기 상한 초과
    expect(await h.readMarker(folder())).toBeNull();
  });

  it('listMarkers: 깊이 ≤ 4, 숨김·.trash·node_modules 제외, 링크 미추적', async () => {
    const h = createShareHandlers(makeDeps());
    const mk = async (rel: string, m = marker) => {
      const dir = path.join(ws, rel, MARKER_DIR);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'room.json'), JSON.stringify(m));
    };
    await mk('a', { ...marker, roomId: 'room-depth1' });
    await mk('a/b/c/d', { ...marker, roomId: 'room-depth4' });
    await mk('a/b/c/d/e', { ...marker, roomId: 'room-depth5' }); // 너무 깊음
    await mk('.trash/x', { ...marker, roomId: 'room-trash1' });
    await mk('node_modules/x', { ...marker, roomId: 'room-nodemod' });
    await mk('.hidden/x', { ...marker, roomId: 'room-hidden1' });
    await fs.symlink(path.join(ws, 'a'), path.join(ws, 'alias'));
    const ids = (await h.listMarkers()).map((e) => e.marker.roomId).sort();
    expect(ids).toEqual(['room-depth1', 'room-depth4']);
  });
});

describe('표식 스캔 한계는 렌더러의 공유 가능 검사와 같은 값을 쓴다', () => {
  it('LIST_MAX_DEPTH·LIST_MAX_DIRS는 src/io/shareLimits.ts의 값(하나의 원천)', () => {
    expect(LIST_MAX_DEPTH).toBe(SHARE_MAX_FOLDER_DEPTH);
    expect(LIST_MAX_DIRS).toBe(SHARE_MAX_SCAN_DIRS);
  });
});

describe('토큰 IPC (safeStorage)', () => {
  it('set → get → delete, 디스크에는 평문이 없다', async () => {
    const h = createShareHandlers(makeDeps());
    expect(await h.tokenGet(ROOM)).toBeNull();
    expect(await h.tokenSet(ROOM, 'secret-token_123')).toEqual({ ok: true });
    expect(await h.tokenGet(ROOM)).toBe('secret-token_123');
    const raw = await fs.readFile(path.join(userData, 'share-tokens', `${ROOM}.bin`));
    expect(raw.toString()).not.toContain('secret-token_123');
    await h.tokenDelete(ROOM);
    expect(await h.tokenGet(ROOM)).toBeNull();
    await h.tokenDelete(ROOM); // 멱등
  });

  it('잘못된 roomId·토큰은 거부(경로 주입 포함)', async () => {
    const h = createShareHandlers(makeDeps());
    expect(await h.tokenSet('../../evil-room', 'tok')).toEqual({ ok: false, error: 'invalid_input' });
    expect(await h.tokenSet(ROOM, 'bad token\r\n')).toEqual({ ok: false, error: 'invalid_input' });
    expect(await h.tokenSet(ROOM, 42)).toEqual({ ok: false, error: 'invalid_input' });
    expect(await h.tokenGet('../../evil-room')).toBeNull();
    await h.tokenDelete('../../evil-room'); // 던지지 않고 무시
    await expect(fs.readdir(path.join(userData, 'share-tokens'))).rejects.toThrow(); // 아무것도 만들지 않음
  });

  it('암호화를 쓸 수 없으면 평문 저장 대신 실패', async () => {
    const h = createShareHandlers(
      makeDeps({ safeStorage: { ...fakeSafeStorage, isEncryptionAvailable: () => false } }),
    );
    expect(await h.tokenSet(ROOM, 'tok')).toEqual({ ok: false, error: 'secure_storage_unavailable' });
    await expect(fs.readdir(path.join(userData, 'share-tokens'))).rejects.toThrow();
  });

  it('복호화 불가·훼손 파일은 null', async () => {
    const h = createShareHandlers(makeDeps());
    await fs.mkdir(path.join(userData, 'share-tokens'));
    await fs.writeFile(path.join(userData, 'share-tokens', `${ROOM}.bin`), 'plaintext-not-encrypted');
    expect(await h.tokenGet(ROOM)).toBeNull();
  });
});

describe('릴레이 REST IPC', () => {
  const newRoom = { roomId: ROOM, ownerId: PID, ownerToken: 'owner-token_1', inviteCode: 'ABCD2345', inviteExpiresAt: 1_800_000_000_000 };

  it('릴레이 미설정이면 네트워크를 건드리지 않고 relay_not_configured', async () => {
    const fetchSpy = vi.fn();
    const h = createShareHandlers(makeDeps({ envRelayUrl: undefined, defaultRelayUrl: '', fetch: fetchSpy as unknown as FetchFn }));
    expect(await h.relayUrl()).toEqual({ ok: false, error: 'relay_not_configured' });
    expect(await h.createRoom({ ownerName: '지호' })).toEqual({ ok: false, error: 'relay_not_configured' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('createRoom: 토큰은 safeStorage에만 저장하고 렌더러 응답에는 없다', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, newRoom));
    const h = createShareHandlers(makeDeps({ fetch: fetchSpy as unknown as FetchFn }));
    const r = await h.createRoom({ ownerName: '  지호 ' });
    expect(r).toEqual({
      ok: true,
      room: { roomId: ROOM, participantId: PID, inviteCode: 'ABCD2345', inviteExpiresAt: 1_800_000_000_000 },
    });
    expect(JSON.stringify(r)).not.toContain('owner-token_1');
    expect(await h.tokenGet(ROOM)).toBe('owner-token_1');
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://relay.example.com/rooms');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body as string)).toEqual({ ownerName: '지호' });
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('createRoom: folderName을 정규화해 서버로 보내고, 형식이 틀리면 네트워크 전에 거부', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, newRoom));
    const h = createShareHandlers(makeDeps({ fetch: fetchSpy as unknown as FetchFn }));
    await h.createRoom({ ownerName: '지호', folderName: '  기획 노트 ' });
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ ownerName: '지호', folderName: '기획 노트' });
    const calls = fetchSpy.mock.calls.length;
    for (const bad of ['', 'a/b', '.hidden', 'x'.repeat(81), 5]) {
      expect(await h.createRoom({ ownerName: '지호', folderName: bad })).toEqual({ ok: false, error: 'invalid_input' });
    }
    expect(fetchSpy.mock.calls.length).toBe(calls);
  });

  it('createRoom: 이름 검증 실패·서버 응답 형식 오류', async () => {
    const h = createShareHandlers(makeDeps({ fetch: (async () => jsonResponse(200, { roomId: 'x' })) as unknown as FetchFn }));
    expect(await h.createRoom({ ownerName: '' })).toEqual({ ok: false, error: 'invalid_input' });
    expect(await h.createRoom(null)).toEqual({ ok: false, error: 'invalid_input' });
    expect(await h.createRoom({ ownerName: '지호' })).toEqual({ ok: false, error: 'bad_response' });
  });

  it('join: 토큰 저장, 오류 코드 정규화, 형식이 이상한 코드는 네트워크 전에 거부', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { roomId: ROOM, participantId: 'pid-BBBBBBBBBBBB', token: 'part-token_1', role: 'participant', folderName: '기획 노트' }))
      .mockResolvedValueOnce(jsonResponse(404, { error: 'invalid_code' }))
      .mockResolvedValueOnce(jsonResponse(429, { error: 'rate_limited' }))
      .mockResolvedValueOnce(jsonResponse(502));
    const h = createShareHandlers(makeDeps({ fetch: fetchSpy as unknown as FetchFn }));
    const ok = await h.join({ code: 'abcd-2345', displayName: '민수' });
    expect(ok).toEqual({
      ok: true,
      joined: { roomId: ROOM, participantId: 'pid-BBBBBBBBBBBB', role: 'participant', folderName: '기획 노트' },
    });
    expect(JSON.stringify(ok)).not.toContain('part-token_1');
    expect(await h.tokenGet(ROOM)).toBe('part-token_1');
    expect(await h.join({ code: 'ZZZZ9999', displayName: '민수' })).toEqual({ ok: false, error: 'invalid_code' });
    expect(await h.join({ code: 'ZZZZ9999', displayName: '민수' })).toEqual({ ok: false, error: 'rate_limited' });
    expect(await h.join({ code: 'ZZZZ9999', displayName: '민수' })).toEqual({ ok: false, error: 'server' });
    const calls = fetchSpy.mock.calls.length;
    expect(await h.join({ code: 'bad;code!', displayName: '민수' })).toEqual({ ok: false, error: 'invalid_code' });
    expect(await h.join({ code: 'ABCD2345', displayName: '<x>' })).toEqual({ ok: false, error: 'invalid_input' });
    expect(fetchSpy.mock.calls.length).toBe(calls);
  });

  it('invite/participants/revoke: 저장된 토큰을 Bearer로 붙이고 응답을 검증', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const list = [{ participantId: PID, displayName: '지호', role: 'owner', joinedAt: 1, online: true }];
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      if (url.endsWith('/invites')) return jsonResponse(200, { inviteCode: 'WXYZ2345', inviteExpiresAt: 5 });
      if (url.endsWith('/participants')) return jsonResponse(200, list);
      return jsonResponse(204);
    }) as unknown as FetchFn;
    const h = createShareHandlers(makeDeps({ fetch: fetchFn }));
    await h.tokenSet(ROOM, 'owner-token_1');

    expect(await h.invite(ROOM)).toEqual({ ok: true, invite: { inviteCode: 'WXYZ2345', inviteExpiresAt: 5 } });
    expect(await h.participants(ROOM)).toEqual({ ok: true, participants: list });
    expect(await h.revoke(ROOM, 'pid-BBBBBBBBBBBB')).toEqual({ ok: true });
    for (const s of seen) {
      expect((s.init.headers as Record<string, string>).Authorization).toBe('Bearer owner-token_1');
      expect(new URL(s.url).origin).toBe('https://relay.example.com');
    }
    expect(seen[0].url).toBe(`https://relay.example.com/rooms/${ROOM}/invites`);
    expect(seen[2].init.method).toBe('DELETE');
    expect(seen[2].url).toBe(`https://relay.example.com/rooms/${ROOM}/participants/pid-BBBBBBBBBBBB`);
  });

  it('토큰이 없으면 no_token, 잘못된 id는 invalid_input(네트워크 없음)', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, []));
    const h = createShareHandlers(makeDeps({ fetch: fetchSpy as unknown as FetchFn }));
    expect(await h.participants(ROOM)).toEqual({ ok: false, error: 'no_token' });
    expect(await h.participants('../../x')).toEqual({ ok: false, error: 'invalid_input' });
    expect(await h.invite('a/b')).toEqual({ ok: false, error: 'invalid_input' });
    expect(await h.revoke(ROOM, '../pid')).toEqual({ ok: false, error: 'invalid_input' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('401/403은 denied, 참가자 응답이 이상하면 bad_response', async () => {
    let status = 401;
    const fetchFn = (async () => (status === 200 ? jsonResponse(200, [{ nope: 1 }]) : jsonResponse(status, { error: 'unauthorized' }))) as unknown as FetchFn;
    const h = createShareHandlers(makeDeps({ fetch: fetchFn }));
    await h.tokenSet(ROOM, 'tok-1');
    expect(await h.participants(ROOM)).toEqual({ ok: false, error: 'denied' });
    status = 403;
    expect(await h.revoke(ROOM, 'pid-BBBBBBBBBBBB')).toEqual({ ok: false, error: 'denied' });
    status = 200;
    expect(await h.participants(ROOM)).toEqual({ ok: false, error: 'bad_response' });
  });

  it('네트워크 오류·타임아웃·과대 응답을 정규화', async () => {
    const h1 = createShareHandlers(makeDeps({ fetch: (async () => { throw new TypeError('fetch failed'); }) as unknown as FetchFn }));
    expect(await h1.createRoom({ ownerName: '지호' })).toEqual({ ok: false, error: 'network' });

    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_res, rej) => {
        init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })) as unknown as FetchFn;
    const h2 = createShareHandlers(makeDeps({ fetch: hang, timeoutMs: 20 }));
    expect(await h2.createRoom({ ownerName: '지호' })).toEqual({ ok: false, error: 'timeout' });

    const big = (async () => jsonResponse(200, newRoom, { 'content-length': String(5 * 1024 * 1024) })) as unknown as FetchFn;
    const h3 = createShareHandlers(makeDeps({ fetch: big }));
    expect(await h3.createRoom({ ownerName: '지호' })).toEqual({ ok: false, error: 'bad_response' });
  });

  it('Content-Length 없이(또는 거짓으로) 무한히 흘려보내는 응답도 1MB에서 끊는다', async () => {
    let pulled = 0;
    let cancelled = false;
    const chunk = new Uint8Array(64 * 1024).fill(0x61); // 'a'
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk.byteLength;
        controller.enqueue(chunk);
        if (pulled > 64 * 1024 * 1024) controller.close(); // 안전장치 — 끊지 않으면 64MB까지 흘러간다
      },
      cancel() {
        cancelled = true;
      },
    });
    // 헤더는 작다고 거짓말한다
    const liar = (async () => new Response(stream, { status: 200, headers: { 'content-length': '10' } })) as unknown as FetchFn;
    const h = createShareHandlers(makeDeps({ fetch: liar }));
    expect(await h.createRoom({ ownerName: '지호' })).toEqual({ ok: false, error: 'bad_response' });
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(4 * 1024 * 1024); // 상한(1MB) 근처에서 멈췄다 — 수십 MB를 읽지 않았다
    expect(logs.some((l) => l.includes('oversized'))).toBe(true);
  });

  it('readBoundedText: 상한 이하는 그대로, 초과는 ok:false, body 없는 응답은 text()로', async () => {
    const mk = (n: number) => new Response('x'.repeat(n));
    expect(await readBoundedText(mk(100), 100)).toEqual({ ok: true, text: 'x'.repeat(100) });
    expect(await readBoundedText(mk(101), 100)).toEqual({ ok: false });
    // 멀티바이트는 바이트 수로 센다
    expect(await readBoundedText(new Response('가'.repeat(40)), 100)).toEqual({ ok: false }); // 120바이트
    const noBody = { body: null, text: async () => 'y'.repeat(50) } as unknown as Response;
    expect(await readBoundedText(noBody, 100)).toEqual({ ok: true, text: 'y'.repeat(50) });
    expect(await readBoundedText({ body: null, text: async () => 'y'.repeat(500) } as unknown as Response, 100)).toEqual({ ok: false });
  });

  it('deleteRoom: DELETE /rooms/:roomId에 소유자 토큰을 붙이고 204면 ok, 오류는 정규화', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    let status = 204;
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return status === 204 ? jsonResponse(204) : jsonResponse(status, { error: status === 404 ? 'not_found' : 'x' });
    }) as unknown as FetchFn;
    const h = createShareHandlers(makeDeps({ fetch: fetchFn }));
    expect(await h.deleteRoom(ROOM)).toEqual({ ok: false, error: 'no_token' }); // 토큰 없으면 네트워크 없이
    expect(seen).toHaveLength(0);
    await h.tokenSet(ROOM, 'owner-token_1');
    expect(await h.deleteRoom(ROOM)).toEqual({ ok: true });
    expect(seen[0].url).toBe(`https://relay.example.com/rooms/${ROOM}`);
    expect(seen[0].init.method).toBe('DELETE');
    expect((seen[0].init.headers as Record<string, string>).Authorization).toBe('Bearer owner-token_1');
    status = 404;
    expect(await h.deleteRoom(ROOM)).toEqual({ ok: false, error: 'not_found' });
    status = 403;
    expect(await h.deleteRoom(ROOM)).toEqual({ ok: false, error: 'denied' });
    status = 500;
    expect(await h.deleteRoom(ROOM)).toEqual({ ok: false, error: 'server' });
    expect(await h.deleteRoom('../../x')).toEqual({ ok: false, error: 'invalid_input' });
    expect(await h.deleteRoom(undefined)).toEqual({ ok: false, error: 'invalid_input' });
    expect(logs.join('\n')).not.toContain('owner-token_1');
  });

  it('로그에 코드·토큰·이름이 남지 않는다', async () => {
    const fetchFn = (async (url: string) =>
      url.endsWith('/join')
        ? jsonResponse(200, { roomId: ROOM, participantId: PID, token: 'part-token_1', role: 'participant' })
        : jsonResponse(200, newRoom)) as unknown as FetchFn;
    const h = createShareHandlers(makeDeps({ fetch: fetchFn }));
    await h.createRoom({ ownerName: '비밀이름' });
    await h.join({ code: 'SECRETCODE', displayName: '비밀이름' });
    const all = logs.join('\n');
    for (const secret of ['owner-token_1', 'part-token_1', 'SECRETCODE', 'ABCD2345', '비밀이름']) {
      expect(all).not.toContain(secret);
    }
    expect(all).toContain('/rooms');
  });
});

describe('사이드카 IPC', () => {
  const folder = () => path.join(ws, 'shared');
  const bytes = new Uint8Array([1, 2, 3, 250, 0, 7]);
  const NOTE1 = sidecarIdForDocKey('note:note-1')!; // n_ + hex
  const N1 = sidecarIdForDocKey('note:n1')!;

  it('표식이 있는 폴더에서 write → read 왕복(바이트 보존)', async () => {
    const h = createShareHandlers(makeDeps());
    await h.writeMarker(folder(), marker);
    expect(await h.sidecarRead(folder(), NOTE1)).toBeNull();
    expect(await h.sidecarWrite(folder(), NOTE1, bytes)).toEqual({ ok: true });
    const got = await h.sidecarRead(folder(), NOTE1);
    expect(got).toBeInstanceOf(Uint8Array);
    expect(Array.from(got!)).toEqual(Array.from(bytes));
    expect(await fs.readdir(path.join(folder(), MARKER_DIR))).toContain(`${NOTE1}.yjs`);
  });

  it('표식이 없는 폴더에는 쓰지 않는다', async () => {
    const h = createShareHandlers(makeDeps());
    expect(await h.sidecarWrite(folder(), NOTE1, bytes)).toEqual({ ok: false, error: 'not_shared' });
    await expect(fs.access(path.join(folder(), MARKER_DIR))).rejects.toThrow();
  });

  it('id 주입·크기 초과·잘못된 데이터 타입·경계 밖 경로를 거부', async () => {
    const h = createShareHandlers(makeDeps());
    await h.writeMarker(folder(), marker);
    for (const bad of [
      '../evil', 'a/b', '.hidden', '..', '', 'x'.repeat(200),
      'note-1', // 예전(hex 이전) 형식 — 이제 허용하지 않는다
      'N_6e', // 대문자 접두사
      'n_6E', // 대문자 hex
      'n_6', // 홀수 길이
      'n_', '_file_', '_manifest2', '_Manifest',
      `n_${'61'.repeat(101)}`, // 상한(100자) 초과
      'n_61/../x',
    ]) {
      expect(await h.sidecarWrite(folder(), bad, bytes), bad).toEqual({ ok: false, error: 'invalid_input' });
      expect(await h.sidecarRead(folder(), bad), bad).toBeNull();
    }
    expect(await h.sidecarWrite(folder(), N1, new Uint8Array(MAX_SIDECAR_BYTES + 1))).toEqual({ ok: false, error: 'invalid_input' });
    expect(await h.sidecarWrite(folder(), N1, 'not bytes')).toEqual({ ok: false, error: 'invalid_input' });
    expect(await h.sidecarWrite(folder(), N1, [1, 2, 3])).toEqual({ ok: false, error: 'invalid_input' });
    expect(await h.sidecarWrite(base, N1, bytes)).toEqual({ ok: false, error: 'invalid_input' });
    expect(await h.sidecarRead(base, N1)).toBeNull();
    expect(await fs.readdir(path.join(folder(), MARKER_DIR))).toEqual(['room.json']);
  });

  it('시스템 사이드카(_manifest·_comments·_file_<hex>)와 노트 사이드카를 모두 허용', async () => {
    const h = createShareHandlers(makeDeps());
    await h.writeMarker(folder(), marker);
    for (const id of ['_manifest', '_comments', sidecarIdForDocKey('file:m1')!, sidecarIdForDocKey('note:_manifest')!]) {
      expect(await h.sidecarWrite(folder(), id, bytes), id).toEqual({ ok: true });
      expect(Array.from((await h.sidecarRead(folder(), id))!), id).toEqual(Array.from(bytes));
    }
    // 노트 id가 `_manifest`여도 시스템 사이드카를 덮어쓰지 않는다(서로 다른 파일)
    const files = await fs.readdir(path.join(folder(), MARKER_DIR));
    expect(files.filter((f) => f.endsWith('.yjs')).length).toBe(4);
  });

  it('렌더러가 만드는 사이드카 id는 모두 main의 화이트리스트를 통과한다(두 규칙이 어긋나지 않음)', () => {
    for (const key of ['manifest', 'comments', 'note:abc', 'note:A.b_c-D', `note:${'z'.repeat(MAX_SIDECAR_DOC_ID)}`, 'file:f1', `file:${'Q'.repeat(MAX_SIDECAR_DOC_ID)}`]) {
      const id = sidecarIdForDocKey(key);
      expect(id, key).not.toBeNull();
      expect(isSidecarId(id), key).toBe(true);
    }
  });

  it('원본 버퍼의 일부(byteOffset)만 담긴 Uint8Array도 정확히 저장', async () => {
    const h = createShareHandlers(makeDeps());
    await h.writeMarker(folder(), marker);
    const whole = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const view = whole.subarray(2, 5);
    await h.sidecarWrite(folder(), N1, view);
    expect(Array.from((await h.sidecarRead(folder(), N1))!)).toEqual([1, 2, 3]);
  });

  it('심볼릭 링크인 사이드카 파일은 읽지 않는다', async () => {
    const h = createShareHandlers(makeDeps());
    await h.writeMarker(folder(), marker);
    const secret = path.join(base, 'secret.bin');
    await fs.writeFile(secret, 'top secret');
    await fs.symlink(secret, path.join(folder(), MARKER_DIR, 'n_6c65616b.yjs'));
    expect(await h.sidecarRead(folder(), 'n_6c65616b')).toBeNull(); // 'leak'의 hex
  });
});
