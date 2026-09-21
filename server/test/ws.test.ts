import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Harness, addGuest, newRoom, until } from './helpers.js';

let h: Harness;

afterEach(async () => {
  await h?.stop();
});

describe('note co-editing', () => {
  it('syncs two clients in both directions', async () => {
    h = await new Harness().start();
    const room = await newRoom(h.api);
    const guest = await addGuest(h.api, room);
    const name = `${room.roomId}/note:n1`;

    const a = h.connect(name, room.owner.token);
    const b = h.connect(name, guest.token);
    await Promise.all([a.synced(), b.synced()]);

    a.doc.getText('body').insert(0, 'hello');
    await until(() => b.doc.getText('body').toString() === 'hello', 'a -> b');
    b.doc.getText('body').insert(5, ' world');
    await until(() => a.doc.getText('body').toString() === 'hello world', 'b -> a');
  });

  it('lets participants write to manifest and comments too', async () => {
    h = await new Harness().start();
    const room = await newRoom(h.api);
    const guest = await addGuest(h.api, room);

    for (const key of ['manifest', 'comments']) {
      const name = `${room.roomId}/${key}`;
      const owner = h.connect(name, room.owner.token);
      const member = h.connect(name, guest.token);
      await Promise.all([owner.synced(), member.synced()]);
      expect(member.provider.authorizedScope).toBe('read-write');
      member.doc.getArray('items').push(['from-guest']);
      await until(() => owner.doc.getArray('items').length === 1, `${key} guest -> owner`);
    }
  });
});

describe('access control', () => {
  it('rejects tokens for a different room and never leaks the other room document', async () => {
    h = await new Harness().start();
    const roomA = await newRoom(h.api, 'A');
    const roomB = await newRoom(h.api, 'B');

    const owner = h.connect(`${roomA.roomId}/note:secret`, roomA.owner.token);
    await owner.synced();
    owner.doc.getText('body').insert(0, 'room-a-only');

    // 양성 신호(거부 응답 또는 close)를 기다린 뒤에 단언한다 — 원인 분석용으로 상태를 오류에 담는다.
    const intruder = h.connect(`${roomA.roomId}/note:secret`, roomB.owner.token);
    await until(
      () => intruder.failed.length > 0 || intruder.closes.length > 0,
      'intruder denied',
      10_000,
      () => `failed=${JSON.stringify(intruder.failed)} closes=${JSON.stringify(intruder.closes)} relay=${JSON.stringify(h.relay.stats())}`,
    );
    expect(intruder.failed).toEqual(['permission-denied']);
    expect(intruder.doc.getText('body').toString()).toBe('');
  });

  it('rejects unknown tokens and malformed document names', async () => {
    h = await new Harness().start();
    const room = await newRoom(h.api);

    const badToken = h.connect(`${room.roomId}/manifest`, 'not-a-token');
    await badToken.synced();
    expect(badToken.failed).toEqual(['permission-denied']);

    for (const bad of [`${room.roomId}/other`, `${room.roomId}/note:`, `${room.roomId}/note:a/b`, 'manifest', `../x/manifest`]) {
      const client = h.connect(bad, room.owner.token);
      await client.synced();
      expect(client.failed, bad).toEqual(['permission-denied']);
    }
    expect(h.relay.stats().documents).toBe(0);
  });
});

describe('file:* is owner-write only', () => {
  it('forces readOnly for participants on the server and drops their writes', async () => {
    h = await new Harness().start();
    const room = await newRoom(h.api);
    const guest = await addGuest(h.api, room);
    const name = `${room.roomId}/file:map1`;

    const owner = h.connect(name, room.owner.token);
    await owner.synced();
    expect(owner.provider.authorizedScope).toBe('read-write');
    owner.doc.getMap('snapshot').set('title', 'owner-title');

    const viewer = h.connect(name, guest.token);
    await viewer.synced();
    expect(viewer.provider.authorizedScope).toBe('readonly');
    await until(() => viewer.doc.getMap('snapshot').get('title') === 'owner-title', 'viewer sees owner content');

    viewer.doc.getMap('snapshot').set('title', 'tampered');
    viewer.doc.getMap('snapshot').set('extra', 'injected');
    await new Promise((r) => setTimeout(r, 200));

    expect(owner.doc.getMap('snapshot').get('title')).toBe('owner-title');
    expect(owner.doc.getMap('snapshot').has('extra')).toBe(false);

    const fresh = h.connect(name, room.owner.token, new Y.Doc());
    await fresh.synced();
    expect(fresh.doc.getMap('snapshot').get('title')).toBe('owner-title');
    expect(fresh.doc.getMap('snapshot').has('extra')).toBe(false);
  });

  it('still lets owner updates flow to viewers live', async () => {
    h = await new Harness().start();
    const room = await newRoom(h.api);
    const guest = await addGuest(h.api, room);
    const name = `${room.roomId}/file:board1`;
    const owner = h.connect(name, room.owner.token);
    const viewer = h.connect(name, guest.token);
    await Promise.all([owner.synced(), viewer.synced()]);

    owner.doc.getMap('snapshot').set('rev', 2);
    await until(() => viewer.doc.getMap('snapshot').get('rev') === 2, 'owner -> viewer');
  });
});

describe('participant removal', () => {
  it('denies a removed participant on new connections', async () => {
    h = await new Harness().start();
    const room = await newRoom(h.api);
    const guest = await addGuest(h.api, room);
    await h.api.call('DELETE', `/rooms/${room.roomId}/participants/${guest.participantId}`, { token: room.owner.token });

    const client = h.connect(`${room.roomId}/manifest`, guest.token);
    await client.synced();
    expect(client.failed).toEqual(['permission-denied']);
  });

  it('terminates live connections immediately, on every document and the socket itself', async () => {
    h = await new Harness().start();
    const room = await newRoom(h.api);
    const guest = await addGuest(h.api, room);

    const owner = h.connect(`${room.roomId}/note:n1`, room.owner.token);
    const guestNote = h.connect(`${room.roomId}/note:n1`, guest.token);
    const guestManifest = h.connect(`${room.roomId}/manifest`, guest.token);
    await Promise.all([owner.synced(), guestNote.synced(), guestManifest.synced()]);

    const listPath = `/rooms/${room.roomId}/participants`;
    await until(async () => {
      const res = await h.api.call('GET', listPath, { token: room.owner.token });
      return res.body.find((p: { participantId: string }) => p.participantId === guest.participantId)?.online === true;
    }, 'guest shown online');
    expect(h.relay.stats().connections).toBe(3);

    const del = await h.api.call('DELETE', `${listPath}/${guest.participantId}`, { token: room.owner.token });
    expect(del.status).toBe(204);

    expect(h.relay.stats().connections).toBe(1);
    await until(() => guestNote.closes.includes(4403) && guestManifest.closes.includes(4403), 'guest sockets closed with 4403', 2000);

    guestNote.doc.getText('body').insert(0, 'after-kick');
    await new Promise((r) => setTimeout(r, 300));
    expect(owner.doc.getText('body').toString()).toBe('');

    const res = await h.api.call('GET', listPath, { token: room.owner.token });
    expect(res.body.map((p: { displayName: string }) => p.displayName)).toEqual(['Owner']);
  });

  it('keeps other participants connected when one is removed', async () => {
    h = await new Harness().start();
    const room = await newRoom(h.api);
    const alice = await addGuest(h.api, room, 'Alice');
    const bob = await addGuest(h.api, room, 'Bob');
    const name = `${room.roomId}/note:n1`;
    const a = h.connect(name, alice.token);
    const b = h.connect(name, bob.token);
    await Promise.all([a.synced(), b.synced()]);

    await h.api.call('DELETE', `/rooms/${room.roomId}/participants/${alice.participantId}`, { token: room.owner.token });
    b.doc.getText('body').insert(0, 'still-here');
    const owner = h.connect(name, room.owner.token);
    await owner.synced();
    await until(() => owner.doc.getText('body').toString() === 'still-here', 'bob still syncing');
  });
});
