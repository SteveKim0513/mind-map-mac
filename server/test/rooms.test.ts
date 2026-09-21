import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { Harness, addGuest, cleanupTemp, newRoom, tempDbPath, until } from './helpers.js';

let h: Harness;
let clockMs: number;
const DAY = 24 * 60 * 60 * 1000;

const startClocked = async (extra: Parameters<Harness['start']>[0] = {}) => {
  clockMs = 1_700_000_000_000;
  h = await new Harness().start({ clock: () => clockMs, ...extra });
};

afterEach(async () => {
  await h?.stop();
  cleanupTemp();
});

describe('DELETE /rooms/:roomId', () => {
  it('lets only the owner delete the room (204) and removes every trace of it', async () => {
    const dbPath = tempDbPath();
    h = await new Harness().start({ dbPath });
    const room = await newRoom(h.api, 'Steve', 'SecretFolderName');
    const guest = await addGuest(h.api, room, 'Alice');
    const spare = await h.api.call('POST', `/rooms/${room.roomId}/invites`, { token: room.owner.token });
    const other = await newRoom(h.api, 'Other');
    const path = `/rooms/${room.roomId}`;

    expect((await h.api.call('DELETE', path)).status).toBe(401);
    expect((await h.api.call('DELETE', path, { token: 'garbage' })).status).toBe(401);
    expect((await h.api.call('DELETE', path, { token: guest.token })).status).toBe(403);
    expect((await h.api.call('DELETE', path, { token: other.owner.token })).status).toBe(403);
    expect((await h.api.call('GET', path, { token: room.owner.token })).status).toBe(405);
    // 아직 아무것도 지워지지 않았다.
    expect((await h.api.call('GET', `${path}/participants`, { token: guest.token })).status).toBe(200);

    const res = await h.api.call('DELETE', path, { token: room.owner.token });
    expect(res.status).toBe(204);

    // 이후 그 방의 어떤 토큰으로도 REST가 인증되지 않고, 남은 초대 코드로 참가할 수 없다.
    for (const token of [room.owner.token, guest.token]) {
      expect((await h.api.call('GET', `${path}/participants`, { token })).status).toBe(401);
      expect((await h.api.call('POST', `${path}/invites`, { token })).status).toBe(401);
      expect((await h.api.call('DELETE', path, { token })).status).toBe(401);
    }
    expect((await h.api.join(spare.body.inviteCode, 'Late')).status).toBe(404);
    expect((await h.api.join(room.inviteCode, 'Late')).status).toBe(404);
    // 다른 방은 영향 없다.
    expect((await h.api.call('GET', `/rooms/${other.roomId}/participants`, { token: other.owner.token })).status).toBe(200);

    // WebSocket 인증도 실패한다.
    const denied = h.connect(`${room.roomId}/note:n1`, guest.token);
    await denied.synced();
    expect(denied.failed).toEqual(['permission-denied']);

    await h.stop();
    const db = new Database(dbPath, { readonly: true });
    const count = (sql: string) => (db.prepare(sql).get(room.roomId) as { n: number }).n;
    expect(count('SELECT COUNT(*) AS n FROM rooms WHERE room_id = ?')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM participants WHERE room_id = ?')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM invites WHERE room_id = ?')).toBe(0);
    const names = db.prepare('SELECT folder_name FROM rooms').all() as { folder_name: string | null }[];
    expect(names.map((r) => r.folder_name)).not.toContain('SecretFolderName');
    db.close();
  });

  it('closes every live socket of the room with 4403 room_deleted and leaves other rooms connected', async () => {
    h = await new Harness().start();
    const room = await newRoom(h.api);
    const guest = await addGuest(h.api, room);
    const other = await newRoom(h.api, 'Other');
    const otherGuest = await addGuest(h.api, other);

    const ownerNote = h.connect(`${room.roomId}/note:n1`, room.owner.token);
    const guestNote = h.connect(`${room.roomId}/note:n1`, guest.token);
    const guestManifest = h.connect(`${room.roomId}/manifest`, guest.token);
    const otherOwner = h.connect(`${other.roomId}/note:n1`, other.owner.token);
    const otherMember = h.connect(`${other.roomId}/note:n1`, otherGuest.token);
    await Promise.all([ownerNote, guestNote, guestManifest, otherOwner, otherMember].map((c) => c.synced()));
    expect(h.relay.stats().connections).toBe(5);

    const res = await h.api.call('DELETE', `/rooms/${room.roomId}`, { token: room.owner.token });
    expect(res.status).toBe(204);
    expect(h.relay.stats().connections).toBe(2);

    await until(
      () => [ownerNote, guestNote, guestManifest].every((c) => c.closes.includes(4403)),
      'room sockets closed with 4403',
      3000,
      () => JSON.stringify([ownerNote.closes, guestNote.closes, guestManifest.closes]),
    );
    // 삭제된 방의 클라이언트가 계속 써도 아무 데도 전달되지 않는다.
    guestNote.doc.getText('body').insert(0, 'ghost');

    otherOwner.doc.getText('body').insert(0, 'still-alive');
    await until(() => otherMember.doc.getText('body').toString() === 'still-alive', 'other room unaffected');
    expect(otherOwner.closes).toEqual([]);
    expect(otherMember.closes).toEqual([]);
  });
});

describe('inactive room cleanup (ROOM_TTL_DAYS)', () => {
  it('deletes rooms idle past the TTL, keeps rooms with live connections or recent activity', async () => {
    await startClocked({ limits: { roomTtlDays: 30 } });
    const idle = await newRoom(h.api, 'Idle', 'IdleFolder');
    const live = await newRoom(h.api, 'Live');
    const touched = await newRoom(h.api, 'Touched');

    const client = h.connect(`${live.roomId}/manifest`, live.owner.token);
    await client.synced();

    clockMs += 20 * DAY;
    // REST 활동은 마지막 활동 시각을 갱신한다.
    expect((await h.api.call('GET', `/rooms/${touched.roomId}/participants`, { token: touched.owner.token })).status).toBe(200);
    expect(h.relay.sweepStaleRooms()).toBe(0);

    clockMs += 11 * DAY; // idle: 31일 무활동, touched: 11일 무활동, live: 31일이지만 접속 중
    expect(h.relay.sweepStaleRooms()).toBe(1);
    expect((await h.api.call('GET', `/rooms/${idle.roomId}/participants`, { token: idle.owner.token })).status).toBe(401);
    expect((await h.api.join(idle.inviteCode, 'Late')).status).toBe(404);
    expect((await h.api.call('GET', `/rooms/${touched.roomId}/participants`, { token: touched.owner.token })).status).toBe(200);
    expect((await h.api.call('GET', `/rooms/${live.roomId}/participants`, { token: live.owner.token })).status).toBe(200);
    expect(client.closes).toEqual([]);

    // 접속 중이던 방은 스윕에서 활동으로 갱신되었으므로 바로 다음 스윕에서도 안전하다.
    client.destroy();
    await until(() => h.relay.stats().connections === 0, 'client left');
    expect(h.relay.sweepStaleRooms()).toBe(0);
    clockMs += 31 * DAY;
    expect(h.relay.sweepStaleRooms()).toBe(2);
  });

  it('is disabled with ROOM_TTL_DAYS=0', async () => {
    await startClocked({ limits: { roomTtlDays: 0 } });
    const room = await newRoom(h.api);
    clockMs += 3650 * DAY;
    expect(h.relay.sweepStaleRooms()).toBe(0);
    expect((await h.api.call('GET', `/rooms/${room.roomId}/participants`, { token: room.owner.token })).status).toBe(200);
  });

  it('starts pre-existing rooms (no last_active_at yet) with a fresh activity clock', async () => {
    const dbPath = tempDbPath();
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE rooms (room_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, folder_name TEXT);
      CREATE TABLE participants (
        participant_id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(room_id), display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'participant')), token_hash TEXT NOT NULL UNIQUE,
        joined_at INTEGER NOT NULL, revoked_at INTEGER
      );
      CREATE TABLE invites (
        code_hash TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(room_id), created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
      );
      INSERT INTO rooms (room_id, created_at) VALUES ('legacyroom1', 1);
    `);
    legacy.close();

    await startClocked({ dbPath, limits: { roomTtlDays: 30 } });
    // created_at=1(아주 오래됨)이어도 배포 직후 바로 정리되지 않는다.
    expect(h.relay.sweepStaleRooms()).toBe(0);
    clockMs += 31 * DAY;
    expect(h.relay.sweepStaleRooms()).toBe(1);
  });
});

describe('room creation capacity', () => {
  it('caps room creation across all IPs per hour, independent of the per-IP limit', async () => {
    await startClocked({ trustProxyHops: 1, limits: { roomCreateGlobalPerHour: 3 } });
    const create = (i: number) =>
      h.api.call('POST', '/rooms', { body: { ownerName: 'O' }, headers: { 'X-Forwarded-For': `10.3.0.${i}` } });
    for (let i = 0; i < 3; i++) expect((await create(i)).status).toBe(200);
    const blocked = await create(10);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    clockMs += 60 * 60 * 1000 + 1;
    expect((await create(11)).status).toBe(200);
  });

  it('refuses new rooms with 503 capacity_reached once the total room cap is hit; deleting frees a slot', async () => {
    await startClocked({ limits: { maxRooms: 2 } });
    const a = await newRoom(h.api);
    await newRoom(h.api);
    const full = await h.api.createRoom('Third');
    expect(full.status).toBe(503);
    expect(full.body).toEqual({ error: 'capacity_reached' });
    await h.api.call('DELETE', `/rooms/${a.roomId}`, { token: a.owner.token });
    expect((await h.api.createRoom('Third')).status).toBe(200);
  });
});
