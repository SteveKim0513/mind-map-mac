import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Harness, SharedSocket, addGuest, cleanupTemp, newRoom, openRaw, until } from './helpers.js';

let h: Harness;

afterEach(async () => {
  await h?.stop();
  cleanupTemp();
});

const KIB = 1024;
const text = (bytes: number) => 'x'.repeat(bytes);

describe('socket-level frame and time limits', () => {
  it('drops an unauthenticated socket that sends a frame above the pre-auth limit (1009), before any parsing', async () => {
    h = await new Harness().start({ limits: { preAuthMaxPayloadBytes: 4 * KIB } });
    const socket = openRaw(h.relay.wsUrl);
    expect(await socket.opened, `raw socket failed to open: ${socket.failure()}`).toBe(true);
    socket.ws.send(new Uint8Array(64 * KIB));
    expect(await socket.closed).toBe(1009);
  });

  it('raises the frame limit after authentication so legitimate large updates still sync', async () => {
    h = await new Harness().start({ limits: { preAuthMaxPayloadBytes: 4 * KIB } });
    const room = await newRoom(h.api);
    const guest = await addGuest(h.api, room);
    const name = `${room.roomId}/note:big`;
    const a = h.connect(name, room.owner.token);
    const b = h.connect(name, guest.token);
    await Promise.all([a.synced(), b.synced()]);

    const body = text(200 * KIB); // 인증 전 상한(4KiB)의 50배
    a.doc.getText('body').insert(0, body);
    await until(() => b.doc.getText('body').length === body.length, 'large update reaches the other client');
    expect(a.closes).toEqual([]);
    expect(b.closes).toEqual([]);
  });

  it('closes a socket that never authenticates within the timeout (4408) and keeps authenticated ones', async () => {
    h = await new Harness().start({ limits: { authTimeoutMs: 300 } });
    const room = await newRoom(h.api);
    const client = h.connect(`${room.roomId}/manifest`, room.owner.token);
    await client.synced();

    const idle = openRaw(h.relay.wsUrl);
    expect(await idle.opened).toBe(true);
    expect(await idle.closed).toBe(4408);
    // 인증된 소켓은 같은 시간이 지나도 유지된다(양성 신호 뒤에 확인).
    expect(client.closes).toEqual([]);
    client.doc.getMap('m').set('k', 'v');
  });

  it('refuses WebSocket upgrades beyond the global and per-IP socket caps, and frees slots when sockets close', async () => {
    h = await new Harness().start({ limits: { maxSockets: 3, maxSocketsPerIp: 2 } });
    const first = openRaw(h.relay.wsUrl);
    const second = openRaw(h.relay.wsUrl);
    expect(await first.opened).toBe(true);
    expect(await second.opened).toBe(true);

    const third = openRaw(h.relay.wsUrl); // 같은 IP(127.0.0.1)의 세 번째 → IP 상한
    await third.closed;
    expect(third.wasOpen()).toBe(false);

    first.ws.close();
    await first.closed;
    // 서버가 소켓 종료를 반영할 때까지(비동기) 재시도한다.
    let retried: ReturnType<typeof openRaw> | undefined;
    await until(
      async () => {
        retried = openRaw(h.relay.wsUrl);
        return retried.opened;
      },
      'slot freed after close',
      5000,
    );
    expect(retried?.wasOpen()).toBe(true);
    retried?.ws.close();
    second.ws.close();
  });

  it('refuses upgrades above the global socket cap (503)', async () => {
    h = await new Harness().start({ limits: { maxSockets: 1 } });
    const first = openRaw(h.relay.wsUrl);
    expect(await first.opened).toBe(true);
    const second = openRaw(h.relay.wsUrl);
    await second.closed;
    expect(second.wasOpen()).toBe(false);
    first.ws.close();
  });
});

describe('connection caps after authentication', () => {
  it('limits concurrent sockets per participant (4429 too_many_connections) without disturbing the existing ones', async () => {
    h = await new Harness().start({ limits: { maxSocketsPerParticipant: 2 } });
    const room = await newRoom(h.api);
    const a = h.connect(`${room.roomId}/note:a`, room.owner.token);
    const b = h.connect(`${room.roomId}/note:b`, room.owner.token);
    await Promise.all([a.synced(), b.synced()]);

    const c = h.connect(`${room.roomId}/note:c`, room.owner.token);
    await until(() => c.closes.includes(4429), 'third socket refused', 5000, () => JSON.stringify(c.closes));
    await until(() => h.relay.stats().connections === 2, 'only the two admitted sockets remain');
    expect(a.closes).toEqual([]);
    expect(b.closes).toEqual([]);
  });

  it('limits concurrent sockets per room across participants', async () => {
    h = await new Harness().start({ limits: { maxSocketsPerRoom: 2 } });
    const room = await newRoom(h.api);
    const guest = await addGuest(h.api, room);
    const owner = h.connect(`${room.roomId}/note:a`, room.owner.token);
    const member = h.connect(`${room.roomId}/note:a`, guest.token);
    await Promise.all([owner.synced(), member.synced()]);

    const extra = h.connect(`${room.roomId}/note:b`, guest.token);
    await until(() => extra.closes.includes(4429), 'extra socket refused', 5000, () => JSON.stringify(extra.closes));
    owner.doc.getText('body').insert(0, 'still-syncing');
    await until(() => member.doc.getText('body').toString() === 'still-syncing', 'existing pair unaffected');
  });

  it('caps a socket message rate (4429 rate_limited) and lets the client reconnect later', async () => {
    h = await new Harness().start({ limits: { messageBurst: 40, messageRatePerSec: 1 } });
    const room = await newRoom(h.api);
    const flood = h.connect(`${room.roomId}/note:f`, room.owner.token);
    await flood.synced();
    for (let i = 0; i < 200; i++) flood.doc.getText('body').insert(0, 'a');
    await until(() => flood.closes.includes(4429), 'flooding socket closed', 5000, () => JSON.stringify(flood.closes));
    await until(() => h.relay.stats().connections === 0, 'server released the flooding connection');
  });
});

describe('document size and room memory budget', () => {
  it('evicts a document that grows past the per-document cap (close reason doc_too_large) and drops its state', async () => {
    h = await new Harness().start({ limits: { maxDocumentBytes: 200 * KIB } });
    const room = await newRoom(h.api);
    const name = `${room.roomId}/note:n1`;
    const client = h.connect(name, room.owner.token);
    await client.synced();

    client.doc.getText('body').insert(0, text(100 * KIB)); // 상한 이하: 유지
    await until(() => h.relay.stats().documents === 1, 'small doc loaded');
    client.doc.getText('body').insert(0, text(300 * KIB)); // 상한 초과
    await until(() => client.closeReasons.includes('doc_too_large'), 'oversized doc evicted', 5000, () => JSON.stringify(client.closeReasons));
    await until(() => h.relay.stats().documents === 0, 'oversized doc unloaded from memory');

    const fresh = h.connect(name, room.owner.token, new Y.Doc());
    await fresh.synced();
    expect(fresh.doc.getText('body').toString()).toBe('');
  });

  it('evicts the document that pushes a room over its memory budget and keeps the others', async () => {
    h = await new Harness().start({ limits: { maxRoomBytes: 300 * KIB } });
    const room = await newRoom(h.api);
    const guest = await addGuest(h.api, room);
    const a = h.connect(`${room.roomId}/note:a`, room.owner.token);
    const aPeer = h.connect(`${room.roomId}/note:a`, guest.token);
    const b = h.connect(`${room.roomId}/note:b`, room.owner.token);
    await Promise.all([a.synced(), aPeer.synced(), b.synced()]);

    a.doc.getText('body').insert(0, text(200 * KIB));
    await until(() => aPeer.doc.getText('body').length === 200 * KIB, 'first doc fits the budget');
    b.doc.getText('body').insert(0, text(200 * KIB)); // 합계 400KiB > 300KiB
    await until(() => b.closeReasons.includes('room_over_budget'), 'second doc evicted', 5000, () => JSON.stringify(b.closeReasons));

    expect(a.closeReasons).toEqual([]);
    a.doc.getText('body').insert(0, 'still-fine');
    await until(() => aPeer.doc.getText('body').toString().startsWith('still-fine'), 'first doc still syncing');
  });

  it('evicts when the instance-wide budget is exceeded', async () => {
    h = await new Harness().start({ limits: { maxTotalBytes: 250 * KIB } });
    const one = await newRoom(h.api, 'One');
    const two = await newRoom(h.api, 'Two');
    const a = h.connect(`${one.roomId}/note:a`, one.owner.token);
    const b = h.connect(`${two.roomId}/note:a`, two.owner.token);
    await Promise.all([a.synced(), b.synced()]);
    a.doc.getText('body').insert(0, text(200 * KIB));
    await until(() => h.relay.stats().documents === 2, 'both docs loaded');
    b.doc.getText('body').insert(0, text(200 * KIB));
    await until(() => b.closeReasons.includes('room_over_budget'), 'instance budget enforced', 5000, () => JSON.stringify(b.closeReasons));
    expect(a.closeReasons).toEqual([]);
  });
});

describe('per-room document cap (room_full)', () => {
  it('denies the 1001st distinct document but still lets clients join an already-open one', async () => {
    h = await new Harness().start();
    const room = await newRoom(h.api);
    const names = Array.from({ length: 1000 }, (_, i) => `note:n${i}`);
    const owner = new SharedSocket(h.relay.wsUrl);
    const guestSocket = new SharedSocket(h.relay.wsUrl);
    const overflowSocket = new SharedSocket(h.relay.wsUrl);
    try {
      // 소켓당 미인증 대기 문서 상한(100)을 넘지 않도록 50개씩 나눠 붙인다 — 공유 소켓 하나에 문서 1000개.
      for (let i = 0; i < names.length; i += 50) {
        const batch = owner.attach(room.roomId, room.owner.token, names.slice(i, i + 50));
        await until(
          () => batch.every((p) => p.isSynced) || owner.failed.length > 0,
          `batch ${i / 50} synced`,
          15_000,
          () => JSON.stringify({ failed: owner.failed, relay: h.relay.stats() }),
        );
        expect(owner.failed).toEqual([]);
      }
      expect(h.relay.stats().documents).toBe(1000);

      overflowSocket.attach(room.roomId, room.owner.token, ['note:overflow']);
      await until(() => overflowSocket.failed.length > 0, 'overflow denied', 8000, () => JSON.stringify(h.relay.stats()));
      expect(overflowSocket.failed).toEqual(['note:overflow:room_full']);
      expect(h.relay.stats().documents).toBe(1000);

      // 이미 열린 문서에는 다른 참가자가 계속 붙을 수 있다.
      const guest = await addGuest(h.api, room);
      const [existing] = guestSocket.attach(room.roomId, guest.token, ['note:n0']);
      await until(() => existing?.isSynced === true || guestSocket.failed.length > 0, 'existing doc joinable', 8000);
      expect(guestSocket.failed).toEqual([]);
    } finally {
      owner.destroy();
      guestSocket.destroy();
      overflowSocket.destroy();
    }
  }, 60_000);
});

describe('token handling on the socket', () => {
  it('rejects tokens longer than 256 characters', async () => {
    h = await new Harness().start();
    const room = await newRoom(h.api);
    const tooLong = h.connect(`${room.roomId}/manifest`, 'a'.repeat(257));
    await tooLong.synced();
    expect(tooLong.failed).toEqual(['permission-denied']);
    const empty = h.connect(`${room.roomId}/manifest`, '');
    await empty.synced();
    expect(empty.failed).toEqual(['permission-denied']);
    expect(h.relay.stats().documents).toBe(0);
  });
});

describe('revoke racing with authentication', () => {
  it('re-checks membership in the connected hook when the participant is removed while authenticating', async () => {
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let armed = false;
    h = await new Harness().start({
      testHooks: {
        afterAuthenticate: async () => {
          if (!armed) return;
          entered();
          await gate;
        },
      },
    });
    const room = await newRoom(h.api);
    const guest = await addGuest(h.api, room);
    armed = true;

    const client = h.connect(`${room.roomId}/note:n1`, guest.token);
    await enteredPromise; // 서버가 토큰을 유효로 판정한 직후, 연결이 성립하기 전
    const del = await h.api.call('DELETE', `/rooms/${room.roomId}/participants/${guest.participantId}`, {
      token: room.owner.token,
    });
    expect(del.status).toBe(204); // 이 시점엔 끊을 라이브 연결이 아직 없다
    release();

    await until(() => client.closes.includes(4403), 'raced participant closed by connected hook', 5000, () =>
      JSON.stringify({ closes: client.closes, failed: client.failed, relay: h.relay.stats() }),
    );
    await until(() => h.relay.stats().connections === 0 && h.relay.stats().documents === 0, 'nothing left in memory');
  });
});
