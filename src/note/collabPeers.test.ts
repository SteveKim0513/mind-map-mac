import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { MAX_AWARENESS_SCANNED, MAX_PEERS, MAX_PEER_CHIPS, VIEWING_FIELD, initialOf, presenceCssVar, readPeers, samePeers } from './collabPeers';

/** 원격 참가자 하나의 awareness 상태를 로컬 awareness에 흘려 넣는다(실제 프로바이더가 하는 일). */
function addRemote(local: Awareness, user: { participantId?: string; name?: string } | null, extra: Record<string, unknown> = {}): void {
  const remoteDoc = new Y.Doc();
  const remote = new Awareness(remoteDoc);
  remote.setLocalState({ ...(user ? { user } : {}), ...extra });
  applyAwarenessUpdate(local, encodeAwarenessUpdate(remote, [remote.clientID]), 'test');
}

describe('readPeers (지금 함께 보는 사람)', () => {
  it('노트를 열어 본 다른 참가자만, 자기 자신은 제외하고 모은다', () => {
    const local = new Awareness(new Y.Doc());
    local.setLocalState({ user: { participantId: 'me-myself-1', name: '나' }, [VIEWING_FIELD]: true });
    addRemote(local, { participantId: 'p-minsu-01', name: '민수' }, { [VIEWING_FIELD]: true });
    addRemote(local, { participantId: 'p-jiho-001', name: '지호' }, { [VIEWING_FIELD]: true });
    // 연결만 돼 있고 이 노트를 열어 보지는 않는 참가자(매니저가 user만 싣는다) — 칩에 나오면 안 된다
    addRemote(local, { participantId: 'p-idle-001', name: '유휴' });
    expect(readPeers(local, 'me-myself-1').map((p) => p.name)).toEqual(['민수', '지호']);
  });

  it('같은 참가자의 창이 둘이어도 한 명으로 센다, 내 다른 창은 제외한다', () => {
    const local = new Awareness(new Y.Doc());
    local.setLocalState({ user: { participantId: 'me-myself-1', name: '나' }, [VIEWING_FIELD]: true });
    addRemote(local, { participantId: 'p-minsu-01', name: '민수' }, { [VIEWING_FIELD]: true });
    addRemote(local, { participantId: 'p-minsu-01', name: '민수' }, { [VIEWING_FIELD]: true });
    addRemote(local, { participantId: 'me-myself-1', name: '나' }, { [VIEWING_FIELD]: true }); // 같은 사람의 다른 창
    expect(readPeers(local, 'me-myself-1')).toHaveLength(1);
  });

  it('user가 없거나 이름이 비면 대체 이름을 쓰고, 안 열어 본 상태(null)는 내려간 것으로 본다', () => {
    const local = new Awareness(new Y.Doc());
    addRemote(local, { participantId: 'p-xxxxx-01', name: '  ' }, { [VIEWING_FIELD]: true });
    addRemote(local, null, { [VIEWING_FIELD]: true });
    addRemote(local, { participantId: 'p-yyyyy-01', name: '영희' }, { [VIEWING_FIELD]: null });
    expect(readPeers(local, 'me-myself-1').map((p) => p.name)).toEqual(['참가자']);
  });
});

describe('readPeers — 원격 awareness 값은 신뢰하지 않는다', () => {
  const ME = 'me-myself-1';
  const mk = () => {
    const local = new Awareness(new Y.Doc());
    local.setLocalState({ user: { participantId: ME, name: '나' }, [VIEWING_FIELD]: true });
    return local;
  };

  it('이름은 표시 이름 규칙으로 정규화한다: 앞뒤 공백 제거, 너무 길거나 제어문자·< > 가 있으면 "참가자"', () => {
    const local = mk();
    addRemote(local, { participantId: 'p-aaaaaaaa-1', name: '  민수  ' }, { [VIEWING_FIELD]: true });
    addRemote(local, { participantId: 'p-bbbbbbbb-1', name: 'x'.repeat(500) }, { [VIEWING_FIELD]: true });
    addRemote(local, { participantId: 'p-cccccccc-1', name: '<img src=x onerror=alert(1)>' }, { [VIEWING_FIELD]: true });
    addRemote(local, { participantId: 'p-dddddddd-1', name: '가\u202E나\u0000' }, { [VIEWING_FIELD]: true });
    addRemote(local, { participantId: 'p-eeeeeeee-1', name: 42 as unknown as string }, { [VIEWING_FIELD]: true });
    const names = readPeers(local, ME).map((p) => p.name).sort();
    expect(names).toEqual(['민수', '참가자', '참가자', '참가자', '참가자'].sort());
    for (const p of readPeers(local, ME)) expect([...p.name].length).toBeLessThanOrEqual(40);
  });

  it('participantId 형식이 어긋나면(경로·HTML·너무 짧음) 그 값을 id로 쓰지 않고 연결 번호로 대체한다', () => {
    const local = mk();
    addRemote(local, { participantId: '<b>evil</b>', name: '가짜' }, { [VIEWING_FIELD]: true });
    addRemote(local, { participantId: '../../x', name: '경로' }, { [VIEWING_FIELD]: true });
    const peers = readPeers(local, ME);
    expect(peers).toHaveLength(2);
    for (const p of peers) expect(p.id).toMatch(/^client-\d+$/);
  });

  it('내 participantId를 내세우는 원격 상태(사칭·다른 창)는 무시한다', () => {
    const local = mk();
    addRemote(local, { participantId: ME, name: '나인 척' }, { [VIEWING_FIELD]: true });
    addRemote(local, { participantId: ME, name: '나인 척 2' }, { [VIEWING_FIELD]: true });
    expect(readPeers(local, ME)).toEqual([]);
  });

  it('같은 id의 상태가 여럿이어도 한 명만 남고 어느 이름이 남는지는 결정적이다(clientID가 가장 작은 상태)', () => {
    const a = mk();
    const b = mk();
    const ids = [1, 2].map(() => new Awareness(new Y.Doc()));
    ids[0].setLocalState({ user: { participantId: 'p-same-0001', name: '첫째' }, [VIEWING_FIELD]: true });
    ids[1].setLocalState({ user: { participantId: 'p-same-0001', name: '둘째' }, [VIEWING_FIELD]: true });
    const order = ids[0].clientID < ids[1].clientID ? [0, 1] : [1, 0];
    for (const i of order) applyAwarenessUpdate(a, encodeAwarenessUpdate(ids[i], [ids[i].clientID]), 't');
    for (const i of [...order].reverse()) applyAwarenessUpdate(b, encodeAwarenessUpdate(ids[i], [ids[i].clientID]), 't'); // 도착 순서만 다르다
    const expectName = ids[0].clientID < ids[1].clientID ? '첫째' : '둘째';
    expect(readPeers(a, ME)).toEqual([{ id: 'p-same-0001', name: expectName }]);
    expect(readPeers(b, ME)).toEqual([{ id: 'p-same-0001', name: expectName }]);
  });

  it('상태를 수천 개 만들어도 훑는 개수(200)와 인원(50)에 상한이 있다', () => {
    const local = mk();
    for (let i = 0; i < MAX_AWARENESS_SCANNED + 300; i++) {
      addRemote(local, { participantId: `p-flood-${String(i).padStart(5, '0')}`, name: `참가${i}` }, { [VIEWING_FIELD]: true });
    }
    const peers = readPeers(local, ME);
    expect(peers.length).toBeLessThanOrEqual(MAX_PEERS);
    expect(peers.length).toBe(MAX_PEERS);
  });

  it('user가 객체가 아니어도 던지지 않는다', () => {
    const local = mk();
    addRemote(local, 'str' as unknown as { name: string }, { [VIEWING_FIELD]: true });
    addRemote(local, [1, 2] as unknown as { name: string }, { [VIEWING_FIELD]: true });
    expect(() => readPeers(local, ME)).not.toThrow();
  });
});

describe('표시 헬퍼', () => {
  it('참가자 표시색은 id마다 결정론적이고 태그 팔레트 변수를 쓴다(raw hex 없음)', () => {
    const a = presenceCssVar({ participantId: 'p-1', name: '가' });
    expect(a).toMatch(/^var\(--tag-(red|orange|green|teal|violet|pink|brown)\)$/);
    expect(presenceCssVar({ participantId: 'p-1', name: '다른 이름' })).toBe(a); // 이름이 아니라 id로 정해진다
  });

  it('이니셜: 한글은 첫 글자, 영문은 대문자, 빈 이름은 물음표', () => {
    expect(initialOf('민수')).toBe('민');
    expect(initialOf('  alice')).toBe('A');
    expect(initialOf('')).toBe('?');
  });

  it('samePeers는 id·이름이 모두 같을 때만 같다', () => {
    expect(samePeers([{ id: 'a', name: 'A' }], [{ id: 'a', name: 'A' }])).toBe(true);
    expect(samePeers([{ id: 'a', name: 'A' }], [{ id: 'a', name: 'B' }])).toBe(false);
    expect(MAX_PEER_CHIPS).toBe(4);
  });
});
