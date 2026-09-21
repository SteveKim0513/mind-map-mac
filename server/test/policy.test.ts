import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Harness, addGuest, cleanupTemp, newRoom, openRaw, tempDbPath, until } from './helpers.js';

let h: Harness;

afterEach(async () => {
  await h?.stop();
  cleanupTemp();
  vi.restoreAllMocks();
});

describe('no content persistence', () => {
  it('drops document state when the last client leaves and keeps no content on disk', async () => {
    const dbPath = tempDbPath();
    const marker = 'TOP-SECRET-NOTE-BODY-7f3a91';
    h = await new Harness().start({ dbPath });
    const room = await newRoom(h.api);
    const guest = await addGuest(h.api, room);

    const note = `${room.roomId}/note:n1`;
    const file = `${room.roomId}/file:m1`;
    const a = h.connect(note, room.owner.token);
    const b = h.connect(note, guest.token);
    const f = h.connect(file, room.owner.token);
    await Promise.all([a.synced(), b.synced(), f.synced()]);
    a.doc.getText('body').insert(0, marker);
    f.doc.getMap('snapshot').set('title', marker);
    await until(() => b.doc.getText('body').toString() === marker, 'guest sees note');
    expect(h.relay.stats().documents).toBe(2);

    a.destroy();
    b.destroy();
    f.destroy();
    await until(() => h.relay.stats().documents === 0 && h.relay.stats().connections === 0, 'room memory released');

    const late = h.connect(note, room.owner.token, new Y.Doc());
    await late.synced();
    expect(late.doc.getText('body').toString()).toBe('');
    late.destroy();
    await until(() => h.relay.stats().documents === 0, 'late doc released');

    await h.stop();

    const dir = dirname(dbPath);
    for (const name of readdirSync(dir)) {
      expect(readFileSync(join(dir, name)).includes(marker), `${name} contains note content`).toBe(false);
    }

    const db = new Database(dbPath, { readonly: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(['invites', 'participants', 'rooms']);
    const columns = tables.flatMap((table) =>
      db.prepare(`PRAGMA table_info(${table})`).all().map((c) => `${table}.${(c as { name: string }).name}`),
    );
    expect(columns).toEqual([
      'invites.code_hash',
      'invites.room_id',
      'invites.created_by',
      'invites.created_at',
      'invites.expires_at',
      'invites.used_at',
      'participants.participant_id',
      'participants.room_id',
      'participants.display_name',
      'participants.role',
      'participants.token_hash',
      'participants.joined_at',
      'participants.revoked_at',
      'rooms.room_id',
      'rooms.created_at',
      'rooms.folder_name',
      'rooms.last_active_at',
    ]);
    db.close();
  });

  it('stores only hashes of tokens and invite codes', async () => {
    const dbPath = tempDbPath();
    h = await new Harness().start({ dbPath });
    const room = await newRoom(h.api);
    const guest = await addGuest(h.api, room);
    await h.stop();

    const raw = readdirSync(dirname(dbPath)).map((name) => readFileSync(join(dirname(dbPath), name)).toString('latin1'));
    for (const secret of [room.owner.token, guest.token, room.inviteCode]) {
      expect(raw.some((content) => content.includes(secret))).toBe(false);
    }
  });
});

describe('logging policy', () => {
  it('never writes tokens, invite codes or document payloads to stdout/stderr', async () => {
    const captured: string[] = [];
    const sink = (chunk: unknown) => {
      captured.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'));
      return true;
    };
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      });
    }
    vi.spyOn(process.stdout, 'write').mockImplementation(sink as typeof process.stdout.write);
    vi.spyOn(process.stderr, 'write').mockImplementation(sink as typeof process.stderr.write);

    const payload = 'PAYLOAD-MARKER-c0ffee-do-not-log';
    // debug까지 켜서(ws.closed·ws.disconnected 등 새 진단 이벤트 포함) 모든 로그 경로를 검사한다.
    h = await new Harness().start({ silent: false, logLevel: 'debug' });
    const room = await newRoom(h.api, 'Steve', 'FolderNameSecret');
    const guest = await addGuest(h.api, room, 'Alice');
    await h.api.join('ZZZZZZZZ', 'Attacker');
    await h.api.call('GET', `/rooms/${room.roomId}/participants`, { token: guest.token });

    const note = `${room.roomId}/note:n1`;
    const a = h.connect(note, room.owner.token);
    const b = h.connect(note, guest.token);
    const denied = h.connect(note, 'wrong-token-value-123');
    const viewer = h.connect(`${room.roomId}/file:m1`, guest.token);
    await Promise.all([a.synced(), b.synced(), denied.synced(), viewer.synced()]);
    a.doc.getText('body').insert(0, payload);
    viewer.doc.getMap('snapshot').set('t', payload);
    await until(() => b.doc.getText('body').toString() === payload, 'payload synced');
    // 클라이언트가 임의로 정하는 close 사유와 잘못된 본문도 로그로 새지 않아야 한다.
    const rude = openRaw(h.relay.wsUrl);
    await rude.opened;
    rude.ws.close(4000, 'client-chosen-reason-with-secret-abc123');
    await rude.closed;
    await h.api.call('POST', '/join', { raw: '{"displayName":"Mallory-body-fragment","code":' });
    await h.api.call('DELETE', `/rooms/${room.roomId}/participants/${guest.participantId}`, { token: room.owner.token });
    await until(() => captured.some((line) => line.includes('"ws.closed"') && line.includes('4403')), 'revoked close logged');
    await h.api.call('DELETE', `/rooms/${room.roomId}`, { token: room.owner.token });
    await h.stop();

    vi.restoreAllMocks();
    const output = captured.join('\n');
    expect(output).toContain('room.created');
    expect(output).toContain('participant.revoked');
    expect(output).toContain('room.deleted');
    expect(output).toContain('ws.closed');
    expect(output).toContain('"route":"/join"');
    for (const secret of [
      room.owner.token,
      guest.token,
      room.inviteCode,
      'ZZZZZZZZ',
      'wrong-token-value-123',
      payload,
      'Steve',
      'Alice',
      'FolderNameSecret',
      'client-chosen-reason',
      'Mallory-body-fragment',
    ]) {
      expect(output.includes(secret), `log leaked: ${secret}`).toBe(false);
    }
  });

  it('is silent when silent:true', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    h = await new Harness().start({ silent: true });
    await newRoom(h.api);
    await h.stop();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('isolation', () => {
  it('runs independent relays on random ports without shared state', async () => {
    h = await new Harness().start();
    const other = await new Harness().start();
    try {
      expect(other.relay.port).not.toBe(h.relay.port);
      const room = await newRoom(h.api);
      const res = await other.api.call('POST', `/rooms/${room.roomId}/invites`, { token: room.owner.token });
      expect(res.status).toBe(401);
    } finally {
      await other.stop();
    }
  });
});
