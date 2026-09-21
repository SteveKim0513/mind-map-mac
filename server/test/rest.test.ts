import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseIntEnv } from '../src/config.js';
import { startRelay } from '../src/relay.js';
import { Harness, addGuest, cleanupTemp, joinRoom, newRoom, tempDbPath } from './helpers.js';

const CODE_SHAPE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;

let h: Harness;
let clockMs: number;
const startClocked = async (extra: Parameters<Harness['start']>[0] = {}) => {
  clockMs = 1_700_000_000_000;
  h = await new Harness().start({ clock: () => clockMs, ...extra });
};
const start = async (extra: Parameters<Harness['start']>[0] = {}) => {
  h = await new Harness().start(extra);
};

afterEach(async () => {
  await h?.stop();
  cleanupTemp();
});

describe('health / room creation', () => {
  it('GET /health -> 200 {ok:true}', async () => {
    await start();
    const res = await h.api.call('GET', '/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('POST /rooms issues room, owner token and an 8-char Crockford invite code with a 10 minute TTL', async () => {
    await startClocked();
    const res = await h.api.createRoom('Steve');
    expect(res.status).toBe(200);
    expect(res.body.inviteCode).toMatch(CODE_SHAPE);
    expect(res.body.ownerToken.length).toBeGreaterThanOrEqual(43);
    expect(res.body.inviteExpiresAt).toBe(clockMs + 10 * 60 * 1000);
    expect(res.body.roomId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it('rejects invalid owner names, bad JSON and oversized bodies with 4xx', async () => {
    await start();
    expect((await h.api.createRoom('')).status).toBe(400);
    expect((await h.api.createRoom('x'.repeat(41))).status).toBe(400);
    expect((await h.api.createRoom('bad\nname')).status).toBe(400);
    expect((await h.api.createRoom('<script>')).status).toBe(400);
    expect((await h.api.call('POST', '/rooms', { raw: '{not json' })).status).toBe(400);
    expect((await h.api.call('POST', '/rooms', { raw: '[]' })).status).toBe(400);
    const big = await h.api.call('POST', '/rooms', {
      raw: JSON.stringify({ ownerName: 'a', pad: 'x'.repeat(20_000) }),
    });
    expect(big.status).toBe(413);
    expect((await h.api.createRoom('한글 이름 🙂')).status).toBe(200);
  });

  it('limits room creation per IP', async () => {
    await start();
    for (let i = 0; i < 30; i++) expect((await h.api.createRoom()).status).toBe(200);
    const blocked = await h.api.createRoom();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('unknown routes are 404 and wrong methods 405', async () => {
    await start();
    expect((await h.api.call('GET', '/nope')).status).toBe(404);
    expect((await h.api.call('GET', '/rooms')).status).toBe(405);
  });
});

describe('folder name metadata', () => {
  it('stores the optional folderName at room creation and returns it from /join', async () => {
    await start();
    const room = await newRoom(h.api, 'Steve', '  기획 노트 🙂 ');
    const joined = await h.api.join(room.inviteCode, 'Alice');
    expect(joined.status).toBe(200);
    expect(joined.body.folderName).toBe('기획 노트 🙂');
    // 새 초대 코드로 들어와도 같은 폴더 이름 — 소유자가 오프라인이어도(연결 없음) 알 수 있다.
    const again = await addGuest(h.api, room, 'Bob');
    const res = await h.api.call('POST', `/rooms/${room.roomId}/invites`, { token: room.owner.token });
    const second = await h.api.join(res.body.inviteCode, 'Carol');
    expect(second.body.folderName).toBe('기획 노트 🙂');
    expect(again.roomId).toBe(room.roomId);
  });

  it('is optional: rooms without folderName join with folderName null', async () => {
    await start();
    const room = await newRoom(h.api);
    const joined = await h.api.join(room.inviteCode, 'Alice');
    expect(joined.status).toBe(200);
    expect(joined.body.folderName).toBeNull();
    const explicitNull = await h.api.call('POST', '/rooms', { body: { ownerName: 'x', folderName: null } });
    expect(explicitNull.status).toBe(200);
  });

  it('rejects invalid folder names without creating a room', async () => {
    await start();
    for (const bad of ['', '   ', 'a/b', 'a\\b', 'tab\there', 'nl\nname', 'x'.repeat(81), '.hidden', '..', 5, ['a'], {}]) {
      expect((await h.api.createRoom('Owner', bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await h.api.createRoom('Owner', 'x'.repeat(80))).status).toBe(200);
  });

  it('keeps the participants response shape unchanged', async () => {
    await startClocked();
    const room = await newRoom(h.api, 'Steve', 'Docs');
    const res = await h.api.call('GET', `/rooms/${room.roomId}/participants`, { token: room.owner.token });
    expect(res.body).toEqual([
      { participantId: room.owner.participantId, displayName: 'Steve', role: 'owner', joinedAt: clockMs, online: false },
    ]);
  });

  it('migrates a database created before the folder_name column existed', async () => {
    const dbPath = tempDbPath();
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE rooms (room_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
      CREATE TABLE participants (
        participant_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(room_id),
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'participant')),
        token_hash TEXT NOT NULL UNIQUE,
        joined_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE TABLE invites (
        code_hash TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(room_id),
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      );
      INSERT INTO rooms (room_id, created_at) VALUES ('legacyroom1', 1);
    `);
    legacy.close();

    await start({ dbPath });
    // 기존 방(폴더 이름 없음)도 동작하고, 새 방은 폴더 이름을 저장한다. 재시작해도 ALTER가 다시 실패하지 않는다.
    const room = await newRoom(h.api, 'Steve', 'Migrated');
    expect((await h.api.join(room.inviteCode, 'Alice')).body.folderName).toBe('Migrated');
    await h.stop();
    await start({ dbPath });
    const room2 = await newRoom(h.api, 'Steve');
    expect((await h.api.join(room2.inviteCode, 'Bob')).body.folderName).toBeNull();
  });
});

describe('invite codes', () => {
  it('is single-use: the second redemption of the same code fails', async () => {
    await start();
    const room = await newRoom(h.api);
    const first = await h.api.join(room.inviteCode, 'Alice');
    expect(first.status).toBe(200);
    expect(first.body.role).toBe('participant');
    expect(first.body.roomId).toBe(room.roomId);
    const second = await h.api.join(room.inviteCode, 'Mallory');
    expect(second.status).toBe(404);
  });

  it('accepts lowercase and hyphenated input for the same code', async () => {
    await start();
    const room = await newRoom(h.api);
    const typed = `${room.inviteCode.slice(0, 4)}-${room.inviteCode.slice(4)}`.toLowerCase();
    expect((await h.api.join(typed, 'Alice')).status).toBe(200);
  });

  it('expires after the TTL', async () => {
    await startClocked({ inviteTtlMs: 1000 });
    const room = await newRoom(h.api);
    clockMs += 1001;
    const res = await h.api.join(room.inviteCode, 'Late');
    expect(res.status).toBe(404);
  });

  it('is still valid right before expiry', async () => {
    await startClocked({ inviteTtlMs: 1000 });
    const room = await newRoom(h.api);
    clockMs += 999;
    expect((await h.api.join(room.inviteCode, 'OnTime')).status).toBe(200);
  });

  it('rate-limits wrong-code attempts per IP and blocks even a valid code while limited', async () => {
    await startClocked();
    const room = await newRoom(h.api);
    for (let i = 0; i < 10; i++) {
      const res = await h.api.join('ZZZZZZZZ', 'Attacker');
      expect(res.status).toBe(404);
    }
    const blocked = await h.api.join('ZZZZZZZZ', 'Attacker');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await h.api.join(room.inviteCode, 'Attacker')).status).toBe(429);

    clockMs += 10 * 60 * 1000 + 1;
    const fresh = await h.api.call('POST', `/rooms/${room.roomId}/invites`, { token: room.owner.token });
    expect((await h.api.join(fresh.body.inviteCode, 'Legit')).status).toBe(200);
  });

  it('counts malformed codes as failures too', async () => {
    await start();
    for (let i = 0; i < 10; i++) await h.api.join('short', 'Attacker');
    expect((await h.api.join('short', 'Attacker')).status).toBe(429);
  });

  it('limits per client IP when behind a trusted proxy (X-Forwarded-For)', async () => {
    await start({ trustProxyHops: 1 });
    const room = await newRoom(h.api);
    for (let i = 0; i < 10; i++) await h.api.join('ZZZZZZZZ', 'A', { 'X-Forwarded-For': '203.0.113.7' });
    expect((await h.api.join('ZZZZZZZZ', 'A', { 'X-Forwarded-For': '203.0.113.7' })).status).toBe(429);
    const other = await h.api.join(room.inviteCode, 'B', { 'X-Forwarded-For': '198.51.100.9' });
    expect(other.status).toBe(200);
  });

  it('validates display names on /join without burning the code', async () => {
    await start();
    const room = await newRoom(h.api);
    expect((await h.api.join(room.inviteCode, '')).status).toBe(400);
    expect((await h.api.join(room.inviteCode, 'a b')).status).toBe(400);
    expect((await h.api.call('POST', '/join', { body: { displayName: 'x' } })).status).toBe(400);
    expect((await h.api.join(room.inviteCode, 'Alice')).status).toBe(200);
  });
});

describe('owner-only operations', () => {
  it('only the owner can issue invites', async () => {
    await start();
    const room = await newRoom(h.api);
    const guest = await joinRoom(h.api, room.inviteCode);
    const path = `/rooms/${room.roomId}/invites`;

    const ok = await h.api.call('POST', path, { token: room.owner.token });
    expect(ok.status).toBe(200);
    expect(ok.body.inviteCode).toMatch(CODE_SHAPE);
    expect(ok.body.inviteCode).not.toBe(room.inviteCode);

    expect((await h.api.call('POST', path, { token: guest.token })).status).toBe(403);
    expect((await h.api.call('POST', path)).status).toBe(401);
    expect((await h.api.call('POST', path, { token: 'garbage' })).status).toBe(401);

    const otherRoom = await newRoom(h.api, 'Other');
    expect((await h.api.call('POST', path, { token: otherRoom.owner.token })).status).toBe(403);
  });

  it('only the owner can remove participants, never the owner themself', async () => {
    await start();
    const room = await newRoom(h.api);
    const alice = await joinRoom(h.api, room.inviteCode, 'Alice');
    const bob = await addGuest(h.api, room, 'Bob');
    const del = (target: string, token: string) =>
      h.api.call('DELETE', `/rooms/${room.roomId}/participants/${target}`, { token });

    expect((await del(bob.participantId, alice.token)).status).toBe(403);
    expect((await del(room.owner.participantId, room.owner.token)).status).toBe(400);
    expect((await del('missing-id', room.owner.token)).status).toBe(404);
    expect((await del(alice.participantId, room.owner.token)).status).toBe(204);
    expect((await del(alice.participantId, room.owner.token)).status).toBe(404);
  });

  it('a removed participant loses REST access and disappears from the list', async () => {
    await start();
    const room = await newRoom(h.api);
    const alice = await joinRoom(h.api, room.inviteCode, 'Alice');
    const list = `/rooms/${room.roomId}/participants`;

    expect((await h.api.call('GET', list, { token: alice.token })).status).toBe(200);
    await h.api.call('DELETE', `${list}/${alice.participantId}`, { token: room.owner.token });
    expect((await h.api.call('GET', list, { token: alice.token })).status).toBe(401);

    const after = await h.api.call('GET', list, { token: room.owner.token });
    expect(after.body.map((p: { displayName: string }) => p.displayName)).toEqual(['Owner']);
  });
});

describe('participants list', () => {
  it('returns members only, with role, joinedAt and online flag', async () => {
    await startClocked();
    const room = await newRoom(h.api, 'Steve');
    clockMs += 5000;
    const alice = await joinRoom(h.api, room.inviteCode, 'Alice');
    const list = `/rooms/${room.roomId}/participants`;

    const res = await h.api.call('GET', list, { token: alice.token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { participantId: room.owner.participantId, displayName: 'Steve', role: 'owner', joinedAt: 1_700_000_000_000, online: false },
      { participantId: alice.participantId, displayName: 'Alice', role: 'participant', joinedAt: 1_700_000_005_000, online: false },
    ]);

    const outsider = await newRoom(h.api, 'Outsider');
    expect((await h.api.call('GET', list, { token: outsider.owner.token })).status).toBe(403);
    expect((await h.api.call('GET', list)).status).toBe(401);
  });
});

describe('restart persistence', () => {
  it('keeps participants, spent codes and removals across a restart', async () => {
    const dbPath = tempDbPath();
    await start({ dbPath });
    const room = await newRoom(h.api);
    const alice = await joinRoom(h.api, room.inviteCode, 'Alice');
    const bob = await addGuest(h.api, room, 'Bob');
    await h.api.call('DELETE', `/rooms/${room.roomId}/participants/${bob.participantId}`, { token: room.owner.token });
    await h.stop();

    await start({ dbPath });
    const list = `/rooms/${room.roomId}/participants`;
    const res = await h.api.call('GET', list, { token: alice.token });
    expect(res.status).toBe(200);
    expect(res.body.map((p: { displayName: string }) => p.displayName)).toEqual(['Owner', 'Alice']);
    expect((await h.api.call('GET', list, { token: bob.token })).status).toBe(401);
    expect((await h.api.join(room.inviteCode, 'Replay')).status).toBe(404);
  });
});

describe('client IP key for /join limits', () => {
  const fail = async (headers: Record<string, string>, times: number) => {
    for (let i = 0; i < times; i++) expect((await h.api.join('ZZZZZZZZ', 'A', headers)).status).toBe(404);
  };
  const XFF = 'X-Forwarded-For';

  it('hops=1 keys on the LAST X-Forwarded-For entry and ignores spoofable leading ones', async () => {
    await start({ trustProxyHops: 1 });
    const room = await newRoom(h.api);
    await fail({ [XFF]: '203.0.113.7, 198.51.100.9' }, 10);
    // 같은 실제 클라이언트(198.51.100.9), 다른 위조 앞 항목 → 같은 키라 차단. (chain[0]을 쓰면 여기서 404가 나와 실패한다.)
    expect((await h.api.join('ZZZZZZZZ', 'A', { [XFF]: '8.8.8.8, 198.51.100.9' })).status).toBe(429);
    // 앞 항목만 같고 실제 클라이언트가 다르면 별개 키.
    expect((await h.api.join(room.inviteCode, 'B', { [XFF]: '203.0.113.7, 198.51.100.10' })).status).toBe(200);
  });

  it('hops=2 keys on the second entry from the right', async () => {
    await start({ trustProxyHops: 2 });
    const room = await newRoom(h.api);
    await fail({ [XFF]: '203.0.113.7, 198.51.100.9' }, 10);
    // 마지막 항목(첫 번째 프록시)만 달라도 같은 클라이언트(203.0.113.7)라 차단.
    expect((await h.api.join('ZZZZZZZZ', 'A', { [XFF]: '203.0.113.7, 198.51.100.10' })).status).toBe(429);
    // 오른쪽에서 두 번째 항목이 다르면 별개 키 — 마지막 항목(198.51.100.9)이 같아도 차단되지 않는다.
    expect((await h.api.join(room.inviteCode, 'B', { [XFF]: '203.0.113.8, 198.51.100.9' })).status).toBe(200);
  });

  it('treats one IPv6 /64 as one key and maps IPv4-mapped IPv6 to IPv4', async () => {
    await start({ trustProxyHops: 1 });
    const room = await newRoom(h.api);
    await fail({ [XFF]: '2001:db8:1:2:aaaa::1' }, 10);
    expect((await h.api.join('ZZZZZZZZ', 'A', { [XFF]: '2001:db8:1:2:bbbb:cccc:dddd:2' })).status).toBe(429);
    expect((await h.api.join('ZZZZZZZZ', 'A', { [XFF]: '2001:0DB8:0001:0002::9' })).status).toBe(429);
    // 다른 /64는 별개.
    expect((await h.api.join('ZZZZZZZZ', 'A', { [XFF]: '2001:db8:1:3::1' })).status).toBe(404);

    await fail({ [XFF]: '::ffff:203.0.113.50' }, 10);
    expect((await h.api.join('ZZZZZZZZ', 'A', { [XFF]: '203.0.113.50' })).status).toBe(429);
    expect((await h.api.join(room.inviteCode, 'B', { [XFF]: '203.0.113.51' })).status).toBe(200);
  });

  it('falls back to the socket IP and logs only the event when X-Forwarded-For is unusable', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    try {
      await start({ trustProxyHops: 1, silent: false });
      expect((await h.api.join('ZZZZZZZZ', 'A')).status).toBe(404);
      expect((await h.api.join('ZZZZZZZZ', 'A', { [XFF]: 'not-an-ip' })).status).toBe(404);
      const output = lines.join('\n');
      expect(output).toContain('xff.fallback');
      expect(output).toContain('"reason":"missing"');
      expect(output).not.toContain('127.0.0.1');
      expect(output).not.toContain('not-an-ip');
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects a non-integer trustProxyHops instead of silently keying everyone on one IP', async () => {
    for (const bad of [Number.NaN, -1, 1.5, Number('abc')]) {
      await expect(startRelay({ silent: true, trustProxyHops: bad })).rejects.toThrow(/trustProxyHops/);
    }
  });
});

describe('global /join failure gate', () => {
  it('backs off exponentially once failures from all IPs exceed the per-minute ceiling', async () => {
    await startClocked({ trustProxyHops: 1 });
    const room = await newRoom(h.api);
    const from = (i: number) => ({ 'X-Forwarded-For': `10.1.${Math.floor(i / 200)}.${i % 200}` });
    // 서로 다른 IP 60개에서 각 1회 실패: IP별 제한(10회)에는 전혀 안 걸리지만 전역 상한에는 걸린다.
    for (let i = 0; i < 60; i++) expect((await h.api.join('ZZZZZZZZ', 'A', from(i))).status).toBe(404);
    const blocked = await h.api.join('ZZZZZZZZ', 'A', from(100));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('30');
    // 올바른 코드도 차단 중에는 거절된다(브루트포스가 정답을 맞혀도 못 쓰게).
    expect((await h.api.join(room.inviteCode, 'Legit', from(101))).status).toBe(429);

    clockMs += 31_000;
    for (let i = 0; i < 60; i++) expect((await h.api.join('ZZZZZZZZ', 'A', from(200 + i))).status).toBe(404);
    const second = await h.api.join('ZZZZZZZZ', 'A', from(300));
    expect(second.status).toBe(429);
    expect(second.headers.get('retry-after')).toBe('60');

    clockMs += 61_000;
    expect((await h.api.join(room.inviteCode, 'Legit', from(301))).status).toBe(200);
  });

  it('stays open below the ceiling', async () => {
    // 전역 상한(60)은 IP별 상한(10)에 가려지므로 IP를 바꿔가며 60회까지는 모두 404(차단 없음).
    await start({ trustProxyHops: 1 });
    for (let i = 0; i < 60; i++) {
      expect((await h.api.join('ZZZZZZZZ', 'A', { 'X-Forwarded-For': `10.2.0.${i}` })).status).toBe(404);
    }
  });
});

describe('invite quota', () => {
  it('caps open invites at 20 per room; used and expired codes do not count', async () => {
    await startClocked();
    const room = await newRoom(h.api); // 초대 1개(열림)
    const path = `/rooms/${room.roomId}/invites`;
    const issue = () => h.api.call('POST', path, { token: room.owner.token });

    for (let i = 2; i <= 20; i++) expect((await issue()).status, `invite #${i}`).toBe(200);
    const over = await issue();
    expect(over.status).toBe(429);
    expect(over.body).toEqual({ error: 'too_many_open_invites' });

    // 사용된 코드는 세지 않는다.
    expect((await h.api.join(room.inviteCode, 'Alice')).status).toBe(200);
    expect((await issue()).status).toBe(200);
    expect((await issue()).status).toBe(429);

    // 만료된 코드도 세지 않는다.
    clockMs += 10 * 60 * 1000 + 1;
    expect((await issue()).status).toBe(200);
  });
});

describe('CORS preflight', () => {
  it('OPTIONS /rooms and /rooms/:id answer 204 with permissive CORS headers', async () => {
    await start();
    for (const path of ['/rooms', '/rooms/abcdefgh12/participants/x']) {
      const res = await h.api.call('OPTIONS', path);
      expect(res.status, path).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-methods')).toContain('DELETE');
      expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
    }
  });
});

describe('folder name boundaries (server-side validation)', () => {
  it('counts code points, normalizes to NFC and rejects invisible/control characters', async () => {
    await start();
    const create = (name: unknown) => h.api.createRoom('Owner', name);
    expect((await create('🙂'.repeat(80))).status).toBe(200);
    expect((await create('🙂'.repeat(81))).status).toBe(400);
    // 결합 문자 분해형(e + U+0301)은 NFC(é)로 저장되어 참가 응답에 그대로 나온다.
    const room = await newRoom(h.api, 'Owner', 'café');
    expect((await h.api.join(room.inviteCode, 'Alice')).body.folderName).toBe('café');
    for (const bad of ['a b', 'a‮b', 'a​b', 'a b', '', '.', ' . ', 'a\\b']) {
      expect((await create(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    // 내부 점·공백은 허용, 앞뒤 공백은 잘린다.
    expect((await create('my.notes v2')).status).toBe(200);
    const trimmed = await newRoom(h.api, 'Owner', '  x  ');
    expect((await h.api.join(trimmed.inviteCode, 'Bob')).body.folderName).toBe('x');
  });
});

describe('env parsing', () => {
  it('parseIntEnv falls back when unset and rejects non-integers / out-of-range values', () => {
    const range = { min: 0, max: 10 };
    expect(parseIntEnv('X', undefined, 3, range)).toBe(3);
    expect(parseIntEnv('X', '', 3, range)).toBe(3);
    expect(parseIntEnv('X', ' 2 ', 3, range)).toBe(2);
    for (const bad of ['abc', '1.5', '-1', '11', '1e2', '0x1']) {
      expect(() => parseIntEnv('TRUST_PROXY_HOPS', bad, 3, range), bad).toThrow(/TRUST_PROXY_HOPS/);
    }
  });
});
