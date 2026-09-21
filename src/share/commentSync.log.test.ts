// 코멘트 동기화 진단 로그: 기준선 초기화·검증 거부 집계만 남기고(코멘트 내용·이름 없음), 정상 코멘트마다 로그를 남기지 않는다.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { CommentAnchor } from '../types';
import { COMMENTS_MAP_NAME, createCommentSync } from './commentSync';
import { memSink } from './commentTestKit';

const ROOM = 'room-abcdef12';
const NODE: CommentAnchor = { kind: 'map', fileId: 'file-1', targetId: 'n1', label: '루트' };
const SECRET = 'SECRET-COMMENT-BODY-do-not-log';

async function start(o: { doc?: Y.Doc; hadSidecar?: boolean; baselines?: Record<string, number>; stateLost?: boolean } = {}) {
  const doc = o.doc ?? new Y.Doc();
  const lines: string[] = [];
  const clock = { t: 1_000_000 };
  const mem = memSink({ baselines: o.baselines, stateLost: o.stateLost });
  const sync = createCommentSync({
    roomId: ROOM,
    folderName: '기획',
    self: { participantId: 'me-participant-1', displayName: '지호', role: 'participant' },
    ydoc: doc,
    hadSidecar: o.hadSidecar ?? false,
    sink: mem.sink,
    now: () => clock.t,
    newId: () => `c${clock.t++}`,
    log: (level, message) => lines.push(`${level}: ${message}`),
  });
  await sync.start();
  const map = () => doc.getMap<unknown>(COMMENTS_MAP_NAME);
  return { doc, lines, clock, sync, mem, map };
}

const junk = (map: Y.Map<unknown>, n: number, prefix = 'junk') => {
  for (let i = 0; i < n; i++) map.set(`${prefix}-${i}`, { text: SECRET, anchor: 42, authorName: SECRET });
};

describe('기준선 초기화 로그', () => {
  it('이 기기의 첫 동기화(사이드카 없음)는 info, 쓰던 방인데 알림 상태가 손상돼 복구된 경우만 warn(recovered)', async () => {
    expect((await start()).lines).toEqual(['info: notification baseline initialized reason=first_sync']);
    expect((await start({ hadSidecar: true })).lines).toEqual(['info: notification baseline initialized reason=no_baseline']);
    expect((await start({ hadSidecar: true, stateLost: true })).lines).toEqual(['warn: notification baseline initialized reason=recovered']);
    // 새로 설치한 앱은 알림 파일이 없어 stateLost지만 처음 참가한 방이라 경고가 아니다.
    expect((await start({ hadSidecar: false, stateLost: true })).lines).toEqual(['info: notification baseline initialized reason=first_sync']);
  });

  it('기준선이 이미 있으면 아무것도 남기지 않는다', async () => {
    expect((await start({ hadSidecar: true, baselines: { [ROOM]: 5 } })).lines).toEqual([]);
  });
});

describe('정상 코멘트는 소음을 만들지 않는다', () => {
  it('내가 쓰거나 원격이 쓴 정상 코멘트·삭제에는 로그가 없다', async () => {
    const d = await start({ baselines: { [ROOM]: 1 } });
    for (let i = 0; i < 20; i++) expect(d.sync.add(NODE, `안녕 ${i}`).ok).toBe(true);
    d.map().set('remote-1', {
      id: 'remote-1',
      anchor: NODE,
      authorId: 'other-participant',
      authorName: '민수',
      text: '원격 코멘트',
      createdAt: 2_000_000,
    });
    d.map().delete('remote-1');
    expect(d.lines).toEqual([]);
  });
});

describe('원격 코멘트 검증 거부는 개수만 집계한다', () => {
  it('첫 거부는 바로, 이후는 60초 안에 모아 다음 창에 합계로 — 내용은 남기지 않는다', async () => {
    const d = await start({ baselines: { [ROOM]: 1 } });
    junk(d.map(), 1, 'a');
    expect(d.lines).toEqual(['warn: remote comments rejected by validation count=1']);
    junk(d.map(), 4, 'b'); // 같은 창 — 쌓기만 한다
    expect(d.lines).toHaveLength(1);
    d.clock.t += 61_000;
    junk(d.map(), 1, 'c');
    expect(d.lines).toEqual(['warn: remote comments rejected by validation count=1', 'warn: remote comments rejected by validation count=5']);
    expect(d.lines.join('\n')).not.toContain(SECRET);
  });

  it('검증을 통과하지 못한 항목이 시작 때(사이드카) 이미 들어 있으면 그 개수를 한 번 남긴다', async () => {
    const doc = new Y.Doc();
    junk(doc.getMap<unknown>(COMMENTS_MAP_NAME), 3);
    doc.getMap<unknown>(COMMENTS_MAP_NAME).set('__proto__', 'x'); // 안전하지 않은 키도 거부로 센다
    const d = await start({ doc, hadSidecar: true, baselines: { [ROOM]: 1 } });
    expect(d.lines).toEqual(['warn: remote comments rejected by validation count=4']);
  });

  it('지운 키나 정상 코멘트는 거부로 세지 않는다', async () => {
    const d = await start({ baselines: { [ROOM]: 1 } });
    junk(d.map(), 1, 'x'); // 거부 1
    d.clock.t += 61_000;
    d.map().delete('x-0'); // 삭제 이벤트
    d.sync.add(NODE, '정상');
    expect(d.lines).toEqual(['warn: remote comments rejected by validation count=1']);
  });
});
